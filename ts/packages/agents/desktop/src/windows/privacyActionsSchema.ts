// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DesktopPrivacyActions =
    | ManageMicrophoneAccessAction
    | ManageCameraAccessAction
    | ManageLocationAccessAction;

// Manages microphone access for apps
export type ManageMicrophoneAccessAction = {
    actionName: "ManageMicrophoneAccess";
    parameters: {
        accessSetting: "allow" | "deny";
    };
};

// Manages camera access for apps
export type ManageCameraAccessAction = {
    actionName: "ManageCameraAccess";
    parameters: {
        accessSetting?: "allow" | "deny";
    };
};

// Manages location access for apps
export type ManageLocationAccessAction = {
    actionName: "ManageLocationAccess";
    parameters: {
        accessSetting?: "allow" | "deny";
    };
};
