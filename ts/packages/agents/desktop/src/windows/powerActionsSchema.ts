// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DesktopPowerActions =
    | BatterySaverActivationLevelAction
    | SetPowerModePluggedInAction
    | SetPowerModeOnBatteryAction;

// Sets the battery saver activation threshold
export type BatterySaverActivationLevelAction = {
    actionName: "BatterySaverActivationLevel";
    parameters: {
        thresholdValue: number; // 0-100
    };
};

// Sets power mode when plugged in
export type SetPowerModePluggedInAction = {
    actionName: "setPowerModePluggedIn";
    parameters: {
        powerMode: "bestPerformance" | "balanced" | "bestPowerEfficiency";
    };
};

// Sets power mode when on battery
export type SetPowerModeOnBatteryAction = {
    actionName: "SetPowerModeOnBattery";
    parameters: {
        mode?: string;
    };
};
