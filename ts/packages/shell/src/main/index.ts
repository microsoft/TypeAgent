// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ipcMain,
    app,
    globalShortcut,
    dialog,
    shell,
    Notification,
    protocol,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { ClientIO, createDispatcher, Dispatcher } from "agent-dispatcher";
import {
    getDefaultAppAgentProviders,
    getDefaultAppAgentInstaller,
    getDefaultConstructionProvider,
    getIndexingServiceRegistry,
} from "default-agent-provider";
import {
    ensureShellDataDir,
    getShellDataDir,
    ShellSettingManager,
    ShellUserSettings,
} from "./shellSettings.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createShellAgentProvider } from "./agent.js";
import { closeLocalWhisper } from "./localWhisperCommandHandler.js";
import { createDispatcherRpcServer } from "agent-dispatcher/rpc/dispatcher/server";
import { createGenericChannel } from "agent-rpc/channel";
import { createClientIORpcClient } from "agent-dispatcher/rpc/clientio/client";
import { getClientId, getInstanceDir } from "agent-dispatcher/helpers/data";
import { getStatusSummary } from "agent-dispatcher/helpers/status";
import { getConsolePrompt } from "agent-dispatcher/helpers/console";
import {
    getShellWindowForChatViewIpcEvent,
    getShellWindowForMainWindowIpcEvent,
    ShellWindow,
} from "./shellWindow.js";

import { debugShell, debugShellError } from "./debug.js";
import { loadKeys, loadKeysFromEnvFile } from "./keys.js";
import { parseShellCommandLine } from "./args.js";
import {
    hasPendingUpdate,
    setPendingUpdateCallback,
    setUpdateConfigPath,
    startBackgroundUpdateCheck,
} from "./commands/update.js";
import { createInlineBrowserControl } from "./inlineBrowserControl.js";
import { BrowserControl } from "browser-typeagent/agent/types";
import { initializeSearchMenuUI } from "./electronSearchMenuUI.js";
import { initializePen } from "./commands/pen.js";
import { initializeSpeech, triggerRecognitionOnce } from "./speech.js";

import {
    initializePDFViewerIpcHandlers,
    initializeExternalStorageIpcHandlers,
    initializeBrowserExtension,
} from "./webViewIpcHandlers.js";

debugShell("App name", app.getName());
debugShell("App version", app.getVersion());

// Register custom protocol scheme as privileged
protocol.registerSchemesAsPrivileged([
    {
        scheme: "typeagent-browser",
        privileges: {
            standard: true,
            secure: true,
            bypassCSP: true,
            allowServiceWorkers: true,
            supportFetchAPI: true,
            corsEnabled: true,
        },
    },
]);

if (process.platform === "darwin") {
    if (fs.existsSync("/opt/homebrew/bin/az")) {
        // Set the PATH to include homebrew so it have access to Azure CLI
        process.env.PATH = `/opt/homebrew/bin:${process.env.PATH}`;
    }
}
// Make sure we have chalk colors
process.env.FORCE_COLOR = "true";

const parsedArgs = parseShellCommandLine();
export const isProd = parsedArgs.prod ?? app.isPackaged;
debugShell("Is prod", isProd);
export const isTest = parsedArgs.test ?? false;
debugShell("Is test", isTest);

// Use single instance lock in prod to make the existing instance focus
// Allow multiple instance for dev build, with lock for data directory "instanceDir".
if (isProd) {
    if (!app.requestSingleInstanceLock()) {
        debugShellError("Another instance is running");
        process.exit(0);
    }
}

// Set app user model id for windows
if (process.platform === "win32") {
    app.setAppUserModelId(
        isProd ? "Microsoft.TypeAgentShell" : process.execPath,
    );
}

const instanceDir =
    parsedArgs.data ??
    (app.isPackaged
        ? path.join(app.getPath("userData"), "data")
        : getInstanceDir());

debugShell("Instance Dir", instanceDir);

if (parsedArgs.clean) {
    // Delete all files in the instance dir.
    if (fs.existsSync(instanceDir)) {
        await fs.promises.rm(instanceDir, { recursive: true });
        debugShell("Cleaned data dir", instanceDir);
    }
} else if (parsedArgs.reset) {
    // Delete shell setting files.
    const shellDataDir = getShellDataDir(instanceDir);
    if (fs.existsSync(shellDataDir)) {
        await fs.promises.rm(shellDataDir, { recursive: true });
        debugShell("Cleaned shell data dir", shellDataDir);
    }
}

ensureShellDataDir(instanceDir);

if (parsedArgs.update) {
    if (!fs.existsSync(parsedArgs.update)) {
        throw new Error(
            `Update config file does not exist: ${parsedArgs.update}`,
        );
    }
    setUpdateConfigPath(parsedArgs.update);
}

const time = performance.now();
debugShell("Starting...");

function createWindow(shellSettings: ShellSettingManager) {
    debugShell("Creating window", performance.now() - time);

    // Create the browser window.
    return new ShellWindow(shellSettings);
}

