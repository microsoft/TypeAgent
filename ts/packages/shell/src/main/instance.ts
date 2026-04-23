// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { app, BrowserWindow, dialog, ipcMain, Notification } from "electron";
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
    replayDisplayHistory,
} from "./conversationManager.js";
import {
    ClientIO,
    createDispatcher,
    Dispatcher,
    RequestId,
} from "agent-dispatcher";
import { getStatusSummary } from "agent-dispatcher/helpers/status";
import { setPendingUpdateCallback } from "./commands/update.js";
import { createClientIORpcClient } from "@typeagent/dispatcher-rpc/clientio/client";
import { isTest } from "./index.js";
import { getFsStorageProvider } from "dispatcher-node-providers";
import {
    ensureAgentServer,
    connectAgentServer,
    stopAgentServer,
} from "@typeagent/agent-server-client";
import type { AgentServerConnection } from "@typeagent/agent-server-client";
import { loadUserSettings } from "agent-dispatcher/helpers/userSettings";

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
        let newDispatcher: Dispatcher;
        let connection: AgentServerConnection | undefined;
        let initialConversationId: string | undefined;
        let initialConversationName: string | undefined;
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
            connection = await connectAgentServer(url, () => {
                if (!quitting) {
                    dialog.showErrorBox(
                        "Disconnected",
                        "The connection to the dispatcher was lost.",
                    );
                    app.quit();
                }
            });
            // Find-or-create the default "Shell" conversation, matching CLI behavior.
            const SHELL_CONVERSATION_NAME = "Shell";
            const existing = await connection.listConversations(
                SHELL_CONVERSATION_NAME,
            );
            const match = existing.find(
                (s) =>
                    s.name.toLowerCase() ===
                    SHELL_CONVERSATION_NAME.toLowerCase(),
            );
            const shellConversationId =
                match !== undefined
                    ? match.conversationId
                    : (
                          await connection.createConversation(
                              SHELL_CONVERSATION_NAME,
                          )
                      ).conversationId;
            let conversation: Awaited<
                ReturnType<typeof connection.joinConversation>
            >;
            try {
                conversation = await connection.joinConversation(clientIO, {
                    conversationId: shellConversationId,
                });
            } catch (e: any) {
                // The conversation may have been deleted between listConversations and
                // joinConversation (race condition). Fall back to creating a fresh one.
                debugShellInit(
                    "joinConversation failed for Shell conversation, creating new one:",
                    e.message,
                );
                const fresh = await connection.createConversation(
                    SHELL_CONVERSATION_NAME,
                );
                conversation = await connection.joinConversation(clientIO, {
                    conversationId: fresh.conversationId,
                });
            }
            newDispatcher = conversation.dispatcher;
            initialConversationId = conversation.conversationId;
            initialConversationName = conversation.name;
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

            newDispatcher = await createDispatcher("shell", {
                appAgentProviders: [
                    createShellAgentProvider(shellWindow),
                    ...getDefaultAppAgentProviders(instanceDir, configName),
                ],
                agentInitOptions: {
                    browser: browserControl.control,
                },
                agentInstaller: getDefaultAppAgentInstaller(instanceDir),
                persistSession: true,
                persistDir: instanceDir,
                storageProvider: getFsStorageProvider(),
                metrics: true,
                dblogging: true,
                traceId: getTraceId(),
                clientIO,
                indexingServiceRegistry,
                constructionProvider: getDefaultConstructionProvider(),
                allowSharedLocalView: ["browser"],
            });
        }

        async function processShellRequest(
            text: string,
            id: string,
            images: string[],
        ) {
            if (typeof text !== "string" || typeof id !== "string") {
                throw new Error("Invalid request");
            }

            // Update before processing the command in case there was change outside of command processing
            const summary = await updateSummary(dispatcher);

            if (debugShell.enabled) {
                debugShell(getConsolePrompt(summary), text);
            }

            const commandResult = await newDispatcher.processCommand(
                text,
                id,
                images,
            );
            shellWindow.chatView.webContents.send(
                "send-demo-event",
                "CommandProcessed",
            );

            // Give the chat view the focus back after the command for the next command.
            shellWindow.chatView.webContents.focus();

            // Update the summary after processing the command in case state changed.
            await updateSummary(dispatcher);
            return commandResult;
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
            if (connection !== undefined) {
                await connection.close();
            }
            clientIOChannel.notifyDisconnected();
            ipcMain.removeListener("clientio-rpc-reply", onClientIORpcReply);
            browserControl.close();
        }

        const dispatcher = {
            ...newDispatcher,
            processCommand: processShellRequest,
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
            dispatcher.processCommand = processShellRequest;
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
            rebindDispatcher,
        };
    } catch (e: any) {
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
                (conversationId, name) => {
                    shellWindow.sendConversationChanged(conversationId, name);
                },
                rebindDispatcher,
                () => shellWindow.sendMarkHistory(),
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

            // Notify the renderer process that the dispatcher is initialized
            chatView.webContents.send("dispatcher-initialized");

            // Give focus to the chat view once initialization is done.
            chatView.webContents.focus();

            // Clear the stale local HTML snapshot and replay the server's
            // authoritative display history, just as switchConversation does.
            clientIO.clear({
                requestId: "",
                clientRequestId: "initial-connect",
            });
            await replayDisplayHistory(
                dispatcher,
                clientIO,
                initialConversationName,
                () => shellWindow.sendMarkHistory(),
            );

            // send the agent greeting if it's turned on
            if (shellSettings.user.agentGreeting) {
                dispatcher.processCommand(
                    `@greeting${mockGreetings ? " --mock" : ""}`,
                    "agent-0",
                    [],
                );
            }
            return;
        }

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

        // Notify the renderer process that the dispatcher is initialized
        chatView.webContents.send("dispatcher-initialized");

        // Give focus to the chat view once initialization is done.
        chatView.webContents.focus();

        // send the agent greeting if it's turned on
        if (shellSettings.user.agentGreeting) {
            dispatcher.processCommand(
                `@greeting${mockGreetings ? " --mock" : ""}`,
                "agent-0",
                [],
            );
        }
    };
    ipcMain.on("chat-view-ready", onChatViewReady);

    shellWindow.mainWindow.on("closed", () => {
        ensureCleanupInstance();
        cleanupConversationIpc();
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
