// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PlatformServices } from "../../common/platformServices.mjs";

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
                const result = await chrome.runtime.sendMessage({
                    type: "checkWebSocketConnection",
                });
                return { connected: result?.connected ?? false };
            },
        },
    };
}
