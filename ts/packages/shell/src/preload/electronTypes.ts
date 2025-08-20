// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ShellUserSettings } from "./shellSettingsType.js";
import type { Dispatcher, ClientIO } from "agent-dispatcher";

export type { ShellUserSettings };

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

export type ClientActions =
    | "show-camera"
    | "open-app"
    | "show-notification"
    | "start-intent"
    | "open-folder";

// end duplicate type section

// Functions that are called from the renderer process to the main process.
export interface ClientAPI {
    registerClient: (client: Client) => void;
    getSpeechToken: (silent: boolean) => Promise<SpeechToken | undefined>;
    getLocalWhisperStatus: () => Promise<boolean>;
    getChatHistory: () => Promise<string | undefined>;
    saveChatHistory: (history: string) => void;
    saveSettings: (settings: ShellUserSettings) => void;
    openImageFile: () => void;
    openFolder: (path: string) => void;
}

// Functions that are called from the main process to the renderer process.
export interface Client {
    clientIO: ClientIO;
    updateRegisterAgents(agents: [string, string][]): void;
    showInputText(message: string): Promise<void>;
    showDialog(key: string): void;
    updateSettings(settings: ShellUserSettings): void;
    fileSelected(fileName: string, fileContent: string): void;
    listen(token: SpeechToken | undefined, useLocalWhisper: boolean): void;
}

export interface ElectronWindowFields {
    api: ClientAPI;
    dispatcher: Promise<Dispatcher>;
}

export type ElectronWindow = typeof globalThis & ElectronWindowFields;
