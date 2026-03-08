// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ContinuationState,
    webAgentStorage,
} from "../contentScript/webAgentStorage";
import { WebAgent, WebAgentContext, matchesUrl } from "./WebAgentContext";
import { sendUIEventsRequest } from "../contentScript/elementInteraction";
import {
    extractComponent as rpcExtractComponent,
    sendNotification,
} from "./webAgentRpc";
import { CrosswordWebAgent } from "./crossword/CrosswordWebAgent";
import { CommerceWebAgent } from "./commerce/CommerceWebAgent";
import { InstacartWebAgent } from "./instacart/InstacartWebAgent";
import { UIActions, EnterTextOptions } from "./WebAgentContext";

declare global {
    interface Window {
        electronAPI?: {
            getTabId?: () => string | null;
        };
        _tabId?: string;
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

const registeredAgents: WebAgent[] = [
    new CrosswordWebAgent(),
    new CommerceWebAgent(),
    new InstacartWebAgent(),
];

let activeAgent: WebAgent | null = null;
let activeContext: WebAgentContext | null = null;

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

function handleContinuationResume(event: Event): void {
    const customEvent = event as CustomEvent<ContinuationState>;
    const continuation = customEvent.detail;

    if (!activeAgent || !activeContext) {
        console.warn("No active agent to handle continuation");
        return;
    }

    if (activeAgent.handleContinuation) {
        activeContext.continuation = continuation;
        activeAgent.handleContinuation(continuation, activeContext);
    }
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
