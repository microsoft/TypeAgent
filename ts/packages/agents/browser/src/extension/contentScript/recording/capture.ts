// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getPageHTML } from "../htmlUtils";
import { getRecordingState, setLastScreenshot, setLastPageHtml } from "./index";

/**
 * Captures the current UI state
 */
export async function captureUIState(): Promise<void> {
    try {
        const screenshot = await chrome.runtime.sendMessage({
            type: "takeScreenshot",
        });
        setLastScreenshot(screenshot);
    } catch (error) {
        console.error("Error capturing screenshot:", error);
    }

    setLastPageHtml(getPageHTML(false, "", 0, false));
}

/**
 * Captures an annotated screenshot
 * @param screenshotUrl Optional URL of a screenshot to annotate
 * @returns Promise resolving to the annotated screenshot URL
 */
export async function captureAnnotatedScreenshot(
    screenshotUrl?: string,
): Promise<string> {
    return new Promise(async (resolve, reject) => {
        if (screenshotUrl === undefined || screenshotUrl.length == 0) {
            try {
                screenshotUrl = await chrome.runtime.sendMessage({
                    type: "takeScreenshot",
                });
            } catch (error) {
                console.error("Error capturing screenshot:", error);
                resolve("");
                return;
            }
        }

        if (!screenshotUrl) {
            console.error("Failed to capture screenshot");
            resolve("");
            return;
        }

        const img = new Image();
        img.src = screenshotUrl;
        img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d")!;
            canvas.width = img.width;
            canvas.height = img.height;

            ctx.drawImage(img, 0, 0);
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

            getRecordingState().recordedActions.forEach((action: any) => {
                if (action.boundingBox) {
                    const { left, top, width, height } = action.boundingBox;
                    ctx.strokeStyle = "red";
                    ctx.lineWidth = 2;
                    ctx.strokeRect(left, top, width, height);

                    ctx.fillStyle = "red";
                    ctx.font = "bold 14px Arial";
                    var textWidth = ctx.measureText(
                        action.cssSelector ?? "",
                    ).width;

                    ctx.fillText(
                        action.cssSelector ?? "",
                        left + width - textWidth,
                        top - 5,
                    );
                }
            });

            const annotatedScreenshot = canvas.toDataURL("image/png");
            resolve(annotatedScreenshot);
        };

        img.onerror = () => {
            console.error("Error loading image");
            resolve("");
        };
    });
}
