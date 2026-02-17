// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { initializeEventHandlers } from "./eventHandlers";
import { restoreRecordingState } from "./recording";
import { interceptHistory } from "./spaNavigation";
import { PDFInterceptor } from "./pdfInterceptor";
import "./autoIndexing"; // Initialize auto-indexing

// Imports to help with bundling
import "./domUtils";
import "./elementInteraction";
import "./eventHandlers";
import "./htmlUtils";
import "./loadingDetector";
import "./messaging";
import "./pageContent";
import "./pdfInterceptor";
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

    // Initialize PDF interceptor
    await initializePDFInterceptor();

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

/**
 * Initializes PDF link interceptor
 */
async function initializePDFInterceptor(): Promise<void> {
    try {
        const pdfInterceptor = new PDFInterceptor();
        await pdfInterceptor.initialize();
    } catch (error) {
        console.error("Error initializing PDF interceptor:", error);
    }
}

// Initialize the content script when the DOM is fully loaded
document.addEventListener("DOMContentLoaded", initialize);

// Listen for test messages from the page (for debugging/testing)
window.addEventListener("message", async (event) => {
    // Only accept messages from the same window
    if (event.source !== window) return;

    const data = event.data;

    // Handle screenshot test requests from the page
    if (data && data.type === "test-screenshot-request") {
        try {
            const screenshot = await chrome.runtime.sendMessage({
                type: "takeScreenshot",
            });

            // Send response back to the page
            window.postMessage(
                {
                    type: "test-screenshot-response",
                    requestId: data.requestId,
                    success: true,
                    screenshot: screenshot,
                },
                "*",
            );
        } catch (error: any) {
            window.postMessage(
                {
                    type: "test-screenshot-response",
                    requestId: data.requestId,
                    success: false,
                    error: error.message,
                },
                "*",
            );
        }
    }
});

// Export any functions that need to be accessed from other modules
export { initialize };
