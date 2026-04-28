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

import type { SearchMenuItem } from "agent-dispatcher/helpers/completion";
export type { SearchMenuItem };

export type SearchMenuPosition = {
    left: number;
    bottom: number;
};

export type SearchMenuUIUpdateData = {
    position?: SearchMenuPosition;
    prefix?: string;
    items?: SearchMenuItem[];
};

// Functions that are called from the renderer process to the main process.
export interface ClientAPI {
    registerClient: (client: Client) => void;
    getSpeechToken: (silent: boolean) => Promise<SpeechToken | undefined>;
    getLocalWhisperStatus: () => Promise<boolean>;
    getChatHistory: () => Promise<{ html: string; seq: number } | undefined>;
    saveChatHistory: (history: string, seq: number) => void;
    saveSettings: (settings: ShellUserSettings) => void;
    openImageFile: () => void;
    openFolder: (path: string) => void;
    openUrlInBrowserTab: (url: string) => void;
    openUrlExternal: (url: string) => void;

    searchMenuUpdate(
        id: number,
        data: {
            position?: SearchMenuPosition;
            prefix?: string;
            items?: SearchMenuItem[];
            visibleItemsCount?: number;
        },
    ): void;
    searchMenuAdjustSelection(id: number, deltaY: number): void;
    searchMenuSelectCompletion(id: number): void;
    searchMenuClose(id: number): void;
    continuousSpeechProcessing(text: string): Promise<string | undefined>;

    // Conversation management
    conversationList(): Promise<ConversationInfo[]>;
    conversationCreate(name: string): Promise<ConversationInfo>;
    conversationSwitch(
        conversationId: string,
    ): Promise<ConversationSwitchResult>;
    conversationRename(conversationId: string, newName: string): Promise<void>;
    conversationDelete(conversationId: string): Promise<void>;
    conversationGetCurrent(): Promise<
        { conversationId: string; name: string } | undefined
    >;
}

// Functions that are called from the main process to the renderer process.
export interface Client {
    clientIO: ClientIO;
    dispatcherInitialized(dispatcher: Dispatcher): void;
    updateRegisterAgents(agents: [string, string][]): void;
    showInputText(message: string): Promise<void>;
    showDialog(key: string): void;
    updateSettings(settings: ShellUserSettings): void;
    fileSelected(fileName: string, fileContent: string): void;
    listen(token: SpeechToken | undefined, useLocalWhisper: boolean): void;
    toggleAlwaysListen(waitforWakeWord: boolean): void;
    focusInput(): void;
    titleUpdated(title: string): void;

    searchMenuCompletion(id: number, item: SearchMenuItem): void;
    continuousSpeechProcessed(userExpressions: UserExpression[]): void;
    tabRestoreStatus(count: number): void;
    systemNotification?(message: string, id: string, timestamp: number): void;
    conversationChanged?(conversationId: string, name: string): void;
    markHistoryEntries?(): void;
}

export interface ElectronWindowFields {
    api: ClientAPI;
}

export type ElectronWindow = typeof globalThis & ElectronWindowFields;

// NOTE: This type is duplicated in speechProcessingSchema.ts and must be kept in sync.
export type UserExpression = {
    type: "statement" | "question" | "command" | "other";
    other_explanation?: string;
    confidence: "low" | "medium" | "high";
    complete_statement: boolean;
    text: string;
};

// Conversation management types
export type ConversationInfo = {
    conversationId: string;
    name: string;
    clientCount: number;
    createdAt: string; // ISO 8601
};

export type ConversationSwitchResult = {
    success: boolean;
    conversationId?: string;
    name?: string;
    error?: string;
};
