// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ElectronAPI } from "@electron-toolkit/preload";

export type SpeechToken = {
    token: string;
    expire: number;
    endpoint: string;
    region: string;
};

// TODO: remove duplicate types due to package circular dependencies (commonUtils/command.ts is other source)

export type SearchMenuItem = {
    matchText: string;
    selectedText: string;
    emojiChar?: string;
    groupName?: string;
};

export type ActionUICommand = "register" | "replace" | "remove";
export type ActionInfo = {
    actionTemplates: ActionTemplateSequence;
    requestId: string;
};

export type TemplateParamPrimitive = {
    type: "string" | "number" | "boolean";
    value?: string | number | boolean;
};

export type TemplateParamStringUnion = {
    type: "string-union";
    typeEnum: string[];
    value?: string;
};

export type TemplateParamScalar =
    | TemplateParamPrimitive
    | TemplateParamStringUnion;

export type TemplateParamArray = {
    type: "array";
    elementType: TemplateParamField;
    elements?: TemplateParamField[];
};

export type TemplateParamObject = {
    type: "object";
    fields: {
        [key: string]: TemplateParamFieldOpt;
    };
};

export type TemplateParamFieldOpt = {
    optional?: boolean;
    field: TemplateParamField;
};

export type TemplateParamField =
    | TemplateParamScalar
    | TemplateParamObject
    | TemplateParamArray;

export type ActionTemplate = {
    agent: string;
    name: string;
    parameterStructure: TemplateParamObject;
};

export type ActionTemplateSequence = {
    templates: ActionTemplate[];
    prefaceSingle?: string;
    prefaceMultiple?: string;
};

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
            source: string,
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
            source: string,
            temporary: boolean,
        ) => void,
    ): void;
    onActionCommand(
        callback: (
            e: Electron.IpcRendererEvent,
            actionTemplates: ActionTemplateSequence,
            command: ActionUICommand,
            requestId: string,
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
    onRandomCommandSelected(
        callback: (
            e: Electron.IpcRendererEvent,
            id: string,
            message: string,
        ) => void,
    ): void;
    onSettingSummaryChanged(
        callback: (e: Electron.IpcRendererEvent, summary: string, agents: Map<string, string>) => void,
    ): void;
    onAskYesNo(
        callback: (
            e: Electron.IpcRendererEvent,
            askYesNoId: number,
            message: string,
            requestId: string,
            source: string
        ) => void,
    ): void;
    sendYesNo: (askYesNoId: number, accept: boolean) => void;
    onQuestion(
        callback: (
            e: Electron.IpcRendererEvent,
            questionId: number,
            message: string,
            requestId: string,
            source: string,
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
    onRandomMessageRequested(
        callback: (e: Electron.IpcRendererEvent, key: string) => void,
    ): void;
}

export interface ElectronWindowFields {
    api: ClientAPI;
    electron: ElectronAPI;
}

export type ElectronWindow = typeof globalThis & ElectronWindowFields;
