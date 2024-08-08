// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ipcMain, BrowserWindow, dialog } from "electron";
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
            if (name == targetName) {
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

function sendChatInputText(message: string, window: BrowserWindow) {
    const timeoutPromise = new Promise((f) => setTimeout(f, 2000));

    const actionPromise = new Promise<string | undefined>((resolve) => {
        const callback = (_event: Electron.IpcMainEvent) => {
            ipcMain.removeListener("send-input-text-complete", callback);
            resolve(undefined);
        };
        ipcMain.on("send-input-text-complete", callback);
    });

    window?.webContents.send("send-input-text", message);
    return Promise.race([actionPromise, timeoutPromise]);
}

export async function runDemo(
    window: BrowserWindow,
    awaitKeyboardInput: boolean,
) {
    const data = await openDemoFile(window);
    if (data) {
        const lines = data.split(/\r?\n/);

        for (let line of lines) {
            if (line.startsWith("@pauseForInput")) {
                await getActionCompleteEvent(true);
            } else if (line && !line.startsWith("#")) {
                await sendChatInputText(line, window);
                var manualInput = awaitKeyboardInput && !line.startsWith("@");
                await getActionCompleteEvent(manualInput);
            }
        }
    }
}
