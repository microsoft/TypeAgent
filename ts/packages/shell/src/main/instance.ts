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
    ClientIO,
    createDispatcher,
    Dispatcher,
    RequestId,
} from "agent-dispatcher";
import { getStatusSummary } from "agent-dispatcher/helpers/status";
import { setPendingUpdateCallback } from "./commands/update.js";
import { createClientIORpcClient } from "@typeagent/dispatcher-rpc/clientio/client";
import { isProd } from "./index.js";
import { getFsStorageProvider } from "dispatcher-node-providers";
import { connectDispatcher } from "@typeagent/agent-server-client";

type ShellInstance = {
    shellWindow: ShellWindow;
    dispatcherP: Promise<Dispatcher | undefined>;
};

let instance: ShellInstance | undefined;
let cleanupP: Promise<void> | undefined;
let quitting: boolean = false;

async function initializeDispatcher(
    instanceDir: string | undefined,
    shellWindow: ShellWindow,
    updateSummary: (dispatcher: Dispatcher) => Promise<string>,
    startTime: number,
    connect?: number,
): Promise<Dispatcher | undefined> {
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
            popupQuestion: async (
                message: string,
                choices: string[],
                defaultId: number | undefined,
                source: string,
            ) => {
                const result = await dialog.showMessageBox(
                    shellWindow.mainWindow,
                    {
                        type: "question",
                        buttons: choices,
                        defaultId,
                        message,
                        icon: source,
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
        };

        const browserControl = createInlineBrowserControl(shellWindow);

        // Set up dispatcher
        let newDispatcher: Dispatcher;
        if (connect !== undefined) {
            // Connect to remote dispatcher instead of creating one
            newDispatcher = await connectDispatcher(
                clientIO,
                `ws://localhost:${connect}`,
                undefined,
                () => {
                    dialog.showErrorBox(
                        "Disconnected",
                        "The connection to the dispatcher was lost.",
                    );
                    app.quit();
                },
            );
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
            const indexingServiceRegistry =
                await getIndexingServiceRegistry(instanceDir);

            newDispatcher = await createDispatcher("shell", {
                appAgentProviders: [
                    createShellAgentProvider(shellWindow),
                    ...getDefaultAppAgentProviders(instanceDir),
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
                portBase: isProd ? 9001 : 9050,
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

        const dispatcher = {
            ...newDispatcher,
            processCommand: processShellRequest,
            close: async () => {
                ipcMain.removeListener(
                    "dispatcher-rpc-call",
                    onDispatcherRpcCall,
                );
                dispatcherChannel.notifyDisconnected();
                await newDispatcher.close();
                clientIOChannel.notifyDisconnected();
                ipcMain.removeListener(
                    "clientio-rpc-reply",
                    onClientIORpcReply,
                );
                browserControl.close();
            },
        };

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

        return dispatcher;
    } catch (e: any) {
        dialog.showErrorBox("Exception initializing dispatcher", e.stack);
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
) {
    if (instance !== undefined) {
        throw new Error("Instance already initialized");
    }

    debugShellInit(
        "Start initializing Instance",
        performance.now() - startTime,
    );

    const shellWindow = new ShellWindow(shellSettings, inputOnly);

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
    );

    const onChatViewReady = async (event: Electron.IpcMainEvent) => {
        const eventWindow = getShellWindowForChatViewIpcEvent(event);
        if (eventWindow !== shellWindow) {
            return;
        }
        ipcMain.removeListener("chat-view-ready", onChatViewReady);
        debugShellInit("Showing window", performance.now() - startTime);

        // The dispatcher can be use now that dom is ready and the client is ready to receive messages
        const dispatcher = await dispatcherP;
        if (dispatcher === undefined) {
            app.quit();
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
        const dispatcher = await dispatcherP;
        if (dispatcher) {
            await dispatcher.close();
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
