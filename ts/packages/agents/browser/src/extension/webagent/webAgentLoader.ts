// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ContinuationState,
    webAgentStorage,
} from "../contentScript/webAgentStorage";
import {
    WebAgent,
    WebAgentContext,
    PageReadyOptions,
    matchesUrl,
} from "./WebAgentContext";
import { sendUIEventsRequest } from "../contentScript/elementInteraction";
import {
    extractComponent as rpcExtractComponent,
    sendNotification,
} from "./webAgentRpc";
import { UIActions, EnterTextOptions } from "./WebAgentContext";

declare global {
    interface Window {
        electronAPI?: {
            getTabId?: () => string | null;
        };
        _tabId?: string;
        __webAgentRegister?: (agent: WebAgent) => void;
    }
}

function escapeCssSelector(selector: string): string {
    if (selector.startsWith("#id_")) {
        return selector;
    }

    if (selector.charAt(0) === "#") {
        return "#" + CSS.escape(selector.substring(1));
    }

    return CSS.escape(selector);
}

async function getTabId(): Promise<string | null> {
    // Electron: check for electronAPI or _tabId
    if (window.electronAPI?.getTabId) {
        return window.electronAPI.getTabId();
    }
    if (window._tabId) {
        return window._tabId;
    }
    // For main world scripts, tabId may not be available
    // Return a session-based ID as fallback
    return null;
}

function createUIActions(): UIActions {
    return {
        async clickOn(selector: string): Promise<void> {
            await sendUIEventsRequest({
                actionName: "clickOnElement",
                parameters: {
                    cssSelector: escapeCssSelector(selector),
                },
            });
        },

        async enterTextIn(
            selector: string,
            text: string,
            options?: EnterTextOptions,
        ): Promise<void> {
            await sendUIEventsRequest({
                actionName: "enterTextInElement",
                parameters: {
                    cssSelector: escapeCssSelector(selector),
                    value: text,
                    submitForm: options?.triggerSubmit ?? false,
                },
            });
        },

        async setDropdown(
            selector: string,
            optionLabel: string,
        ): Promise<void> {
            await sendUIEventsRequest({
                actionName: "setDropdownValue",
                parameters: {
                    cssSelector: escapeCssSelector(selector),
                    optionLabel,
                },
            });
        },

        async scroll(direction: "up" | "down"): Promise<void> {
            const scrollAmount = window.innerHeight * 0.9;
            if (direction === "down") {
                window.scrollTo(0, window.scrollY + scrollAmount);
            } else {
                window.scrollTo(0, window.scrollY - scrollAmount);
            }
        },
    };
}

// Agents are registered dynamically via site-specific scripts (sites/crossword.ts, etc.)
// injected only on matching URLs by the extension manifest.
const registeredAgents: WebAgent[] = [];

let activeAgent: WebAgent | null = null;
let activeContext: WebAgentContext | null = null;

// Continuation received before agent finished initializing.
// Dispatched after activateAgentForUrl completes.
let pendingContinuation: ContinuationState | null = null;

async function awaitPageReady(options?: PageReadyOptions): Promise<void> {
    const stabilityMs = options?.stabilityMs ?? 500;
    const timeoutMs = options?.timeoutMs ?? 5000;

    if (document.readyState === "loading") {
        await new Promise<void>((r) =>
            document.addEventListener("DOMContentLoaded", () => r(), {
                once: true,
            }),
        );
    }

    // Use MutationObserver-based stability detection:
    // watch for DOM mutations to settle, resolving when no mutations
    // occur within the stability window.
    await new Promise<void>((resolve) => {
        let stabilityTimer: number | null = null;
        const maxTimer = window.setTimeout(() => {
            cleanup();
            resolve();
        }, timeoutMs);

        const observer = new MutationObserver(() => {
            if (stabilityTimer !== null) {
                window.clearTimeout(stabilityTimer);
            }
            stabilityTimer = window.setTimeout(() => {
                cleanup();
                resolve();
            }, stabilityMs);
        });

        function cleanup() {
            observer.disconnect();
            if (stabilityTimer !== null) window.clearTimeout(stabilityTimer);
            window.clearTimeout(maxTimer);
        }

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
        });

        // If the DOM is already stable, start the stability timer immediately
        stabilityTimer = window.setTimeout(() => {
            cleanup();
            resolve();
        }, stabilityMs);
    });
}

function createWebAgentContext(
    continuation?: ContinuationState,
): WebAgentContext {
    return {
        ui: createUIActions(),
        extractComponent: rpcExtractComponent,
        notify: sendNotification,
        continuation,
        storage: webAgentStorage,
        getTabId,
        getCurrentUrl: () => window.location.href,
        awaitPageReady,
    };
}

