// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AndroidDeviceAction = SetAlarmAction | SetTimerAction;

export type SetAlarmAction = {
    actionName: "setAlarm";
    parameters: {
        // The original user request, used as the alarm label.
        originalRequest: string;
        // Local time of day in HH:mm format. The device schedules the next occurrence.
        time: string;
    };
};

export type SetTimerAction = {
    actionName: "setTimer";
    parameters: {
        // The original user request, used as the timer label.
        originalRequest: string;
        // Positive timer duration in seconds.
        durationInSeconds: number;
    };
};
