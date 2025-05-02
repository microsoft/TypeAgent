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
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { createDispatcher, Dispatcher } from "agent-dispatcher";
import {
    getDefaultAppAgentProviders,
    getDefaultAppAgentInstaller,
    getDefaultConstructionProvider,
} from "default-agent-provider";
import {
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
import { loadKeys } from "./keys.js";
import { parseShellCommandLine } from "./args.js";
import {
    setUpdateConfigPath,
    startBackgroundUpdateCheck,
} from "./commands/update.js";

if (process.platform === "darwin") {
    if (fs.existsSync("/opt/homebrew/bin/az")) {
        // Set the PATH to include homebrew so it have access to Azure CLI
        process.env.PATH = `/opt/homebrew/bin:${process.env.PATH}`;
    }
}

// Make sure we have chalk colors
process.env.FORCE_COLOR = "true";

const appPath = app.getAppPath();
debugShell("App path", appPath);
const isAsar = path.basename(appPath) === "app.asar"; // running with packaged, behaves like prod
debugShell("Is ASAR", isAsar);
const instanceDir = getInstanceDir(isAsar);
debugShell("Instance Dir", instanceDir);

const parsedArgs = parseShellCommandLine();

if (parsedArgs.reset) {
    // Delete shell setting files.
    await fs.promises.rm(getShellDataDir(instanceDir), { recursive: true });
}

if (parsedArgs.update) {
    if (!fs.existsSync(parsedArgs.update)) {
        throw new Error(
            `Update config file does not exist: ${parsedArgs.update}`,
        );
    }
    setUpdateConfigPath(parsedArgs.update);
}

export function runningTests(): boolean {
    return (
        process.env["INSTANCE_NAME"] !== undefined &&
        process.env["INSTANCE_NAME"].startsWith("test_") === true
    );
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

async function getSpeechToken() {
    if (speechToken === undefined || speechToken.expire <= Date.now()) {
        debugShell("Getting speech token");
        const tokenResponse = await AzureSpeech.getInstance().getTokenAsync();
        speechToken = {
            token: tokenResponse.token,
            expire: Date.now() + 9 * 60 * 1000, // 9 minutes (token expires in 10 minutes)
            region: tokenResponse.region,
            endpoint: tokenResponse.endpoint,
        };
    }
    return speechToken;
}

async function triggerRecognitionOnce(chatView: WebContentsView) {
    const speechToken = await getSpeechToken();
    const useLocalWhisper = isLocalWhisperEnabled();
    chatView.webContents.send(
        "listen-event",
        "Alt+M",
        speechToken,
        useLocalWhisper,
    );
}

function initializeSpeech(chatView: WebContentsView) {
    const key = process.env["SPEECH_SDK_KEY"];
    const region = process.env["SPEECH_SDK_REGION"];
    const endpoint = process.env["SPEECH_SDK_ENDPOINT"] as string;
    if (key && region) {
        AzureSpeech.initialize({
            azureSpeechSubscriptionKey: key,
            azureSpeechRegion: region,
            azureSpeechEndpoint: endpoint,
        });
        ipcMain.handle("get-speech-token", async () => {
            return getSpeechToken();
        });
    } else {
        ipcMain.handle("get-speech-token", async () => {
            dialog.showErrorBox(
                "Azure Speech Service: Missing configuration",
                "Environment variable SPEECH_SDK_KEY or SPEECH_SDK_REGION is missing.  Switch to local whisper or provide the configuration and restart.",
            );
        });
        debugShellError("Speech: no key or region");
    }

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
        const clientIO = {
            ...newClientIO,
            exit: () => {
                app.quit();
            },
        };

        // Set up dispatcher
        const newDispatcher = await createDispatcher("shell", {
            appAgentProviders: [
                createShellAgentProvider(shellWindow),
                ...getDefaultAppAgentProviders(instanceDir),
            ],
            agentInstaller: getDefaultAppAgentInstaller(instanceDir),
            explanationAsynchronousMode: true,
            persistSession: true,
            persistDir: instanceDir,
            enableServiceHost: true,
            metrics: true,
            dblogging: true,
            clientId: getClientId(),
            clientIO,
            constructionProvider: getDefaultConstructionProvider(),
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

            const metrics = await newDispatcher.processCommand(
                text,
                id,
                images,
            );
            shellWindow.chatView.webContents.send(
                "send-demo-event",
                "CommandProcessed",
            );
            updateSummary(dispatcher);
            return metrics;
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
        const newTitle =
            zoomFactor === 1
                ? newSettingSummary
                : `${newSettingSummary} Zoom: ${Math.round(zoomFactor * 100)}%`;
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

    await loadKeys(
        instanceDir,
        parsedArgs.env ? path.resolve(appPath, parsedArgs.env) : undefined,
    );

    // Set app user model id for windows
    electronApp.setAppUserModelId("com.electron");

    const browserExtensionPath = path.join(
        // HACK HACK for packaged build: The browser extension cannot be loaded from ASAR, so it is not packed.
        // Assume we can just replace app.asar with app.asar.unpacked in all cases.
        isAsar
            ? path.join(path.dirname(appPath), "app.asar.unpacked")
            : appPath,
        "node_modules/browser-typeagent/dist/electron",
    );
    await session.defaultSession.loadExtension(browserExtensionPath, {
        allowFileAccess: true,
    });

    const shellSettings = loadShellSettings(instanceDir);
    const settings = shellSettings.user;
    ipcMain.handle("get-chat-history", async () => {
        if (settings.chatHistory) {
            // Load chat history if enabled
            const dataDir = getShellDataDir(instanceDir);
            const chatHistory: string = path.join(dataDir, "chat_history.html");
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
        const file: string = path.join(instanceDir, "chat_history.html");

        debugShell(`Saving chat history to '${file}'.`, performance.now());

        try {
            writeFileSync(file, html);
        } catch (e) {
            debugShell(
                `Unable to save history to '${file}'. Error: ${e}`,
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

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on("browser-window-created", async (_, window) => {
        optimizer.watchWindowShortcuts(window);
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
    if (process.platform == "win32" && !runningTests()) {
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
            server.listen(pipePath);
        } catch {
            debugShellError(`Error creating pipe at ${pipePath}`);
        }
    }
    await initializeInstance(instanceDir, shellSettings);

    if (shellSettings.user.autoUpdate !== -1) {
        startBackgroundUpdateCheck(
            shellSettings.user.autoUpdate,
            shellSettings.user.autoRestart,
            60, // start up delay of 1 minute
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
