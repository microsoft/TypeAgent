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
} from "electron";
import { join } from "node:path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { AzureSpeech } from "./azureSpeech.js";
import { runDemo } from "./demo.js";
import registerDebug from "debug";
import {
    ClientIO,
    createDispatcher,
    RequestId,
    Dispatcher,
} from "agent-dispatcher";

import {
    IAgentMessage,
    SearchMenuCommand,
} from "../../../dispatcher/dist/handlers/common/interactiveIO.js";
import {
    ActionTemplateSequence,
    SearchMenuItem,
} from "../preload/electronTypes.js";
import { ShellSettings } from "./shellSettings.js";
import { unlinkSync } from "fs";
import { existsSync } from "node:fs";
import { AppAgentEvent, DisplayAppendMode } from "@typeagent/agent-sdk";
import { shellAgentProvider } from "./agent.js";
import { KnowledgeGraph, TypeAgentList, VisualizationNotifier } from "./visualizationNotifier.js";

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

let mainWindow: BrowserWindow | null = null;
let vizWindow: BrowserWindow | null = null;

const time = performance.now();
debugShell("Starting...");
function createWindow(): void {
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

    vizWindow = new BrowserWindow({
        width: ShellSettings.getinstance().width! * 3,
        height: ShellSettings.getinstance().height,
        show: true,
        autoHideMenuBar: true,

        webPreferences: {
            preload: join(__dirname, "../preload/index.mjs"),
            sandbox: false,
            zoomFactor: ShellSettings.getinstance().zoomLevel,
        },
        x: 0,
        y: 0, 

    });

    setupDevicePermissinos(mainWindow);

    mainWindow.on("ready-to-show", () => {
        mainWindow!.show();

        if (ShellSettings.getinstance().devTools) {
            mainWindow?.webContents.openDevTools();
        }

        vizWindow?.webContents.openDevTools();
    });    

    vizWindow.on("ready-to-show", () => {
        vizWindow!.show();
        vizWindow?.webContents.openDevTools();
    });    

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: "deny" };
    });

    mainWindow.on("close", () => {
        if (mainWindow) {
            ShellSettings.getinstance().zoomLevel =
                mainWindow.webContents.zoomLevel;
            ShellSettings.getinstance().devTools =
                mainWindow.webContents.isDevToolsOpened();
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

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
        vizWindow.loadURL(process.env["ELECTRON_RENDERER_URL"] + "/tree.html");
    } else {
        mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
        vizWindow.loadFile(join(__dirname, "../renderer/tree.html"))
    }

    mainWindow.removeMenu();

    setupZoomHandlers(mainWindow);

    // Notify renderer process whenever settings are modified
    ShellSettings.getinstance().onSettingsChanged = (): void => {
        mainWindow?.webContents.send(
            "settings-changed",
            ShellSettings.getinstance().getSerializable(),
        );
    };

    ShellSettings.getinstance().onShowSettingsDialog = (
        dialogName: string,
    ): void => {
        mainWindow?.webContents.send("show-dialog", dialogName);
    };

    ShellSettings.getinstance().onRunDemo = (interactive: boolean): void => {
        runDemo(mainWindow!, interactive);
    };

    ShellSettings.getinstance().toggleToopMost = () => {
        mainWindow?.setAlwaysOnTop(!mainWindow?.isAlwaysOnTop());
    };

    VisualizationNotifier.getinstance().onListChanged = (lists: TypeAgentList) => {
        vizWindow?.webContents.send("update-list-visualization", lists);
    };

    VisualizationNotifier.getinstance().onKnowledgeUpdated = (graph: KnowledgeGraph[][]) => {
        vizWindow?.webContents.send("update-knowledge-visualization", graph);
    };
}

/**
 * Allows the application to gain access to camea devices
 * @param mainWindow the main browser window
 */
function setupDevicePermissinos(mainWindow: BrowserWindow) {
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

async function triggerRecognitionOnce(dispatcher: Dispatcher) {
    const speechToken = await getSpeechToken();
    const useLocalWhisper =
        typeof dispatcher.getContext().localWhisper !== "undefined";
    mainWindow?.webContents.send(
        "listen-event",
        "Alt+M",
        speechToken,
        useLocalWhisper,
    );
}

function updateDisplay(message: IAgentMessage, mode?: DisplayAppendMode) {
    // Ignore message without requestId
    if (message.requestId === undefined) {
        console.warn("updateDisplay: requestId is undefined");
        return;
    }
    mainWindow?.webContents.send("updateDisplay", message, mode);
}

function markRequestExplained(
    requestId: RequestId,
    timestamp: string,
    fromCache?: boolean,
    fromUser?: boolean,
) {
    // Ignore message without requestId
    if (requestId === undefined) {
        console.warn("markRequestExplained: requestId is undefined");
        return;
    }
    mainWindow?.webContents.send(
        "mark-explained",
        requestId,
        timestamp,
        fromCache,
        fromUser,
    );
}

function updateRandomCommandSelected(requestId: RequestId, message: string) {
    // Ignore message without requestId
    if (requestId === undefined) {
        console.warn("updateRandomCommandSelected: requestId is undefined");
        return;
    }

    mainWindow?.webContents.send("update-random-command", requestId, message);
}

let maxAskYesNoId = 0;
async function askYesNo(
    message: string,
    requestId: RequestId,
    defaultValue: boolean = false,
) {
    // Ignore message without requestId
    if (requestId === undefined) {
        console.warn("askYesNo: requestId is undefined");
        return defaultValue;
    }
    const currentAskYesNoId = maxAskYesNoId++;
    return new Promise<boolean>((resolve) => {
        const callback = (
            _event: Electron.IpcMainEvent,
            questionId: number,
            response: boolean,
        ) => {
            if (currentAskYesNoId !== questionId) {
                return;
            }
            ipcMain.removeListener("askYesNoResponse", callback);
            resolve(response);
        };
        ipcMain.on("askYesNoResponse", callback);
        mainWindow?.webContents.send(
            "askYesNo",
            currentAskYesNoId,
            message,
            requestId,
        );
    });
}

let maxQuestionId = 0;
async function question(message: string, requestId: RequestId) {
    // Ignore message without requestId
    if (requestId === undefined) {
        console.warn("question: requestId is undefined");
        return undefined;
    }
    const currentQuestionId = maxQuestionId++;
    return new Promise<string | undefined>((resolve) => {
        const callback = (
            _event: Electron.IpcMainEvent,
            questionId: number,
            response?: string,
        ) => {
            if (currentQuestionId !== questionId) {
                return;
            }
            ipcMain.removeListener("questionResponse", callback);
            resolve(response);
        };
        ipcMain.on("questionResponse", callback);
        mainWindow?.webContents.send(
            "question",
            currentQuestionId,
            message,
            requestId,
        );
    });
}

function searchMenuCommand(
    menuId: string,
    command: SearchMenuCommand,
    prefix?: string,
    choices?: SearchMenuItem[],
    visible?: boolean,
) {
    mainWindow?.webContents.send(
        "search-menu-command",
        menuId,
        command,
        prefix,
        choices,
        visible,
    );
}

function actionCommand(
    actionTemplates: ActionTemplateSequence,
    command: string,
    requestId: RequestId,
) {
    mainWindow?.webContents.send(
        "action-command",
        actionTemplates,
        command,
        requestId,
    );
}

const clientIO: ClientIO = {
    clear: () => {
        mainWindow?.webContents.send("clear");
    },
    setDisplay: updateDisplay,
    appendDisplay: (message, mode) => updateDisplay(message, mode ?? "inline"),
    setDynamicDisplay,
    searchMenuCommand,
    actionCommand,
    askYesNo,
    question,
    notify(event: string, requestId: RequestId, data: any, source: string) {
        switch (event) {
            case "explained":
                markRequestExplained(
                    requestId,
                    data.time,
                    data.fromCache,
                    data.fromUser,
                );
                break;
            case "randomCommandSelected":
                updateRandomCommandSelected(requestId, data.message);
                break;
            case "showNotifications":
                mainWindow?.webContents.send(
                    "notification-command",
                    requestId,
                    data,
                );
                break;
            case AppAgentEvent.Error:
            case AppAgentEvent.Warning:
            case AppAgentEvent.Info:
                console.log(`[${event}] ${source}: ${data}`);
                mainWindow?.webContents.send(
                    "notification-arrived",
                    event,
                    requestId,
                    source,
                    data,
                );
                break;
            default:
            // ignore
        }
    },
    exit: () => {
        app.quit();
    },
};

async function setDynamicDisplay(
    source: string,
    requestId: RequestId,
    actionIndex: number,
    displayId: string,
    nextRefreshMs: number,
) {
    mainWindow?.webContents.send(
        "set-dynamic-action-display",
        source,
        requestId,
        actionIndex,
        displayId,
        nextRefreshMs,
    );
}

async function initializeSpeech(dispatcher: Dispatcher) {
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
        triggerRecognitionOnce(dispatcher);
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

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
    debugShell("Ready", performance.now() - time);
    // Set app user model id for windows
    electronApp.setAppUserModelId("com.electron");

    const dispatcher = await createDispatcher("shell", {
        appAgentProviders: [shellAgentProvider],
        explanationAsynchronousMode: true,
        persistSession: true,
        enableServiceHost: true,
        metrics: true,
        clientIO,
    });

    let settingSummary: string = "";
    async function processShellRequest(
        text: string,
        id: string,
        images: string[],
    ) {
        if (typeof text !== "string" || typeof id !== "string") {
            throw new Error("Invalid request");
        }
        debugShell(dispatcher.getPrompt(), text);

        const metrics = await dispatcher.processCommand(text, id, images);
        mainWindow?.webContents.send("send-demo-event", "CommandProcessed");
        const newSettingSummary = dispatcher.getSettingSummary();
        if (newSettingSummary !== settingSummary) {
            settingSummary = newSettingSummary;
            mainWindow?.webContents.send(
                "setting-summary-changed",
                newSettingSummary,
                dispatcher.getTranslatorNameToEmojiMap(),
            );
        }

        return metrics;
    }

    ipcMain.on(
        "process-shell-request",
        (_event, text: string, id: string, images: string[]) => {
            processShellRequest(text, id, images)
                .then((metrics) =>
                    mainWindow?.webContents.send(
                        "process-shell-request-done",
                        id,
                        metrics,
                    ),
                )
                .catch((error) => {
                    mainWindow?.webContents.send(
                        "process-shell-request-error",
                        id,
                        error.message,
                    );
                });
        },
    );
    ipcMain.handle(
        "get-dynamic-display",
        async (_event, appAgentName: string, id: string) =>
            dispatcher.getDynamicDisplay(appAgentName, "html", id),
    );
    ipcMain.on("dom ready", async () => {
        settingSummary = dispatcher.getSettingSummary();
        mainWindow?.webContents.send(
            "setting-summary-changed",
            settingSummary,
            dispatcher.getTranslatorNameToEmojiMap(),
        );

        // Send settings asap
        ShellSettings.getinstance().onSettingsChanged!();
    });

    await initializeSpeech(dispatcher);
    ipcMain.handle("get-localWhisper-status", async () => {
        return typeof dispatcher.getContext().localWhisper !== "undefined";
    });

    ipcMain.on("save-settings", (_event, settings: ShellSettings) => {
        // Save the shell configurable settings
        ShellSettings.getinstance().microphoneId = settings.microphoneId;
        ShellSettings.getinstance().microphoneName = settings.microphoneName;
        ShellSettings.getinstance().tts = settings.tts;
        ShellSettings.getinstance().ttsSettings = settings.ttsSettings;
        ShellSettings.getinstance().agentGreeting = settings.agentGreeting;
        ShellSettings.getinstance().save();
    });

    globalShortcut.register("Alt+Right", () => {
        mainWindow?.webContents.send("send-demo-event", "Alt+Right");
    });

    globalShortcut.register("F1", () => {
        mainWindow?.webContents.send("help-requested", "F1");
    });

    globalShortcut.register("F2", () => {
        mainWindow?.webContents.send("random-message-requested", "F2");
    });

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on("browser-window-created", (_, window) => {
        optimizer.watchWindowShortcuts(window);
    });

    createWindow();

    app.on("activate", function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("will-quit", () => {
    // Unregister all shortcuts.
    globalShortcut.unregisterAll();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

function zoomIn(mainWindow: BrowserWindow) {
    const curr = mainWindow.webContents.zoomLevel;
    mainWindow.webContents.zoomLevel = Math.min(curr + 0.5, 9);

    ShellSettings.getinstance().set(
        "zoomLevel",
        mainWindow.webContents.zoomLevel,
    );
}

function zoomOut(mainWindow: BrowserWindow) {
    const curr = mainWindow.webContents.zoomLevel;
    mainWindow.webContents.zoomLevel = Math.max(curr - 0.5, -8);
    ShellSettings.getinstance().set(
        "zoomLevel",
        mainWindow.webContents.zoomLevel,
    );
}

const isMac = process.platform === "darwin";

function setupZoomHandlers(mainWindow: BrowserWindow) {
    mainWindow.webContents.on("before-input-event", (_event, input) => {
        if ((isMac ? input.meta : input.control) && input.type === "keyDown") {
            if (
                input.key === "NumpadAdd" ||
                input.key === "+" ||
                input.key === "="
            ) {
                zoomIn(mainWindow);
            } else if (input.key === "-" || input.key === "NumpadMinus") {
                zoomOut(mainWindow);
            } else if (input.key === "0") {
                mainWindow.webContents.zoomLevel = 0;
                ShellSettings.getinstance().set("zoomLevel", 0);
            }
        }
    });

    // Register mouse wheel as well.
    mainWindow.webContents.on("zoom-changed", (_event, zoomDirection) => {
        if (zoomDirection === "in") {
            zoomIn(mainWindow);
        } else {
            zoomOut(mainWindow);
        }
    });
}

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
