// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DynamicDisplay } from "@typeagent/agent-sdk";
import { PartialCompletionResult, RequestMetrics } from "agent-dispatcher";
import { ClientAPI, SpeechToken } from "../../preload/electronTypes";

export const webapi: ClientAPI = {
    onListenEvent: (
        callback: (
            e: Electron.IpcRendererEvent,
            name: string,
            token?: SpeechToken,
            useLocalWhisper?: boolean,
        ) => void,
    ) => placeHolder("listen-event", callback),

    processShellRequest: (request: string, id: string, images: string[]) => {
        return new Promise<RequestMetrics | undefined>((resolve, reject) => {
            placeHolder(id, { resolve, reject });
            placeHolder4("process-shell-request", request, id, images);
        });
    },
    getPartialCompletion: (prefix: string) => {
        return new Promise<PartialCompletionResult | undefined>((resolve, reject) => {
            placeHolder1({ resolve, reject });
            placeHolder("process-shell-request", prefix);
        });
    },
    getDynamicDisplay(source: string, id: string) {
        return new Promise<DynamicDisplay>((resolve, reject) => {
            placeHolder(source, id);
            placeHolder1({resolve, reject});
        });
    },
    onActionCommand: (callback) => {
        placeHolder("action-command", callback);
    },
    onSearchMenuCommand: (callback) => {
        placeHolder("search-menu-command", callback);
    },
    onUpdateDisplay(callback) {
        placeHolder("updateDisplay", callback);
    },
    onSetDynamicActionDisplay(callback) {
        placeHolder("set-dynamic-action-display", callback);
    },
    onClear(callback) {
        placeHolder("clear", callback);
    },
    onSettingSummaryChanged(callback) {
        placeHolder("setting-summary-changed", callback);
    },
    onMarkRequestExplained(callback) {
        placeHolder("mark-explained", callback);
    },
    onRandomCommandSelected(callback) {
        placeHolder("update-random-command", callback);
    },
    onAskYesNo(callback) {
        placeHolder("askYesNo", callback);
    },
    sendYesNo: (askYesNoId: number, accept: boolean) => {
        placeHolder3("askYesNoResponse", askYesNoId, accept);
    },
    onQuestion(callback) {
        placeHolder("question", callback);
    },
    sendAnswer: (questionId: number, answer?: string) => {
        placeHolder3("questionResponse", questionId, answer);
    },
    getSpeechToken: () => {
        return new Promise<SpeechToken | undefined>((resolve, reject) => {
            placeHolder1({resolve, reject});
        });
    },
    getLocalWhisperStatus: () => {
        return new Promise<boolean | undefined>((resolve, reject) => {
            placeHolder1({resolve, reject});
        });
    },
    onSendInputText(callback) {
        placeHolder("send-input-text", callback);
    },
    onSendDemoEvent(callback) {
        placeHolder("send-demo-event", callback);
    },
    onHelpRequested(callback) {
        placeHolder("help-requested", callback);
    },
    onRandomMessageRequested(callback) {
        placeHolder("random-message-requested", callback);
    },
    onShowDialog(callback) {
        placeHolder("show-dialog", callback);
    },
    onSettingsChanged(callback) {
        placeHolder("settings-changed", callback);
    },
    onNotificationCommand(callback) {
        placeHolder("notification-command", callback);
    },
    onNotify(callback) {
        placeHolder("notification-arrived", callback);
    },
    onTakeAction(callback) {
        placeHolder("take-action", callback);
    },
};

function placeHolder1(category: any) {
    console.log(category);
}

function placeHolder(category: string, callback: any) {
    console.log(category + "\n" + callback);
}

function placeHolder3(category: string, data: any, data2: any) {
    console.log(category + "\n" + data + data2);
}

function placeHolder4(category: string, data: any, data2: any, data3: any) {
    console.log(category + "\n" + data + data2 + data3);
}