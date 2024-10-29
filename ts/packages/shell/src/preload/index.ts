// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { ClientAPI, SpeechToken } from "./electronTypes.js"; // Custom APIs for renderer
import { RequestMetrics } from "agent-dispatcher";

function getProcessShellRequest() {
    const pendingRequests = new Map<
        string,
        {
            resolve: (metrics?: RequestMetrics) => void;
            reject: (reason?: any) => void;
        }
    >();

    ipcRenderer.on(
        "process-shell-request-done",
        (_, id: string, metrics?: RequestMetrics) => {
            const pendingRequest = pendingRequests.get(id);
            if (pendingRequest !== undefined) {
                pendingRequest.resolve(metrics);
                pendingRequests.delete(id);
            } else {
                console.warn(`Pending request ${id} not found`);
            }
        },
    );
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
        return new Promise<RequestMetrics | undefined>((resolve, reject) => {
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
    getCommandCompletion: (prefix: string) => {
        return ipcRenderer.invoke("getCommandCompletion", prefix);
    },
    getTemplateCompletion: (
        templateAgentName: string,
        templateName: string,
        data: unknown,
        propertyName: string,
    ) => {
        return ipcRenderer.invoke(
            "getTemplateCompletion",
            templateAgentName,
            templateName,
            data,
            propertyName,
        );
    },
    getDynamicDisplay(source: string, id: string) {
        return ipcRenderer.invoke("get-dynamic-display", source, id);
    },
    getTemplateSchema: (
        templateAgentName: string,
        templateName: string,
        data: unknown,
    ) => {
        return ipcRenderer.invoke(
            "get-template-schema",
            templateAgentName,
            templateName,
            data,
        );
    },
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
    onTakeAction(callback) {
        ipcRenderer.on("take-action", callback);
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
