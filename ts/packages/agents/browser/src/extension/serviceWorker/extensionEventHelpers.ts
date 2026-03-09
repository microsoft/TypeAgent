// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ExtensionEventMap } from "../../common/extensionEvents.mjs";

export function broadcastEvent<K extends keyof ExtensionEventMap>(
    event: K,
    data: ExtensionEventMap[K],
): void {
    chrome.runtime
        .sendMessage({ type: "event", event, data })
        .catch(() => {});
}

export function onExtensionEvent<K extends keyof ExtensionEventMap>(
    event: K,
    callback: (data: ExtensionEventMap[K]) => void,
): () => void {
    const listener = (message: any) => {
        if (message.type === "event" && message.event === event) {
            callback(message.data);
        }
    };

    chrome.runtime.onMessage.addListener(listener);

    return () => {
        chrome.runtime.onMessage.removeListener(listener);
    };
}