async function initializeDispatcher(
    instanceDir: string,
    shellWindow: ShellWindow,
    updateSummary: (dispatcher: Dispatcher) => string,
) {
    try {
        const clientIOChannel = createGenericChannel((message: any) => {
            shellWindow.chatView.webContents.send("clientio-rpc-call", message);
        });
        ipcMain.on("clientio-rpc-reply", (_event, message) => {
            clientIOChannel.message(message);
        });

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

        let browserControl: BrowserControl | undefined;
        try {
            browserControl = createInlineBrowserControl(shellWindow);
        } catch {}

        // Set up dispatcher
        const newDispatcher = await createDispatcher("shell", {
            appAgentProviders: [
                createShellAgentProvider(shellWindow),
                ...getDefaultAppAgentProviders(instanceDir),
            ],
            agentInitOptions: {
                browser: browserControl,
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
        };

        // Set up the RPC
        const dispatcherChannel = createGenericChannel((message: any) => {
            shellWindow.chatView.webContents.send(
                "dispatcher-rpc-reply",
                message,
            );
        });
        ipcMain.on("dispatcher-rpc-call", (_event, message) => {
            dispatcherChannel.message(message);
        });
        createDispatcherRpcServer(dispatcher, dispatcherChannel.channel);

        setupQuit(dispatcher);

        shellWindow.dispatcherInitialized();

        // Dispatcher is ready to be called from the client, but we need to wait for the dom to be ready to start
        // using it to process command, so that the client can receive messages.
        debugShell("Dispatcher initialized", performance.now() - time);

        return dispatcher;
    } catch (e: any) {
        dialog.showErrorBox("Exception initializing dispatcher", e.stack);
        return undefined;
    }
}

async function initializeInstance(
    instanceDir: string,
    shellSettings: ShellSettingManager,
) {
    const shellWindow = createWindow(shellSettings);
    const { mainWindow, chatView } = shellWindow;
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
            chatView.webContents.send(
                "setting-summary-changed",
                status.agents.map((agent) => [agent.name, agent.emoji]),
            );

            mainWindow.setTitle(newTitle);
        }

        return newSettingSummary;
    }

    // Note: Make sure dom ready before using dispatcher.
    const dispatcherP = initializeDispatcher(
        instanceDir,
        shellWindow,
        updateTitle,
    );

    ipcMain.on("dom ready", async () => {
        debugShell("Showing window", performance.now() - time);

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
    });

    return shellWindow.waitForContentLoaded();
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
async function initialize() {
    debugShell("Ready", performance.now() - time);

    const appPath = app.getAppPath();
    const envFile = parsedArgs.env
        ? path.resolve(appPath, parsedArgs.env)
        : undefined;
    if (isTest) {
        if (!envFile) {
            throw new Error("Test mode requires --env argument");
        }
        await loadKeysFromEnvFile(envFile);
    } else {
        await loadKeys(
            instanceDir,
            parsedArgs.reset || parsedArgs.clean,
            envFile,
        );
    }

    protocol.handle("typeagent-browser", (request) => {
        const url = new URL(request.url);
        const pathname = url.pathname;
        const queryString = url.search;

        const browserExtensionUrls = (global as any).browserExtensionUrls;
        if (browserExtensionUrls && browserExtensionUrls[pathname]) {
            const resolvedUrl = browserExtensionUrls[pathname] + queryString;
            debugShell(`Protocol handler: ${request.url} -> ${resolvedUrl}`);

            const shellWindow = ShellWindow.getInstance();
            if (shellWindow) {
                shellWindow.createBrowserTab(new URL(resolvedUrl), {
                    background: false,
                });
            }

            // Return a redirect response
            return new Response("", {
                status: 302,
                headers: { Location: resolvedUrl },
            });
        } else {
            debugShell(`Protocol handler: Unknown library page: ${pathname}`);
            return new Response("Not Found", { status: 404 });
        }
    });

    const shellSettings = new ShellSettingManager(instanceDir);
    const settings = shellSettings.user;
    const dataDir = getShellDataDir(instanceDir);
    const chatHistory: string = path.join(dataDir, "chat_history.html");
    ipcMain.handle("get-chat-history", async (event) => {
        // Make sure the event is from the chat view of the current shell window
        const shellWindow = getShellWindowForChatViewIpcEvent(event);
        if (!shellWindow) return;
        if (settings.chatHistory) {
            // Load chat history if enabled
            if (existsSync(chatHistory)) {
                return readFileSync(chatHistory, "utf-8");
            }
        }
        return undefined;
    });

    // Store the chat history whenever the DOM changes
    // this let's us rehydrate the chat when reopening the shell
    ipcMain.on("save-chat-history", async (event, html) => {
        // Make sure the event is from the chat view of the current shell window
        const shellWindow = getShellWindowForChatViewIpcEvent(event);
        if (!shellWindow) return;

        // store the modified DOM contents

        debugShell(
            `Saving chat history to '${chatHistory}'.`,
            performance.now(),
        );

        try {
            writeFileSync(chatHistory, html);
        } catch (e) {
            debugShell(
                `Unable to save history to '${chatHistory}'. Error: ${e}`,
                performance.now(),
            );
        }
    });

    ipcMain.on("save-settings", (event, settings: ShellUserSettings) => {
        const shellWindow = getShellWindowForChatViewIpcEvent(event);
        shellWindow?.setUserSettings(settings);
    });

    ipcMain.on("views-resized-by-user", (event, newPos: number) => {
        const shellWindow = getShellWindowForMainWindowIpcEvent(event);
        shellWindow?.updateContentSize(newPos);
    });

    ipcMain.on("open-image-file", async (event) => {
        const shellWindow = getShellWindowForChatViewIpcEvent(event);
        if (!shellWindow) return;
        const result = await dialog.showOpenDialog(shellWindow.mainWindow, {
            filters: [
                {
                    name: "Image files",
                    extensions: ["png", "jpg", "jpeg", "gif"],
                },
            ],
        });

        if (result && !result.canceled) {
            let paths = result.filePaths;
            if (paths && paths.length > 0) {
                const content = readFileSync(paths[0], "base64");
                shellWindow.chatView.webContents.send(
                    "file-selected",
                    paths[0],
                    content,
                );
            }
        }
    });

    ipcMain.on("open-folder", async (event, path: string) => {
        // Make sure the event is from the chat view of the current shell window
        const shellWindow = getShellWindowForChatViewIpcEvent(event);
        if (!shellWindow) return;
        shell.openPath(path);
    });

    ipcMain.on("open-url-in-browser-tab", async (event, url: string) => {
        // Make sure the event is from the chat view of the current shell window
        const shellWindow = getShellWindowForChatViewIpcEvent(event);
        if (!shellWindow) return;

        // Handle custom protocol URLs
        if (url.startsWith("typeagent-browser://")) {
            const parsedUrl = new URL(url);
            const pathname = parsedUrl.pathname;
            const queryString = parsedUrl.search;

            const browserExtensionUrls = (global as any).browserExtensionUrls;
            if (browserExtensionUrls && browserExtensionUrls[pathname]) {
                const resolvedUrl =
                    browserExtensionUrls[pathname] + queryString;
                shellWindow.createBrowserTab(new URL(resolvedUrl), {
                    background: false,
                });
            }
        } else if (url.startsWith("http://") || url.startsWith("https://")) {
            // Handle HTTP/HTTPS URLs - open them in a new browser tab
            shellWindow.createBrowserTab(new URL(url), { background: false });
        }
    });

    await initializePen(triggerRecognitionOnce);
    initializeSearchMenuUI();
    initializeSpeech();

    // Web view IPC handlers
    await initializeBrowserExtension(appPath);
    initializeExternalStorageIpcHandlers(instanceDir);
    initializePDFViewerIpcHandlers();

    app.on("activate", async function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (ShellWindow.getInstance() === undefined)
            await initializeInstance(instanceDir, shellSettings);
    });

    await initializeInstance(instanceDir, shellSettings);

    if (shellSettings.user.autoUpdate.intervalMs !== -1) {
        startBackgroundUpdateCheck(
            shellSettings.user.autoUpdate.intervalMs,
            shellSettings.user.autoUpdate.restart,
            shellSettings.user.autoUpdate.initialIntervalMs,
        );
    }
}

