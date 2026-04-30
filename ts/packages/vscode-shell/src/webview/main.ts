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
import completionUiStyles from "@typeagent/completion-ui/styles.css";
import vscodeThemeStyles from "./vscode-theme.css";

// Inject the chat-ui base styles first, then the completion-ui dropdown
// styles, then the VS Code theme overlay so it can override defaults via
// --vscode-* CSS variables.
function injectStyles(css: string): void {
    const styleEl = document.createElement("style");
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
}
injectStyles(chatPanelStyles as unknown as string);
injectStyles(completionUiStyles as unknown as string);
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

// Mount inline + dropdown command-completion driven by the host
// (CompletionController in AgentServerBridge). The chat-ui posts
// pcUpdate / pcAccept / pcDismiss / pcHide / pcDispose; the host
// answers with `pcState` (handled in the message switch below).
chatPanel.attachCompletion((msg) => vscode.postMessage(msg));

// Map dispatcher's CommandResult to chat-ui's completeRequest result shape.
// dispatcher: { metrics: { actions: PhaseTiming[], command, parse, duration },
//               tokenUsage, ... }
// chat-ui:    { actionPhase?, totalDuration?, tokenUsage?, parsePhase? }
// We pick the last action's phase (or the command phase) as actionPhase, the
// overall duration as totalDuration, the parse phase as parsePhase (drives
// the "Translation" tooltip on the user bubble), and pass tokenUsage through.
function mapResult(result: any): {
    actionPhase?: any;
    totalDuration?: number;
    tokenUsage?: any;
    parsePhase?: any;
} | undefined {
    if (!result) return undefined;
    const metrics = result.metrics;
    const actions: any[] | undefined = metrics?.actions;
    const lastAction =
        actions && actions.length > 0 ? actions[actions.length - 1] : undefined;
    return {
        actionPhase: lastAction ?? metrics?.command,
        totalDuration: metrics?.duration,
        tokenUsage: result.tokenUsage,
        parsePhase: metrics?.parse,
    };
}

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
    // First pass: derive "First Message" timing per requestId — the elapsed
    // ms from the user's request to the first agent display message. The
    // dispatcher does not persist this directly; we reconstruct it from the
    // recorded user-request and set/append-display timestamps.
    const userRequestTs = new Map<string, number>();
    const firstAgentTs = new Map<string, number>();
    for (const e of entries) {
        const rid: string | undefined =
            e.requestId ?? clientIdOf(e.message?.requestId);
        if (!rid || typeof e.timestamp !== "number") continue;
        if (e.type === "user-request") {
            if (!userRequestTs.has(rid)) userRequestTs.set(rid, e.timestamp);
        } else if (e.type === "set-display" || e.type === "append-display") {
            // Skip ephemeral status lines — they don't represent the first
            // real agent response.
            if (e.type === "append-display" && e.mode === "temporary") continue;
            if (!firstAgentTs.has(rid)) firstAgentTs.set(rid, e.timestamp);
        }
    }
    const firstMessageMsByRequestId = new Map<string, number>();
    for (const [rid, start] of userRequestTs) {
        const first = firstAgentTs.get(rid);
        if (first !== undefined && first >= start) {
            firstMessageMsByRequestId.set(rid, first - start);
        }
    }

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
            case "set-display-info":
                // Restores the action JSON popup + action-derived bubble
                // title on replayed history items.
                out.push({
                    kind: "display-info",
                    source: e.source ?? "",
                    action: e.action,
                    requestId: e.requestId ?? clientIdOf(e.message?.requestId),
                });
                break;
            case "command-result": {
                // Restores the metrics tooltip on replayed agent bubbles.
                const m = e.metrics;
                const actions: any[] | undefined = m?.actions;
                const lastAction =
                    actions && actions.length > 0
                        ? actions[actions.length - 1]
                        : undefined;
                out.push({
                    kind: "command-result",
                    requestId: e.requestId,
                    actionPhase: lastAction ?? m?.command,
                    totalDuration: m?.duration,
                    tokenUsage: e.tokenUsage,
                    parsePhase: m?.parse,
                    firstMessageMs: e.requestId
                        ? firstMessageMsByRequestId.get(e.requestId)
                        : undefined,
                });
                break;
            }
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
            chatPanel.setUserInfo(msg.name);
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
            // chat-ui signature: (source, sourceIcon?, action?, requestId?)
            chatPanel.setDisplayInfo(
                msg.source,
                undefined,
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
                chatPanel.completeRequest(rid, mapResult(msg.data?.result));
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
            if (rid) chatPanel.completeRequest(rid, mapResult(msg.result));
            break;
        }
        case "peerMetrics": {
            // Forwarded from a peer tab on the same session — apply the
            // timing tooltip to our local bubble for that requestId.
            const rid = msg.requestId;
            if (rid) chatPanel.completeRequest(rid, mapResult(msg.result));
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
            chatPanel.applyPcState(msg.state);
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
