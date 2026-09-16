// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ScreencaptureAction =
    | TakeScreenshotAction
    | StartRecordingAction
    | StopRecordingAction
    | ListWindowsAction;

export type ScreencaptureActivity = RecordingActivity;

// Take a screenshot. If `target` is omitted the whole primary screen is
// captured; otherwise `target` is a program or window name to fuzzy-match
// against the currently visible windows (e.g. "Chrome", "Visual Studio").
export type TakeScreenshotAction = {
    actionName: "takeScreenshot";
    parameters: {
        target?: string;
    };
};

// Start a screen recording. Same `target` semantics as takeScreenshot.
// Only one recording can be active at a time.
export type StartRecordingAction = {
    actionName: "startRecording";
    parameters: {
        target?: string;
    };
};

// Stop the currently active screen recording.
export type StopRecordingAction = {
    actionName: "stopRecording";
    parameters: {};
};

// List all currently visible windows so the user can target them by name.
export type ListWindowsAction = {
    actionName: "listWindows";
    parameters: {};
};

// Activity type tracked while a recording is in progress.
export type RecordingActivity = {
    actionName: "recording";
    parameters: {
        target?: string;
        outputPath: string;
        startedAtMs: number;
    };
};
