// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import {
    ipcMain,
    app,
    shell,
    BrowserWindow,
    globalShortcut,
    Menu,
    MenuItem,
    dialog,
} from "electron";
import { join } from "node:path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { AzureSpeech } from "./azureSpeech.js";
import { runDemo } from "./demo.js";
import registerDebug from "debug";
import {
    ClientIO,
    CommandHandlerContext,
    RequestId,
    getPrompt,
    getSettingSummary,
    initializeCommandHandlerContext,
    processCommand,
    partialInput,
} from "agent-dispatcher";

import { SearchMenuCommand } from "../../../dispatcher/dist/handlers/common/interactiveIO.js";
import {
    ActionTemplateSequence,
    SearchMenuItem,
} from "../preload/electronTypes.js";

const debugShell = registerDebug("typeagent:shell");
const debugShellError = registerDebug("typeagent:shell:error");

const envPath = join(__dirname, "../../../../.env");
dotenv.config({ path: envPath });

// Make sure we have chalk colors
process.env.FORCE_COLOR = "true";

let mainWindow: BrowserWindow | null = null;

const time = performance.now();
debugShell("Starting...");
function createWindow(): void {
    debugShell("Creating window", performance.now() - time);
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 900,
        height: 1200,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, "../preload/index.mjs"),
            sandbox: false,
        },
    });

    mainWindow.on("ready-to-show", () => {
        mainWindow!.show();
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: "deny" };
    });

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    } else {
        mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
    }

    setAppMenu(mainWindow);
    setupZoomHandlers(mainWindow);
}

let speechToken: { token: string; expire: number } | undefined;

async function getSpeechToken() {
    if (speechToken === undefined || speechToken.expire <= Date.now()) {
        debugShell("Getting speech token");
        const tokenResponse = await AzureSpeech.getInstance().getTokenAsync();
        speechToken = {
            token: tokenResponse.token,
            expire: Date.now() + 9 * 60 * 1000, // 9 minutes (token expires in 10 minutes)
        };
    }
    return speechToken;
}

async function triggerRecognitionOnce(context: CommandHandlerContext) {
    const speechToken = await getSpeechToken();
    const useLocalWhisper = typeof context.localWhisper !== "undefined";
    mainWindow?.webContents.send(
        "listen-event",
        "Alt+M",
        speechToken,
        useLocalWhisper,
    );
}

function showResult(
    message: string,
    requestId: RequestId,
    actionIndex?: number,
    groupId?: string,
) {
    // Ignore message without requestId
    if (requestId === undefined) {
        console.warn("showResult: requestId is undefined");
        return;
    }
    mainWindow?.webContents.send(
        "response",
        message,
        requestId,
        actionIndex,
        groupId,
    );
}

