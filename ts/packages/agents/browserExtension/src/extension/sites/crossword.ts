// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CrosswordWebAgent } from "../webagent/crossword/CrosswordWebAgent";
import { WebAgent } from "../webagent/WebAgentContext";
import { getCrosswordMode } from "../webagent/crossword/decisionBridge";

declare global {
    interface Window {
        __webAgentRegister?: (agent: WebAgent) => void;
        __webAgentRegisterOnDemand?: (agent: WebAgent) => Promise<void>;
    }
}

const agent: WebAgent = new CrosswordWebAgent();
agent.matchesDocument = hasVisibleExolvePuzzle;

export function hasVisibleExolvePuzzle(): boolean {
    return Array.from(
        document.querySelectorAll(".xlv-frame .xlv-clues .xlv-clue-text"),
    ).some(
        (element) =>
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== "hidden",
    );
}

function register() {
    if (window.__webAgentRegister) {
        window.__webAgentRegister(agent);
    } else {
        console.warn("[sites/crossword] __webAgentRegister not available");
    }
    void registerOnDemand();
}

async function registerOnDemand(): Promise<void> {
    try {
        if ((await getCrosswordMode()) === "decision")
            await window.__webAgentRegisterOnDemand?.(agent);
    } catch (error) {
        console.warn(
            "[sites/crossword] On-demand registration unavailable",
            error,
        );
    }
}

window.addEventListener("message", (event: MessageEvent) => {
    if (
        event.source === window &&
        event.origin === location.origin &&
        event.data?.type === "typeagent-crossword-mode" &&
        event.data.mode === "decision"
    )
        void registerOnDemand();
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        register();
    });
} else {
    register();
}

if (!agent.matchesDocument?.()) {
    const observer = new MutationObserver(() => {
        if (agent.matchesDocument?.()) {
            observer.disconnect();
            register();
        }
    });
    observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden"],
    });
    window.addEventListener("pagehide", () => observer.disconnect(), {
        once: true,
    });
}
