// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import {
    ipcMain,
    app,
    shell,
    BrowserWindow,
    globalShortcut,
    dialog,
    DevicePermissionHandlerHandlerDetails,
    WebContents,
    session,
    WebContentsView,
} from "electron";
import path, { join } from "node:path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { runDemo } from "./demo.js";
import registerDebug from "debug";
import { createDispatcher, Dispatcher } from "agent-dispatcher";
import {
    getDefaultAppAgentProviders,
    getDefaultAppAgentInstaller,
    getDefaultConstructionProvider,
} from "default-agent-provider";
import { ShellSettings } from "./shellSettings.js";
import { unlinkSync } from "fs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { shellAgentProvider } from "./agent.js";
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

const debugShell = registerDebug("typeagent:shell");
const debugShellError = registerDebug("typeagent:shell:error");

const envPath = join(__dirname, "../../../../.env");
dotenv.config({ path: envPath });

// Make sure we have chalk colors
process.env.FORCE_COLOR = "true";

// do we need to reset shell settings?
process.argv.forEach((arg) => {
    if (arg.toLowerCase() == "--setup" && existsSync(ShellSettings.filePath)) {
        unlinkSync(ShellSettings.filePath);
    }
});

export function runningTests(): boolean {
    return (
        process.env["INSTANCE_NAME"] !== undefined &&
        process.env["INSTANCE_NAME"].startsWith("test_") === true
    );
}

let mainWindow: BrowserWindow | null = null;
let inlineWebContentView: WebContentsView | null = null;
let chatView: WebContentsView | null = null;

const inlineBrowserSize = 1000;
const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";

function setContentSize() {
    if (mainWindow && chatView) {
        const newBounds = mainWindow.getContentBounds();
        const newHeight = newBounds.height;
        let newWidth = newBounds.width;
        let chatWidth = chatView.getBounds().width;

        if (inlineWebContentView) {
            let browserWidth = newWidth - chatWidth;
            inlineWebContentView?.setBounds({
                x: chatWidth + 4,
                y: 0,
                width: browserWidth,
                height: newHeight,
            });

            if (browserWidth <= 0) {
                chatWidth = newWidth;
            }
        } else {
            chatWidth = newWidth;
        }

        chatView?.setBounds({
            x: 0,
            y: 0,
            width: chatWidth,
            height: newHeight,
        });

        mainWindow.webContents.send("chat-view-resized", chatWidth);
    }
}

const time = performance.now();
debugShell("Starting...");