function sendStatusMessage(
    message: string,
    requestId: RequestId,
    temporary: boolean = false,
) {
    // Ignore message without requestId
    if (requestId === undefined) {
        console.warn(`sendStatusMessage: requestId is undefined. ${message}`);
        return;
    }
    mainWindow?.webContents.send(
        "status-message",
        message,
        requestId,
        temporary,
    );
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

function updateResult(message: string, group_id: string) {
    mainWindow?.webContents.send("update", message, group_id);
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
    info: () => {
        /* ignore */
    },
    success: sendStatusMessage,
    status: (message, requestId) => sendStatusMessage(message, requestId, true),
    warn: sendStatusMessage,
    error: sendStatusMessage,
    result: showResult,
    setActionStatus: showResult,
    updateActionStatus: updateResult,
    searchMenuCommand,
    actionCommand,
    askYesNo,
    question,
    notify(event: string, requestId: RequestId, data: any) {
        switch (event) {
            case "explained":
                markRequestExplained(
                    requestId,
                    data.time,
                    data.fromCache,
                    data.fromUser,
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

async function initializeSpeech(context: CommandHandlerContext) {
    const key = process.env["SPEECH_SDK_KEY"];
    const region = process.env["SPEECH_SDK_REGION"];
    if (key && region) {
        await AzureSpeech.initializeAsync({
            azureSpeechSubscriptionKey: key,
            azureSpeechRegion: region,
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
        triggerRecognitionOnce(context);
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

    const context = await initializeCommandHandlerContext("shell", {
        explanationAsynchronousMode: true,
        persistSession: true,
        enableServiceHost: true,
        clientIO,
    });
    function translatorSetPartialInputHandler() {
        mainWindow?.webContents.send(
            "set-partial-input-handler",
            context.currentTranslatorName === "player",
        );
    }

    let settingSummary: string = "";
    ipcMain.handle("request", async (_event, text: string, id: string) => {
        if (typeof text !== "string" || typeof id !== "string") {
            throw new Error("Invalid request");
        }
        debugShell(getPrompt(context), text);

        await processCommand(text, context, id);
        mainWindow?.webContents.send("send-demo-event", "CommandProcessed");
        translatorSetPartialInputHandler();
        const newSettingSummary = getSettingSummary(context);
        if (newSettingSummary !== settingSummary) {
            settingSummary = newSettingSummary;
            mainWindow?.webContents.send(
                "setting-summary-changed",
                newSettingSummary,
            );
        }
    });
    ipcMain.on("partial-input", async (_event, text: string) => {
        if (typeof text !== "string") {
            return;
        }
        partialInput(text, context);
    });
    ipcMain.on("dom ready", async () => {
        settingSummary = getSettingSummary(context);
        translatorSetPartialInputHandler();
        mainWindow?.webContents.send("setting-summary-changed", settingSummary);
    });

    await initializeSpeech(context);
    ipcMain.handle("get-localWhisper-status", async () => {
        return typeof context.localWhisper !== "undefined";
    });

    globalShortcut.register("Alt+Right", () => {
        mainWindow?.webContents.send("send-demo-event", "Alt+Right");
    });

    globalShortcut.register("F1", () => {
        mainWindow?.webContents.send("help-requested", "F1");
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
}

function zoomOut(mainWindow: BrowserWindow) {
    const curr = mainWindow.webContents.zoomLevel;
    mainWindow.webContents.zoomLevel = Math.max(curr - 0.5, -8);
}

const isMac = process.platform === "darwin";

function setupZoomHandlers(mainWindow: BrowserWindow) {
    // For some reason zoom out's Ctrl+- accelerator doesn't work. Manually handle it.
    mainWindow.webContents.on("before-input-event", (_event, input) => {
        if ((isMac ? input.meta : input.control) && input.type === "keyDown") {
            // In addition to CmdOrCtrl+= accelerator
            if (input.code == "NumpadAdd") {
                zoomIn(mainWindow);
            } else if (input.key === "-") {
                // REVIEW: accelerator doesn't work for CmdOrCtrl+-. Handle manually.
                // Handle both regular and numpad minus
                zoomOut(mainWindow);
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
function setAppMenu(mainWindow: BrowserWindow) {
    const template: Electron.MenuItemConstructorOptions[] = [
        {
            label: "File",
            role: "fileMenu",
        },
        {
            id: "viewMenu",
            label: "View",
            submenu: [
                { role: "reload" },
                { role: "forceReload" },
                { role: "toggleDevTools" },
                { type: "separator" },
                { role: "resetZoom" },
                {
                    id: "zoomIn",
                    label: "Zoom In",
                    accelerator: "CmdOrCtrl+=",
                    click: () => zoomIn(mainWindow),
                },
                {
                    id: "zoomOut",
                    label: "Zoom Out",
                    accelerator: "CmdOrCtrl+-", // doesn't work for some reason. Handle manually. See setupZoomHandlers
                    click: () => zoomOut(mainWindow),
                },
                { type: "separator" },
                { role: "togglefullscreen" },
            ],
        },
        {
            id: "demoMenu",
            label: "Demo",
            submenu: [],
        },
        {
            id: "windowMenu",
            role: "windowMenu",
        },
        {
            role: "help",
            submenu: [
                {
                    label: "Learn More",
                },
            ],
        },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    const demoItem = menu.getMenuItemById("demoMenu");
    demoItem?.submenu?.append(
        new MenuItem({
            label: "Run Demo",
            click() {
                runDemo(mainWindow!, false);
            },
        }),
    );

    demoItem?.submenu?.append(
        new MenuItem({
            label: "Run Demo Interactive",
            click() {
                runDemo(mainWindow!, true);
            },
        }),
    );

    const windowItem = menu.getMenuItemById("windowMenu");
    windowItem?.submenu?.append(
        new MenuItem({
            label: "Always on Top",
            click() {
                mainWindow?.setAlwaysOnTop(true, "floating");
            },
        }),
    );
}
