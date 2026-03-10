// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    webAgentStorage,
    continuationStorage,
    ContinuationState,
} from "./webAgentStorage";

let initialized = false;

declare global {
    interface Window {
        electronAPI?: {
            getTabId?: () => string | null;
        };
        _tabId?: string;
    }
}

async function getTabId(): Promise<string | null> {
    // Electron: check for electronAPI or _tabId
    if (typeof window !== "undefined") {
        if (window.electronAPI?.getTabId) {
            return window.electronAPI.getTabId();
        }
        if (window._tabId) {
            return window._tabId;
        }
    }

    // Chrome extension: request tabId from service worker
    return new Promise((resolve) => {
        try {
            if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({ type: "getTabId" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error(
                            "getTabId error:",
                            chrome.runtime.lastError,
                        );
                        resolve(null);
                        return;
                    }
                    resolve(response?.tabId ?? null);
                });
            } else {
                resolve(null);
            }
        } catch (e) {
            console.error("getTabId exception:", e);
            resolve(null);
        }
    });
}

async function waitForPageStability(maxWaitMs = 3000): Promise<void> {
    return new Promise((resolve) => {
        let lastMutationTime = Date.now();
        let checkInterval: number | null = null;

        const observer = new MutationObserver(() => {
            lastMutationTime = Date.now();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        const startTime = Date.now();
        checkInterval = window.setInterval(() => {
            const timeSinceLastMutation = Date.now() - lastMutationTime;
            const totalElapsed = Date.now() - startTime;

            if (timeSinceLastMutation > 500 || totalElapsed > maxWaitMs) {
                observer.disconnect();
                if (checkInterval) clearInterval(checkInterval);
                resolve();
            }
        }, 100);
    });
}

async function checkAndResumeContinuation(): Promise<void> {
    console.log("[ContinuationHandler] Checking for continuation...");
    webAgentStorage.cleanup();

    const tabId = await getTabId();
    console.log("[ContinuationHandler] tabId:", tabId);
    if (!tabId) {
        console.log("[ContinuationHandler] No tabId, skipping");
        return;
    }

    const continuation = continuationStorage.get(tabId);
    console.log("[ContinuationHandler] continuation:", continuation);
    if (!continuation) {
        console.log(
            "[ContinuationHandler] No continuation found for tabId:",
            tabId,
        );
        return;
    }

    // Remove the continuation from storage before resuming to prevent re-triggering
    continuationStorage.remove(tabId);

    await waitForPageStability();

    console.log(
        "[ContinuationHandler] Resuming continuation:",
        continuation.type,
        continuation.step,
        "at URL:",
        window.location.href,
    );

    window.dispatchEvent(
        new CustomEvent("webagent-continuation-resume", {
            detail: continuation,
        }),
    );
}

function handleSpaNavigation(): void {
    setTimeout(() => {
        checkAndResumeContinuation();
    }, 500);
}

export function initializeContinuationHandler(): void {
    if (initialized) return;
    initialized = true;

    checkAndResumeContinuation();

    window.addEventListener("spa-navigation", handleSpaNavigation);
}

export async function setContinuation(
    state: Omit<ContinuationState, "tabId" | "createdAt">,
): Promise<void> {
    const tabId = await getTabId();
    if (!tabId) {
        throw new Error("Could not get tabId for continuation");
    }
    continuationStorage.set(tabId, state);
}

export async function clearContinuation(): Promise<void> {
    const tabId = await getTabId();
    if (tabId) {
        continuationStorage.remove(tabId);
    }
}

export async function getContinuation(): Promise<ContinuationState | null> {
    const tabId = await getTabId();
    if (!tabId) {
        return null;
    }
    return continuationStorage.get(tabId);
}

export { getTabId };
