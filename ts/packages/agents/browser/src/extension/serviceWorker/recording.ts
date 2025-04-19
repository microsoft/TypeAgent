// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getActiveTab } from "./tabManager";
import { getTabHTMLFragments } from "./capture";
import {
    saveRecordedActions,
    getRecordedActions,
    clearRecordedActions,
} from "./storage";

/**
 * Starts recording user actions in the active tab
 */
export async function startRecording(): Promise<void> {
    const targetTab = await getActiveTab();
    if (targetTab?.id) {
        await chrome.tabs.sendMessage(
            targetTab.id,
            {
                type: "startRecording",
            },
            { frameId: 0 }, // Limit action recording to the top frame for now
        );
    }
}

/**
 * Stops recording user actions in the active tab
 * @returns Promise resolving to the recorded actions
 */
export async function stopRecording(): Promise<any> {
    const targetTab = await getActiveTab();
    if (targetTab?.id) {
        const response = await chrome.tabs.sendMessage(
            targetTab.id,
            {
                type: "stopRecording",
            },
            { frameId: 0 },
        );
        return response;
    }
    return null;
}

/**
 * Takes a screenshot of the active tab
 * @returns Promise resolving to the screenshot data URL
 */
export async function takeScreenshot(): Promise<string> {
    return await chrome.tabs.captureVisibleTab({
        format: "png",
    });
}

/**
 * Captures HTML fragments from the active tab
 * @returns Promise resolving to the HTML fragments
 */
export async function captureHtmlFragments(): Promise<any[]> {
    const targetTab = await getActiveTab();
    if (targetTab) {
        return await getTabHTMLFragments(targetTab);
    }
    return [];
}

/**
 * Records that recording has stopped
 * @param recordedActions The recorded actions
 * @param recordedActionPageHTML The HTML of the page during recording
 * @param recordedActionScreenshot The screenshot taken during recording
 * @param actionIndex The index of the current action
 */
export async function recordingStopped(
    recordedActions: any[],
    recordedActionPageHTML: any,
    recordedActionScreenshot: string,
    actionIndex: number,
): Promise<void> {
    await saveRecordedActions(
        recordedActions,
        recordedActionPageHTML,
        recordedActionScreenshot,
        actionIndex,
        false,
    );
}

/**
 * Downloads data as a JSON file
 * @param data The data to download
 * @param filename The filename to use
 */
export async function downloadData(
    data: any,
    filename?: string,
): Promise<void> {
    const jsonString = JSON.stringify(data, null, 2);
    const dataUrl =
        "data:application/json;charset=utf-8," + encodeURIComponent(jsonString);

    chrome.downloads.download({
        url: dataUrl,
        filename: filename || "schema-metadata.json",
        saveAs: true,
    });
}
