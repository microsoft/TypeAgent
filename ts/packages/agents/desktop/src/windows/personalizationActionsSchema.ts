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

// Opens the high contrast accessibility settings page. Only use when the user explicitly asks for high contrast settings.
export type HighContrastThemeAction = {
    actionName: "HighContrastTheme";
    parameters: {};
};

// Sets the system-wide theme mode to light or dark (affects apps, taskbar, and Start menu). Only for light/dark mode, not for named themes.
export type SystemThemeModeAction = {
    actionName: "SystemThemeMode";
    parameters: {
        mode: "light" | "dark"; // the system theme mode
    };
};
