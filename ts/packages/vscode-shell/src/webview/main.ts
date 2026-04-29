// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Webview entry point — runs in the browser sandbox inside VS Code.
// Communicates with the extension host via postMessage.
// The extension host manages the actual RPC connection to the agent server.
//
// Renders the shared `chat-ui` ChatPanel; the only host-managed UI element
// is the connection status ribbon at the top (#status-bar).

import { ChatPanel, HistoryEntry } from "chat-ui";
import chatPanelStyles from "chat-ui/styles";
import vscodeThemeStyles from "./vscode-theme.css";

// Inject the chat-ui base styles first, then the VS Code theme overlay so
// it can override the defaults via --vscode-* CSS variables.
function injectStyles(css: string): void {
    const styleEl = document.createElement("style");
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
}
injectStyles(chatPanelStyles as unknown as string);
injectStyles(vscodeThemeStyles as unknown as string);

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const statusEl = document.getElementById("status-bar")!;
const rootEl = document.getElementById("chat-root")!;

// Track the higher-level disabled reasons so we can reconcile them when
// any one of them flips. ChatPanel.setEnabled honors switching/history
// loading internally, but we additionally require the websocket to be
// connected before the input is enabled.
let isConnected = false;

const chatPanel = new ChatPanel(rootEl, {
    platformAdapter: {
        // Open links via the extension host — webviews can't call window.open
        // for arbitrary URLs in a useful way.
        handleLinkClick: (href: string, _target: string | null) => {
            vscode.postMessage({ type: "openExternal", href });
        },
    },
    onSend: (text: string, _attachments, requestId: string) => {
        vscode.postMessage({ type: "sendCommand", command: text, requestId });
    },
    onCancel: (requestId: string) => {
        vscode.postMessage({ type: "cancelCommand", requestId });
    },
});

// `onDemoAction` is exposed as a settable public property on ChatPanel
// (not part of ChatPanelOptions), so wire it after construction.
chatPanel.onDemoAction = (action: "continue" | "cancel") => {
    vscode.postMessage({ type: "demoCommand", action });
};

// Helper: pull clientRequestId out of a RequestId object/string. Most fields
// arrive pre-normalized as plain strings from the bridge, but the
// historyReplay payload still carries server `IAgentMessage`s whose nested
// `requestId` can be either shape — so this is retained for that path only.
function clientIdOf(requestId: any): string | undefined {
    if (!requestId) return undefined;
    if (typeof requestId === "string") return requestId;
    return requestId.clientRequestId as string | undefined;
}

// Translate the bridge's history-entry shape (which mirrors the dispatcher's
// internal recorded events) to chat-ui's HistoryEntry union.
function toChatPanelHistory(entries: any[]): HistoryEntry[] {
    const out: HistoryEntry[] = [];
    for (const e of entries) {
        switch (e.type) {
            case "user-request":
                out.push({
                    kind: "user",
                    text: e.command,
                    requestId: e.requestId,
                    timestamp: e.timestamp,
                });
                break;
            case "set-display":
                out.push({
                    kind: "agent-replace",
                    content: e.message?.message,
                    source: e.message?.source,
                    requestId: e.requestId ?? clientIdOf(e.message?.requestId),
                    timestamp: e.timestamp,
                });
                break;
            case "append-display":
                // Skip temporary status messages — they were ephemeral
                // status lines (e.g. "Translating...") that were already
                // replaced by real content during the original interaction.
                if (e.mode === "temporary") break;
                out.push({
                    kind: "agent-append",
                    content: e.message?.message,
                    source: e.message?.source,
                    mode: e.mode,
                    requestId: e.requestId ?? clientIdOf(e.message?.requestId),
                    timestamp: e.timestamp,
                });
                break;
            // set-display-info and command-result aren't part of chat-ui's
            // HistoryEntry union; drop them on replay (the action label /
            // metrics tooltips will only show for live requests).
        }
    }
    return out;
}

