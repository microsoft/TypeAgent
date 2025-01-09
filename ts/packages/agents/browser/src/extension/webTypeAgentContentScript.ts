// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Proxy message between the page content and the extension.

const port = chrome.runtime?.connect({ name: "typeagent" });
// page => extension
window.addEventListener("message", (event) => {
    if (event.source !== window) {
        return;
    }

    const data = event.data;
    if (data.target === "dispatcher" && data.source === "webAgent") {
        port.postMessage(data);
    }
});

// extension => page
port.onMessage.addListener((data) => {
    if (
        data.target === "webAgent" &&
        data.source === "dispatcher" &&
        data.messageType == "message"
    ) {
        window.postMessage(data);
    }
});

port.onDisconnect.addListener(() => {
    window.postMessage({
        source: "dispatcher",
        target: "webAgent",
        messageType: "disconnect",
    });
});
