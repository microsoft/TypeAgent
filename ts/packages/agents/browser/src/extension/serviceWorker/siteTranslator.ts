// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ensureWebsocketConnected, sendActionToAgent } from "./websocket";

let currentSiteTranslator = "";
let currentCrosswordUrl = "";

/**
 * Determines and enables the appropriate site translator based on the URL of the tab
 * @param targetTab The tab to enable the translator for
 */
export async function toggleSiteTranslator(
    targetTab: chrome.tabs.Tab,
): Promise<void> {
    let method = "enableSiteTranslator";
    let schemaName = "";
    await ensureWebsocketConnected();

    if (targetTab.url) {
        // Register discovery helper
        if (schemaName === "") {
            method = "enableSiteTranslator";
            schemaName = "browser.actionDiscovery";
            currentSiteTranslator = schemaName;
        }

        if (schemaName) {
            try {
                await sendActionToAgent({
                    actionName: method,
                    parameters: { translator: schemaName },
                });
            } catch (error) {
                console.error("Failed to send site translator action:", error);
            }
        }
    }
}

/**
 * Gets the current site translator
 * @returns The current site translator
 */
export function getCurrentSiteTranslator(): string {
    return currentSiteTranslator;
}

/**
 * Gets the current crossword URL
 * @returns The current crossword URL
 */
export function getCurrentCrosswordUrl(): string {
    return currentCrosswordUrl;
}

/**
 * Sets the current crossword URL
 * @param url The crossword URL to set
 */
export function setCurrentCrosswordUrl(url: string): void {
    currentCrosswordUrl = url;
}

/**
 * Sets the current site translator
 * @param translator The translator to set
 */
export function setCurrentSiteTranslator(translator: string): void {
    currentSiteTranslator = translator;
}