app.whenReady()
    .then(initialize)
    .catch((e) => {
        dialog.showErrorBox("Error starting shell", e.stack);
        app.quit();
    });

function setupQuit(dispatcher: Dispatcher) {
    let quitting = false;
    let canQuit = false;
    async function quit() {
        quitting = true;

        // Unregister all shortcuts.
        globalShortcut.unregisterAll();

        closeLocalWhisper();

        debugShell("Closing dispatcher");
        try {
            await dispatcher.close();
        } catch (e) {
            debugShellError("Error closing dispatcher", e);
        }

        debugShell("Quitting");
        canQuit = true;
        app.quit();
    }

    app.on("before-quit", (e) => {
        if (canQuit) {
            return;
        }
        // Stop the quitting to finish async tasks.
        e.preventDefault();

        // if we are already quitting, do nothing
        if (quitting) {
            return;
        }

        quit();
    });
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("second-instance", () => {
    // Someone tried to run a second instance, we should focus our window.
    debugShell("Second instance");
    ShellWindow.getInstance()?.showAndFocus();
});

// Similar to what electron-toolkit does with optimizer.watchWindowShortcuts, but apply to all web contents, not just browser windows.
// Default open or close DevTools by F12 in development
// and ignore CommandOrControl + R in production.
// see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
app.on("web-contents-created", async (_, webContents) => {
    webContents.on("before-input-event", (_event, input) => {
        if (input.type === "keyDown") {
            if (isProd) {
                // Ignore CommandOrControl + R
                if (input.code === "KeyR" && (input.control || input.meta))
                    _event.preventDefault();
            } else {
                // Toggle devtool(F12)
                if (input.code === "F12") {
                    if (webContents.isDevToolsOpened()) {
                        webContents.closeDevTools();
                    } else {
                        webContents.openDevTools({ mode: "undocked" });
                    }
                }
            }
        }
    });
});
