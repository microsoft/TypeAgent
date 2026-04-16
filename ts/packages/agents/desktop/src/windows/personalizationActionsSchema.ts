// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DesktopPersonalizationActions =
    | EnableTransparencyAction
    | ApplyColorToTitleBarAction
    | HighContrastThemeAction
    | SystemThemeModeAction;

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

// Sets the system-wide theme mode (affects apps, taskbar, and Start menu)
export type SystemThemeModeAction = {
    actionName: "SystemThemeMode";
    parameters: {
        mode: "light" | "dark"; // the system theme mode
    };
};
