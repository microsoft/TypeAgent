// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DesktopActions =
    | LaunchProgramAction
    | CloseProgramAction
    | TileWindowsAction
    | MaximizeWindowAction
    | MinimizeWindowAction
    | SwitchToWindowAction
    | SetVolumeAction
    | AdjustVolumeAction
    | RestoreVolumeAction
    | MuteVolumeAction
    | SetWallpaperAction
    | ChangeThemeModeAction
    | ApplyThemeAction
    | ListThemesAction
    | ConnectWifiAction
    | DisconnectWifiAction
    | ListWifiNetworksAction
    | ToggleAirplaneModeAction
    | CreateDesktopAction
    | MoveWindowToDesktopAction
    | PinWindowToAllDesktopsAction
    | SwitchDesktopAction
    | NextDesktopAction
    | PreviousDesktopAction
    | ToggleNotificationsAction
    | DebugAutoShellAction
    | SetTextSizeAction
    | SetScreenResolutionAction
    // Common settings actions
    | BluetoothToggleAction
    | EnableWifiAction
    | AdjustScreenBrightnessAction;

// Launches a new program window on a Windows Desktop
// Example:
//  user: Launch edge
//  agent: {
//     "actionName": "LaunchProgram",
//     "parameters": {
//        "name": "edge"
//     }
//  }
export type LaunchProgramAction = {
    actionName: "LaunchProgram";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
    };
};

// Closes a program window on a Windows Desktop
export type CloseProgramAction = {
    actionName: "CloseProgram";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
    };
};

// Maximizes a program window on a Windows Desktop
export type MaximizeWindowAction = {
    actionName: "Maximize";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
    };
};

// Minimizes a program window on a Windows Desktop
export type MinimizeWindowAction = {
    actionName: "Minimize";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
    };
};

// Sets focus to a program window on a Windows Desktop
export type SwitchToWindowAction = {
    actionName: "SwitchTo";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
    };
};

// Positions program windows on a program window on a Windows Desktop
export type TileWindowsAction = {
    actionName: "Tile";
    parameters: {
        leftWindow: KnownPrograms | string; // The name of the software application
        rightWindow: KnownPrograms | string; // The name of the software application
    };
};

export type SetVolumeAction = {
    actionName: "Volume";
    parameters: {
        targetVolume: number; // value between 0 and 100
    };
};

// Adjusts system volume up or down by a relative amount
export type AdjustVolumeAction = {
    actionName: "AdjustVolume";
    parameters: {
        direction: "up" | "down"; // whether to increase or decrease volume
        amount?: number; // percentage to adjust by (default 10)
    };
};

export type RestoreVolumeAction = {
    actionName: "RestoreVolume";
};

export type MuteVolumeAction = {
    actionName: "Mute";
    parameters: {
        on: boolean;
    };
};

export type SetWallpaperAction = {
    actionName: "SetWallpaper";
    parameters: {
        filePath?: string; // The path to the file
        url?: string; // The url to the image
    };
};

// Sets the theme mode of the current [windows] desktop
export type ChangeThemeModeAction = {
    actionName: "SetThemeMode";
    parameters: {
        mode: "light" | "dark" | "toggle"; // the theme mode
    };
};

// Applies a Windows theme by name (e.g. "Captured Motion", "Glow", "Sunrise") or file path. Use this when the user wants to switch to a specific named theme.
export type ApplyThemeAction = {
    actionName: "ApplyTheme";
    parameters: {
        filePath: string; // The theme name or .theme file path to apply (use "previous" to revert)
    };
};

// Lists all installed Windows themes
export type ListThemesAction = {
    actionName: "ListThemes";
    parameters: {};
};

export type ConnectWifiAction = {
    actionName: "ConnectWifi";
    parameters: {
        ssid: string; // The SSID of the wifi network
        password?: string; // The password of the wifi network, if required
    };
};

// Disconnects from the current wifi network
export type DisconnectWifiAction = {
    actionName: "DisconnectWifi";
    parameters: {
        // No parameters required
    };
};

// Lists available WiFi networks
export type ListWifiNetworksAction = {
    actionName: "ListWifiNetworks";
    parameters: {};
};

export type ToggleAirplaneModeAction = {
    actionName: "ToggleAirplaneMode";
    parameters: {
        enable: boolean; // true to enable, false to disable
    };
};

// creates a new Windows Desktop
export type CreateDesktopAction = {
    actionName: "CreateDesktop";
    parameters: {
        names: string[]; // The name(s) of the desktop(s) to create (default: Desktop 1, Desktop 2, etc.)
    };
};

export type MoveWindowToDesktopAction = {
    actionName: "MoveWindowToDesktop";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
        desktopId: number; // The ID of the desktop to move the window to
    };
};

export type PinWindowToAllDesktopsAction = {
    actionName: "PinWindow";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
    };
};

export type SwitchDesktopAction = {
    actionName: "SwitchDesktop";
    parameters: {
        desktopId: number; // The ID of the desktop to switch to
    };
};

// switches to the next Windows Desktop
export type NextDesktopAction = {
    actionName: "NextDesktop";
    parameters: {
        // No parameters required
    };
};

// switches to the previous Windows Desktop
export type PreviousDesktopAction = {
    actionName: "PreviousDesktop";
    parameters: {
        // No parameters required
    };
};

// Shows/hides windows notification center
export type ToggleNotificationsAction = {
    actionName: "ToggleNotifications";
    parameters: {
        enable: boolean; // true to enable, false to disable
    };
};

// Attaches the debugger to the AutoShell process
export type DebugAutoShellAction = {
    actionName: "Debug";
    parameters: {};
};

// Changes the text size that appears throughout Windows and your apps
export type SetTextSizeAction = {
    actionName: "SetTextSize";
    parameters: {
        // small changes are 5% increments, large changes are 25% increments
        size: number; // size in percentage (100% is default) (range is 100 - 225)
    };
};

// Change screen resolution
export type SetScreenResolutionAction = {
    actionName: "SetScreenResolution";
    parameters: {
        width: number; // width in pixels
        height: number; // height in pixels
        refreshRate?: number; // refresh rate in Hz (e.g. 60, 144)
    };
};

// ===== Common Settings Actions =====

// Toggles Bluetooth radio on or off
export type BluetoothToggleAction = {
    actionName: "BluetoothToggle";
    parameters: {
        enableBluetooth?: boolean; // true to enable, false to disable
    };
};

// Enables or disables WiFi adapter
export type EnableWifiAction = {
    actionName: "EnableWifi";
    parameters: {
        enable: boolean; // true to enable, false to disable
    };
};

// Adjusts screen brightness (increase or decrease)
export type AdjustScreenBrightnessAction = {
    actionName: "AdjustScreenBrightness";
    parameters: {
        brightnessLevel: "increase" | "decrease";
    };
};

export type KnownPrograms =
    | "chrome"
    | "word"
    | "excel"
    | "powerpoint"
    | "outlook"
    | "edge"
    | "visual studio"
    | "visual studio code"
    | "paint"
    | "notepad"
    | "calculator"
    | "file explorer"
    | "control panel"
    | "task manager"
    | "cmd"
    | "powershell"
    | "snipping tool"
    | "magnifier"
    | "paint 3d"
    | "task manager"
    | "spotify"
    | "m365 copilot";
