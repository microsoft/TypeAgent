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
// Helper: pull clientRequestId out of a RequestId object/string.
function clientIdOf(requestId: any): string | undefined {
    if (!requestId) return undefined;
    if (typeof requestId === "string") return requestId;
    return requestId.clientRequestId as string | undefined;
}

window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
        case "status":
            chatUI.setStatus(msg.connected, msg.sessionId, msg.sessionName);
            if (msg.connected && msg.sessionId) {
                vscode.setState({
                    sessionId: msg.sessionId,
                    sessionName: msg.sessionName,
                });
            }
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
                clientIdOf(msg.message.requestId),
            );
            break;
        case "appendDisplay":
            chatUI.appendAgentDisplay(
                msg.message.message,
                msg.message.source,
                msg.mode,
                msg.timestamp,
                clientIdOf(msg.message.requestId),
            );
            break;
        case "setUserRequest":
            // Live: user message shown immediately on send — skip echo.
            // History now comes through historyReplay batch, not here.
            break;
        case "setDisplayInfo":
            chatUI.setDisplayInfo(
                msg.source,
                msg.action,
                clientIdOf(msg.requestId),
            );
            break;
        case "clear":
            chatUI.clearMessages();
            break;
        case "notify":
            // Let the chat UI consume status notifications (explained,
            // grammarRule). Anything it doesn't handle becomes a visible
            // system message.
            if (!chatUI.onNotify(msg.event, msg.data, msg.source, msg.requestId)) {
                chatUI.addNotification(msg.event, msg.data, msg.source);
            }
            break;
        case "error":
            chatUI.addErrorMessage(msg.message);
            break;
        case "commandResult":
            // Legacy — no-op
            break;
        case "commandComplete":
            // Command finished — clean up any remaining temporary status
            chatUI.onCommandComplete(msg.requestId, msg.result);
            break;
        case "switching":
            chatUI.setSwitching(msg.switching, msg.targetName);
            break;
        case "historyReplay":
            chatUI.replayHistory(msg.entries);
            break;
        case "setActive":
            document.body.classList.toggle("chat-inactive", !msg.active);
            break;
    }
});

// Wire up the send button and input
chatUI.onSend((text, requestId) => {
    vscode.postMessage({ type: "sendCommand", command: text, requestId });
});

// Ask the extension host to connect
vscode.postMessage({ type: "connect" });

// Report focus changes so the extension can drive a context key for keybindings.
const reportFocus = (focused: boolean) => {
    vscode.postMessage({ type: "focus", focused });
};
window.addEventListener("focus", () => reportFocus(true));
window.addEventListener("blur", () => reportFocus(false));
document.addEventListener("focusin", () => reportFocus(true));
document.addEventListener("focusout", (e: FocusEvent) => {
    // Only report blur if focus left the document entirely
    if (!document.hasFocus()) reportFocus(false);
});
if (document.hasFocus()) reportFocus(true);
