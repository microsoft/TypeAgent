// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ipcMain,
    app,
    globalShortcut,
    dialog,
    shell,
    protocol,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import {
    ensureShellDataDir,
    getShellDataDir,
    ShellSettingManager,
    ShellUserSettings,
} from "./shellSettings.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { closeLocalWhisper } from "./localWhisperCommandHandler.js";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    initializeInstance,
    closeInstance,
    getShellWindow,
    getShellWindowForChatViewIpcEvent,
    getShellWindowForMainWindowIpcEvent,
    fatal,
} from "./instance.js";

import {
    debugShell,
    debugShellCleanup,
    debugShellError,
    debugShellInit,
} from "./debug.js";
import { loadKeys, loadKeysFromEnvFile } from "./keys.js";
import { parseShellCommandLine } from "./args.js";
import {
    setUpdateConfigPath,
    startBackgroundUpdateCheck,
} from "./commands/update.js";
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
const mockGreetings = parsedArgs.mockGreetings ?? false;

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
debugShellInit("Starting...");

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
async function initialize() {
    debugShellInit("Ready", performance.now() - time);

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

            const shellWindow = getShellWindow();
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

        // sync the chat history with any chat history tab
        shellWindow?.chatViewServer?.broadcast(html);
    });

    ipcMain.on("save-settings", (event, settings: ShellUserSettings) => {
        const shellWindow = getShellWindowForChatViewIpcEvent(event);
        shellWindow?.setUserSettings(settings);
    });

    ipcMain.on("views-resized-by-user", (event, newPos: number) => {
        const shellWindow = getShellWindowForMainWindowIpcEvent(event);
        shellWindow?.updateContentSize(newPos);
    });

    ipcMain.handle("toggle-layout", (event) => {
        const shellWindow = getShellWindowForMainWindowIpcEvent(event);
        if (shellWindow) {
            // Toggle the verticalLayout setting
            const currentLayout =
                shellWindow.getUserSettings().ui.verticalLayout;
            const newLayout = !currentLayout;
            shellWindow.setUserSettingValue("ui.verticalLayout", newLayout);

            // Return the new layout state
            return { verticalLayout: newLayout };
        }
        return null;
    });

    // Window control handlers
    ipcMain.on("window-minimize", (event) => {
        const shellWindow = getShellWindowForMainWindowIpcEvent(event);
        shellWindow?.minimize();
    });

    ipcMain.on("window-maximize", (event) => {
        const shellWindow = getShellWindowForMainWindowIpcEvent(event);
        shellWindow?.toggleMaximize();
    });

    ipcMain.on("window-close", (event) => {
        const shellWindow = getShellWindowForMainWindowIpcEvent(event);
        shellWindow?.close();
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

    initializeQuit();

    app.on("activate", function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (getShellWindow() === undefined)
            initializeInstance(instanceDir, shellSettings, mockGreetings);
    });

    // Start up the first instance
    const shellWindow = initializeInstance(
        instanceDir,
        shellSettings,
        mockGreetings,
        time,
    );

    shellWindow.waitForReady().then(() => {
        // Wait until the first shell is ready before we start background update check.
        if (shellSettings.user.autoUpdate.intervalMs !== -1) {
            startBackgroundUpdateCheck(
                shellSettings.user.autoUpdate.intervalMs,
                shellSettings.user.autoUpdate.restart,
                shellSettings.user.autoUpdate.initialIntervalMs,
            );
        }
    });
}

app.whenReady().then(initialize).catch(fatal);

let reloadingInstance = false;
export async function reloadInstance() {
    reloadingInstance = true;
    try {
        await closeInstance();
        const shellSettings = new ShellSettingManager(instanceDir);
        await initializeInstance(instanceDir, shellSettings, mockGreetings);
    } finally {
        reloadingInstance = false;
    }
}

function initializeQuit() {
    let quitting = false;
    let canQuit = false;
    async function quit() {
        quitting = true;

        // Unregister all shortcuts.
        globalShortcut.unregisterAll();

        closeLocalWhisper();

        debugShellCleanup("Closing instance");

        await closeInstance(true);

        debugShellCleanup("Quitting");
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
    if (reloadingInstance === false && process.platform !== "darwin") {
        app.quit();
    }
});

app.on("second-instance", () => {
    // Someone tried to run a second instance, we should focus our window.
    debugShell("Second instance");
    getShellWindow()?.showAndFocus();
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
