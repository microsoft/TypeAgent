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
import { createDispatcherRpcServer } from "agent-dispatcher/rpc/dispatcher/server";
import { ShellWindow } from "./shellWindow.js";
import { createGenericChannel } from "agent-rpc/channel";
import { getConsolePrompt } from "agent-dispatcher/helpers/console";
import {
    getDefaultAppAgentInstaller,
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
    getIndexingServiceRegistry,
} from "default-agent-provider";
import { getClientId } from "agent-dispatcher/helpers/data";
import { createShellAgentProvider } from "./agent.js";
import { createInlineBrowserControl } from "./inlineBrowserControl.js";
import { ClientIO, createDispatcher, Dispatcher } from "agent-dispatcher";
import { getStatusSummary } from "agent-dispatcher/helpers/status";
import {
    hasPendingUpdate,
    setPendingUpdateCallback,
} from "./commands/update.js";
import { createClientIORpcClient } from "agent-dispatcher/rpc/clientio/client";
import { isProd } from "./index.js";

type ShellInstance = {
    shellWindow: ShellWindow;
    dispatcherP: Promise<Dispatcher | undefined>;
};

let instance: ShellInstance | undefined;
let cleanupP: Promise<void> | undefined;
let quitting: boolean = false;

async function initializeDispatcher(
    instanceDir: string,
    shellWindow: ShellWindow,
    updateSummary: (dispatcher: Dispatcher) => string,
    startTime: number,
): Promise<Dispatcher | undefined> {
    if (cleanupP !== undefined) {
        // Make sure the previous cleanup is done.
        await cleanupP;
    }
    try {
        const clientIOChannel = createGenericChannel((message: any) => {
            shellWindow.chatView.webContents.send("clientio-rpc-call", message);
        });
        const onClientIORpcReply = (event, message) => {
            if (getShellWindowForChatViewIpcEvent(event) !== shellWindow) {
                return;
            }
            clientIOChannel.message(message);
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
            openLocalView: (port: number) => {
                debugShell(`Opening local view on port ${port}`);
                shellWindow.createBrowserTab(
                    new URL(`http://localhost:${port}/`),
                    { background: false },
                );
                return Promise.resolve();
            },
            closeLocalView: (port: number) => {
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
        const newDispatcher = await createDispatcher("shell", {
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
            enableServiceHost: true,
            metrics: true,
            dblogging: true,
            clientId: getClientId(),
            clientIO,
            indexingServiceRegistry:
                await getIndexingServiceRegistry(instanceDir),
            constructionProvider: getDefaultConstructionProvider(),
            allowSharedLocalView: ["browser"],
            portBase: isProd ? 9001 : 9050,
        });

        async function processShellRequest(
            text: string,
            id: string,
            images: string[],
        ) {
            if (typeof text !== "string" || typeof id !== "string") {
                throw new Error("Invalid request");
            }

            // Update before processing the command in case there was change outside of command processing
            const summary = updateSummary(dispatcher);

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
            updateSummary(dispatcher);
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
                dispatcherChannel.disconnect();
                await newDispatcher.close();
                clientIOChannel.disconnect();
                ipcMain.removeListener(
                    "clientio-rpc-reply",
                    onClientIORpcReply,
                );
                browserControl.close();
            },
        };

        // Set up the RPC
        const dispatcherChannel = createGenericChannel((message: any) => {
            shellWindow.chatView.webContents.send(
                "dispatcher-rpc-reply",
                message,
            );
        });
        const onDispatcherRpcCall = (event, message) => {
            if (getShellWindowForChatViewIpcEvent(event) !== shellWindow) {
                return;
            }
            dispatcherChannel.message(message);
        };
        ipcMain.on("dispatcher-rpc-call", onDispatcherRpcCall);
        createDispatcherRpcServer(dispatcher, dispatcherChannel.channel);

        shellWindow.dispatcherInitialized();

        debugShellInit("Dispatcher initialized", performance.now() - startTime);

        return dispatcher;
    } catch (e: any) {
        dialog.showErrorBox("Exception initializing dispatcher", e.stack);
        return undefined;
    }
}

export async function initializeInstance(
    instanceDir: string,
    shellSettings: ShellSettingManager,
    startTime: number = performance.now(),
) {
    if (instance !== undefined) {
        throw new Error("Instance already initialized");
    }

    debugShellInit(
        "Start initializing Instance",
        performance.now() - startTime,
    );

    const shellWindow = new ShellWindow(shellSettings);
    const { chatView } = shellWindow;
    let title: string = "";
    function updateTitle(dispatcher: Dispatcher) {
        const status = dispatcher.getStatus();

        const newSettingSummary = getStatusSummary(status);
        const zoomFactor = chatView.webContents.zoomFactor;
        const pendingUpdate = hasPendingUpdate() ? " [Pending Update]" : "";
        const zoomFactorTitle =
            zoomFactor === 1 ? "" : ` Zoom: ${Math.round(zoomFactor * 100)}%`;
        const newTitle = `${app.getName()} v${app.getVersion()} - ${newSettingSummary}${pendingUpdate}${zoomFactorTitle}`;
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

        // send the agent greeting if it's turned on
        if (shellSettings.user.agentGreeting) {
            dispatcher.processCommand("@greeting", "agent-0", []);
        }
    };
    ipcMain.on("chat-view-ready", onChatViewReady);

    shellWindow.mainWindow.on("closed", () => {
        ensureCleanupInstance();
        ipcMain.removeListener("chat-view-ready", onChatViewReady);
    });

    instance = { shellWindow, dispatcherP };
    return shellWindow.waitForContentLoaded();
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
    await shellWindow.mainWindow.close();

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
