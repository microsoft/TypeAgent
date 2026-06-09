// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { app, BrowserWindow, dialog, ipcMain, Notification } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    debugShell,
    debugShellCleanup,
    debugShellError,
    debugShellInit,
} from "./debug.js";
import { ShellSettingManager } from "./shellSettings.js";
import { createDispatcherRpcServer } from "@typeagent/dispatcher-rpc/dispatcher/server";
import { ShellWindow } from "./shellWindow.js";
import { createChannelAdapter } from "@typeagent/agent-rpc/channel";
import { getConsolePrompt } from "agent-dispatcher/helpers/console";
import {
    getDefaultAppAgentInstaller,
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
    getIndexingServiceRegistry,
} from "default-agent-provider";
import { getTraceId } from "agent-dispatcher/helpers/data";
import { createShellAgentProvider } from "./agent.js";
import { createInlineBrowserControl } from "./inlineBrowserControl.js";
import { BrowserAgentIpc } from "./browserIpc.js";
import {
    createLocalConversationBackend,
    createRemoteConversationBackend,
    registerConversationIpcHandlers,
} from "./conversationManager.js";
import {
    ClientIO,
    Dispatcher,
    PortRegistrar,
    QueuedRequest,
    QueueSnapshot,
    RequestId,
} from "agent-dispatcher";
import {
    createInProcessAgentServer,
    type InProcessAgentServer,
} from "agent-server/in-process";
import type { SubmitResult } from "@typeagent/dispatcher-types";
import { awaitCommand } from "@typeagent/dispatcher-types";
import { randomUUID } from "node:crypto";
import { getStatusSummary } from "agent-dispatcher/helpers/status";
import { setPendingUpdateCallback } from "./commands/update.js";
import { createClientIORpcClient } from "@typeagent/dispatcher-rpc/clientio/client";
import { isTest } from "./index.js";
import { getFsStorageProvider } from "dispatcher-node-providers";
import {
    ensureAgentServer,
    connectAgentServer,
    stopAgentServer,
    AGENT_SERVER_DEFAULT_PORT,
} from "@typeagent/agent-server-client";
import type { AgentServerConnection } from "@typeagent/agent-server-client";
import { joinNamedOrFallback } from "@typeagent/agent-server-client/conversation";
import {
    loadUserSettings,
    saveUserSettings,
} from "agent-dispatcher/helpers/userSettings";
import {
    startStandaloneDiscoveryServer,
    type StandaloneDiscoveryServer,
} from "./discoveryServer.js";

type ShellInstance = {
    shellWindow: ShellWindow;
    dispatcherP: Promise<InitResult | undefined>;
};

let instance: ShellInstance | undefined;
let cleanupP: Promise<void> | undefined;
let quitting: boolean = false;

type InitResult = {
    dispatcher: Dispatcher;
    clientIO: ClientIO;
    connection?: AgentServerConnection;
    initialConversationId?: string;
    initialConversationName?: string;
    initialQueueSnapshot?: QueueSnapshot;
    rebindDispatcher?: (freshDispatcher: Dispatcher) => void;
};