function setStatus(
    connected: boolean,
    sessionId?: string,
    sessionName?: string,
): void {
    isConnected = connected;
    if (connected) {
        statusEl.className = "status connected";
        const label = sessionName || sessionId?.substring(0, 8) || "";
        statusEl.textContent = label
            ? `Connected · ${label}`
            : "Connected to TypeAgent";
    } else {
        statusEl.className = "status disconnected";
        statusEl.textContent = "Disconnected";
    }
    chatPanel.setEnabled(connected);
}

window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
        case "status":
            setStatus(msg.connected, msg.sessionId, msg.sessionName);
            if (msg.connected && msg.sessionId) {
                vscode.setState({
                    sessionId: msg.sessionId,
                    sessionName: msg.sessionName,
                });
            }
            break;
        case "userInfo":
            // chat-ui doesn't yet expose a user-name affordance; ignore.
            break;
        case "sessionChanged":
            chatPanel.clear();
            break;
        case "setDisplay":
            chatPanel.replaceAgentMessage(
                msg.message.message,
                msg.message.source,
                undefined,
                msg.requestId,
            );
            break;
        case "appendDisplay":
            chatPanel.addAgentMessage(
                msg.message.message,
                msg.message.source,
                undefined,
                msg.mode,
                msg.requestId,
            );
            break;
        case "setUserRequest": {
            // Echo from server. If we already rendered this locally (this tab
            // is the originator), skip. Otherwise, another tab on the same
            // conversation sent it — render it so both tabs stay in sync.
            const rid = msg.requestId;
            if (rid && !chatPanel.hasUserMessage(rid)) {
                chatPanel.addUserMessage(msg.command, rid);
            }
            break;
        }
        case "setDisplayInfo":
            chatPanel.setDisplayInfo(
                msg.source,
                msg.action,
                msg.requestId,
            );
            break;
        case "clear":
            chatPanel.clear();
            break;
        case "notify": {
            const rid = msg.requestId;
            if (msg.event === "explained" && rid) {
                chatPanel.notifyExplained(rid, msg.data);
            } else if (msg.event === "grammarRule" && rid) {
                chatPanel.updateGrammarResult(rid, msg.data);
            } else if (msg.event === "commandComplete" && rid) {
                chatPanel.completeRequest(rid, msg.data?.result);
            } else {
                chatPanel.addSystemMessage(`[${msg.source}] ${msg.event}`);
            }
            break;
        }
        case "error":
            chatPanel.addSystemMessage(`Error: ${msg.message}`);
            break;
        case "commandResult":
            // Legacy — no-op
            break;
        case "commandComplete": {
            const rid = msg.requestId;
            if (rid) chatPanel.completeRequest(rid, msg.result);
            break;
        }
        case "peerMetrics": {
            // Forwarded from a peer tab on the same session — apply the
            // timing tooltip to our local bubble for that requestId.
            const rid = msg.requestId;
            if (rid) chatPanel.completeRequest(rid, msg.result);
            break;
        }
        case "switching":
            chatPanel.setSwitching(msg.switching, msg.targetName);
            // Re-apply connection-derived enable state when the switch ends.
            if (!msg.switching) chatPanel.setEnabled(isConnected);
            break;
        case "historyReplay":
            chatPanel.replayHistory(toChatPanelHistory(msg.entries));
            break;
        case "setActive":
            document.body.classList.toggle("chat-inactive", !msg.active);
            break;
        case "historyLoading":
            chatPanel.setHistoryLoading(msg.loading);
            if (!msg.loading) chatPanel.setEnabled(isConnected);
            break;
        case "pcState":
            // Inline command-completion state from the extension host. Not
            // wired through chat-ui yet (deferred to A9 — lift partialCompletion
            // into chat-ui). For now this is a no-op.
            break;
        case "demoPaused":
            chatPanel.setDemoPaused(msg.paused, msg.message);
            break;
        case "demoTypeAndSend":
            // Animate typing into the chat input then submit, so demo
            // playback in the extension matches the Electron shell's
            // natural-keystroke effect.
            void chatPanel.typeAndSend(msg.command, msg.requestId);
            break;
    }
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
document.addEventListener("focusout", () => {
    // Only report blur if focus left the document entirely
    if (!document.hasFocus()) reportFocus(false);
});
if (document.hasFocus()) reportFocus(true);
