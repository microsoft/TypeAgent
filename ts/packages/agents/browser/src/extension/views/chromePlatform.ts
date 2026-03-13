// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PlatformServices } from "../../common/platformServices.mjs";
import { createChromeRpcClient } from "./chromeRpcClient";

let chromeRpcSingleton: ReturnType<typeof createChromeRpcClient> | undefined;
function getChromeRpc() {
    if (!chromeRpcSingleton) chromeRpcSingleton = createChromeRpcClient();
    return chromeRpcSingleton;
}

export function createChromePlatform(): PlatformServices {
    return {
        storage: {
            async get(keys: string[]) {
                return chrome.storage.sync.get(keys);
            },
            async set(items: Record<string, any>) {
                await chrome.storage.sync.set(items);
            },
        },
        tabs: {
            async getActiveTab() {
                const [tab] = await chrome.tabs.query({
                    active: true,
                    currentWindow: true,
                });
                if (!tab?.id) return null;
                return {
                    id: tab.id,
                    url: tab.url ?? "",
                    title: tab.title ?? "",
                };
            },
            async createTab(url: string, active = true) {
                return chrome.tabs.create({ url, active });
            },
        },
        connection: {
            async checkWebSocket() {
                const { rpc } = getChromeRpc();
                const result = await (rpc as any).invoke(
                    "checkWebSocketConnection",
                    { type: "checkWebSocketConnection" },
                );
                return { connected: result?.connected ?? false };
            },
        },
    };
}
