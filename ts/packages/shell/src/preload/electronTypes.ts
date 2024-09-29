// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ElectronAPI } from "@electron-toolkit/preload";
import {
    AppAgentEvent,
    DisplayAppendMode,
    DynamicDisplay,
} from "@typeagent/agent-sdk";
import { ShellSettings } from "../main/shellSettings.js";
import { IAgentMessage } from "agent-dispatcher";
import { RequestMetrics } from "agent-dispatcher";

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

export enum NotifyCommands {
    ShowSummary = "summarize",
    Clear = "clear",
    ShowUnread = "unread",
    ShowAll = "all",
}

export type EmptyFunction = () => void;
export type SetSettingFunction = (name: string, value: any) => void;
export interface ClientSettingsProvider {
    set: SetSettingFunction | null;
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
    processShellRequest: (
        request: string,
        id: string,
        images: string[],
    ) => Promise<RequestMetrics | undefined>;
    getDynamicDisplay: (source: string, id: string) => Promise<DynamicDisplay>;
    onUpdateDisplay(
        callback: (
            e: Electron.IpcRendererEvent,
            message: IAgentMessage,
            mode?: DisplayAppendMode,
        ) => void,
    ): void;
    onSetDynamicActionDisplay(
        callback: (
            e: Electron.IpcRendererEvent,
            source: string,
            id: string,
            actionIndex: number,
            displayId: string,
            nextRefreshMs: number,
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
        callback: (
            e: Electron.IpcRendererEvent,
            summary: string,
            agents: Map<string, string>,
        ) => void,
    ): void;
    onAskYesNo(
        callback: (
            e: Electron.IpcRendererEvent,
            askYesNoId: number,
            message: string,
            requestId: string,
            source: string,
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
    onShowDialog(
        callback: (e: Electron.IpcRendererEvent, key: string) => void,
    ): void;
    onSettingsChanged(
        callback: (
            e: Electron.IpcRendererEvent,
            settings: ShellSettings,
        ) => void,
    ): void;
    onNotificationCommand(
        callback: (
            e: Electron.IpcRendererEvent,
            requestId: string,
            command: string,
        ) => void,
    );
    onNotify(
        callback: (
            e: Electron.IpcRendererEvent,
            event: AppAgentEvent,
            requestId: string,
            source: string,
            data: any,
        ) => void,
    ): void;
    onUpdateListVisualization(
        callback: (e: Electron.IpcRendererEvent, data) => void,
    ): void;
    onUpdateKnowledgeVisualization(
        callback: (e: Electron.IpcRendererEvent, data) => void,
    ): void;
    onUpdateKnowledgeHierarchyVisualization(
        callback: (e: Electron.IpcRendererEvent, data) => void,
    ): void;    
}

export interface ElectronWindowFields {
    api: ClientAPI;
    electron: ElectronAPI;
}

export type ElectronWindow = typeof globalThis & ElectronWindowFields;
