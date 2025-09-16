// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { dialog, globalShortcut, ipcMain } from "electron";
import { AzureSpeech } from "./azureSpeech.js";
import { isLocalWhisperEnabled } from "./localWhisperCommandHandler.js";

import registerDebug from "debug";
import {
    getShellWindowForChatViewIpcEvent,
    ShellWindow,
} from "./shellWindow.js";
const debugShell = registerDebug("typeagent:shell:speech");
const debugShellError = registerDebug("typeagent:shell:speech:error");

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

export async function triggerRecognitionOnce() {
    const shellWindow = ShellWindow.getInstance();
    if (shellWindow === undefined) {
        return;
    }
    const chatView = shellWindow.chatView;
    const speechToken = await getSpeechToken(false);
    const useLocalWhisper = isLocalWhisperEnabled();
    chatView.webContents.send("listen-event", speechToken, useLocalWhisper);
}

export function initializeSpeech() {
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

    ipcMain.handle("get-speech-token", async (event, silent: boolean) => {
        // Make sure the request comes from the chat view
        const shellWindow = getShellWindowForChatViewIpcEvent(event);
        if (shellWindow === undefined) {
            return undefined;
        }
        return getSpeechToken(silent);
    });

    ipcMain.handle("get-localWhisper-status", async (event) => {
        // Make sure the request comes from the chat view
        const shellWindow = getShellWindowForChatViewIpcEvent(event);
        if (shellWindow === undefined) {
            return undefined;
        }
        return isLocalWhisperEnabled();
    });

    const ret = globalShortcut.register("Alt+M", triggerRecognitionOnce);

    if (ret) {
        // Double check whether a shortcut is registered.
        debugShell(
            `Global shortcut Alt+M: ${globalShortcut.isRegistered("Alt+M")}`,
        );
    } else {
        debugShellError("Global shortcut registration failed");
    }
}
