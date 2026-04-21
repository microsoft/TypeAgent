// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Webview entry point — runs in the browser sandbox inside VS Code.
// Connects to the TypeAgent agent server via WebSocket and provides
// a chat UI for sending requests and displaying responses.

import { ChatUI } from "./chatUI";
import { AgentConnection } from "./agentConnection";

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const chatUI = new ChatUI();
const connection = new AgentConnection(chatUI);

// Request the server URL from the extension host
vscode.postMessage({ type: "getServerUrl" });

// Listen for messages from the extension host
window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
        case "serverUrl":
            connection.connect(message.url);
            break;
    }
});

// Wire up the send button and input
chatUI.onSend((text) => {
    connection.sendRequest(text);
});
