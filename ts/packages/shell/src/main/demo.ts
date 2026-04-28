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

    if (awaitKeyboardInput) {
        return actionPromise;
    } else {
        return Promise.race([actionPromise, timeoutPromise]);
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

    chatView.webContents.send("send-input-text", message);
    return Promise.race([actionPromise, timeoutPromise]);
}

let demoRunning = false;

export async function runDemo(
    window: BrowserWindow,
    chatView: WebContentsView,
    awaitKeyboardInput: boolean,
) {
    if (demoRunning) {
        await dialog.showMessageBox(window, {
            type: "warning",
            title: "Demo already running",
            message:
                "A demo is already running. Wait for it to finish (or restart the shell) before starting another.",
        });
        return;
    }

    demoRunning = true;
    try {
        const data = await openDemoFile(window);
        if (data) {
            const lines = data.split(/\r?\n/);

            for (let line of lines) {
                if (line.startsWith("@pauseForInput")) {
                    await getActionCompleteEvent(true);
                } else if (line && !line.startsWith("#")) {
                    await sendChatInputText(line, chatView);
                    var manualInput =
                        awaitKeyboardInput && !line.startsWith("@");
                    await getActionCompleteEvent(manualInput);
                }
            }
        }
    } finally {
        demoRunning = false;
    }
}