async function initializeDispatcher(
    instanceDir: string | undefined,
    shellWindow: ShellWindow,
    updateSummary: (dispatcher: Dispatcher) => Promise<string>,
    startTime: number,
    connect?: number,
    hidden?: boolean,
    idleTimeout?: number,
): Promise<InitResult | undefined> {
    if (cleanupP !== undefined) {
        // Make sure the previous cleanup is done.
        await cleanupP;
    }
    // Hoisted above the try{} so the catch can clean up an already-bound
    // discovery WS if a later step (createDispatcher, etc.) throws —
    // otherwise the listening socket on AGENT_SERVER_DEFAULT_PORT would
    // leak across re-init attempts and block the next launch with
    // EADDRINUSE.
    let standaloneDiscovery: StandaloneDiscoveryServer | undefined;
    try {
        const clientIOChannel = createChannelAdapter((message: any) => {
            shellWindow.chatView.webContents.send("clientio-rpc-call", message);
        });
        const onClientIORpcReply = (event, message) => {
            if (getShellWindowForChatViewIpcEvent(event) !== shellWindow) {
                return;
            }
            clientIOChannel.notifyMessage(message);
        };
        ipcMain.on("clientio-rpc-reply", onClientIORpcReply);

        const newClientIO = createClientIORpcClient(clientIOChannel.channel);
        const clientIO: ClientIO = {
            ...newClientIO,
            // Main process intercepted clientIO calls
            question: async (
                requestId: RequestId | undefined,
                message: string,
                choices: string[],
                defaultId?: number,
            ) => {
                // If a requestId is present, the question is tied to an active request
                // and should be displayed in the chat view (renderer) so tests and the
                // UI can observe it.  Only fall back to a native dialog for broadcast
                // questions (no requestId).
                if (requestId !== undefined) {
                    return newClientIO.question(
                        requestId,
                        message,
                        choices,
                        defaultId,
                    );
                }
                const result = await dialog.showMessageBox(
                    shellWindow.mainWindow,
                    {
                        type: "question",
                        buttons: choices,
                        defaultId,
                        message,
                    },
                );
                return result.response;
            },
            openLocalView: async (_: RequestId, port: number) => {
                debugShell(`Opening local view on port ${port}`);
                shellWindow.createBrowserTab(
                    new URL(`http://localhost:${port}/`),
                    { background: false },
                );
            },
            closeLocalView: async (_: RequestId, port: number) => {
                const targetUrl = `http://localhost:${port}/`;
                debugShell(
                    `Closing local view on port ${port}, target url: ${targetUrl}`,
                );

                // Find and close the tab with the matching URL
                const allTabs = shellWindow.getAllBrowserTabs();
                const matchingTab = allTabs.find(
                    (tab) => tab.url === targetUrl,
                );

                if (matchingTab) {
                    shellWindow.closeBrowserTab(matchingTab.id);
                    debugShell(`Closed tab with URL: ${targetUrl}`);
                } else {
                    debugShell(`No tab found with URL: ${targetUrl}`);
                }
            },
            exit: () => {
                app.quit();
            },
            shutdown: () => {
                if (connection !== undefined) {
                    connection
                        .shutdown()
                        .catch(() => {
                            // Graceful failed — force kill via PID file
                            return stopAgentServer(connect!, true);
                        })
                        .catch(() => {
                            // Best-effort: server may already be stopped.
                        })
                        .finally(() => {
                            app.quit();
                        });
                } else {
                    app.quit();
                }
            },
        };

        const browserControl = createInlineBrowserControl(shellWindow);

        // Set up dispatcher
        // Use 'let' so that session switches can rebind the active dispatcher.
        // Definite-assignment (!) because it is assigned inside the shared
        // restoreOrJoinShellConversation() closure on every success path; if
        // that throws we fall through to the catch block and never read it.
        let newDispatcher!: Dispatcher;
        let connection: AgentServerConnection | undefined;
        let inProcessServer: InProcessAgentServer | undefined;
        let initialConversationId: string | undefined;
        let initialConversationName: string | undefined;
        // Bootstrap snapshot from joinConversation (remote mode only).
        let initialQueueSnapshot: QueueSnapshot | undefined;

        // Restore the last-open conversation (or find-or-create the default
        // "Shell" conversation) and join it. Shared by both the embedded
        // in-process agent server (standalone) and the remote agent server
        // (--connect) so there is a single conversation join code path.
        async function restoreOrJoinShellConversation(
            conn: AgentServerConnection,
        ): Promise<void> {
            const SHELL_CONVERSATION_NAME = "Shell";
            const savedConversationId = loadUserSettings().conversation
                .lastConversationId as string | undefined;

            const result = await joinNamedOrFallback(conn, clientIO, {
                ...(savedConversationId ? { savedConversationId } : {}),
                defaultName: SHELL_CONVERSATION_NAME,
                onSavedConversationUnavailable: (e) => {
                    debugShellInit(
                        "Failed to restore last conversation, falling back:",
                        savedConversationId,
                        (e as { message?: string })?.message ?? String(e),
                    );
                },
            });

            const conversation = result.conversation;
            newDispatcher = conversation.dispatcher;
            initialConversationId = conversation.conversationId;
            initialConversationName = conversation.name;
            initialQueueSnapshot = conversation.queueSnapshot;
            if (result.usedSavedId) {
                debugShellInit(
                    "Restored last conversation",
                    conversation.conversationId,
                );
            }
            try {
                saveUserSettings({
                    conversation: {
                        lastConversationId: conversation.conversationId,
                    },
                });
            } catch (e: any) {
                debugShellInit(
                    "Failed to persist lastConversationId:",
                    e.message,
                );
            }
        }

        if (connect !== undefined) {
            // Connect to remote dispatcher — use connectAgentServer directly
            // so we retain the connection reference for multi-session support.
            const userSettings = loadUserSettings();
            const effectiveHidden = hidden ?? userSettings.server.hidden;
            const effectiveIdleTimeout =
                idleTimeout !== undefined
                    ? idleTimeout
                    : userSettings.server.idleTimeout;
            await ensureAgentServer(
                connect,
                effectiveHidden,
                effectiveIdleTimeout,
            );
            const url = `ws://localhost:${connect}`;

            // Reconnect state. When the WebSocket drops we attempt a few
            // backoff retries before giving up and surfacing the modal
            // "Disconnected" dialog. This keeps the shell alive across
            // brief server hiccups (server restart, transient network
            // blip when running with --connect to a remote host).
            // Backoff schedule mirrors the vscode-shell extension's
            // AgentServerBridge.scheduleReconnect (4/6/8/...30s cap).
            const MAX_RECONNECT_ATTEMPTS = 12; // ~5 minutes total at the 30s cap
            let reconnectAttempt = 0;
            let reconnecting = false;
            let onConnectionLost: (() => void) | undefined;

            const giveUpAndQuit = (msg: string): void => {
                broadcastReconnect(undefined);
                dialog.showErrorBox(
                    "Disconnected",
                    `The connection to the dispatcher was lost and could not be re-established.\n\n${msg}`,
                );
                app.quit();
            };

            const broadcastReconnect = (message: string | undefined): void => {
                try {
                    if (!shellWindow.chatView.webContents.isDestroyed()) {
                        shellWindow.chatView.webContents.send(
                            "reconnect-status",
                            message,
                        );
                    }
                } catch (e: any) {
                    debugShellInit(
                        "broadcastReconnect failed:",
                        e?.message ?? e,
                    );
                }
            };

            const attemptReconnect = async (): Promise<void> => {
                if (quitting || reconnecting) return;
                reconnecting = true;
                try {
                    while (
                        !quitting &&
                        reconnectAttempt < MAX_RECONNECT_ATTEMPTS
                    ) {
                        reconnectAttempt++;
                        const backoffSec = Math.min(
                            30,
                            2 + reconnectAttempt * 2,
                        );
                        debugShellInit(
                            `Reconnect attempt ${reconnectAttempt} in ${backoffSec}s`,
                        );
                        // Countdown banner (updated every second so the user
                        // sees the time tick down instead of a static label).
                        for (let s = backoffSec; s > 0 && !quitting; s--) {
                            broadcastReconnect(
                                `Disconnected — retrying in ${s}s (attempt ${reconnectAttempt})`,
                            );
                            await new Promise((r) => setTimeout(r, 1000));
                        }
                        if (quitting) return;
                        broadcastReconnect(
                            `Disconnected — connecting (attempt ${reconnectAttempt})…`,
                        );
                        try {
                            // NOTE: deliberately do NOT call ensureAgentServer
                            // here — auto-spawning a replacement server in a
                            // new window is surprising when the user killed it
                            // intentionally. Just try to reconnect to the
                            // existing one; if it's gone we keep retrying.
                            const fresh = await connectAgentServer(url, () =>
                                onConnectionLost?.(),
                            );
                            // Re-join the conversation we were on. Read the
                            // latest saved conversation id from userSettings
                            // — switchConversation writes it on every switch
                            // and the initial join writes it too, so this is
                            // always up to date as a single source of truth.
                            const targetConversationId = (loadUserSettings()
                                .conversation.lastConversationId ??
                                initialConversationId) as string | undefined;
                            let freshConversation:
                                | Awaited<
                                      ReturnType<typeof fresh.joinConversation>
                                  >
                                | undefined;
                            if (targetConversationId) {
                                try {
                                    freshConversation =
                                        await fresh.joinConversation(clientIO, {
                                            conversationId:
                                                targetConversationId,
                                        });
                                } catch (e: any) {
                                    debugShellInit(
                                        "Reconnect: saved conversation gone, falling back to default Shell:",
                                        e.message,
                                    );
                                }
                            }
                            if (freshConversation === undefined) {
                                // Fall back to the default Shell conversation.
                                const list =
                                    await fresh.listConversations("Shell");
                                const m = list.find(
                                    (s) => s.name.toLowerCase() === "shell",
                                );
                                const id =
                                    m?.conversationId ??
                                    (await fresh.createConversation("Shell"))
                                        .conversationId;
                                freshConversation =
                                    await fresh.joinConversation(clientIO, {
                                        conversationId: id,
                                    });
                            }
                            connection = fresh;
                            rebindDispatcher(freshConversation.dispatcher);
                            reconnectAttempt = 0;
                            broadcastReconnect(undefined);
                            debugShellInit("Reconnected to dispatcher");
                            return;
                        } catch (e: any) {
                            debugShellInit(
                                `Reconnect attempt ${reconnectAttempt} failed: ${e.message}`,
                            );
                            // continue loop
                        }
                    }
                    if (!quitting) {
                        giveUpAndQuit(
                            `Tried ${reconnectAttempt} times without success.`,
                        );
                    }
                } finally {
                    reconnecting = false;
                }
            };

            onConnectionLost = () => {
                if (quitting) return;
                debugShellInit(
                    "Dispatcher connection lost; will attempt to reconnect.",
                );
                broadcastReconnect("Disconnected — preparing to reconnect…");
                void attemptReconnect();
            };

            connection = await connectAgentServer(url, () =>
                onConnectionLost?.(),
            );
            // Find-or-create the default "Shell" conversation, matching CLI
            // behavior. Shared with the standalone (embedded) path.
            await restoreOrJoinShellConversation(connection);
            // Note: connection.close() is called by closeDispatcher() on
            // shutdown, so no override here — it would double-close the WebSocket.

            debugShellInit(
                "Connected to remote dispatcher",
                performance.now() - startTime,
            );
        } else {
            if (!instanceDir) {
                throw new Error(
                    "instanceDir is required when not in connect mode",
                );
            }
            const configName = isTest ? "test" : undefined;
            const indexingServiceRegistry = await getIndexingServiceRegistry(
                instanceDir,
                configName,
            );

            // Standalone shell hosts its own dispatcher in-process. Pre-build
            // a PortRegistrar so we can hand the same instance to both the
            // dispatcher (where agents register their dynamically assigned
            // ports) and the discovery WS server below (which reads from it
            // to answer external lookups). Without this shared instance, the
            // dispatcher would silently make its own private registrar and
            // the Chrome extension's discoverPort lookup would never find
            // the browser agent's port.
            const portRegistrar = new PortRegistrar();

            // Stand up the discovery WS so the Chrome extension (and any
            // other external client speaking the agent-server discovery
            // protocol) can find in-process agents at parity with what
            // they get when connecting to a real agent-server. Bind is
            // exact on AGENT_SERVER_DEFAULT_PORT (8999): an EADDRINUSE
            // here usually means a real agent-server is already running,
            // and silently picking a random port would only confuse the
            // user (their default-configured extension would still fail).
            try {
                standaloneDiscovery = await startStandaloneDiscoveryServer(
                    AGENT_SERVER_DEFAULT_PORT,
                    portRegistrar,
                );
            } catch (e) {
                debugShellError(
                    "Failed to start standalone discovery server on port %d: %s. External clients (e.g. Chrome extension) will not be able to discover in-process agent ports.",
                    AGENT_SERVER_DEFAULT_PORT,
                    (e as Error).message,
                );
            }

            // Standalone shell embeds an agent server in this process and
            // connects to it over an in-memory loopback — the exact same
            // ConversationManager / dispatcher code path as --connect, just
            // without a WebSocket. This keeps a single dispatcher path and
            // makes conversation history persist across restarts the same way
            // the remote agent server does.
            inProcessServer = await createInProcessAgentServer(
                "shell",
                {
                    appAgentProviders: [
                        createShellAgentProvider(shellWindow),
                        ...getDefaultAppAgentProviders(instanceDir, configName),
                    ],
                    agentInitOptions: {
                        browser: browserControl.control,
                    },
                    portRegistrar,
                    agentInstaller: getDefaultAppAgentInstaller(instanceDir),
                    persistSession: true,
                    storageProvider: getFsStorageProvider(),
                    metrics: true,
                    dblogging: true,
                    traceId: getTraceId(),
                    indexingServiceRegistry,
                    constructionProvider: getDefaultConstructionProvider(),
                    allowSharedLocalView: ["browser"],
                },
                instanceDir,
                {
                    shutdown: () => {
                        app.quit();
                    },
                },
            );
            connection = inProcessServer.connection;
            await restoreOrJoinShellConversation(connection);
        }

        async function processShellRequest(
            text: string,
            attachments?: string[],
            options?: any,
            id?: unknown,
            requestId?: string,
        ): Promise<SubmitResult> {
            if (typeof text !== "string") {
                throw new Error("Invalid request");
            }

            // In agent-server connect mode the shell agent is not registered
            // with the remote dispatcher (it lives only in this Electron
            // process), so commands like "@shell run" can't be routed to it.
            // Intercept the demo-runner commands locally so they continue
            // to work regardless of connect mode.
            const trimmed = text.trim();
            if (
                trimmed === "@shell run" ||
                trimmed === "@shell run interactive"
            ) {
                shellWindow.runDemo(trimmed.endsWith("interactive"));
                shellWindow.chatView.webContents.send(
                    "send-demo-event",
                    "CommandProcessed",
                );
                // Synthesize a QueuedRequest for the local short-circuit.
                // NOTE: this entry is NOT enqueued in context.requestQueue —
                // queue snapshots, lifecycle events, and DisplayLog audit
                // intentionally do not reflect it.
                const submittedAt = Date.now();
                const synthRequestId = requestId ?? randomUUID();
                const synthEntry: QueuedRequest = {
                    requestId: synthRequestId,
                    // Sentinel — searchable in logs; never collides with a
                    // real connection id assigned by SharedDispatcher.
                    originatorConnectionId:
                        dispatcher.connectionId ?? "shell-local-shortcircuit",
                    text,
                    submittedAt,
                    startedAt: submittedAt,
                    finishedAt: submittedAt,
                    state: "succeeded",
                    attachmentCount: attachments?.length ?? 0,
                };
                if (id !== undefined) synthEntry.clientRequestId = id;
                if (options !== undefined) synthEntry.options = options;
                // Fire commandComplete explicitly: the short-circuit bypasses
                // commandHandlerContext (which normally emits it), and renderer
                // awaiters wake via wrapClientIOForCompletion intercepting this
                // notify. Without it, RPC clients' completion promises hang.
                const completeRid: RequestId = {
                    requestId: synthRequestId,
                    clientRequestId: id,
                };
                clientIO.notify(
                    completeRid,
                    "commandComplete",
                    { result: null },
                    "shell",
                );
                return {
                    ok: true,
                    entry: {
                        ...synthEntry,
                        completion: Promise.resolve(undefined),
                    },
                };
            }

            // Update before processing the command in case there was change outside of command processing
            const summary = await updateSummary(dispatcher);

            if (debugShell.enabled) {
                debugShell(getConsolePrompt(summary), text);
            }

            const submit = await newDispatcher.submitCommand(
                text,
                attachments,
                options,
                id,
                requestId,
            );
            if (!submit.ok) {
                return submit;
            }
            const completion = submit.entry.completion.then(async (result) => {
                shellWindow.chatView.webContents.send(
                    "send-demo-event",
                    "CommandProcessed",
                );
                // Give the chat view the focus back after the command for the next command.
                shellWindow.chatView.webContents.focus();
                // Update the summary after processing the command in case state changed.
                await updateSummary(dispatcher);
                return result;
            });
            return {
                ok: true,
                entry: { ...submit.entry, completion },
            };
        }

        // Shared close handler — tears down RPC channels and releases resources.
        // Uses late-bound references so it always closes the current newDispatcher.
        async function closeDispatcher(): Promise<void> {
            ipcMain.removeListener("dispatcher-rpc-call", onDispatcherRpcCall);
            dispatcherChannel.notifyDisconnected();
            await newDispatcher.close();
            // In remote mode, newDispatcher.close() only calls leaveSession()
            // after a session switch (the override set in rebindDispatcher's
            // caller). The underlying WebSocket connection must be closed
            // explicitly here so the process doesn't leak it on shutdown.
            if (inProcessServer !== undefined) {
                // Standalone embedded server: closing this also tears down the
                // loopback transport and the ConversationManager (flushing any
                // pending display-log writes).
                await inProcessServer.close();
            } else if (connection !== undefined) {
                await connection.close();
            }
            if (standaloneDiscovery !== undefined) {
                standaloneDiscovery.close();
                standaloneDiscovery = undefined;
            }
            clientIOChannel.notifyDisconnected();
            ipcMain.removeListener("clientio-rpc-reply", onClientIORpcReply);
            browserControl.close();
        }

        const dispatcher = {
            ...newDispatcher,
            submitCommand: processShellRequest,
            close: closeDispatcher,
        };

        /**
         * Rebind the dispatcher object in-place after a session switch.
         *
         * WHY IN-PLACE: The RPC server (createDispatcherRpcServer) captures a
         * reference to `dispatcher` at startup and routes all renderer calls
         * through it.  Replacing `dispatcher` with a new object would leave the
         * RPC server pointing at the old, stale instance.  Instead we mutate the
         * existing object so the RPC server always sees the current session's
         * methods without needing to restart or be re-initialised.
         *
         * LIMITATION: Object.assign() only copies own, enumerable properties.
         * If the Dispatcher interface ever gains non-enumerable or Symbol-keyed
         * members, those won't be copied and the rebind will silently skip them.
         * If the RPC server is ever changed to hold a copy of the dispatcher
         * rather than a live reference, this pattern will break — update both
         * together.
         */
        function rebindDispatcher(freshDispatcher: Dispatcher): void {
            newDispatcher = freshDispatcher;
            // Copy all properties from the new dispatcher onto the existing
            // object so the RPC server sees updated method implementations.
            Object.assign(dispatcher, freshDispatcher);
            // Re-apply shell-specific overrides that must wrap the dispatcher.
            dispatcher.submitCommand = processShellRequest;
            dispatcher.close = closeDispatcher;
            debugShell("Dispatcher rebound after session switch");
        }

        // Set up the RPC
        const dispatcherChannel = createChannelAdapter((message: any) => {
            shellWindow.chatView.webContents.send(
                "dispatcher-rpc-reply",
                message,
            );
        });
        const onDispatcherRpcCall = (event, message) => {
            if (getShellWindowForChatViewIpcEvent(event) !== shellWindow) {
                return;
            }
            dispatcherChannel.notifyMessage(message);
        };
        ipcMain.on("dispatcher-rpc-call", onDispatcherRpcCall);
        createDispatcherRpcServer(dispatcher, dispatcherChannel.channel);

        debugShellInit("Dispatcher initialized", performance.now() - startTime);

        return {
            dispatcher,
            clientIO,
            connection,
            initialConversationId,
            initialConversationName,
            initialQueueSnapshot,
            rebindDispatcher,
        };
    } catch (e: any) {
        // Tear down the discovery WS if it was already bound before the
        // failure — otherwise port AGENT_SERVER_DEFAULT_PORT stays held
        // by this process and the next shell launch hits EADDRINUSE.
        if (standaloneDiscovery !== undefined) {
            standaloneDiscovery.close();
        }
        if (isTest) {
            // In test mode, avoid blocking dialogs so the process can exit cleanly
            console.error("Exception initializing dispatcher:", e.stack);
        } else {
            dialog.showErrorBox("Exception initializing dispatcher", e.stack);
        }
        return undefined;
    }
}

