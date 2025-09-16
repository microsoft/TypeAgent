// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ipcMain,
    app,
    globalShortcut,
    dialog,
    session,
    WebContentsView,
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
import { BrowserAgentIpc } from "./browserIpc.js";
import { WebSocketMessageV2 } from "common-utils";
import { AzureSpeech } from "./azureSpeech.js";
import {
    closeLocalWhisper,
    isLocalWhisperEnabled,
} from "./localWhisperCommandHandler.js";
import { createDispatcherRpcServer } from "agent-dispatcher/rpc/dispatcher/server";
import { createGenericChannel } from "agent-rpc/channel";
import { createClientIORpcClient } from "agent-dispatcher/rpc/clientio/client";
import { getClientId, getInstanceDir } from "agent-dispatcher/helpers/data";
import { getStatusSummary } from "agent-dispatcher/helpers/status";
import { getConsolePrompt } from "agent-dispatcher/helpers/console";
import { ShellWindow } from "./shellWindow.js";

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
import { ExtensionStorageManager } from "./extensionStorage.js";
import { initializeSearchMenuUI } from "./electronSearchMenuUI.js";
import { initializePen } from "./commands/pen.js";

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
    const shellWindow = new ShellWindow(shellSettings);

    initializeSpeech(shellWindow.chatView);
    initializeSearchMenuUI(shellWindow);

    ipcMain.on("views-resized-by-user", (_, newPos: number) => {
        shellWindow.updateContentSize(newPos);
    });

    ipcMain.handle("init-browser-ipc", async () => {
        await BrowserAgentIpc.getinstance().ensureWebsocketConnected();

        BrowserAgentIpc.getinstance().onMessageReceived = (
            message: WebSocketMessageV2,
        ) => {
            shellWindow.sendMessageToInlineWebContent(message);
        };
    });

    return shellWindow;
}

let speechToken:
    | { token: string; expire: number; region: string; endpoint: string }
    | undefined;

async function getSpeechToken(silent: boolean) {
    const instance = AzureSpeech.getInstance();
    if (instance === undefined) {
        if (!silent) {
            dialog.showErrorBox(
                "Azure Speech Service: Missing configuration",
                "Environment variable SPEECH_SDK_KEY or SPEECH_SDK_REGION is missing.  Switch to local whisper or provide the configuration and restart.",
            );
        }
        return undefined;
    }

    if (speechToken !== undefined && speechToken.expire > Date.now()) {
        return speechToken;
    }
    try {
        debugShell("Getting speech token");
        const tokenResponse = await instance.getTokenAsync();
        speechToken = {
            token: tokenResponse.token,
            expire: Date.now() + 9 * 60 * 1000, // 9 minutes (token expires in 10 minutes)
            region: tokenResponse.region,
            endpoint: tokenResponse.endpoint,
        };
        return speechToken;
    } catch (e: any) {
        debugShellError("Error getting speech token", e);
        if (!silent) {
            dialog.showErrorBox(
                "Azure Speech Service: Error getting token",
                e.message,
            );
        }
        return undefined;
    }
}

async function triggerRecognitionOnce(chatView: WebContentsView) {
    const speechToken = await getSpeechToken(false);
    const useLocalWhisper = isLocalWhisperEnabled();
    chatView.webContents.send("listen-event", speechToken, useLocalWhisper);
}

