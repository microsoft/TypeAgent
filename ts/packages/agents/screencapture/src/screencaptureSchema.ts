// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ScreencaptureAction =
    | TakeScreenshotAction
    | StartRecordingAction
    | StopRecordingAction
    | ListWindowsAction;

export type ScreencaptureActivity = RecordingActivity;

// Capture the whole primary screen, entire display, desktop, or a named OS
// window. "Capture the whole screen to a file" and "screenshot my entire
// display" both use takeScreenshot with an empty parameters object; the handler
// chooses the output file. If `target` is present, it is a program or window
// name to fuzzy-match (e.g. "Chrome", "Visual Studio"). Do not use this action
// for only the current browser or web page; use browser.captureScreenshot.
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
