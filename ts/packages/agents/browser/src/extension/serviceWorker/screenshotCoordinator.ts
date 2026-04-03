// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getActiveTab } from "./tabManager";

/**
 * Screenshot capture using chrome.tabs.captureVisibleTab.
 * This is the standard approach for Chrome MV3 extensions — simple,
 * reliable, and works directly from the service worker without
 * offscreen documents or tabCapture streams.
 *
 * Rate limit: 2 calls/sec (Chrome 92+), which is sufficient for
 * agent-driven captures (a few per minute).
 */

interface ScreenshotOptions {
    format?: "jpeg" | "png";
    quality?: number; // 0-1 for JPEG
    tabId?: number; // Optional, uses active tab if not provided
}

class ScreenshotCoordinator {
    private static instance: ScreenshotCoordinator;

    private constructor() {}

    public static getInstance(): ScreenshotCoordinator {
        if (!ScreenshotCoordinator.instance) {
            ScreenshotCoordinator.instance = new ScreenshotCoordinator();
        }
        return ScreenshotCoordinator.instance;
    }

    public async captureScreenshot(
        options: ScreenshotOptions = {},
    ): Promise<string> {
        const CAPTURE_TIMEOUT = 10000;
        return Promise.race([
            this.capture(options),
            new Promise<string>((_, reject) =>
                setTimeout(
                    () => reject(new Error("Screenshot capture timed out")),
                    CAPTURE_TIMEOUT,
                ),
            ),
        ]);
    }

    private async capture(options: ScreenshotOptions): Promise<string> {
        const format = options.format || "png";
        const quality = options.quality;
        const captureOptions = {
            format: format as "png" | "jpeg",
            ...(format === "jpeg" && quality !== undefined
                ? { quality: Math.round(quality * 100) }
                : {}),
        };

        try {
            if (options.tabId) {
                const tab = await chrome.tabs.get(options.tabId);
                if (!tab.windowId) {
                    throw new Error("Tab has no window ID");
                }
                return await chrome.tabs.captureVisibleTab(
                    tab.windowId,
                    captureOptions,
                );
            } else {
                return await chrome.tabs.captureVisibleTab(captureOptions);
            }
        } catch (error: any) {
            if (error.message?.includes("Cannot access")) {
                throw new Error("Cannot capture screenshot of this page type");
            }
            throw error;
        }
    }
}

export const screenshotCoordinator = ScreenshotCoordinator.getInstance();
