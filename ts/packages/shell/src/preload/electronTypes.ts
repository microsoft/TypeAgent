// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ElectronAPI } from "@electron-toolkit/preload";
import {
    AppAgentEvent,
    DisplayAppendMode,
    DynamicDisplay,
    TemplateSchema,
} from "@typeagent/agent-sdk";
import { ShellSettings } from "../main/shellSettings.js";
import {
    TemplateEditConfig,
    IAgentMessage,
    CommandCompletionResult,
    NotifyExplainedData,
} from "agent-dispatcher";
import { RequestMetrics } from "agent-dispatcher";

export type SpeechToken = {
    token: string;
    expire: number;
    endpoint: string;
    region: string;
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

export type DisplayType = "html" | "iframe" | "text";

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
    getCommandCompletion: (
        input: string,
    ) => Promise<CommandCompletionResult | undefined>;
    getTemplateCompletion: (
        templateAgentName: string,
        templateName: string,
        data: unknown,
        propertyName: string,
    ) => Promise<string[]>;
    getDynamicDisplay: (source: string, id: string) => Promise<DynamicDisplay>;
    getTemplateSchema: (
        templateAgentName: string,
        templateName: string,
        data: unknown,
    ) => Promise<TemplateSchema>;
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
    onClear(
        callback: (
            e: Electron.IpcRendererEvent,
            updateMessage: string,
            group_id: string,
        ) => void,
    ): void;
    onNotifyExplained(
        callback: (
            e: Electron.IpcRendererEvent,
            requestId: string,
            data: NotifyExplainedData,
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
    onProposeAction(
        callback: (
            e: Electron.IpcRendererEvent,
            proposeActionId: number,
            actionTemplates: TemplateEditConfig,
            requestId: string,
            source: string,
        ) => void,
    ): void;
    sendProposedAction(proposeActionId: number, replacement?: unknown): void;
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
    ): void;
    onNotify(
        callback: (
            e: Electron.IpcRendererEvent,
            event: AppAgentEvent,
            requestId: string,
            source: string,
            data: any,
        ) => void,
    ): void;
    onTakeAction(
        callback: (e: Electron.IpcRendererEvent, action: string) => void,
    );
}

export interface ElectronWindowFields {
    api: ClientAPI;
    electron: ElectronAPI;
}

export type ElectronWindow = typeof globalThis & ElectronWindowFields;
