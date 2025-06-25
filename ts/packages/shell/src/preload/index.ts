// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { contextBridge, ipcRenderer } from "electron";
import { Client, ClientAPI, ShellUserSettings } from "./electronTypes.js"; // Custom APIs for renderer
import { Dispatcher } from "agent-dispatcher";
import { createGenericChannel } from "agent-rpc/channel";
import { createDispatcherRpcClient } from "agent-dispatcher/rpc/dispatcher/client";
import { createClientIORpcServer } from "agent-dispatcher/rpc/clientio/server";

ipcRenderer.on("send-demo-event", (_, name) => {
    // bounce back to the main process
    ipcRenderer.send("send-demo-event", name);
});

let clientRegistered = false;
function registerClient(client: Client) {
    if (clientRegistered) {
        throw new Error("Client already registered");
    }

    // Establish the clientIO RPC
    clientRegistered = true;
    const clientIOChannel = createGenericChannel((message: any) =>
        ipcRenderer.send("clientio-rpc-reply", message),
    );
    ipcRenderer.on("clientio-rpc-call", (_event, message) => {
        clientIOChannel.message(message);
    });
    createClientIORpcServer(client.clientIO, clientIOChannel.channel);

    ipcRenderer.on("listen-event", (_, token, useLocalWhisper) => {
        client.listen(token, useLocalWhisper);
    });
    ipcRenderer.on("setting-summary-changed", (_, updatedAgents) => {
        client.updateRegisterAgents(updatedAgents);
    });
    ipcRenderer.on("send-input-text", async (_, message) => {
        await client.showInputText(message);
        ipcRenderer.send("send-input-text-complete");
    });
    ipcRenderer.on("show-dialog", (_, key) => {
        client.showDialog(key);
    });
    ipcRenderer.on("settings-changed", (_, value: ShellUserSettings) => {
        client.updateSettings(value);
    });
    ipcRenderer.on(
        "file-selected",
        (_, fileName: string, fileContent: string) => {
            client.fileSelected(fileName, fileContent);
        },
    );

    // Signal the main process that the client has been registered
    ipcRenderer.send("dom ready");
}

const api: ClientAPI = {
    registerClient,
    getSpeechToken: (silent: boolean) => {
        return ipcRenderer.invoke("get-speech-token", silent);
    },
    getLocalWhisperStatus: () => {
        return ipcRenderer.invoke("get-localWhisper-status");
    },
    openImageFile: () => {
        ipcRenderer.send("open-image-file");
    },
    getChatHistory: () => {
        return ipcRenderer.invoke("get-chat-history");
    },
    saveChatHistory: (html: string) => {
        ipcRenderer.send("save-chat-history", html);
    },
    saveSettings: (settings: ShellUserSettings) => {
        ipcRenderer.send("save-settings", settings);
    },
    openFolder: (path: string) => {
        ipcRenderer.send("open-folder", path);
    },
};

// set up dispatch RPC client
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
        contextBridge.exposeInMainWorld("api", api);
        contextBridge.exposeInMainWorld("dispatcher", dispatcher);
    } catch (error) {
        console.error(error);
    }
} else {
    // @ts-ignore (define in dts)
    window.api = api;
    // @ts-ignore (define in dts)
    window.dispatcher = dispatcher;
}