async function createWindow() {
    debugShell("Creating window", performance.now() - time);

    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: ShellSettings.getinstance().width,
        height: ShellSettings.getinstance().height,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, "../preload/index.mjs"),
            sandbox: false,
            zoomFactor: ShellSettings.getinstance().zoomLevel,
        },
        x: ShellSettings.getinstance().x,
        y: ShellSettings.getinstance().y,
    });

    // This (seemingly redundant) call is needed when we use a BrowserView.
    // Without this call, the mainWindow opens using default width/height, not the
    // values saved in ShellSettings
    mainWindow.setBounds({
        width: ShellSettings.getinstance().width,
        height: ShellSettings.getinstance().height,
    });

    mainWindow.webContents.setUserAgent(userAgent);

    const browserExtensionPath = join(
        app.getAppPath(),
        "../agents/browser/dist/electron",
    );
    await session.defaultSession.loadExtension(browserExtensionPath, {
        allowFileAccess: true,
    });

    chatView = new WebContentsView({
        webPreferences: {
            preload: join(__dirname, "../preload/index.mjs"),
            sandbox: false,
            zoomFactor: ShellSettings.getinstance().zoomLevel,
        },
    });

    chatView.webContents.setUserAgent(userAgent);

    // ensure links are opened in a new browser window
    chatView.webContents.setWindowOpenHandler((details) => {
        // TODO: add logic for keeping things in the browser window
        shell.openExternal(details.url);
        return { action: "deny" };
    });

    setContentSize();

    mainWindow.contentView.addChildView(chatView);

    setupDevicePermissions(mainWindow);

    mainWindow.on("ready-to-show", () => {
        mainWindow!.show();

        if (ShellSettings.getinstance().devTools) {
            chatView?.webContents.openDevTools();
        }
    });

    mainWindow.on("close", () => {
        if (mainWindow) {
            ShellSettings.getinstance().zoomLevel =
                mainWindow.webContents.zoomLevel;
            ShellSettings.getinstance().devTools =
                mainWindow.webContents.isDevToolsOpened();

            mainWindow.hide();
            ShellSettings.getinstance().closeInlineBrowser();
            ShellSettings.getinstance().size = mainWindow.getSize();
        }
    });

    mainWindow.on("closed", () => {
        ShellSettings.getinstance().save();
    });

    mainWindow.on("moved", () => {
        ShellSettings.getinstance().position = mainWindow?.getPosition();
    });

    mainWindow.on("resized", () => {
        if (mainWindow) {
            ShellSettings.getinstance().size = mainWindow.getSize();
        }
    });

    mainWindow.on("resize", setContentSize);

    const contentLoadP: Promise<void>[] = [];
    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        contentLoadP.push(
            chatView.webContents.loadURL(process.env["ELECTRON_RENDERER_URL"]),
        );
    } else {
        contentLoadP.push(
            chatView.webContents.loadFile(
                join(__dirname, "../renderer/index.html"),
            ),
        );
    }

    contentLoadP.push(
        mainWindow.webContents.loadFile(
            join(__dirname, "../renderer/viewHost.html"),
        ),
    );

    mainWindow.removeMenu();

    setupZoomHandlers(chatView);
    setupDevToolsHandlers(chatView);

    ipcMain.on("views-resized-by-user", (_, newX: number) => {
        if (mainWindow) {
            const chatBounds = chatView?.getBounds();
            const bounds = mainWindow.getBounds();
            let newWidth = newX;

            chatView?.setBounds({
                x: 0,
                y: 0,
                width: newWidth,
                height: chatBounds?.height!,
            });

            if (inlineWebContentView) {
                inlineWebContentView?.setBounds({
                    x: chatBounds!.width + 4,
                    y: 0,
                    width: bounds.width - newWidth - 20,
                    height: bounds.height - 50,
                });
            }
        }
    });

    // Notify renderer process whenever settings are modified
    ShellSettings.getinstance().onSettingsChanged = (
        settingName?: string | undefined,
    ): void => {
        chatView?.webContents.send(
            "settings-changed",
            ShellSettings.getinstance().getSerializable(),
        );

        if (settingName == "size") {
            mainWindow?.setSize(
                ShellSettings.getinstance().width,
                ShellSettings.getinstance().height,
            );
        } else if (settingName == "position") {
            mainWindow?.setPosition(
                ShellSettings.getinstance().x!,
                ShellSettings.getinstance().y!,
            );
        }

        if (settingName == "zoomLevel") {
            setZoomLevel(ShellSettings.getinstance().zoomLevel, chatView);
        }
    };

    ShellSettings.getinstance().onShowSettingsDialog = (
        dialogName: string,
    ): void => {
        chatView?.webContents.send("show-dialog", dialogName);
    };

    ShellSettings.getinstance().onRunDemo = (interactive: boolean): void => {
        runDemo(mainWindow!, chatView!, interactive);
    };

    ShellSettings.getinstance().onToggleTopMost = () => {
        mainWindow?.setAlwaysOnTop(!mainWindow?.isAlwaysOnTop());
    };

    ShellSettings.getinstance().onOpenInlineBrowser = (
        targetUrl: URL,
    ): void => {
        const mainWindowSize = mainWindow?.getBounds();

        if (!inlineWebContentView && mainWindowSize) {
            inlineWebContentView = new WebContentsView({
                webPreferences: {
                    preload: join(__dirname, "../preload-cjs/webview.cjs"),
                    sandbox: false,
                },
            });

            inlineWebContentView.webContents.setUserAgent(userAgent);

            mainWindow?.contentView.addChildView(inlineWebContentView);

            setupDevToolsHandlers(inlineWebContentView);
            setupZoomHandlers(inlineWebContentView);

            mainWindow?.setBounds({
                width: mainWindowSize.width + inlineBrowserSize,
            });
            setContentSize();
        }

        inlineWebContentView?.webContents.loadURL(targetUrl.toString());
    };

    ShellSettings.getinstance().onCloseInlineBrowser = (): void => {
        const mainWindowSize = mainWindow?.getBounds();

        if (inlineWebContentView && mainWindowSize) {
            const browserBounds = inlineWebContentView.getBounds();
            inlineWebContentView.webContents.close();
            mainWindow?.contentView.removeChildView(inlineWebContentView);
            inlineWebContentView = null;

            mainWindow?.setBounds({
                width: mainWindowSize.width - browserBounds.width,
            });

            setContentSize();
        }
    };

    ipcMain.handle("init-browser-ipc", async () => {
        await BrowserAgentIpc.getinstance().ensureWebsocketConnected();

        BrowserAgentIpc.getinstance().onMessageReceived = (
            message: WebSocketMessageV2,
        ) => {
            inlineWebContentView?.webContents.send(
                "received-from-browser-ipc",
                message,
            );
        };
    });

    return { mainWindow, chatView, contentLoadP };
}

