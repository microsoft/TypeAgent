// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ensureWebsocketConnected, getWebSocket } from "./websocket";

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
        const host = new URL(targetTab.url).host;

        // Crossword site handling
        if (
            targetTab.url.startsWith("https://embed.universaluclick.com/") ||
            targetTab.url.startsWith(
                "https://data.puzzlexperts.com/puzzleapp",
            ) ||
            targetTab.url.startsWith("https://nytsyn.pzzl.com/cwd_seattle") ||
            targetTab.url.startsWith("https://www.wsj.com/puzzles/crossword") ||
            targetTab.url.startsWith(
                "https://www.seattletimes.com/games-nytimes-crossword",
            ) ||
            targetTab.url.startsWith(
                "https://www.denverpost.com/games/daily-crossword",
            ) ||
            targetTab.url.startsWith(
                "https://www.denverpost.com/puzzles/?amu=/iwin-crossword",
            ) ||
            targetTab.url.startsWith(
                "https://www.bestcrosswords.com/bestcrosswords/guestconstructor",
            )
        ) {
            method = "enableSiteTranslator";
            schemaName = "browser.crossword";
            currentSiteTranslator = schemaName;
            currentCrosswordUrl = targetTab.url;
        }

        // Commerce site handling
        const commerceHosts = [
            "www.homedepot.com",
            "www.target.com",
            "www.walmart.com",
        ];

        if (commerceHosts.includes(host)) {
            method = "enableSiteTranslator";
            schemaName = "browser.commerce";
            currentSiteTranslator = schemaName;
        }

        // Instacart site handling
        if (host === "instacart.com" || host === "www.instacart.com") {
            method = "enableSiteTranslator";
            schemaName = "browser.instacart";
            currentSiteTranslator = schemaName;
        }

        // Default to actionDiscovery if no specific translator is identified
        if (schemaName === "") {
            method = "enableSiteTranslator";
            schemaName = "browser.actionDiscovery";
            currentSiteTranslator = schemaName;
        }

        // Trigger translator change if WebSocket is open
        const webSocket = getWebSocket();
        if (
            webSocket &&
            webSocket.readyState === WebSocket.OPEN &&
            schemaName
        ) {
            webSocket.send(
                JSON.stringify({
                    method: method,
                    params: { translator: schemaName },
                }),
            );
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
