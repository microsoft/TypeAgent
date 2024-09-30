// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { ipcMain, app, shell, BrowserWindow, globalShortcut } from "electron";
import { join } from "node:path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import registerDebug from "debug";
import {
    KnowledgeGraph,
    KnowledgeHierarchy,
    TypeAgentList,
    VisualizationNotifier,
} from "./visualizationNotifier.js";

const debugShell = registerDebug("typeagent:shell");
//const debugShellError = registerDebug("typeagent:shell:error");

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
        width: 1600,
        height: 1200,
        show: false,
        autoHideMenuBar: true,

        webPreferences: {
            preload: join(__dirname, "../preload/index.mjs"),
            sandbox: false,
            zoomFactor: 1,
        },
        // x: ShellSettings.getinstance().x,
        // y: ShellSettings.getinstance().y,
    });

    mainWindow.on("ready-to-show", () => {
        mainWindow!.show();

        // if (ShellSettings.getinstance().devTools) {
        //     mainWindow?.webContents.openDevTools();
        // }
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: "deny" };
    });

    mainWindow.on("close", () => {});

    mainWindow.on("closed", () => {});

    mainWindow.on("moved", () => {});

    mainWindow.on("resized", () => {});

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    } else {
        mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
    }

    mainWindow.removeMenu();

    setupZoomHandlers(mainWindow);
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
    debugShell("Ready", performance.now() - time);
    // Set app user model id for windows
    electronApp.setAppUserModelId("com.electron");

    ipcMain.on("dom ready", async () => {
        VisualizationNotifier.getinstance().onListChanged = (
            lists: TypeAgentList,
        ) => {
            mainWindow?.webContents.send("update-list-visualization", lists);
        };

        VisualizationNotifier.getinstance().onKnowledgeUpdated = (
            graph: KnowledgeGraph[][],
        ) => {
            mainWindow?.webContents.send(
                "update-knowledge-visualization",
                graph,
            );
        };

        VisualizationNotifier.getinstance().onHierarchyUpdated = (
            hierarchy: KnowledgeHierarchy[],
        ) => {
            mainWindow?.webContents.send(
                "update-hierarchy-visualization",
                hierarchy,
            );
        };

        VisualizationNotifier.getinstance().onWordsUpdated = (
            words: string[],
        ) => {
            mainWindow?.webContents.send("update-wordcloud", words);
        };
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
