// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TTSSettings = {
    provider?: string | undefined;
    voice?: string | undefined;
};

export type UISettings = {
    verticalLayout: boolean;
    verticalContentAlwaysVisible: boolean;
    horizontalContentAlwaysVisible: boolean;
    dev: boolean;
    darkMode: boolean;
};
export type ShellUserSettings = {
    microphoneId: string | undefined;
    microphoneName: string | undefined;
    tts: boolean;
    ttsSettings: TTSSettings;
    agentGreeting: boolean;
    multiModalContent: boolean;
    ui: UISettings;
    partialCompletion: boolean;
    chatHistory: boolean; // should the shell load the chat history?
    notifyFilter: string;
    disallowedDisplayType: string; // semicolon separated list of display types that should not be used
    canvas: string | undefined; // the last item shown in the canvas
    autoUpdate: {
        intervalMs: number; // the interval in milliseconds to check for updates
        initialIntervalMs: number; // the initial interval in milliseconds to check for updates
        restart: boolean; // should the shell restart after an update?
    };
};

export const defaultUserSettings: ShellUserSettings = {
    microphoneId: undefined,
    microphoneName: undefined,
    notifyFilter: "error;warning;",
    tts: false,
    ttsSettings: {
        provider: undefined,
        voice: undefined,
    },
    agentGreeting: true,
    multiModalContent: true,
    ui: {
        verticalLayout: false,
        verticalContentAlwaysVisible: true,
        horizontalContentAlwaysVisible: false,
        dev: false,
        darkMode: false,
    },
    partialCompletion: true,
    disallowedDisplayType: "",
    chatHistory: true,
    canvas: undefined,
    autoUpdate: {
        intervalMs: 24 * 60 * 60 * 1000, // 24 hours
        initialIntervalMs: 60 * 1000, // 1 minute
        restart: false,
    },
};
