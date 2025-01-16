// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { ClientAPI, SpeechToken } from "./electronTypes.js"; // Custom APIs for renderer
import { Dispatcher } from "agent-dispatcher";
import { createGenericChannel } from "agent-rpc/channel";
import { createDispatcherRpcClient } from "agent-dispatcher/rpc/client";

const api: ClientAPI = {
    onListenEvent: (
        callback: (
            e: Electron.IpcRendererEvent,
            name: string,
            token?: SpeechToken,
            useLocalWhisper?: boolean,
        ) => void,
    ) => ipcRenderer.on("listen-event", callback),
    onUpdateDisplay(callback) {
        ipcRenderer.on("updateDisplay", callback);
    },
    onSetDynamicActionDisplay(callback) {
        ipcRenderer.on("set-dynamic-action-display", callback);
    },
    onClear(callback) {
        ipcRenderer.on("clear", callback);
    },
    onSettingSummaryChanged(callback) {
        ipcRenderer.on("setting-summary-changed", callback);
    },
    onNotifyExplained(callback) {
        ipcRenderer.on("notifyExplained", callback);
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
    onProposeAction(callback) {
        ipcRenderer.on("proposeAction", callback);
    },
    sendProposedAction: (proposeActionId: number, replacement?: unknown) => {
        ipcRenderer.send("proposeActionResponse", proposeActionId, replacement);
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
    onTakeAction(callback) {
        ipcRenderer.on("take-action", callback);
    },
};

const dispatcherChannel = createGenericChannel((message: any) =>
    ipcRenderer.send("dispatcher-rpc-call", message),
);

ipcRenderer.on("dispatcher-rpc-reply", (_event, message) => {
    dispatcherChannel.message(message);
});

const dispatcher: Dispatcher = createDispatcherRpcClient(
    dispatcherChannel.channel,
);

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld("electron", electronAPI);
        contextBridge.exposeInMainWorld("api", api);
        contextBridge.exposeInMainWorld("dispatcher", dispatcher);
    } catch (error) {
        console.error(error);
    }
} else {
    // @ts-ignore (define in dts)
    window.electron = electronAPI;
    // @ts-ignore (define in dts)
    window.api = api;
    // @ts-ignore (define in dts)
    window.dispatcher = dispatcher;
}
