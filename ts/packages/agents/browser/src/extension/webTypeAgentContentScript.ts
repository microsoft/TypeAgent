// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    isWebAgentMessage,
    isWebAgentMessageFromDispatcher,
    WebAgentDisconnectMessageFromDispatcher,
} from "../common/webAgentMessageTypes.mjs";

// Proxy message between the page content and the extension.
let port: chrome.runtime.Port | undefined;
function sendDisconnect() {
    const message: WebAgentDisconnectMessageFromDispatcher = {
        source: "dispatcher",
        method: "webAgent/disconnect",
    };

    window.postMessage(message);
    port?.disconnect();
    port = undefined;
}

function ensurePort() {
    if (port !== undefined) {
        return port;
    }
    port = chrome.runtime?.connect({ name: "typeagent" });
    // extension => page
    port.onMessage.addListener((data) => {
        if (isWebAgentMessageFromDispatcher(data)) {
            window.postMessage(data);
        }
    });

    port.onDisconnect.addListener(sendDisconnect);
    return port;
}

// page => extension
window.addEventListener("message", (event) => {
    if (event.source !== window) {
        return;
    }

    const data = event.data;
    if (isWebAgentMessage(data)) {
        try {
            ensurePort().postMessage(data);
        } catch (e) {
            sendDisconnect();
        }
    }
});
