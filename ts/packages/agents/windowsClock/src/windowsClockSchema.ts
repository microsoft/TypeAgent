// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type WindowsClockAction =
    | AddWorldClockAction
    | CreateAlarmAction
    | NavigateToAlarmTabAction
    | NavigateToFocusTabAction
    | NavigateToStopwatchTabAction
    | NavigateToTimerTabAction
    | NavigateToWorldClockTabAction
    | RecordLapAction
    | RenameTimerAction
    | SetAlarmEnabledAction
    | SetFocusSessionRunningAction
    | SetStopwatchRunningAction
    | SetTimerViewModeAction
    | StartTimerAction;

// Add a new world clock by searching for a city and selecting it from suggestions.
export type AddWorldClockAction = {
    actionName: "addWorldClock";
    parameters: {
        // Text to search for a matching city in the Add Clock box.
        cityQuery: string;
        // The specific suggestion to select from the list (city, country).
        suggestionItem: string;
    };
};

// Create a new alarm with a specified name and time.
export type CreateAlarmAction = {
    actionName: "createAlarm";
    parameters: {
        // Displayed name of the alarm.
        alarmName: string;
        // Hour component of the alarm time.
        hour: number;
        // Minute component of the alarm time.
        minute: number;
    };
};

// Switch to the Alarms tab in the app.
export type NavigateToAlarmTabAction = {
    actionName: "navigateToAlarmTab";
    parameters: {};
};

// Switch to the Focus tab from the app's navigation.
export type NavigateToFocusTabAction = {
    actionName: "navigateToFocusTab";
    parameters: {};
};

// Switch to the Stopwatch tab.
export type NavigateToStopwatchTabAction = {
    actionName: "navigateToStopwatchTab";
    parameters: {};
};

// Switch to the Timer tab from another section.
export type NavigateToTimerTabAction = {
    actionName: "navigateToTimerTab";
    parameters: {};
};

// Switch to the World Clock tab from another tab.
export type NavigateToWorldClockTabAction = {
    actionName: "navigateToWorldClockTab";
    parameters: {};
};

// Record a lap while the stopwatch continues running.
export type RecordLapAction = {
    actionName: "recordLap";
    parameters: {};
};

// Rename an existing timer and save the changes.
export type RenameTimerAction = {
    actionName: "renameTimer";
    parameters: {
        // The new name to assign to the timer.
        name: string;
    };
};

// Turn on an existing alarm.  [merged from: enableAlarm, disableAlarm]
export type SetAlarmEnabledAction = {
    actionName: "setAlarmEnabled";
    parameters: {
        // Distinguishes enableAlarm / disableAlarm variants.
        enabled: boolean;
    };
};

// Start the focus session when it is paused.  [merged from: startFocusSession, pauseFocusSession]
export type SetFocusSessionRunningAction = {
    actionName: "setFocusSessionRunning";
    parameters: {
        // Distinguishes startFocusSession / pauseFocusSession variants.
        running: boolean;
    };
};

// Pause the running stopwatch.  [merged from: pauseStopwatch, resumeStopwatch]
export type SetStopwatchRunningAction = {
    actionName: "setStopwatchRunning";
    parameters: {
        // Distinguishes pauseStopwatch / resumeStopwatch variants.
        running: boolean;
    };
};

// Expand the timer into its alternate/compact view.  [merged from: expandTimerView, restoreTimerView]
export type SetTimerViewModeAction = {
    actionName: "setTimerViewMode";
    parameters: {
        // Distinguishes expandTimerView / restoreTimerView variants.
        mode: "compact" | "full";
    };
};

// Start or resume the timer from list or paused states.
export type StartTimerAction = {
    actionName: "startTimer";
    parameters: {};
};
