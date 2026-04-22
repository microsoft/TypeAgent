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
            chatUI.setStatus(msg.connected, msg.sessionId, msg.sessionName);
            break;
        case "userInfo":
            chatUI.setUserInfo(msg.name);
            break;
        case "sessionChanged":
            chatUI.onSessionChanged(msg.sessionName);
            break;
        case "setDisplay":
            chatUI.setAgentDisplay(
                msg.message.message,
                msg.message.source,
                msg.timestamp,
            );
            break;
        case "appendDisplay":
            chatUI.appendAgentDisplay(
                msg.message.message,
                msg.message.source,
                msg.mode,
                msg.timestamp,
            );
            break;
        case "setUserRequest":
            // Live: user message shown immediately on send — skip echo.
            // History now comes through historyReplay batch, not here.
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
            // Legacy — no-op
            break;
        case "commandComplete":
            // Command finished — clean up any remaining temporary status
            chatUI.onCommandComplete();
            break;
        case "switching":
            chatUI.setSwitching(msg.switching, msg.targetName);
            break;
        case "historyReplay":
            chatUI.replayHistory(msg.entries);
            break;
    }
});

// Wire up the send button and input
chatUI.onSend((text) => {
    vscode.postMessage({ type: "sendCommand", command: text });
});

// Ask the extension host to connect
vscode.postMessage({ type: "connect" });
