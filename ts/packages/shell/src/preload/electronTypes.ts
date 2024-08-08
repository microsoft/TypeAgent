// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ElectronAPI } from "@electron-toolkit/preload";

export type SpeechToken = {
    token: string;
    expire: number;
};

// TODO: remove duplicate types due to package circular dependencies (commonUtils/command.ts is other source)

export type SearchMenuItem = {
    matchText: string;
    emojiChar?: string;
    groupName?: string;
};

export type TemplateParamValue = {
    type: "string" | "number" | "boolean" | "unknown";
};

export type TemplateParamStringUnion = {
    type: "string-union";
    values: string[];
};

export type TemplateParamArray = {
    type: "array";
    elementType: TemplateParamField;
};

export type TemplateParamObject = {
    type: "object";
    fields: {
        [key: string]: TemplateParamFieldOpt;
    };
};

export type TemplateParamFieldOpt = {
    optional?: boolean;
    fieldType: TemplateParamField;
};

export type TemplateParamField =
    | TemplateParamValue
    | TemplateParamStringUnion
    | TemplateParamObject
    | TemplateParamArray;

export interface ITemplateAction {
    actionName: string;
    parameters: TemplateParamObject;
}

// end duplicate type section

export interface ClientAPI {
    onListenEvent: (
        callback: (
            e: Electron.IpcRendererEvent,
            name: string,
            token?: SpeechToken,
            useLocalWhisper?: boolean,
        ) => void,
    ) => void;
    processShellRequest: (request: string, id: string) => Promise<void>;
    sendPartialInput: (text: string) => void;
    onResponse(
        callback: (
            e: Electron.IpcRendererEvent,
            response: string | undefined,
            id: string,
            actionIndex?: number,
            group_id?: string,
        ) => void,
    ): void;
    onUpdate(
        callback: (
            e: Electron.IpcRendererEvent,
            updateMessage: string,
            group_id: string,
        ) => void,
    ): void;
    onSetPartialInputHandler(
        callback: (e: Electron.IpcRendererEvent, enabled: boolean) => void,
    ): void;
    onClear(
        callback: (
            e: Electron.IpcRendererEvent,
            updateMessage: string,
            group_id: string,
        ) => void,
    ): void;
    onStatusMessage(
        callback: (
            e: Electron.IpcRendererEvent,
            message: string,
            id: string,
            temporary: boolean,
        ) => void,
    ): void;
    onSearchMenuCommand(
        callback: (
            e: Electron.IpcRendererEvent,
            menuId: string,
            command: string,
            prefix?: string,
            choices?: SearchMenuItem[],
            visible?: boolean,
        ) => void,
    ): void;
    onMarkRequestExplained(
        callback: (
            e: Electron.IpcRendererEvent,
            id: string,
            timestamp: string,
            fromCache?: boolean,
        ) => void,
    ): void;
    onSettingSummaryChanged(
        callback: (e: Electron.IpcRendererEvent, summary: string) => void,
    ): void;
    onAskYesNo(
        callback: (
            e: Electron.IpcRendererEvent,
            askYesNoId: number,
            message: string,
            requestId: string,
        ) => void,
    ): void;
    sendYesNo: (askYesNoId: number, accept: boolean) => void;
    onQuestion(
        callback: (
            e: Electron.IpcRendererEvent,
            questionId: number,
            message: string,
            requestId: string,
        ) => void,
    ): void;
    sendAnswer: (questionId: number, answer?: string) => void;
    getSpeechToken: () => Promise<SpeechToken | undefined>;
    getLocalWhisperStatus: () => Promise<boolean | undefined>;
    onSendInputText(
        callback: (e: Electron.IpcRendererEvent, message: string) => void,
    ): void;
    onSendDemoEvent(
        callback: (e: Electron.IpcRendererEvent, name: string) => void,
    ): void;
    onHelpRequested(
        callback: (e: Electron.IpcRendererEvent, key: string) => void,
    ): void;
}

export interface ElectronWindowFields {
    api: ClientAPI;
    electron: ElectronAPI;
}

export type ElectronWindow = typeof globalThis & ElectronWindowFields;