export function initializeInstance(
    instanceDir: string | undefined,
    shellSettings: ShellSettingManager,
    mockGreetings: boolean,
    inputOnly: boolean = false,
    startTime: number = performance.now(),
    connect?: number,
    hidden?: boolean,
    idleTimeout?: number,
    _resume?: boolean, // reserved: shell conversation resume not yet implemented
) {
    if (instance !== undefined) {
        throw new Error("Instance already initialized");
    }

    debugShellInit(
        "Start initializing Instance",
        performance.now() - startTime,
    );

    const shellWindow = new ShellWindow(shellSettings, inputOnly);

    // Register conversation management IPC handlers (local-only backend for now;
    // remote backend would be wired in when connect mode gains multi-conversation).
    const conversationBackend = createLocalConversationBackend();
    let cleanupConversationIpc =
        registerConversationIpcHandlers(conversationBackend);

    // Watch user-settings.json so that changes made via @settings (e.g. from the
    // CLI or NL) hot-reload shell settings immediately without a restart.
    // The file may not exist yet if the user has never changed a setting.
    const userSettingsPath = path.join(
        os.homedir(),
        ".typeagent",
        "user-settings.json",
    );
    let userSettingsWatcher: fs.FSWatcher | undefined;
    const startUserSettingsWatcher = () => {
        userSettingsWatcher?.close();
        userSettingsWatcher = undefined;
        if (!fs.existsSync(userSettingsPath)) {
            return;
        }
        userSettingsWatcher = fs.watch(userSettingsPath, () => {
            try {
                const updated = loadUserSettings();
                shellWindow.setUserSettingValue(
                    "partialCompletion",
                    updated.ui.autoComplete,
                );
            } catch {
                // Ignore transient read errors during file write
            }
        });
    };
    startUserSettingsWatcher();
    // Watch the directory too so we catch the file being created for the first time
    const userSettingsDirWatcher = fs.watch(
        path.join(os.homedir(), ".typeagent"),
        (event, filename) => {
            if (filename === "user-settings.json" && event === "rename") {
                startUserSettingsWatcher();
            }
        },
    );

    // Set up notification callback for browser agent IPC early,
    // so messages queued during tab restoration can trigger notifications
    BrowserAgentIpc.getinstance().onSendNotification = (
        message: string,
        id: string,
    ) => {
        shellWindow.sendSystemNotification(message, id);
    };

    const { chatView } = shellWindow;
    let title: string = "";
    async function updateTitle(dispatcher: Dispatcher) {
        const status = await dispatcher.getStatus();

        const newSettingSummary = getStatusSummary(status);
        const newTitle = app.getName();
        if (newTitle !== title) {
            title = newTitle;
            shellWindow.updateSummary(
                newTitle,
                status.agents.map((agent) => [agent.name, agent.emoji]),
            );
        }

        return newSettingSummary;
    }

    // Note: Make sure dom ready before using dispatcher.
    const dispatcherP = initializeDispatcher(
        instanceDir,
        shellWindow,
        updateTitle,
        startTime,
        connect,
        hidden,
        idleTimeout,
    );

    const onChatViewReady = async (event: Electron.IpcMainEvent) => {
        const eventWindow = getShellWindowForChatViewIpcEvent(event);
        if (eventWindow !== shellWindow) {
            return;
        }
        ipcMain.removeListener("chat-view-ready", onChatViewReady);
        debugShellInit("Showing window", performance.now() - startTime);

        // The dispatcher can be use now that dom is ready and the client is ready to receive messages
        const result = await dispatcherP;
        if (result === undefined) {
            app.quit();
            return;
        }
        const {
            dispatcher,
            clientIO,
            connection,
            initialConversationId,
            initialConversationName,
            initialQueueSnapshot,
            rebindDispatcher,
        } = result;

        // If connected to a remote server, wire up the remote conversation backend
        // and replace the local-only IPC handlers.
        if (
            connection !== undefined &&
            initialConversationId !== undefined &&
            initialConversationName !== undefined
        ) {
            // Remove local handlers first — ipcMain.handle() throws if a
            // channel already has a handler, and both operations are synchronous
            // so there is no async gap between remove and re-register.
            cleanupConversationIpc();
            const remoteBackend = createRemoteConversationBackend(
                connection,
                clientIO,
                initialConversationId,
                initialConversationName,
                (conversationId, name, queueSnapshot) => {
                    shellWindow.sendConversationChanged(
                        conversationId,
                        name,
                        queueSnapshot,
                    );
                },
                rebindDispatcher,
            );
            cleanupConversationIpc =
                registerConversationIpcHandlers(remoteBackend);

            // Notify renderer of the initial conversation
            shellWindow.sendConversationChanged(
                initialConversationId,
                initialConversationName,
            );

            updateTitle(dispatcher);
            setPendingUpdateCallback((version, background) => {
                updateTitle(dispatcher);
                if (background) {
                    new Notification({
                        title: `New version ${version.version} available`,
                        body: `Restart to install the update.`,
                    }).show();
                }
            });

            // Notify the renderer process that the dispatcher is initialized.
            // Capture the current display-log cutoff *before* dispatching the
            // startup greeting so the renderer's (async) history replay can
            // exclude the greeting and only render genuine prior history.
            const historyCutoffSeq = await getHistoryCutoffSeq(dispatcher);
            chatView.webContents.send(
                "dispatcher-initialized",
                initialQueueSnapshot,
                historyCutoffSeq,
            );

            // Give focus to the chat view once initialization is done.
            chatView.webContents.focus();

            // History replay is handled entirely renderer-side: the
            // `dispatcher-initialized` event (sent above) drives the bridge's
            // replayDisplayHistory(), which fetches the dispatcher's structured
            // display history and renders it through chatPanel.replayHistory()
            // (grayed, with a "now" separator banner). The main process no
            // longer re-emits history through clientIO.

            // send the agent greeting if it's turned on
            if (shellSettings.user.agentGreeting) {
                awaitCommand(
                    dispatcher,
                    `@greeting${mockGreetings ? " --mock" : ""}`,
                    [],
                    undefined,
                    "agent-0",
                )
                    .then((result) => {
                        // Forward completion so the renderer can finalize the
                        // greeting's metrics bubble — server-initiated requests
                        // don't go through the renderer's completeRequest path.
                        chatView.webContents.send(
                            "request-completed",
                            "agent-0",
                            result,
                        );
                    })
                    .catch((e: any) => {
                        debugShell("Initial greeting failed:", e?.message ?? e);
                    });
            }
            return;
        }

        updateTitle(dispatcher).catch((e: any) => {
            debugShell("Initial updateTitle failed:", e?.message ?? e);
        });
        setPendingUpdateCallback((version, background) => {
            updateTitle(dispatcher).catch((e: any) => {
                debugShell(
                    "updateTitle on pending update failed:",
                    e?.message ?? e,
                );
            });
            if (background) {
                new Notification({
                    title: `New version ${version.version} available`,
                    body: `Restart to install the update.`,
                }).show();
            }
        });

        // Notify the renderer process that the dispatcher is initialized
        // (standalone path: no queue snapshot). Capture the display-log
        // cutoff before the startup greeting so history replay excludes it.
        const historyCutoffSeq = await getHistoryCutoffSeq(dispatcher);
        chatView.webContents.send(
            "dispatcher-initialized",
            undefined,
            historyCutoffSeq,
        );

        // Give focus to the chat view once initialization is done.
        chatView.webContents.focus();

        // send the agent greeting if it's turned on
        if (shellSettings.user.agentGreeting) {
            awaitCommand(
                dispatcher,
                `@greeting${mockGreetings ? " --mock" : ""}`,
                [],
                undefined,
                "agent-0",
            )
                .then((result) => {
                    // Forward completion so the renderer can finalize the
                    // greeting's metrics bubble — server-initiated requests
                    // don't go through the renderer's completeRequest path.
                    chatView.webContents.send(
                        "request-completed",
                        "agent-0",
                        result,
                    );
                })
                .catch((e: any) => {
                    debugShell("Initial greeting failed:", e?.message ?? e);
                });
        }
    };
    ipcMain.on("chat-view-ready", onChatViewReady);

    shellWindow.mainWindow.on("closed", () => {
        ensureCleanupInstance();
        cleanupConversationIpc();
        userSettingsWatcher?.close();
        userSettingsDirWatcher.close();
        ipcMain.removeListener("chat-view-ready", onChatViewReady);
    });

    shellWindow.waitForReady().catch(fatal);
    instance = { shellWindow, dispatcherP };
    return shellWindow;
}

