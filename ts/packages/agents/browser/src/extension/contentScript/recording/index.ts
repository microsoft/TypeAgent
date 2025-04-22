// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { RecordedAction } from "../types";
import {
    recordClick,
    recordInput,
    recordTextEntry,
    recordNavigation,
} from "./actions";
import { captureUIState, captureAnnotatedScreenshot } from "./capture";
import { setIdsOnAllElements } from "../domUtils";
import { getPageHTML } from "../htmlProcessing";

// State variables
let recording = false;
let recordedActions: RecordedAction[] = [];
let actionIndex = 1;
let recordedHtmlIndex = 0;
let recordedActionHtml: string[] = [];
let recordedActionScreenshot: string[] = [];
let lastUrl = window.location.href;
let lastScreenshot: string = "";
let lastPagehtml: string = "";

/**
 * Starts recording user actions
 */
export async function startRecording(): Promise<void> {
    if (recording) return;

    await chrome.runtime.sendMessage({
        type: "clearRecordedActions",
    });

    recording = true;
    recordedActions = [];
    actionIndex = 1;

    recordedActionHtml = [];
    recordedActionScreenshot = [];
    recordedHtmlIndex = 0;
    lastPagehtml = "";
    lastScreenshot = "";

    setIdsOnAllElements(0);

    document.addEventListener("click", recordClick, true);
    document.addEventListener("input", recordInput, true);
    document.addEventListener("keyup", recordTextEntry, true);

    observeDOMChanges();

    window.addEventListener("unload", recordNavigation);
    window.addEventListener("beforeunload", recordNavigation);
    window.addEventListener("popstate", recordNavigation);
    window.addEventListener("hashchange", recordNavigation);
}

/**
 * Stops recording user actions
 * @returns The recorded actions and related data
 */
export async function stopRecording(): Promise<any> {
    recording = false;
    document.removeEventListener("click", recordClick, true);
    document.removeEventListener("input", recordInput, true);
    document.removeEventListener("keyup", recordTextEntry, true);

    window.removeEventListener("unload", recordNavigation, true);
    window.removeEventListener("beforeunload", recordNavigation, true);
    window.removeEventListener("popstate", recordNavigation, true);
    window.removeEventListener("hashchange", recordNavigation, true);

    const screenshot = await captureAnnotatedScreenshot();
    recordedActionScreenshot.push(screenshot);

    const pageHTML = getPageHTML(false, "", 0, false);
    recordedActionHtml.push(pageHTML);
    recordedHtmlIndex = recordedActionHtml.length;

    await chrome.runtime.sendMessage({
        type: "recordingStopped",
        recordedActions,
        recordedActionScreenshot,
        recordedActionHtml,
    });

    return {
        recordedActions,
        recordedActionHtml,
        recordedActionScreenshot,
    };
}

/**
 * Saves the recorded actions to the background script
 */
export async function saveRecordedActions(): Promise<void> {
    await captureUIState();

    await chrome.runtime.sendMessage({
        type: "saveRecordedActions",
        recordedActions,
        recordedActionScreenshot,
        recordedActionHtml,
        actionIndex,
        isCurrentlyRecording: recording,
    });
}

/**
 * Observes DOM changes for SPA navigation
 */
export function observeDOMChanges(): void {
    const targetNode = document.body; // Observe the entire document
    const observer = new MutationObserver(() => {
        const currentUrl = window.location.href;

        // Detect if URL has changed since last check
        if (currentUrl !== lastUrl) {
            console.log("Navigation detected! New URL:", currentUrl);

            // Update last known URL
            lastUrl = currentUrl;

            // Optional: Send message to background script
            chrome.runtime.sendMessage({
                action: "spaNavigationDetected",
                url: currentUrl,
            });

            window.dispatchEvent(new Event("spa-navigation"));
        }
    });

    observer.observe(targetNode, { childList: true, subtree: true });
}

/**
 * Restores recording state
 * @param restoredData The data to restore
 */
export function restoreRecordingState(restoredData: any): void {
    if (restoredData) {
        recordedActions = restoredData.recordedActions || [];
        recordedActionScreenshot = restoredData.annotatedScreenshot || [];
        recordedActionHtml = restoredData.recordedActionPageHTML || [];

        if (recordedActionHtml !== undefined && recordedActionHtml.length > 0) {
            recordedHtmlIndex = recordedActionHtml.length;
        }

        actionIndex = restoredData.actionIndex ?? 0;
        recording = restoredData.isCurrentlyRecording || false;
    }
}

/**
 * Gets the current recording state
 * @returns The current recording state
 */
export function getRecordingState(): any {
    return {
        recording,
        recordedActions,
        actionIndex,
        recordedHtmlIndex,
        recordedActionHtml,
        recordedActionScreenshot,
        lastUrl,
        lastScreenshot,
        lastPagehtml,
    };
}

/**
 * Sets the current recording state
 * @param state The state to set
 */
export function setRecordingState(state: any): void {
    if (state.recording !== undefined) recording = state.recording;
    if (state.recordedActions) recordedActions = state.recordedActions;
    if (state.actionIndex !== undefined) actionIndex = state.actionIndex;
    if (state.recordedHtmlIndex !== undefined)
        recordedHtmlIndex = state.recordedHtmlIndex;
    if (state.recordedActionHtml) recordedActionHtml = state.recordedActionHtml;
    if (state.recordedActionScreenshot)
        recordedActionScreenshot = state.recordedActionScreenshot;
    if (state.lastUrl) lastUrl = state.lastUrl;
    if (state.lastScreenshot) lastScreenshot = state.lastScreenshot;
    if (state.lastPagehtml) lastPagehtml = state.lastPagehtml;
}

export function setLastScreenshot(value: string) {
    lastScreenshot = value;
}

export function setLastPageHtml(value: string) {
    lastPagehtml = value;
}

export function incrementActionIndex(): number {
    return actionIndex++;
}

// Handle SPA navigation events
window.addEventListener("spa-navigation", async () => {
    if (recording) {
        const screenshot = await captureAnnotatedScreenshot(lastScreenshot);
        recordedActionScreenshot.push(screenshot);

        if (lastPagehtml.length == 0) {
            lastPagehtml = getPageHTML(false, "", 0, false);
        }

        recordedActionHtml.push(lastPagehtml);
        recordedHtmlIndex = recordedActionHtml.length;
        saveRecordedActions();
    }
});

export {
    recordedActions,
    actionIndex,
    recordedHtmlIndex,
    recordedActionHtml,
    recordedActionScreenshot,
    lastUrl,
    lastScreenshot,
    lastPagehtml,
};
