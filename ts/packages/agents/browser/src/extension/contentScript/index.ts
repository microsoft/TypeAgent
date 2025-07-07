// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { initializeEventHandlers } from "./eventHandlers";
import { restoreRecordingState } from "./recording";
import { interceptHistory } from "./spaNavigation";
import "./autoIndexing"; // Initialize auto-indexing

// Imports to help with bundling
import "./domUtils";
import "./elementInteraction";
import "./eventHandlers";
import "./htmlProcessing";
import "./htmlReducer";
import "./loadingDetector";
import "./messaging";
import "./pageContent";
import "./schemaExtraction";
import "./spaNavigation";
import "./types";

/**
 * Initializes the content script
 */
async function initialize(): Promise<void> {
    console.log("Content Script initializing");

    // Initialize event handlers
    initializeEventHandlers();

    // Set up SPA navigation detection
    setupSpaNavigation();

    // Restore recording state if any
    await restoreRecordingStateFromStorage();

    console.log("Content Script initialized");
}

/**
 * Sets up SPA navigation detection
 */
function setupSpaNavigation(): void {
    // Override history methods
    history.pushState = interceptHistory("pushState");
    history.replaceState = interceptHistory("replaceState");
}

/**
 * Restores recording state from storage
 */
async function restoreRecordingStateFromStorage(): Promise<void> {
    try {
        const restoredData = await chrome.runtime.sendMessage({
            type: "getRecordedActions",
        });

        restoreRecordingState(restoredData);
    } catch (error) {
        console.error("Error restoring recording state:", error);
    }
}

// Initialize the content script when the DOM is fully loaded
document.addEventListener("DOMContentLoaded", initialize);

// Export any functions that need to be accessed from other modules
export { initialize };
