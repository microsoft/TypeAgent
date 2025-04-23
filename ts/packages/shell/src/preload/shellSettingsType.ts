// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TTSSettings = {
    provider?: string | undefined;
    voice?: string | undefined;
};

export type ShellUserSettings = {
    microphoneId: string | undefined;
    microphoneName: string | undefined;
    tts: boolean;
    ttsSettings: TTSSettings;
    agentGreeting: boolean;
    multiModalContent: boolean;
    devUI: boolean;
    partialCompletion: boolean;
    darkMode: boolean;
    chatHistory: boolean; // should the shell load the chat history?
    notifyFilter: string;
    disallowedDisplayType: string; // semicolon separated list of display types that should not be used
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
    devUI: false,
    partialCompletion: true,
    disallowedDisplayType: "",
    darkMode: false,
    chatHistory: true,
};
