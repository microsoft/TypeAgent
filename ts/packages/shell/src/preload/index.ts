// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { ClientAPI, SpeechToken } from "./electronTypes.js"; // Custom APIs for renderer

const api: ClientAPI = {
    onListenEvent: (
        callback: (
            e: Electron.IpcRendererEvent,
            name: string,
            token?: SpeechToken,
            useLocalWhisper?: boolean,
        ) => void,
    ) => ipcRenderer.on("listen-event", callback),
    processShellRequest: (request: string, id: string) => {
        return ipcRenderer.invoke("request", request, id);
    },
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
    onMicrophoneChangeRequested(callback) {
        ipcRenderer.on("microphone-change-requested", callback);
    },
    onShowDialog(callback) {
        ipcRenderer.on("show-dialog", callback);
    },
    onHideMenuChanged(callback) {
        ipcRenderer.on("hide-menu-changed", callback);
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
