// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Saves recorded actions to storage
 * @param recordedActions The recorded actions
 * @param recordedActionPageHTML The HTML of the page during recording
 * @param recordedActionScreenshot The screenshot taken during recording
 * @param actionIndex The index of the current action
 * @param isCurrentlyRecording Whether recording is in progress
 */
export async function saveRecordedActions(
    recordedActions: any[],
    recordedActionPageHTML: any,
    recordedActionScreenshot: string,
    actionIndex: number,
    isCurrentlyRecording: boolean,
): Promise<void> {
    await chrome.storage.session.set({
        recordedActions,
        recordedActionPageHTML,
        annotatedScreenshot: recordedActionScreenshot,
        actionIndex,
        isCurrentlyRecording,
    });
}

/**
 * Gets recorded actions from storage
 * @returns The recorded actions and related data
 */
export async function getRecordedActions(): Promise<any> {
    return await chrome.storage.session.get([
        "recordedActions",
        "recordedActionPageHTML",
        "annotatedScreenshot",
        "actionIndex",
        "isCurrentlyRecording",
    ]);
}

/**
 * Clears recorded actions from storage
 */
export async function clearRecordedActions(): Promise<void> {
    try {
        await chrome.storage.session.remove([
            "recordedActions",
            "recordedActionPageHTML",
            "annotatedScreenshot",
            "actionIndex",
            "isCurrentlyRecording",
        ]);
    } catch (error) {
        console.error("Error clearing storage data:", error);
    }
}

/**
 * Gets settings from storage
 * @returns The settings
 */
export async function getSettings(): Promise<Record<string, string>> {
    const settings = await chrome.storage.sync.get({
        websocketHost: "ws://localhost:8080/",
    });
    return settings;
}
