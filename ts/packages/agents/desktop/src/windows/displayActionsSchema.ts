// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DesktopDisplayActions =
    | EnableBlueLightFilterScheduleAction
    | AdjustColorTemperatureAction
    | DisplayScalingAction
    | AdjustScreenOrientationAction
    | RotationLockAction;

// Enables or disables blue light filter schedule (Night Light)
export type EnableBlueLightFilterScheduleAction = {
    actionName: "EnableBlueLightFilterSchedule";
    parameters: {
        schedule: string;
        nightLightScheduleDisabled: boolean;
    };
};

// Adjusts the color temperature for Night Light
export type AdjustColorTemperatureAction = {
    actionName: "adjustColorTemperature";
    parameters: {
        filterEffect?: "reduce" | "increase";
    };
};

// Sets display scaling percentage (100, 125, 150, 175, 200)
export type DisplayScalingAction = {
    actionName: "DisplayScaling";
    parameters: {
        sizeOverride: string; // percentage as string
    };
};

// Adjusts screen orientation between portrait and landscape
export type AdjustScreenOrientationAction = {
    actionName: "AdjustScreenOrientation";
    parameters: {
        orientation: "portrait" | "landscape";
    };
};

// Locks or unlocks screen rotation
export type RotationLockAction = {
    actionName: "RotationLock";
    parameters: {
        enable?: boolean;
    };
};