export function fatal(e: Error) {
    dialog.showErrorBox("Error starting shell", e.stack ?? e.message);
    app.quit();
}

/**
 * Capture the last display-log sequence number currently persisted, used as
 * the cutoff for the renderer's connect-time history replay. Capturing this
 * before dispatching the startup greeting ensures the greeting (which is
 * logged into the same display log) is not pulled into the grayed history by
 * the renderer's asynchronous `getDisplayHistory()` fetch. Best-effort:
 * returns 0 (replay everything) if history can't be read.
 */
async function getHistoryCutoffSeq(dispatcher: Dispatcher): Promise<number> {
    try {
        const history = await dispatcher.getDisplayHistory();
        // seq starts at 0; use -1 for an empty log so a first-ever greeting
        // (which would be logged at seq 0) is excluded from replay.
        return history.length > 0 ? history[history.length - 1].seq : -1;
    } catch {
        return -1;
    }
}

async function cleanupInstance() {
    if (instance === undefined) {
        return undefined;
    }

    debugShellCleanup("Closing dispatcher");
    try {
        const { dispatcherP } = instance;
        instance = undefined;
        const result = await dispatcherP;
        if (result) {
            await result.dispatcher.close();
        }
        cleanupP = undefined;

        debugShellCleanup("Cleaned up instance");
    } catch (e: any) {
        if (quitting) {
            debugShellError("Error closing instance", e);
        } else {
            dialog.showErrorBox("Error closing instance", e.stack);
            app.quit();
        }
    }
}

