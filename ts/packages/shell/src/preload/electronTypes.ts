// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ElectronAPI } from "@electron-toolkit/preload";
import { ShellSettings } from "../main/shellSettings.js";
import { Dispatcher, ClientIO } from "agent-dispatcher";

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

export type DisplayType = "html" | "iframe" | "text" | "markdown";

export type ClientActions =
    | "show-camera"
    | "open-app"
    | "show-notification"
    | "start-intent";

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
    onSettingSummaryChanged(
        callback: (
            e: Electron.IpcRendererEvent,
            summary: string,
            agents: Map<string, string>,
        ) => void,
    ): void;

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
    onShowDialog(
        callback: (e: Electron.IpcRendererEvent, key: string) => void,
    ): void;
    onSettingsChanged(
        callback: (
            e: Electron.IpcRendererEvent,
            settings: ShellSettings,
        ) => void,
    ): void;
    registerClientIO(clientIO: ClientIO);
}

export interface ElectronWindowFields {
    api: ClientAPI;
    dispatcher: Dispatcher;
    electron: ElectronAPI;
}

export type ElectronWindow = typeof globalThis & ElectronWindowFields;
