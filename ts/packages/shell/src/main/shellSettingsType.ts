// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { DisplayType } from "../preload/electronTypes.js";

export type TTSSettings = {
    provider?: string;
    voice?: string;
};

export type ShellSettingsType = {
    size: number[];
    position?: number[];
    zoomLevel: number;
    devTools: boolean;
    microphoneId?: string;
    microphoneName?: string;
    notifyFilter: string;
    tts: boolean;
    ttsSettings: TTSSettings;
    agentGreeting: boolean;
    multiModalContent: boolean;
    devUI: boolean;
    partialCompletion: boolean;
    disallowedDisplayType: DisplayType[];
    darkMode: boolean;
};

export const defaultSettings: ShellSettingsType = {
    size: [900, 1200],
    zoomLevel: 1,
    devTools: false,
    notifyFilter: "error;warning;",
    tts: false,
    ttsSettings: {},
    agentGreeting: true,
    multiModalContent: true,
    devUI: false,
    partialCompletion: true,
    disallowedDisplayType: [],
    darkMode: false,
};
