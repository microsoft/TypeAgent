// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { ClientAPI, SpeechToken } from "./electronTypes.js"; // Custom APIs for renderer

function getProcessShellRequest() {
    const pendingRequests = new Map<
        string,
        { resolve: () => void; reject: (reason?: any) => void }
    >();

    ipcRenderer.on("process-shell-request-done", (_, id: string) => {
        const pendingRequest = pendingRequests.get(id);
        if (pendingRequest !== undefined) {
            pendingRequest.resolve();
            pendingRequests.delete(id);
        } else {
            console.warn(`Pending request ${id} not found`);
        }
    });
    ipcRenderer.on(
        "process-shell-request-error",
        (_, id: string, message: string) => {
            const pendingRequest = pendingRequests.get(id);
            if (pendingRequest !== undefined) {
                pendingRequest.reject(new Error(message));
                pendingRequests.delete(id);
            } else {
                console.warn(
                    `Pending request ${id} not found for error: ${message}`,
                );
            }
        },
    );

    return (request: string, id: string, images: string[]) => {
        return new Promise<void>((resolve, reject) => {
            pendingRequests.set(id, { resolve, reject });
            ipcRenderer.send("process-shell-request", request, id, images);
        });
    };
}

const api: ClientAPI = {
    onListenEvent: (
        callback: (
            e: Electron.IpcRendererEvent,
            name: string,
            token?: SpeechToken,
            useLocalWhisper?: boolean,
        ) => void,
    ) => ipcRenderer.on("listen-event", callback),

    processShellRequest: getProcessShellRequest(),
    sendPartialInput: (text: string) => {
        ipcRenderer.send("partial-input", text);
    },
    getDynamicDisplay(source: string, id: string) {
        return ipcRenderer.invoke("get-dynamic-display", source, id);
    },
    onActionCommand: (callback) => {
        ipcRenderer.on("action-command", callback);
    },
    onSearchMenuCommand: (callback) => {
        ipcRenderer.on("search-menu-command", callback);
    },
    onResponse(callback) {
        ipcRenderer.on("response", callback);
    },
    onSetDynamicActionDisplay(callback) {
        ipcRenderer.on("set-dynamic-action-display", callback);
    },
    onStatusMessage(callback) {
        ipcRenderer.on("status-message", callback);
    },
    onClear(callback) {
        ipcRenderer.on("clear", callback);
    },
    onSetPartialInputHandler(callback) {
        ipcRenderer.on("set-partial-input-handler", callback);
    },
    onSettingSummaryChanged(callback) {
        ipcRenderer.on("setting-summary-changed", callback);
    },
    onMarkRequestExplained(callback) {
        ipcRenderer.on("mark-explained", callback);
    },
    onRandomCommandSelected(callback) {
        ipcRenderer.on("update-random-command", callback);
    },
    onAskYesNo(callback) {
        ipcRenderer.on("askYesNo", callback);
    },
    sendYesNo: (askYesNoId: number, accept: boolean) => {
        ipcRenderer.send("askYesNoResponse", askYesNoId, accept);
    },
    onQuestion(callback) {
        ipcRenderer.on("question", callback);
    },
    sendAnswer: (questionId: number, answer?: string) => {
        ipcRenderer.send("questionResponse", questionId, answer);
    },
    getSpeechToken: () => {
        return ipcRenderer.invoke("get-speech-token");
    },
    getLocalWhisperStatus: () => {
        return ipcRenderer.invoke("get-localWhisper-status");
    },
    onSendInputText(callback) {
        ipcRenderer.on("send-input-text", callback);
    },
    onSendDemoEvent(callback) {
        ipcRenderer.on("send-demo-event", callback);
    },
    onHelpRequested(callback) {
        ipcRenderer.on("help-requested", callback);
    },
    onRandomMessageRequested(callback) {
        ipcRenderer.on("random-message-requested", callback);
    },
    onShowDialog(callback) {
        ipcRenderer.on("show-dialog", callback);
    },
    onSettingsChanged(callback) {
        ipcRenderer.on("settings-changed", callback);
    },
    onNotificationCommand(callback) {
        ipcRenderer.on("notification-command", callback);
    },
    onNotify(callback) {
        ipcRenderer.on("notification-arrived", callback);
    },
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld("electron", electronAPI);
        contextBridge.exposeInMainWorld("api", api);
    } catch (error) {
        console.error(error);
    }
} else {
    // @ts-ignore (define in dts)
    window.electron = electronAPI;
    // @ts-ignore (define in dts)
    window.api = api;
}