/**
 * Allows the application to gain access to camera devices
 * @param mainWindow the main browser window
 */
function setupDevicePermissions(mainWindow: BrowserWindow) {
    let grantedDeviceThroughPermHandler;

    mainWindow.webContents.session.on(
        "select-usb-device",
        (event, details, callback) => {
            // Add events to handle devices being added or removed before the callback on
            // `select-usb-device` is called.
            mainWindow.webContents.session.on(
                "usb-device-added",
                (_event, device) => {
                    console.log("usb-device-added FIRED WITH", device);
                    // Optionally update details.deviceList
                },
            );

            mainWindow.webContents.session.on(
                "usb-device-removed",
                (_event, device) => {
                    console.log("usb-device-removed FIRED WITH", device);
                    // Optionally update details.deviceList
                },
            );

            event.preventDefault();
            if (details.deviceList && details.deviceList.length > 0) {
                const deviceToReturn = details.deviceList.find((device) => {
                    return (
                        !grantedDeviceThroughPermHandler ||
                        device.deviceId !==
                            grantedDeviceThroughPermHandler.deviceId
                    );
                });
                if (deviceToReturn) {
                    callback(deviceToReturn.deviceId);
                } else {
                    callback();
                }
            }
        },
    );

    mainWindow.webContents.session.setPermissionCheckHandler(
        (
            _webContents: WebContents | null,
            permission,
            _requestingOrigin,
            details,
        ): boolean => {
            if (
                (permission === "usb" &&
                    details.securityOrigin === "file:///") ||
                (permission === "media" &&
                    (details.securityOrigin?.startsWith("http://localhost") ||
                        details.securityOrigin?.startsWith(
                            "https://localhost",
                        )))
            ) {
                return true;
            }

            return false;
        },
    );

    mainWindow.webContents.session.setDevicePermissionHandler(
        (details: DevicePermissionHandlerHandlerDetails): boolean => {
            if (details.deviceType === "usb" && details.origin === "file://") {
                if (!grantedDeviceThroughPermHandler) {
                    grantedDeviceThroughPermHandler = details.device;
                    return true;
                } else {
                    return false;
                }
            }
            return false;
        },
    );
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

async function triggerRecognitionOnce() {
    const speechToken = await getSpeechToken();
    const useLocalWhisper = isLocalWhisperEnabled();
    chatView?.webContents.send(
        "listen-event",
        "Alt+M",
        speechToken,
        useLocalWhisper,
    );
}

async function initializeSpeech() {
    const key = process.env["SPEECH_SDK_KEY"];
    const region = process.env["SPEECH_SDK_REGION"];
    const endpoint = process.env["SPEECH_SDK_ENDPOINT"] as string;
    if (key && region) {
        await AzureSpeech.initializeAsync({
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
        triggerRecognitionOnce();
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
    chatView: WebContentsView,
    updateSummary: (dispatcher: Dispatcher) => void,
) {
    try {
        const clientIOChannel = createGenericChannel((message: any) => {
            chatView.webContents.send("clientio-rpc-call", message);
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

        const instanceDir = getInstanceDir();

        // Set up dispatcher
        const newDispatcher = await createDispatcher("shell", {
            appAgentProviders: [
                shellAgentProvider,
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
            chatView.webContents.send("send-demo-event", "CommandProcessed");
            updateSummary(dispatcher);
            return metrics;
        }

        const dispatcher = {
            ...newDispatcher,
            processCommand: processShellRequest,
        };

        // Set up the RPC
        const dispatcherChannel = createGenericChannel((message: any) => {
            chatView.webContents.send("dispatcher-rpc-reply", message);
        });
        ipcMain.on("dispatcher-rpc-call", (_event, message) => {
            dispatcherChannel.message(message);
        });
        createDispatcherRpcServer(dispatcher, dispatcherChannel.channel);

        setupQuit(dispatcher);

        // Dispatcher is ready to be called from the client, but we need to wait for the dom to be ready to start
        // using it to process command, so that the client can receive messages.
        debugShell("Dispatcher initialized", performance.now() - time);

        return dispatcher;
    } catch (e: any) {
        dialog.showErrorBox(
            "Exception initializing dispatcher",
            `${e.message}\n${e.stack}`,
        );
        return undefined;
    }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
async function initialize() {
    debugShell("Ready", performance.now() - time);
    // Set app user model id for windows
    electronApp.setAppUserModelId("com.electron");

    await initializeSpeech();

    const { mainWindow, chatView, contentLoadP } = await createWindow();

    let settingSummary: string = "";
    function updateSummary(dispatcher: Dispatcher) {
        const newSettingSummary = dispatcher.getSettingSummary();
        if (newSettingSummary !== settingSummary) {
            settingSummary = newSettingSummary;
            chatView.webContents.send(
                "setting-summary-changed",
                newSettingSummary,
                dispatcher.getTranslatorNameToEmojiMap(),
            );

            mainWindow.setTitle(
                `${newSettingSummary} Zoom: ${Math.round(chatView.webContents.zoomFactor! * 100)}%`,
            );
        }
    }

    // Note: Make sure dom ready before using dispatcher.
    const dispatcherP = initializeDispatcher(chatView, updateSummary);
    ipcMain.on("dom ready", async () => {
        debugShell("Showing window", performance.now() - time);
        mainWindow.show();

        // Send settings asap
        ShellSettings.getinstance().onSettingsChanged!();

        // Load chat history if enabled
        const chatHistory: string = path.join(
            getInstanceDir(),
            "chat_history.html",
        );
        if (
            ShellSettings.getinstance().chatHistory &&
            existsSync(chatHistory)
        ) {
            chatView?.webContents.send(
                "chat-history",
                readFileSync(
                    path.join(getInstanceDir(), "chat_history.html"),
                    "utf-8",
                ),
            );
        }

        // make sure links are opened in the external browser
        mainWindow.webContents.setWindowOpenHandler((details) => {
            require("electron").shell.openExternal(details.url);
            return { action: "deny" };
        });

        // The dispatcher can be use now that dom is ready and the client is ready to receive messages
        const dispatcher = await dispatcherP;
        if (dispatcher === undefined) {
            app.quit();
            return;
        }
        updateSummary(dispatcher);

        // send the agent greeting if it's turned on
        if (ShellSettings.getinstance().agentGreeting) {
            dispatcher.processCommand("@greeting", "agent-0", []);
        }
    });

    // Store the chat history whenever the DOM changes
    // this let's us rehydrate the chat when reopening the shell
    ipcMain.on("dom changed", async (_event, html) => {
        // store the modified DOM contents
        const file: string = path.join(getInstanceDir(), "chat_history.html");

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

    ipcMain.on("save-settings", (_event, settings: ShellSettings) => {
        // Save the shell configurable settings
        ShellSettings.getinstance().microphoneId = settings.microphoneId;
        ShellSettings.getinstance().microphoneName = settings.microphoneName;
        ShellSettings.getinstance().tts = settings.tts;
        ShellSettings.getinstance().ttsSettings = settings.ttsSettings;
        ShellSettings.getinstance().agentGreeting = settings.agentGreeting;
        ShellSettings.getinstance().partialCompletion =
            settings.partialCompletion;
        ShellSettings.getinstance().darkMode = settings.darkMode;
        ShellSettings.getinstance().chatHistory = settings.chatHistory;

        // write the settings to disk
        ShellSettings.getinstance().save();
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

    ipcMain.on(
        "send-to-browser-ipc",
        async (_event, data: WebSocketMessageV2) => {
            await BrowserAgentIpc.getinstance().send(data);
        },
    );

    globalShortcut.register("Alt+Right", () => {
        chatView.webContents.send("send-demo-event", "Alt+Right");
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
        if (BrowserWindow.getAllWindows().length === 0) await createWindow();
    });

    // On windows, we will spin up a local end point that listens
    // for pen events which will trigger speech reco
    // Don't spin this up during testing
    if (process.platform == "win32" && !runningTests()) {
        const pipePath = path.join("\\\\.\\pipe\\TypeAgent", "speech");
        const server = net.createServer((stream) => {
            stream.on("data", (c) => {
                if (c.toString() == "triggerRecognitionOnce") {
                    console.log("Pen click note button click received!");
                    triggerRecognitionOnce();
                }
            });
            stream.on("error", (e) => {
                console.log(e);
            });
        });

        server.listen(pipePath);
    }
    return Promise.all(contentLoadP);
}

app.whenReady()
    .then(initialize)
    .catch((error) => {
        debugShellError(error);
        console.error(`Error starting shell: ${error.message}`);
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
        // Stop the quiting to finish async tasks.
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

function zoomIn(chatView: WebContentsView) {
    setZoomLevel(chatView.webContents.zoomFactor + 0.1, chatView);
}

function zoomOut(chatView: WebContentsView) {
    setZoomLevel(chatView.webContents.zoomFactor - 0.1, chatView);
}

function setZoomLevel(zoomLevel: number, chatView: WebContentsView | null) {
    if (zoomLevel < 0.1) {
        zoomLevel = 0.1;
    } else if (zoomLevel > 10) {
        zoomLevel = 10;
    }

    chatView!.webContents.zoomFactor = zoomLevel;
    ShellSettings.getinstance().set("zoomLevel", zoomLevel);

    updateZoomInTitle(chatView!);
}

function resetZoom(chatView: WebContentsView) {
    setZoomLevel(1, chatView);
}

function updateZoomInTitle(chatView: WebContentsView) {
    const prevTitle = mainWindow?.getTitle();
    if (prevTitle) {
        let summary = prevTitle.substring(0, prevTitle.indexOf("Zoom: "));

        mainWindow?.setTitle(
            `${summary}Zoom: ${Math.round(chatView.webContents.zoomFactor * 100)}%`,
        );
    }
}

const isMac = process.platform === "darwin";
function setupZoomHandlers(chatView: WebContentsView) {
    chatView.webContents.on("before-input-event", (_event, input) => {
        if ((isMac ? input.meta : input.control) && input.type === "keyDown") {
            if (
                input.key === "NumpadAdd" ||
                input.key === "+" ||
                input.key === "="
            ) {
                zoomIn(chatView);
            } else if (input.key === "-" || input.key === "NumpadMinus") {
                zoomOut(chatView);
            } else if (input.key === "0") {
                resetZoom(chatView);
            }
        }
    });

    // Register mouse wheel as well.
    chatView.webContents.on("zoom-changed", (_event, zoomDirection) => {
        if (zoomDirection === "in") {
            zoomIn(chatView);
        } else {
            zoomOut(chatView);
        }
    });
}

function setupDevToolsHandlers(view: WebContentsView) {
    view.webContents.on("before-input-event", (_event, input) => {
        if (input.type === "keyDown") {
            if (!is.dev) {
                // Ignore CommandOrControl + R
                if (input.code === "KeyR" && (input.control || input.meta))
                    _event.preventDefault();
            } else {
                // Toggle devtool(F12)
                if (input.code === "F12") {
                    if (view.webContents.isDevToolsOpened()) {
                        view.webContents.closeDevTools();
                    } else {
                        view.webContents.openDevTools({ mode: "undocked" });
                    }
                }
            }
        }
    });
}
