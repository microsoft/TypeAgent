// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Webview entry point — runs in the browser sandbox inside VS Code.
// Communicates with the extension host via postMessage.
// The extension host manages the actual RPC connection to the agent server.

import { ChatUI } from "./chatUI";

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const chatUI = new ChatUI();

// Listen for messages from the extension host (bridged from agent server)
window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
        case "status":
            chatUI.setStatus(msg.connected, msg.sessionId);
            break;
        case "setDisplay":
            chatUI.addAgentMessage(msg.message.message, msg.message.source);
            break;
        case "appendDisplay":
            chatUI.appendAgentMessage(
                msg.message.message,
                msg.message.source,
                msg.mode,
            );
            break;
        case "setUserRequest":
            chatUI.addUserMessage(msg.command);
            break;
        case "setDisplayInfo":
            chatUI.setDisplayInfo(msg.source, msg.action);
            break;
        case "clear":
            chatUI.clearMessages();
            break;
        case "notify":
            chatUI.addNotification(msg.event, msg.data, msg.source);
            break;
        case "error":
            chatUI.addErrorMessage(msg.message);
            break;
        case "commandResult":
            // Command completed — could update UI state
            break;
    }
});

// Wire up the send button and input
chatUI.onSend((text) => {
    vscode.postMessage({ type: "sendCommand", command: text });
});

// Ask the extension host to connect
vscode.postMessage({ type: "connect" });