async function activateAgentForUrl(url: string): Promise<void> {
    console.log(`[WebAgentLoader] Checking URL for WebAgent match: ${url}`);
    console.log(
        `[WebAgentLoader] Registered agents: ${registeredAgents.map((a) => a.name).join(", ")}`,
    );

    const matchingAgent = registeredAgents.find((agent) =>
        matchesUrl(url, agent.urlPatterns),
    );

    if (matchingAgent && matchingAgent !== activeAgent) {
        console.log(
            `[WebAgentLoader] Activating WebAgent: ${matchingAgent.name} for ${url}`,
        );
        activeAgent = matchingAgent;
        activeContext = createWebAgentContext();
        console.log(
            `[WebAgentLoader] Calling initialize() on ${matchingAgent.name}...`,
        );
        const startTime = performance.now();
        await activeAgent.initialize(activeContext);
        const elapsed = (performance.now() - startTime).toFixed(0);
        console.log(
            `[WebAgentLoader] WebAgent ${matchingAgent.name} initialized in ${elapsed}ms`,
        );
        // Dispatch any continuation that arrived during initialization
        if (pendingContinuation) {
            const continuation = pendingContinuation;
            pendingContinuation = null;
            console.log(
                `[WebAgentLoader] Dispatching queued continuation ${continuation.step} to ${matchingAgent.name}`,
            );
            dispatchContinuation(continuation);
        }
    } else if (!matchingAgent && activeAgent) {
        console.log(
            `[WebAgentLoader] Deactivating WebAgent: ${activeAgent.name}`,
        );
        activeAgent = null;
        activeContext = null;
    } else if (!matchingAgent) {
        console.log(`[WebAgentLoader] No matching WebAgent for URL`);
    } else {
        console.log(
            `[WebAgentLoader] WebAgent ${matchingAgent.name} already active`,
        );
    }
}

function dispatchContinuation(continuation: ContinuationState): void {
    if (!activeAgent || !activeContext) {
        console.warn("[WebAgentLoader] No active agent to handle continuation");
        return;
    }
    if (activeAgent.handleContinuation) {
        activeContext.continuation = continuation;
        activeAgent.handleContinuation(continuation, activeContext);
    }
}

function handleContinuationResume(event: Event): void {
    const customEvent = event as CustomEvent<ContinuationState>;
    const continuation = customEvent.detail;

    if (!activeAgent || !activeContext) {
        console.log(
            "[WebAgentLoader] Continuation received, agent not ready yet — queuing",
        );
        pendingContinuation = continuation;
        return;
    }

    console.log(
        `[WebAgentLoader] Dispatching continuation ${continuation.step} to ${activeAgent.name}`,
    );
    dispatchContinuation(continuation);
}

function handleSpaNavigation(): void {
    console.log("[WebAgentLoader] SPA navigation detected");
    setTimeout(() => {
        activateAgentForUrl(window.location.href);
    }, 100);
}

export function initializeWebAgentLoader(): void {
    // Only activate WebAgents in the top-level frame, not in iframes
    if (window !== window.top) {
        console.log("[WebAgentLoader] Skipping initialization in iframe");
        return;
    }

    console.log("[WebAgentLoader] Initializing WebAgentLoader...");
    console.log(`[WebAgentLoader] Current URL: ${window.location.href}`);
    activateAgentForUrl(window.location.href);

    // Expose registerWebAgent on window so site-specific IIFE bundles
    // (sites/crossword.js, etc.) share the same loader state instead of
    // getting their own duplicate copy of module variables.
    window.__webAgentRegister = registerWebAgent;

    window.addEventListener("spa-navigation", handleSpaNavigation);
    window.addEventListener(
        "webagent-continuation-resume",
        handleContinuationResume,
    );
    console.log("[WebAgentLoader] Event listeners registered");
}

export function getActiveWebAgent(): WebAgent | null {
    return activeAgent;
}

export function registerWebAgent(agent: WebAgent): void {
    console.log(`[WebAgentLoader] registerWebAgent called for: ${agent.name}`);
    if (!registeredAgents.some((a) => a.name === agent.name)) {
        console.log(`[WebAgentLoader] Adding new WebAgent: ${agent.name}`);
        registeredAgents.push(agent);

        if (matchesUrl(window.location.href, agent.urlPatterns)) {
            console.log(
                `[WebAgentLoader] URL matches, activating ${agent.name}`,
            );
            activateAgentForUrl(window.location.href);
        }
    } else {
        console.log(
            `[WebAgentLoader] WebAgent ${agent.name} already registered`,
        );
    }
}
