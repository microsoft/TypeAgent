// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AndroidDeviceAction =
    | SetAlarmAction
    | SetTimerAction
    | SearchNearbyAction;

// Sets an alarm on the Android device.
// Use when the user asks to create or schedule an alarm for a time of day.
export type SetAlarmAction = {
    actionName: "setAlarm";
    parameters: {
        // The original user request, used as the alarm label.
        originalRequest: string;
        // Local time of day in HH:mm format. The device schedules the next occurrence.
        time: string;
    };
};

// Starts a countdown timer on the Android device.
// Use when the user asks for a timer or countdown lasting a specified duration.
export type SetTimerAction = {
    actionName: "setTimer";
    parameters: {
        // The original user request, used as the timer label.
        originalRequest: string;
        // Positive timer duration in seconds.
        durationInSeconds: number;
    };
};

// Opens the Android device's maps app on a search for places near the user.
// Use when the user asks to find, locate or show places nearby.
export type SearchNearbyAction = {
    actionName: "searchNearby";
    parameters: {
        // The original user request.
        originalRequest: string;
        // The kind of place to look for, for example "coffee shops".
        searchTerm: string;
    };
};