async function ensureCleanupInstance() {
    if (cleanupP === undefined) {
        cleanupP = cleanupInstance();
    }
    return cleanupP;
}

export async function closeInstance(quit: boolean = false) {
    if (quit) {
        quitting = true;
    }
    if (instance === undefined) {
        return;
    }

    debugShellCleanup("Closing window");
    const shellWindow = instance.shellWindow;

    // Close the window first without clearing the instance
    await shellWindow.close();

    // Ensure the instance is fulling cleaned up.
    return ensureCleanupInstance();
}

export function getShellWindow(): ShellWindow | undefined {
    return instance?.shellWindow;
}

export function getShellWindowForIpcEvent(
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
): ShellWindow | undefined {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    if (mainWindow === undefined) {
        return undefined;
    }
    const shellWindow = getShellWindow();
    return shellWindow?.mainWindow === mainWindow ? shellWindow : undefined;
}

export function getShellWindowForMainWindowIpcEvent(
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
): ShellWindow | undefined {
    const shellWindow = getShellWindow();
    return event.sender === shellWindow?.mainWindow.webContents
        ? shellWindow
        : undefined;
}

// Returns the shell window for IPC events from the current chat view.
export function getShellWindowForChatViewIpcEvent(
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
): ShellWindow | undefined {
    const shellWindow = getShellWindow();
    return event.sender === shellWindow?.chatView.webContents
        ? shellWindow
        : undefined;
}
