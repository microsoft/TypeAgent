// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { ClientAPI, SpeechToken } from "./electronTypes.js"; // Custom APIs for renderer
import { ClientIO, Dispatcher } from "agent-dispatcher";
import { createGenericChannel } from "agent-rpc/channel";
import { createDispatcherRpcClient } from "agent-dispatcher/rpc/dispatcher/client";
import { createClientIORpcServer } from "agent-dispatcher/rpc/clientio/server";

let clientIORegistered = false;
const api: ClientAPI = {
    onListenEvent: (
        callback: (
            e: Electron.IpcRendererEvent,
            name: string,
            token?: SpeechToken,
            useLocalWhisper?: boolean,
        ) => void,
    ) => ipcRenderer.on("listen-event", callback),
    onSettingSummaryChanged(callback) {
        ipcRenderer.on("setting-summary-changed", callback);
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
    onShowDialog(callback) {
        ipcRenderer.on("show-dialog", callback);
    },
    onSettingsChanged(callback) {
        ipcRenderer.on("settings-changed", callback);
    },
    onChatHistory(callback) {
        ipcRenderer.on("chat-history", callback);
    },
    onFileSelected(callback) {
        ipcRenderer.on("file-selected", callback);
    },
    registerClientIO: (clientIO: ClientIO) => {
        if (clientIORegistered) {
            throw new Error("ClientIO already registered");
        }
        clientIORegistered = true;
        const clientIOChannel = createGenericChannel((message: any) =>
            ipcRenderer.send("clientio-rpc-reply", message),
        );
        ipcRenderer.on("clientio-rpc-call", (_event, message) => {
            clientIOChannel.message(message);
        });
        createClientIORpcServer(clientIO, clientIOChannel.channel);
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
