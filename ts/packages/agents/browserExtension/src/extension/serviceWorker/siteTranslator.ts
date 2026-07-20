// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ensureWebsocketConnected, sendActionToAgent } from "./websocket";

let currentSiteTranslator = "";

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
