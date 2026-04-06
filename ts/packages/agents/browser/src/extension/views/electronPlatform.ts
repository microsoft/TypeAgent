// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PlatformServices } from "../../common/platformServices.mjs";

export function createElectronPlatform(): PlatformServices {
    const api = (window as any).electronAPI;

    return {
        storage: {
            async get(keys: string[]) {
                return api.getStorage(keys);
            },
            async set(items: Record<string, any>) {
                await api.setStorage(items);
            },
        },
        tabs: {
            async getActiveTab() {
                return {
                    id: -1,
                    url: window.location.href,
                    title: document.title,
                };
            },
            async createTab(url: string, active = true) {
                window.open(url, active ? "_self" : "_blank");
                return { id: -1, url, active };
            },
        },
        connection: {
            async checkWebSocket() {
                try {
                    return await api.checkWebSocketConnection();
                } catch {
                    return { connected: false };
                }
            },
        },
    };
}
