// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    isWebAgentMessage,
    isWebAgentMessageFromDispatcher,
    WebAgentDisconnectMessageFromDispatcher,
} from "../../dist/common/webAgentMessageTypes.mjs";

// Proxy message between the page content and the extension.

const port = chrome.runtime?.connect({ name: "typeagent" });
// page => extension
window.addEventListener("message", (event) => {
    if (event.source !== window) {
        return;
    }

    const data = event.data;
    if (isWebAgentMessage(data)) {
        port.postMessage(data);
    }
});

// extension => page
port.onMessage.addListener((data) => {
    if (isWebAgentMessageFromDispatcher(data)) {
        window.postMessage(data);
    }
});

port.onDisconnect.addListener(() => {
    const message: WebAgentDisconnectMessageFromDispatcher = {
        source: "dispatcher",
        target: "webAgent",
        messageType: "disconnect",
    };

    window.postMessage(message);
});
