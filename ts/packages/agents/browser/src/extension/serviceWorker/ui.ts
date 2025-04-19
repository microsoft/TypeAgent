// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Sets the badge to indicate an error state
 */
export function showBadgeError(): void {
    chrome.action.setBadgeBackgroundColor({ color: "#F00" }, () => {
        chrome.action.setBadgeText({ text: "!" });
    });
}

/**
 * Sets the badge to indicate a healthy state (clear badge)
 */
export function showBadgeHealthy(): void {
    chrome.action.setBadgeText({
        text: "",
    });
}

/**
 * Sets the badge to indicate a busy state
 */
export function showBadgeBusy(): void {
    chrome.action.setBadgeBackgroundColor({ color: "#0000FF" }, () => {
        chrome.action.setBadgeText({ text: "..." });
    });
}
