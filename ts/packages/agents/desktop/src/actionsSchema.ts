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
    | SetWallpaperAction;

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
    | "task manager";
