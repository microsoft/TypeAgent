// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
    hideMenu: boolean;
    hideTabs: boolean;
    notifyFilter: string;
    tts: boolean;
    ttsSettings: TTSSettings;
};

export const defaultSettings: ShellSettingsType = {
    size: [900, 1200],
    zoomLevel: 1,
    devTools: false,
    hideMenu: true,
    hideTabs: true,
    notifyFilter: "error;warning;",
    tts: false,
    ttsSettings: {},
};
