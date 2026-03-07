// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    isWebAgentMessage,
    isWebAgentMessageFromDispatcher,
} from "../../common/webAgentMessageTypes.mjs";

let port: chrome.runtime.Port | null = null;
let portConnected = false;

function ensurePort(): chrome.runtime.Port | null {
    if (port && portConnected) {
        return port;
    }

    try {
        port = chrome.runtime.connect({ name: "typeagent" });
        portConnected = true;

        port.onMessage.addListener((message) => {
            if (isWebAgentMessageFromDispatcher(message)) {
                window.postMessage(message, "*");
            }
        });

        port.onDisconnect.addListener(() => {
            console.log("[WebAgentProxy] Port disconnected");
            portConnected = false;
            port = null;

            window.postMessage(
                {
                    source: "dispatcher",
                    method: "webAgent/disconnect",
                },
                "*",
            );
        });

        console.log("[WebAgentProxy] Connected to service worker");
        return port;
    } catch (error) {
        console.error("[WebAgentProxy] Failed to connect:", error);
        return null;
    }
}

function handleWebAgentMessage(event: MessageEvent): void {
    if (event.source !== window) return;

    const data = event.data;
    if (!isWebAgentMessage(data)) return;

    const activePort = ensurePort();
    if (!activePort) {
        console.error("[WebAgentProxy] No port available to forward message");
        return;
    }

    activePort.postMessage(data);
}

export function initializeWebAgentProxy(): void {
    console.log("[WebAgentProxy] Initializing...");
    window.addEventListener("message", handleWebAgentMessage);
    console.log("[WebAgentProxy] Initialized");
}
