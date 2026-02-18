// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DesktopSystemActions =
    | EnableMeteredConnectionsAction
    | EnableGameModeAction
    | EnableNarratorAction
    | EnableMagnifierAction
    | EnableStickyKeysAction
    | EnableFilterKeysAction
    | MonoAudioToggleAction
    | ShowFileExtensionsAction
    | ShowHiddenAndSystemFilesAction
    | AutomaticTimeSettingAction
    | AutomaticDSTAdjustmentAction
    | EnableQuietHoursAction
    | RememberWindowLocationsAction
    | MinimizeWindowsOnMonitorDisconnectAction;

// Enables or disables metered connection settings
export type EnableMeteredConnectionsAction = {
    actionName: "enableMeteredConnections";
    parameters: {
        enable: boolean;
    };
};

// Enables or disables Game Mode
export type EnableGameModeAction = {
    actionName: "enableGameMode";
    parameters: {};
};

// Enables or disables Narrator
export type EnableNarratorAction = {
    actionName: "EnableNarratorAction";
    parameters: {
        enable?: boolean;
    };
};

// Enables or disables Magnifier
export type EnableMagnifierAction = {
    actionName: "EnableMagnifier";
    parameters: {
        enable?: boolean;
    };
};

// Enables or disables Sticky Keys
export type EnableStickyKeysAction = {
    actionName: "enableStickyKeys";
    parameters: {
        enable: boolean;
    };
};

// Enables or disables Filter Keys
export type EnableFilterKeysAction = {
    actionName: "EnableFilterKeysAction";
    parameters: {
        enable?: boolean;
    };
};

// Enables or disables mono audio
export type MonoAudioToggleAction = {
    actionName: "MonoAudioToggle";
    parameters: {
        enable?: boolean;
    };
};

// Shows or hides file extensions in File Explorer
export type ShowFileExtensionsAction = {
    actionName: "ShowFileExtensions";
    parameters: {
        enable?: boolean;
    };
};

// Shows or hides hidden and system files in File Explorer
export type ShowHiddenAndSystemFilesAction = {
    actionName: "ShowHiddenAndSystemFiles";
    parameters: {
        enable?: boolean;
    };
};

// Enables or disables automatic time synchronization
export type AutomaticTimeSettingAction = {
    actionName: "AutomaticTimeSettingAction";
    parameters: {
        enableAutoTimeSync: boolean;
    };
};

// Enables or disables automatic DST adjustment
export type AutomaticDSTAdjustmentAction = {
    actionName: "AutomaticDSTAdjustment";
    parameters: {
        enable?: boolean;
    };
};

// Enables or disables Focus Assist (Quiet Hours)
export type EnableQuietHoursAction = {
    actionName: "EnableQuietHours";
    parameters: {
        startHour?: number;
        endHour?: number;
    };
};

// Remembers window locations based on monitor configuration
export type RememberWindowLocationsAction = {
    actionName: "RememberWindowLocations";
    parameters: {
        enable: boolean;
    };
};

// Minimizes windows when a monitor is disconnected
export type MinimizeWindowsOnMonitorDisconnectAction = {
    actionName: "MinimizeWindowsOnMonitorDisconnectAction";
    parameters: {
        enable?: boolean;
    };
};
