// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { dialog, globalShortcut, ipcMain } from "electron";
import { CONFIG_LOCAL_FILE } from "@typeagent/config";
import { AzureSpeech } from "./azureSpeech.js";
import { ensureLocalWhisper } from "./localWhisperCommandHandler.js";
import { getSpeechProvider } from "./speechProvider.js";
import { localAsrHost } from "./localAsrHost.js";

import registerDebug from "debug";
import {
    getShellWindow,
    getShellWindowForChatViewIpcEvent,
} from "./instance.js";
import {
    SpeechProcessing,
    isLocalSpeechProcessingSupported,
} from "./speechProcessing.js";
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
                `The \`speech\` section of \`${CONFIG_LOCAL_FILE}\` is missing \`auth\` or \`region\`. Switch to local whisper or provide the configuration and restart.`,
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
    const shellWindow = getShellWindow();
    if (shellWindow === undefined) {
        return;
    }
    const chatView = shellWindow.chatView;
    chatView.webContents.send("listen-event", undefined, false);
}

export async function toggleWakeWordRecognition() {
    const shellWindow = getShellWindow();
    if (shellWindow === undefined) {
        return;
    }
    const chatView = shellWindow.chatView;
    chatView.webContents.send("wake-listen");
}

export async function toggleContinuousRecognition() {
    const shellWindow = getShellWindow();
    if (shellWindow === undefined) {
        return;
    }
    const chatView = shellWindow.chatView;
    chatView.webContents.send("listen-always");
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
        if (getShellWindowForChatViewIpcEvent(event) === undefined) {
            return undefined;
        }
        return getSpeechToken(silent);
    });

    ipcMain.handle("get-localWhisper-status", async (event) => {
        // Make sure the request comes from the chat view
        if (getShellWindowForChatViewIpcEvent(event) === undefined) {
            return undefined;
        }
        const selected = getSpeechProvider() === "whisper";
        if (selected) await ensureLocalWhisper();
        return selected;
    });

    ipcMain.handle("get-speech-provider", async (event) => {
        if (!getShellWindowForChatViewIpcEvent(event))
            throw new Error("Untrusted speech caller.");
        const provider = getSpeechProvider();
        return provider;
    });
    ipcMain.handle("local-asr-start", (event) => {
        if (!getShellWindowForChatViewIpcEvent(event))
            throw new Error("Untrusted speech caller.");
        if (getSpeechProvider() !== "nemotron")
            throw new Error("Nemotron is not the selected speech provider.");
        return localAsrHost.start(event.sender);
    });
    ipcMain.handle("local-asr-append", (event, id: string, pcm: Uint8Array) => {
        if (!getShellWindowForChatViewIpcEvent(event))
            throw new Error("Untrusted speech caller.");
        return localAsrHost.append(event.sender, id, pcm);
    });
    ipcMain.handle("local-asr-end", (event, id: string, cancel: boolean) => {
        if (!getShellWindowForChatViewIpcEvent(event))
            throw new Error("Untrusted speech caller.");
        return localAsrHost.end(event.sender, id, cancel);
    });
    ipcMain.handle("speech-error", (event, message: string) => {
        if (!getShellWindowForChatViewIpcEvent(event))
            throw new Error("Untrusted speech caller.");
        if (typeof message !== "string")
            throw new Error("Invalid speech error.");
        localAsrHost.reportError(message);
    });

    ipcMain.handle(
        "continuous-speech-processing",
        async (event, text: string) => {
            // Make sure the request comes from the chat view
            if (getShellWindowForChatViewIpcEvent(event) === undefined) {
                return undefined;
            }

            console.log("Continuous speech processing: " + text);

            if (!isLocalSpeechProcessingSupported()) {
                debugShell(
                    "Continuous speech processing skipped: Copilot provider not supported in the connect-only shell",
                );
                return undefined;
            }

            const shellWindow = getShellWindow();
            if (shellWindow === undefined) {
                return;
            }
            const chatView = shellWindow.chatView;
            SpeechProcessing.getInstance()
                .processSpeech(text)
                .then((expression) => {
                    chatView.webContents.send(
                        "continuous-speech-processed",
                        expression,
                    );
                });
        },
    );

    const ret = globalShortcut.register("Alt+M", triggerRecognitionOnce);
    if (ret) {
        // Double check whether a shortcut is registered.
        debugShell(
            `Global shortcut Alt+M: ${globalShortcut.isRegistered("Alt+M")}`,
        );
    } else {
        debugShellError("Global shortcut registration failed");
    }

    const ret2 = globalShortcut.register(
        "Alt+Shift+M",
        toggleContinuousRecognition,
    );
    if (ret2) {
        // Double check whether a shortcut is registered.
        debugShell(
            `Global shortcut Alt+Shift+M: ${globalShortcut.isRegistered("Alt+Shift+M")}`,
        );
    } else {
        debugShellError("Global shortcut registration failed");
    }

    const ret3 = globalShortcut.register(
        "Ctrl+Shift+M",
        toggleWakeWordRecognition,
    );
    if (ret3) {
        // Double check whether a shortcut is registered.
        debugShell(
            `Global shortcut Ctrl+Shift+M: ${globalShortcut.isRegistered("Ctrl+Shift+M")}`,
        );
    } else {
        debugShellError("Global shortcut registration failed");
    }
}
