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
    | ChangeThemeAction
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
    | DebugAutoShellAction;

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

// Sets the theme of the current [windows] desktop
export type ChangeThemeAction = {
    actionName: "applyTheme";
    parameters: {
        theme: KnownThemes | "previous" | string; // The name of the theme
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

export type DebugAutoShellAction = {
    actionName: "debug";
    parameters: {};
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

export type KnownThemes =
    | "Windows (light)"
    | "Windows (dark)"
    | "Windows spotlight"
    | "Glow"
    | "Captured Motion"
    | "Sunrise"
    | "Flow"
    | "High Contrast #1"
    | "High Contrast #2"
    | "High Contrast Black"
    | "High Contrast White";
