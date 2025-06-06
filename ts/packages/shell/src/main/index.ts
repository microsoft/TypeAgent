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
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { ClientIO, createDispatcher, Dispatcher } from "agent-dispatcher";
import {
    getDefaultAppAgentProviders,
    getDefaultAppAgentInstaller,
    getDefaultConstructionProvider,
} from "default-agent-provider";
import {
    ensureShellDataDir,
    getShellDataDir,
    loadShellSettings,
    ShellSettings,
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
import net from "node:net";
import { createClientIORpcClient } from "agent-dispatcher/rpc/clientio/client";
import { getClientId, getInstanceDir } from "agent-dispatcher/helpers/data";
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
import type { BrowserControl } from "browser-typeagent/agent/interface";

debugShell("App name", app.getName());
debugShell("App version", app.getVersion());

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

function createWindow(shellSettings: ShellSettings) {
    debugShell("Creating window", performance.now() - time);

    // Create the browser window.
    const shellWindow = new ShellWindow(shellSettings, instanceDir);

    initializeSpeech(shellWindow.chatView);

    ipcMain.on("views-resized-by-user", (_, newX: number) => {
        shellWindow.updateContentSize(newX);
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
    updateSummary: (dispatcher: Dispatcher) => void,
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
                return shellWindow.openInlineBrowser(
                    new URL(`http://localhost:${port}/`),
                );
            },
            closeLocalView: (port: number) => {
                const current = shellWindow.inlineBrowserUrl;
                debugShell(
                    `Closing local view on port ${port}, current url: ${current}`,
                );
                if (current === `http://localhost:${port}/`) {
                    shellWindow.closeInlineBrowser();
                }
            },
            exit: () => {
                app.quit();
            },
        };

        const browserControl: BrowserControl = {
            async openWebPage(url: string) {
                return shellWindow.openInlineBrowser(new URL(url));
            },
            async closeWebPage() {
                shellWindow.closeInlineBrowser();
            },
        };

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
            debugShell(newDispatcher.getPrompt(), text);
            // Update before processing the command in case there was change outside of command processing
            updateSummary(dispatcher);
            const commandResult = await newDispatcher.processCommand(
                text,
                id,
                images,
            );
            shellWindow.chatView.webContents.send(
                "send-demo-event",
                "CommandProcessed",
            );

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
    shellSettings: ShellSettings,
) {
    const shellWindow = createWindow(shellSettings);
    const { mainWindow, chatView } = shellWindow;
    let title: string = "";
    function updateTitle(dispatcher: Dispatcher) {
        const newSettingSummary = dispatcher.getSettingSummary();
        const zoomFactor = chatView.webContents.zoomFactor;
        const pendingUpdate = hasPendingUpdate() ? " [Pending Update]" : "";
        const zoomFactorTitle =
            zoomFactor === 1 ? "" : ` Zoom: ${Math.round(zoomFactor * 100)}%`;
        const newTitle = `${app.getName()} v${app.getVersion()} - ${newSettingSummary}${pendingUpdate}${zoomFactorTitle}`;
        if (newTitle !== title) {
            title = newTitle;
            chatView.webContents.send(
                "setting-summary-changed",
                dispatcher.getTranslatorNameToEmojiMap(),
            );

            mainWindow.setTitle(newTitle);
        }
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
    if (parsedArgs.test) {
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
    await session.defaultSession.loadExtension(browserExtensionPath, {
        allowFileAccess: true,
    });

    const shellSettings = loadShellSettings(instanceDir);
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

    app.on("activate", async function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (ShellWindow.getInstance() === undefined)
            await initializeInstance(instanceDir, shellSettings);
    });

    // On windows, we will spin up a local end point that listens
    // for pen events which will trigger speech reco
    // Don't spin this up during testing
    if (process.platform == "win32" && !parsedArgs.test) {
        const pipePath = path.join("\\\\.\\pipe\\TypeAgent", "speech");
        const server = net.createServer((stream) => {
            stream.on("data", (c) => {
                const shellWindow = ShellWindow.getInstance();
                if (shellWindow === undefined) {
                    // Ignore if there is no shell window
                    return;
                }
                if (c.toString() == "triggerRecognitionOnce") {
                    console.log("Pen click note button click received!");
                    triggerRecognitionOnce(shellWindow.chatView);
                }
            });
            stream.on("error", (e) => {
                console.log(e);
            });
        });

        try {
            const p = Promise.withResolvers<void>();
            server.on("error", (e) => {
                p.reject(e);
            });
            server.listen(pipePath, () => {
                debugShell("Listening for pen events on", pipePath);
                p.resolve();
            });
            await p.promise;
        } catch (e) {
            debugShellError(`Error creating pipe at ${pipePath}: ${e}`);
        }
    }
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
