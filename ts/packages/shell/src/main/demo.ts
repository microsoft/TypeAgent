// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ipcMain, dialog, WebContentsView, BrowserWindow } from "electron";
import { readFileSync } from "fs";

async function openDemoFile(window: BrowserWindow) {
    const options = {
        filters: [{ name: "Text files", extensions: ["txt"] }],
    };

    const result = await dialog.showOpenDialog(window, options);
    if (result && !result.canceled) {
        let paths = result.filePaths;
        if (paths && paths.length > 0) {
            const content = readFileSync(paths[0], "utf-8").toString();
            console.log(content);
            return content;
        }
    }

    return undefined;
}

function getActionCompleteEvent(awaitKeyboardInput: boolean) {
    const timeoutPromise = new Promise((f) => setTimeout(f, 3000));

    const actionPromise = new Promise<string | undefined>((resolve) => {
        const callback = (_event: Electron.IpcMainEvent, name: string) => {
            let targetName = "CommandProcessed";
            if (awaitKeyboardInput) {
                targetName = "Alt+Right";
            }
            if (name === targetName) {
                ipcMain.removeListener("send-demo-event", callback);
                resolve(undefined);
            }
        };
        ipcMain.on("send-demo-event", callback);
    });

    const abortPromise = new Promise<void>((resolve) => {
        abortListeners.push(resolve);
    });

    if (awaitKeyboardInput) {
        return Promise.race([actionPromise, abortPromise]);
    } else {
        return Promise.race([actionPromise, timeoutPromise, abortPromise]);
    }
}

function sendChatInputText(message: string, chatView: WebContentsView) {
    const timeoutPromise = new Promise((f) =>
        setTimeout(f, Math.max(2000, message.length * 50)),
    );

    const actionPromise = new Promise<string | undefined>((resolve) => {
        const callback = (_event: Electron.IpcMainEvent) => {
            ipcMain.removeListener("send-input-text-complete", callback);
            resolve(undefined);
        };
        ipcMain.on("send-input-text-complete", callback);
    });

    const abortPromise = new Promise<void>((resolve) => {
        abortListeners.push(resolve);
    });

    chatView.webContents.send("send-input-text", message);
    return Promise.race([actionPromise, timeoutPromise, abortPromise]);
}

let demoRunning = false;
let demoAborted = false;
const abortListeners: Array<() => void> = [];

export type DemoState = "running" | "paused" | "idle";

function sendDemoState(chatView: WebContentsView, state: DemoState) {
    chatView.webContents.send("demo-state", state);
}

/** Request that the currently-running demo abort at the next safe point. */
export function breakDemo(): boolean {
    if (!demoRunning) return false;
    demoAborted = true;
    const listeners = abortListeners.splice(0);
    for (const l of listeners) l();
    return true;
}

export async function runDemo(
    window: BrowserWindow,
    chatView: WebContentsView,
    awaitKeyboardInput: boolean,
    onStart?: () => void,
) {
    if (demoRunning) {
        await dialog.showMessageBox(window, {
            type: "warning",
            title: "Demo already running",
            message:
                "A demo is already running. Wait for it to finish, press Esc to abort it, or restart the shell before starting another.",
        });
        return;
    }

    const data = await openDemoFile(window);
    if (!data) {
        return;
    }

    demoRunning = true;
    demoAborted = false;
    onStart?.();
    sendDemoState(chatView, "running");
    try {
        const lines = data.split(/\r?\n/);

        for (let line of lines) {
            if (demoAborted) break;
            if (line.startsWith("@pauseForInput")) {
                sendDemoState(chatView, "paused");
                await getActionCompleteEvent(true);
                if (demoAborted) break;
                sendDemoState(chatView, "running");
            } else if (line && !line.startsWith("#")) {
                var manualInput = awaitKeyboardInput && !line.startsWith("@");
                if (manualInput) sendDemoState(chatView, "paused");
                await sendChatInputText(line, chatView);
                await getActionCompleteEvent(manualInput);
                if (manualInput && !demoAborted)
                    sendDemoState(chatView, "running");
            }
        }
    } finally {
        demoRunning = false;
        demoAborted = false;
        sendDemoState(chatView, "idle");
    }
}
