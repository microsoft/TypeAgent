// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    isCrosswordMode,
    isCrosswordDecisionStrategy,
    type CrosswordDecisionStrategy,
    type CrosswordMode,
} from "@typeagent/browser-control-rpc/crosswordDecisionTypes";
import {
    isShoppingMode,
    type ShoppingMode,
} from "@typeagent/browser-control-rpc/uiDecisionTypes";

export interface ExtensionSettings {
    agentServerHost: string;
    defaultExtractionMode: "content";
    shoppingMode: ShoppingMode;
    crosswordMode: CrosswordMode;
    crosswordDecisionStrategy: CrosswordDecisionStrategy;
    maxConcurrentExtractions: number;
    qualityThreshold: number;
    enableIntelligentAnalysis: boolean;
    autoDiscovery: boolean;
    autoDiscoveryMode: "scope" | "content";
    excludeSensitiveSites: boolean;
    autoOpenChatPanel: boolean;
    caseInsensitiveWindowTitleMatching: boolean;
}

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
    agentServerHost: "",
    defaultExtractionMode: "content",
    shoppingMode: "generative",
    crosswordMode: "generative",
    crosswordDecisionStrategy: "hybrid",
    maxConcurrentExtractions: 3,
    qualityThreshold: 0.3,
    enableIntelligentAnalysis: true,
    autoDiscovery: true,
    autoDiscoveryMode: "content",
    excludeSensitiveSites: true,
    autoOpenChatPanel: true,
    caseInsensitiveWindowTitleMatching: true,
};

export async function getShoppingMode(): Promise<ShoppingMode> {
    const { shoppingMode } = await chrome.storage.sync.get("shoppingMode");
    if (isShoppingMode(shoppingMode)) {
        return shoppingMode;
    }
    if (shoppingMode !== undefined) {
        console.warn("Invalid shopping mode; resetting to Generative.");
        await chrome.storage.sync.set({ shoppingMode: "generative" });
    }
    return "generative";
}

export async function getCrosswordMode(): Promise<CrosswordMode> {
    const { crosswordMode } = await chrome.storage.sync.get("crosswordMode");
    if (isCrosswordMode(crosswordMode)) {
        return crosswordMode;
    }
    if (crosswordMode !== undefined) {
        console.warn("Invalid crossword mode; resetting to Generative.");
        await chrome.storage.sync.set({ crosswordMode: "generative" });
    }
    return "generative";
}

export async function getCrosswordDecisionStrategy(): Promise<CrosswordDecisionStrategy> {
    const { crosswordDecisionStrategy } = await chrome.storage.sync.get(
        "crosswordDecisionStrategy",
    );
    if (isCrosswordDecisionStrategy(crosswordDecisionStrategy))
        return crosswordDecisionStrategy;
    if (crosswordDecisionStrategy !== undefined) {
        console.warn(
            "Invalid crossword Decision strategy; resetting to Hybrid.",
        );
        await chrome.storage.sync.set({ crosswordDecisionStrategy: "hybrid" });
    }
    return "hybrid";
}

export async function getCrosswordDecisionSettings() {
    const [mode, strategy] = await Promise.all([
        getCrosswordMode(),
        getCrosswordDecisionStrategy(),
    ]);
    return { mode, strategy };
}

export async function notifyCrosswordModeChanged(
    mode: CrosswordMode,
): Promise<void> {
    const strategy = await getCrosswordDecisionStrategy();
    const tabs = await chrome.tabs.query({
        url: ["http://*/*", "https://*/*"],
    });
    await Promise.all(
        tabs
            .filter((tab) => tab.id !== undefined)
            .map(async (tab) => {
                try {
                    // Omitting frameId delivers to every content-script frame.
                    await chrome.tabs.sendMessage(tab.id!, {
                        type: "crosswordModeChanged",
                        mode,
                        strategy,
                    });
                } catch {
                    // Tabs without a content-script receiver need no update.
                }
            }),
    );
}

/**
 * Saves recorded actions to storage
 * @param recordedActions The recorded actions
 * @param recordedActionPageHTML The HTML of the page during recording
 * @param recordedActionScreenshot The screenshot taken during recording
 * @param actionIndex The index of the current action
 * @param isCurrentlyRecording Whether recording is in progress
 */
export async function saveRecordedActions(
    recordedActions: any[],
    recordedActionPageHTML: any,
    recordedActionScreenshot: string,
    actionIndex: number,
    isCurrentlyRecording: boolean,
): Promise<void> {
    await chrome.storage.session.set({
        recordedActions,
        recordedActionPageHTML,
        annotatedScreenshot: recordedActionScreenshot,
        actionIndex,
        isCurrentlyRecording,
    });
}

/**
 * Gets recorded actions from storage
 * @returns The recorded actions and related data
 */
export async function getRecordedActions(): Promise<any> {
    return await chrome.storage.session.get([
        "recordedActions",
        "recordedActionPageHTML",
        "annotatedScreenshot",
        "actionIndex",
        "isCurrentlyRecording",
    ]);
}

/**
 * Clears recorded actions from storage
 */
export async function clearRecordedActions(): Promise<void> {
    try {
        await chrome.storage.session.remove([
            "recordedActions",
            "recordedActionPageHTML",
            "annotatedScreenshot",
            "actionIndex",
            "isCurrentlyRecording",
        ]);
    } catch (error) {
        console.error("Error clearing storage data:", error);
    }
}

/**
 * Gets settings from storage.
 *
 * `agentServerHost` is the URL of the agent-server's discovery /
 * dispatcher endpoint (default `ws://localhost:8999/`). The browser
 * agent's actual WebSocket port is discovered dynamically through
 * that endpoint — we deliberately do NOT cache or expose a per-agent
 * port here, because the registrar may assign different ports across
 * restarts of the host process.
 */
export async function getSettings(): Promise<Record<string, string>> {
    const settings = await chrome.storage.sync.get(["agentServerHost"]);
    return settings;
}