function initializeSpeech(chatView: WebContentsView) {
    const key = process.env["SPEECH_SDK_KEY"] ?? "identity";
    const region = process.env["SPEECH_SDK_REGION"];
    const endpoint = process.env["SPEECH_SDK_ENDPOINT"] as string;
    if (region) {
        AzureSpeech.initialize({
            azureSpeechSubscriptionKey: key,
            azureSpeechRegion: region,
            azureSpeechEndpoint: endpoint,
        });
    } else {
        debugShellError("Speech: no key or region");
    }

    ipcMain.handle("get-speech-token", async (_, silent: boolean) => {
        return getSpeechToken(silent);
    });
    const ret = globalShortcut.register("Alt+M", () => {
        triggerRecognitionOnce(chatView);
    });

    if (ret) {
        // Double check whether a shortcut is registered.
        debugShell(
            `Global shortcut Alt+M: ${globalShortcut.isRegistered("Alt+M")}`,
        );
    } else {
        debugShellError("Global shortcut registration failed");
    }
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

    ipcMain.on("save-settings", (_event, settings: ShellUserSettings) => {
        shellWindow.setUserSettings(settings);
    });

    ipcMain.on("open-image-file", async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
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
                chatView.webContents.send("file-selected", paths[0], content);
            }
        }
    });

    ipcMain.on("open-folder", async (_event, path: string) => {
        shell.openPath(path);
    });

    ipcMain.on("open-url-in-browser-tab", async (_event, url: string) => {
        const shellWindow = ShellWindow.getInstance();
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
    const browserExtensionPath = path.join(
        // HACK HACK for packaged build: The browser extension cannot be loaded from ASAR, so it is not packed.
        // Assume we can just replace app.asar with app.asar.unpacked in all cases.
        path.basename(appPath) === "app.asar"
            ? path.join(path.dirname(appPath), "app.asar.unpacked")
            : appPath,
        "node_modules/browser-typeagent/dist/electron",
    );
    const extension = await session.defaultSession.extensions.loadExtension(
        browserExtensionPath,
        {
            allowFileAccess: true,
        },
    );

    // Store extension info for later URL construction
    (global as any).browserExtensionId = extension.id;
    (global as any).browserExtensionUrls = {
        "/annotationsLibrary.html": `chrome-extension://${extension.id}/views/annotationsLibrary.html`,
        "/knowledgeLibrary.html": `chrome-extension://${extension.id}/views/knowledgeLibrary.html`,
        "/macrosLibrary.html": `chrome-extension://${extension.id}/views/macrosLibrary.html`,
        "/entityGraphView.html": `chrome-extension://${extension.id}/views/entityGraphView.html`,
    };

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
    const extensionStorage = new ExtensionStorageManager(instanceDir);
    const settings = shellSettings.user;
    const dataDir = getShellDataDir(instanceDir);
    const chatHistory: string = path.join(dataDir, "chat_history.html");
    ipcMain.handle("get-chat-history", async () => {
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
    ipcMain.on("save-chat-history", async (_, html) => {
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

    ipcMain.handle("get-localWhisper-status", async () => {
        return isLocalWhisperEnabled();
    });

    ipcMain.on("send-to-browser-ipc", async (_, data: WebSocketMessageV2) => {
        await BrowserAgentIpc.getinstance().send(data);
    });

    // Extension service adapter IPC handlers - Must handle async response waiting
    ipcMain.handle("browser-extension-message", async (_, message) => {
        try {
            // Route message through browser IPC to TypeAgent backend
            const browserIpc = BrowserAgentIpc.getinstance();

            // Check if this is a long-running import operation
            // Note: ExtensionServiceBase sends with 'type', but it might also come as 'method'
            const methodName = message.method || message.type;
            const isImportOperation =
                methodName === "importWebsiteDataWithProgress" ||
                methodName === "importHtmlFolder";

            // For import operations, use a longer timeout and handle differently
            const timeout = isImportOperation ? 600000 : 30000; // 10 minutes for imports, 30 seconds for others

            // Create a promise to wait for the WebSocket response
            return new Promise((resolve, reject) => {
                const messageId = Date.now().toString();

                // Set up one-time response listener
                const originalHandler = browserIpc.onMessageReceived;
                browserIpc.onMessageReceived = (response) => {
                    if (response.id === messageId) {
                        // Restore original handler
                        browserIpc.onMessageReceived = originalHandler;

                        // Extract the actual data from the ActionResult if it's an extension message
                        let result = response.result || response;
                        if (result && result.data !== undefined) {
                            // This is likely an ActionResult with data field containing the actual extension response
                            result = result.data;
                        }

                        resolve(result);
                    } else if (originalHandler) {
                        // Forward other messages to original handler
                        originalHandler(response);
                    }
                };

                // Send the message directly using the method/params from the message
                browserIpc
                    .send({
                        method: message.method || message.type,
                        params: message.params || message.parameters || message,
                        id: messageId,
                    })
                    .catch(reject);

                // Set timeout to prevent hanging
                setTimeout(() => {
                    browserIpc.onMessageReceived = originalHandler;
                    const method = message.method || message.type || "unknown";
                    const messageInfo = JSON.stringify({
                        method,
                        messageId,
                        hasParams: !!(message.params || message.parameters),
                    });
                    reject(
                        new Error(
                            `Inline-browser message timeout - ${messageInfo}`,
                        ),
                    );
                }, timeout);
            });
        } catch (error) {
            return { error: (error as Error).message };
        }
    });

    // Direct WebSocket connection check via browserIPC
    ipcMain.handle("check-websocket-connection", async () => {
        try {
            const browserIpc = BrowserAgentIpc.getinstance();
            const connected = browserIpc.isConnected();
            return { connected };
        } catch (error) {
            return { connected: false };
        }
    });

    // Extension storage IPC handlers
    ipcMain.handle("extension-storage-get", async (_, keys: string[]) => {
        try {
            return extensionStorage.get(keys);
        } catch (error) {
            debugShellError("Error getting extension storage:", error);
            return {};
        }
    });

    ipcMain.handle(
        "extension-storage-set",
        async (_, items: Record<string, any>) => {
            try {
                extensionStorage.set(items);
                return { success: true };
            } catch (error) {
                debugShellError("Error setting extension storage:", error);
                return { success: false, error: (error as Error).message };
            }
        },
    );

    ipcMain.handle("extension-storage-remove", async (_, keys: string[]) => {
        try {
            extensionStorage.remove(keys);
            return { success: true };
        } catch (error) {
            debugShellError("Error removing extension storage:", error);
            return { success: false, error: (error as Error).message };
        }
    });

    // PDF viewer IPC handlers
    ipcMain.handle("check-typeagent-connection", async () => {
        const shellWindow = ShellWindow.getInstance();
        if (shellWindow) {
            const connected = await shellWindow.checkTypeAgentConnection();
            return { connected };
        }
        return { connected: false };
    });

    ipcMain.handle("open-pdf-viewer", async (_, pdfUrl: string) => {
        const shellWindow = ShellWindow.getInstance();
        if (shellWindow) {
            try {
                await shellWindow.openPDFViewer(pdfUrl);
                return { success: true };
            } catch (error) {
                debugShellError("Error opening PDF viewer:", error);
                return {
                    success: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                };
            }
        }
        return { success: false, error: "Shell window not available" };
    });

    app.on("activate", async function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (ShellWindow.getInstance() === undefined)
            await initializeInstance(instanceDir, shellSettings);
    });

    await initializePen(() => {
        const shellWindow = ShellWindow.getInstance();
        if (shellWindow) {
            triggerRecognitionOnce(shellWindow.chatView);
        }
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
