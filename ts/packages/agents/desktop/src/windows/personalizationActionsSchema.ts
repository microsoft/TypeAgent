// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DesktopPersonalizationActions =
    | EnableTransparencyAction
    | ApplyColorToTitleBarAction
    | HighContrastThemeAction;

// Enables or disables transparency effects
export type EnableTransparencyAction = {
    actionName: "EnableTransparency";
    parameters: {
        enable: boolean;
    };
};

// Applies accent color to title bars
export type ApplyColorToTitleBarAction = {
    actionName: "ApplyColorToTitleBar";
    parameters: {
        enableColor: boolean;
    };
};

// Enables high contrast theme
export type HighContrastThemeAction = {
    actionName: "HighContrastTheme";
    parameters: {};
};
