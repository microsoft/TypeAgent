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
    | RestoreVolumeAction
    | MuteVolumeAction
    | SetWallpaperAction
    | ChangeThemeModeAction
    | ConnectWifiAction
    | DisconnectWifiAction
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
//     "actionName": "launchProgram",
//     "parameters": {
//        "name": "edge"
//     }
//  }
export type LaunchProgramAction = {
    actionName: "launchProgram";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
    };
};

// Closes a program window on a Windows Desktop
export type CloseProgramAction = {
    actionName: "closeProgram";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
    };
};

// Maximizes a program window on a Windows Desktop
export type MaximizeWindowAction = {
    actionName: "maximize";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
    };
};

// Minimizes a program window on a Windows Desktop
export type MinimizeWindowAction = {
    actionName: "minimize";
    parameters: {
        name: KnownPrograms;
    };
};

// Sets focus to a program window on a Windows Desktop
export type SwitchToWindowAction = {
    actionName: "switchTo";
    parameters: {
        name: KnownPrograms;
    };
};

// Positions program windows on a program window on a Windows Desktop
export type TileWindowsAction = {
    actionName: "tile";
    parameters: {
        leftWindow: KnownPrograms;
        rightWindow: KnownPrograms;
    };
};

export type SetVolumeAction = {
    actionName: "volume";
    parameters: {
        targetVolume: number; // value between 0 and 100
    };
};

export type RestoreVolumeAction = {
    actionName: "restoreVolume";
};

export type MuteVolumeAction = {
    actionName: "mute";
    parameters: {
        on: boolean;
    };
};

export type SetWallpaperAction = {
    actionName: "setWallpaper";
    parameters: {
        filePath?: string; // The path to the file
        url?: string; // The url to the image
    };
};

// Sets the theme mode of the current [windows] desktop
export type ChangeThemeModeAction = {
    actionName: "setThemeMode";
    parameters: {
        mode: "light" | "dark" | "toggle"; // the theme mode
    };
};

export type ConnectWifiAction = {
    actionName: "connectWifi";
    parameters: {
        ssid: string; // The SSID of the wifi network
        password?: string; // The password of the wifi network, if required
    };
};

// Disconnects from the current wifi network
export type DisconnectWifiAction = {
    actionName: "disconnectWifi";
    parameters: {
        // No parameters required
    };
};

export type ToggleAirplaneModeAction = {
    actionName: "toggleAirplaneMode";
    parameters: {
        enable: boolean; // true to enable, false to disable
    };
};

// creates a new Windows Desktop
export type CreateDesktopAction = {
    actionName: "createDesktop";
    parameters: {
        names: string[]; // The name(s) of the desktop(s) to create (default: Desktop 1, Desktop 2, etc.)
    };
};

export type MoveWindowToDesktopAction = {
    actionName: "moveWindowToDesktop";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
        desktopId: number; // The ID of the desktop to move the window to
    };
};

export type PinWindowToAllDesktopsAction = {
    actionName: "pinWindow";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
    };
};

export type SwitchDesktopAction = {
    actionName: "switchDesktop";
    parameters: {
        desktopId: number; // The ID of the desktop to switch to
    };
};

// switches to the next Windows Desktop
export type NextDesktopAction = {
    actionName: "nextDesktop";
    parameters: {
        // No parameters required
    };
};

// switches to the previous Windows Desktop
export type PreviousDesktopAction = {
    actionName: "previousDesktop";
    parameters: {
        // No parameters required
    };
};

// Shows/hides windows notification center
export type ToggleNotificationsAction = {
    actionName: "toggleNotifications";
    parameters: {
        enable: boolean; // true to enable, false to disable
    };
};

// Attaches the debugger to the AutoShell process
export type DebugAutoShellAction = {
    actionName: "debug";
    parameters: {};
};

// Changes the text size that appears throughout Windows and your apps
export type SetTextSizeAction = {
    actionName: "setTextSize";
    parameters: {
        // small changes are 5% increments, large changes are 25% increments
        size: number; // size in percentage (100% is default) (range is 100 - 225)
    };
};

// Change screen resolution
export type SetScreenResolutionAction = {
    actionName: "setScreenResolution";
    parameters: {
        width: number; // width in pixels
        height: number; // height in pixels
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
    actionName: "enableWifi";
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
