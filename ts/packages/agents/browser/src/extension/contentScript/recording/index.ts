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
import { getPageHTML, CompressionMode } from "../htmlUtils";

// State variables
let recording = false;
let listenersAttached = false;
let recordedActions: RecordedAction[] = [];
let actionIndex = 1;
let recordedHtmlIndex = 0;
let recordedActionHtml: string[] = [];
let recordedActionScreenshot: string[] = [];
let lastUrl = window.location.href;
let lastScreenshot: string = "";
let lastPagehtml: string = "";

/**
 * Attaches the DOM and window event listeners that drive recording.
 * Safe to call multiple times — guarded by `listenersAttached` so a
 * restore-after-navigation path does not double-bind on top of an
 * existing startRecording().
 */
function attachRecordingListeners(): void {
    if (listenersAttached) return;
    listenersAttached = true;

    document.addEventListener("click", recordClick, true);
    document.addEventListener("input", recordInput, true);
    document.addEventListener("keyup", recordTextEntry, true);

    observeDOMChanges();

    window.addEventListener("unload", recordNavigation, true);
    window.addEventListener("beforeunload", recordNavigation, true);
    window.addEventListener("popstate", recordNavigation, true);
    window.addEventListener("hashchange", recordNavigation, true);
}

/**
 * Detaches the DOM and window event listeners that drive recording.
 */
function detachRecordingListeners(): void {
    if (!listenersAttached) return;
    listenersAttached = false;

    document.removeEventListener("click", recordClick, true);
    document.removeEventListener("input", recordInput, true);
    document.removeEventListener("keyup", recordTextEntry, true);

    window.removeEventListener("unload", recordNavigation, true);
    window.removeEventListener("beforeunload", recordNavigation, true);
    window.removeEventListener("popstate", recordNavigation, true);
    window.removeEventListener("hashchange", recordNavigation, true);
}

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

    attachRecordingListeners();
}

/**
 * Stops recording user actions
 * @returns The recorded actions and related data
 */
export async function stopRecording(): Promise<any> {
    recording = false;
    detachRecordingListeners();

    const screenshot = await captureAnnotatedScreenshot();
    recordedActionScreenshot.push(screenshot);

    const pageHTML = getPageHTML(CompressionMode.Automation, "", 0, false);
    recordedActionHtml.push(pageHTML);
    recordedHtmlIndex = recordedActionHtml.length;

    await chrome.runtime.sendMessage({
        type: "recordingStopped",
        recordedActions,
        recordedActionScreenshot,
        // Service-worker storage and downstream consumers expect the
        // 'recordedActionPageHTML' key (matches the
        // chrome.storage.session key and serviceTypes.mts). Rename
        // on the wire to avoid silently dropping HTML annotations.
        recordedActionPageHTML: recordedActionHtml,
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
        recordedActionPageHTML: recordedActionHtml,
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
                type: "spaNavigationDetected",
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

        // Listener wiring is limited to the top frame, matching the
        // start/stop messages from the service worker which are sent
        // with { frameId: 0 } (see serviceWorker/recording.ts). The
        // content script runs in every iframe ("all_frames": true) so
        // without this guard a cross-page restore would attach listeners
        // and stamp element IDs inside every iframe on the new page.
        const isTopFrame = window.top === window;

        if (recording) {
            // If a recording was in progress on the previous page, the
            // top-frame content script for the new page must reattach the
            // event listeners — the `recording` flag is restored from
            // storage but the listeners are not, so without this
            // clicks/inputs on the destination page are silently dropped.
            if (isTopFrame) {
                setIdsOnAllElements(0);
                attachRecordingListeners();
            }
        } else if (isTopFrame) {
            // Symmetric path: if the restored state says recording has
            // stopped, make sure no listeners are left attached from an
            // earlier call in the same content-script lifetime.
            detachRecordingListeners();
        }
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
    const prevRecording = recording;
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

    // Keep the listener wiring in sync with the recording flag, but only
    // in the top frame — iframes share the same code path via
    // "all_frames": true but the service worker scopes start/stop to
    // { frameId: 0 } and we must not record inside iframes.
    if (state.recording !== undefined && recording !== prevRecording) {
        const isTopFrame = window.top === window;
        if (isTopFrame) {
            if (recording) {
                attachRecordingListeners();
            } else {
                detachRecordingListeners();
            }
        }
    }
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
            lastPagehtml = getPageHTML(
                CompressionMode.Automation,
                "",
                0,
                false,
            );
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
