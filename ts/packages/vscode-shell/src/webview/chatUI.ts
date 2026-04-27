// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AnsiUp } from "ansi_up";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { TextareaPartialCompletion } from "./partialCompletion";

const ansiText = new AnsiUp();
ansiText.use_classes = true;
const ansiMarkdown = new AnsiUp();
ansiMarkdown.use_classes = true;
ansiMarkdown.escape_html = false;

const md = new MarkdownIt({ html: true, linkify: true, breaks: false });
const defaultLinkOpen =
    md.renderer.rules.link_open ||
    function (tokens, idx, options, _env, self) {
        return self.renderToken(tokens, idx, options);
    };
md.renderer.rules.link_open = (tokens, idx, ...args) => {
    tokens[idx].attrSet("target", "_blank");
    return defaultLinkOpen(tokens, idx, ...args);
};

const purifyConfig = {
    ADD_ATTR: ["target"],
    ALLOWED_URI_REGEXP:
        /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

// Roadrunner icon (translation/cache state indicator), copied from the
// Electron shell's icon.ts so the extension matches its visual language.
// The fill is set via `currentColor` so we can recolor it via CSS class.
const ROADRUNNER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 567.896 567.896" fill="currentColor" aria-hidden="true"><path d="M554.918,215.052c-2.068,0.322-4.12,0.718-6.16,1.175c-2.199,0.49-4.37-0.653-5.847-1.848c-0.861-0.698-1.938-1.191-3.109-1.371c-2.896-0.449-6.16,0.784-8.936,1.424c-3.965,0.914-7.931,1.832-11.896,2.75c-11.354,2.624-22.714,5.247-34.072,7.871c-60.73,13.223-122.47,19.984-183.938,28.462c-16.753,2.31-33.203-0.147-48.74-6.703c-29.499-12.44-59.76-21.208-91.943-23.208c-20.294-1.26-31.583-15.977-39.796-32.093c-0.473-0.931-0.542-2.053-0.343-3.301c0.29-1.84,1.636-4.431,2.632-5.818c0.6-0.832,1.232-1.648,1.901-2.444c0.184-0.22,0.302-0.465,0.363-0.718c0.106-0.437,0.661-1.159,1.534-1.31c0.498-0.085,1.032-0.11,1.599-0.069c0.938,0.069,1.469-0.498,1.604-1.187c0.229-1.196,0.171-2.607,1.338-3.439c0.706-0.502,1.408-1.004,2.113-1.506c0.714-0.51,0.902-1.33,0.702-2.011c-0.359-1.208-0.804-1.869,0.347-2.746c0.697-0.53,1.391-1.057,2.089-1.587c0.485-0.367,0.75-0.873,0.795-1.375c0.078-0.897,0.163-1.546,1.146-1.661c0.596-0.069,1.191-0.13,1.791-0.184c1.877-0.163,2.371-2.766,0.453-3.35c0,0-0.767-0.232-1.718-0.522c-0.946-0.29,0.017-0.571,2.134-0.853c1.269-0.167,2.534-0.4,3.803-0.689c1.742-0.404,1.514-2.778,0-3.292c-1.122-0.379-2.24-0.755-3.362-1.126c-1.861-0.616-3.419-1.689-3.913-2.093c-0.265-0.216-0.624-0.343-1.081-0.322c-0.469,0.024-0.938,0.029-1.403,0.012c-0.775-0.024-3.146-0.648-5.3-1.306c-3.745-1.142-7.507-2.244-11.285-3.296c-0.224-0.061-0.437-0.082-0.628-0.061c-0.347,0.032-2.415-0.196-4.663-0.049c-0.139,0.008-0.278,0.021-0.417,0.033c-2.244,0.212-5.773,1.065-7.997,1.432c-1.783,0.293-3.574,0.718-5.381,1.301c-4.088,1.314-7.944,3.309-11.408,5.834c-1.824,1.326-4.733,3.521-6.561,4.839c-7.009,5.051-13.154,11.571-18.433,19.348c-8.152,12.003-18.185,18.213-32.122,20.494c-10.877,1.783-21.795,4.325-30.045,13.672c-1.489,1.689-0.71,3.02,1.53,2.787c5.051-0.526,10.102-1.077,15.166-1.485c10.212-0.828,20.433-1.595,30.661-2.17c1.856-0.106,4.133,0.322,5.594,1.367c10.151,7.283,19.931,15.096,30.245,22.134c7.752,5.292,11.51,12.464,12.893,21.367c0.355,2.285,1.302,4.488,1.542,6.777c3.289,31.343,22.077,49.548,50.013,61.009c9.314,3.823,17.723,9.849,27.629,15.929c1.922,1.179,2.248,3.439,0.734,5.111c-5.418,5.985-9.559,10.976-14.37,15.198c-12.938,11.363-26.193,22.375-39.56,33.236c-8.131,6.609-17.168,9.049-27.895,6.201c-3.154-0.837-6.536-0.804-9.959-0.62c-2.252,0.122-5.854-0.429-8.099-0.249c-1.668,0.135-3.301,0.686-4.77,1.641c-0.445,0.289-0.461,1.142,0.163,1.248c0.922,0.155,1.844,0.311,2.767,0.461c1.53,0.257,3.533,1.045,4.476,1.759s0.045,2.056-2.003,2.994c-1.269,0.58-2.509,1.146-3.733,1.706c-2.048,0.934-5.561,1.207-7.769,1.648c-2.248,0.444-4.223,1.685-5.577,3.517c-1.342,1.812-1.849,4.235-1.457,4.627c0.241,0.236,0.604,0.298,0.889-0.013c2.171-2.354,5.312-2.477,8.327-2.974c2.224-0.367,5.712-1.354,7.952-1.596c8.107-0.873,16.238-1.648,24.109-3.517c12.419-2.95,23.741-2.75,35.749,2.501c5.181,2.264,11.028,2.999,17.115,3.729c2.236,0.27,5.708,1.27,7.817,2.064c2.754,1.037,5.582,1.865,8.482,2.477c0.657,0.139,1.159-0.632,0.665-1.142c-0.473-0.486-0.942-0.976-1.408-1.469c-0.771-0.816-1.408-1.612-1.493-1.751c-0.049-0.077-0.114-0.146-0.204-0.208c-0.065-0.045-0.135-0.09-0.2-0.131c-0.114-0.069-0.89-0.844-1.775-1.705c-0.535-0.522-1.082-1.028-1.645-1.514c-0.608-0.526-1.261-0.906-1.942-1.126c-1.183-0.388-3.19-1.742-4.721-3.398c-6.091-6.61-14.521-7.769-23.766-7.186c-2.249,0.144-4.251-0.277-4.488-1.057c-0.232-0.779,1.053-2.488,2.873-3.818c11.204-8.201,22.378-16.438,33.644-24.554c10.955-7.891,22.04-15.602,33.036-23.436c1.053-0.751,1.722-2.126,2.832-2.701c9.519-4.908,40.384,1.783,47.189,10.188c5.426,6.703,10.465,13.745,16.247,20.118c5.483,6.042,12.036,11.118,17.511,17.169c5.055,5.581,9.637,11.673,13.823,17.939c4.818,7.218,4.794,7.128,14.113,6.638c1.656-0.085,3.35,0.498,5.055,1.253c2.057,0.918,5.243,2.791,7.43,3.329c2.456,0.604,5.022,0.29,7.602-1.619c0.293-0.221,0.343-0.556,0.248-0.833c-0.167-0.489-0.767-0.497-0.849-0.53c-0.045-0.017-0.094-0.028-0.146-0.037c-1.322-0.191-2.644-0.379-3.97-0.566c-2.191-0.314-5.279-1.84-6.896-3.411c-9.266-8.992-18.548-18.005-27.993-27.173c-1.615-1.57-1.844-4.312-0.493-6.116c2.795-3.729,5.847-7.764,8.698-11.938c1.612-2.358,3.15-4.762,4.651-7.148c1.195-1.909,3.814-4.288,6.026-4.721c2.321-0.453,4.716-0.408,7.128,0.155c0.22,0.053,0.407,0.004,0.547-0.102c0.253-0.192,0.583-0.571,0.693-0.869c0.061-0.159,0.045-0.347-0.103-0.539c-0.334-0.433-0.701-0.824-1.093-1.175c-0.665-0.592-1.363-1.105-1.53-1.204c-0.167-0.098-1.734-0.836-3.615-0.971s-5.182,0.118-7.434,0.151c-12.815,0.175-17.055,10.954-21.302,21.31c-0.856,2.085-3.296,3.125-5.279,2.057c-7.728-4.17-13.876-11.963-30.375-37.043c-1.236-1.881-0.784-4.508,0.987-5.903c9.2-7.279,18.001-15.365,28.242-20.686c10.151-5.275,21.771-7.736,33.432-11.18c2.162-0.636,2.656-2.529,1.122-4.178c-0.416-0.448-0.841-0.905-1.265-1.358c-1.534-1.648-1.682-4.451-0.131-6.088c13.333-14.117,31.946-12.75,49.389-14.268c18.474-1.611,35.794-6.65,53.378-12.378c7.577-2.468,15.337-4.374,23.167-6.059c20.607-3.562,41.216-7.124,61.824-10.686c2.219-0.383,5.817-1.008,8.041-1.391c12.049-2.081,24.097-4.166,36.149-6.247c3.357-0.579,9.139-2.428,8.755-6.985c-0.073-0.857-0.313-1.648-0.685-2.333c-0.649-1.188-1.678-1.865-1.73-1.955s0.828-0.437,1.971-0.824c0.689-0.232,1.371-0.477,2.053-0.738c3.464-1.155,6.874-2.46,10.24-3.868c1.922-0.804,5.528-1.121,6.088-4.382C569.3,211.686,558.357,214.513,554.918,215.052z"/></svg>`;

/**
 * Manages the chat UI elements in the webview.
 * Groups messages by requestId to match the shell's behavior.
 */
export class ChatUI {
    private _messagesEl: HTMLElement;
    private _inputEl: HTMLTextAreaElement;
    private _sendBtn: HTMLButtonElement;
    private _statusEl: HTMLElement;
    private _sendCallback?: (text: string, requestId: string) => void;

    // Track the active response bubble for setDisplay/appendDisplay
    private _activeResponseEl?: HTMLElement;
    // Track the status indicator element
    private _statusIndicatorEl?: HTMLElement;
    // Dedup: track last appended content to avoid duplicates
    private _lastAppendedContent?: string;

    // Timestamp of last commandComplete; used to drop late-arriving
    // "temporary" status messages (e.g. when WebSocket RPC arrives after
    // commandComplete went through faster postMessage).
    private _lastCompletedAt?: number;

    // Track switching state to keep input disabled
    private _isSwitching = false;

    // Display name + initial for the local user (set via setUserInfo)
    private _userName = "you";
    private _userInitial = "T";

    // Map from requestId → user bubble element awaiting commandComplete
    private _pendingUserBubbles = new Map<string, HTMLElement>();

    // Map from clientRequestId → the agent bubble for that request, so
    // setDisplayInfo and commandComplete metrics can find their target.
    private _agentBubblesByRequestId = new Map<string, HTMLElement>();

    // Counter for generating unique request IDs
    private _nextRequestId = 1;

    // Optional inline + dropdown completion handler installed by main.ts.
    private _partial?: TextareaPartialCompletion;

    constructor() {
        this._messagesEl = document.getElementById("messages")!;
        this._inputEl = document.getElementById(
            "chat-input",
        ) as HTMLTextAreaElement;
        this._sendBtn = document.getElementById(
            "send-btn",
        ) as HTMLButtonElement;
        this._statusEl = document.getElementById("status-bar")!;

        this._sendBtn.addEventListener("click", () => this._handleSend());
        this._inputEl.addEventListener("keydown", (e) => {
            // Let completion handle Tab/Esc/arrow keys/Enter when active.
            if (this._partial?.handleKeyDownPreSend(e)) return;
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this._handleSend();
            }
        });

        // Auto-resize textarea
        this._inputEl.addEventListener("input", () => {
            this._inputEl.style.height = "auto";
            this._inputEl.style.height =
                Math.min(this._inputEl.scrollHeight, 120) + "px";
        });
    }

    /**
     * Mount inline + dropdown completion on the chat input.  Caller passes
     * a postMessage function that delivers messages to the extension host.
     */
    public attachCompletion(
        post: (msg: any) => void,
    ): TextareaPartialCompletion {
        if (this._partial) return this._partial;
        const inputArea =
            this._inputEl.parentElement ?? document.body;
        this._partial = new TextareaPartialCompletion(
            inputArea,
            this._inputEl,
            post,
        );
        return this._partial;
    }

    public onSend(callback: (text: string, requestId: string) => void): void {
        this._sendCallback = callback;
    }

    /**
     * Set the local user's display name and avatar initial.  Called once
     * from the host with the OS username; safe to call again to update.
     */
    public setUserInfo(name: string): void {
        if (!name) return;
        this._userName = name;
        this._userInitial = name.trim().charAt(0).toUpperCase() || "?";
    }

    public addUserMessage(
        text: string,
        timestamp?: number,
        status: "pending" | "done" = "done",
        requestId?: string,
    ): void {
        this._removeStatusIndicator();
        this._removeTemporary();
        this._activeResponseEl = undefined;
        this._lastAppendedContent = undefined;
        // New user request — clear the late-temp guard so legitimate
        // status messages for this command can render.
        this._lastCompletedAt = undefined;

        const row = document.createElement("div");
        row.className = "message user";
        if (requestId) {
            row.dataset.requestId = requestId;
        }

        const body = document.createElement("div");
        body.className = "message-body";

        const header = this._createHeader(this._userName, timestamp);
        body.appendChild(header);

        const bubble = document.createElement("div");
        bubble.className = "bubble";
        const textEl = document.createElement("span");
        textEl.className = "message-content";
        textEl.textContent = text;
        bubble.appendChild(textEl);

        // Roadrunner: hidden until an "explained" notify arrives (which
        // only fires for action translations — pure chat responses never
        // emit it, so the icon stays hidden for those). Mirrors the
        // Electron shell's translation/cache indicator.
        const icon = document.createElement("span");
        icon.className = "status-icon roadrunner hidden";
        icon.innerHTML = ROADRUNNER_SVG;
        bubble.appendChild(icon);

        body.appendChild(bubble);

        row.appendChild(body);
        row.appendChild(this._createAvatar("user"));

        this._messagesEl.appendChild(row);
        if (status === "pending" && requestId) {
            this._pendingUserBubbles.set(requestId, row);
        }
        this._scrollToBottom();
    }

    /**
     * Returns true if a user message with this requestId is already in the DOM.
     * Used to detect the local-echo case so a server setUserRequest broadcast
     * isn't duplicated on the originating tab. A second tab joined to the same
     * conversation will return false here and render the user message.
     */
    public hasUserMessage(requestId: string): boolean {
        if (!requestId) return false;
        return !!this._messagesEl.querySelector(
            `.message.user[data-request-id="${CSS.escape(requestId)}"]`,
        );
    }

    /**
     * setDisplay: replace the content of the active agent bubble.
     */
    public setAgentDisplay(
        content: any,
        source?: string,
        timestamp?: number,
        requestId?: string,
    ): void {
        this._removeStatusIndicator();
        this._removeTemporary();
        const bubble = this._getOrCreateAgentBubble(source, timestamp, requestId);
        if (source) {
            const sourceEl = bubble.querySelector(".source-label");
            if (sourceEl && !sourceEl.classList.contains("has-action")) {
                sourceEl.textContent = source;
            }
        }
        const contentEl = bubble.querySelector(".agent-content");
        if (contentEl) {
            const html = this._renderDisplayContent(content);
            contentEl.innerHTML = html;
            // Track what's now in the bubble so a follow-up appendDisplay with
            // the same content (e.g., a chat agent emitting setDisplay after
            // streaming the same text) doesn't double up.
            this._lastAppendedContent = html;
            if (html && html.trim().length > 0) {
                bubble.classList.remove("empty");
            }
        }
        this._scrollToBottom();
    }

    /**
     * appendDisplay: append to the active agent bubble.
     * mode "temporary" = replaceable status text (e.g. "Translating...")
     * mode "inline" / "block" = permanent content
     */
    public appendAgentDisplay(
        content: any,
        source?: string,
        mode?: string,
        timestamp?: number,
        requestId?: string,
    ): void {
        this._removeStatusIndicator();

        if (mode === "temporary") {
            // Drop status messages after the command already completed —
            // they're stale (race-arrived after commandComplete) and would
            // otherwise be orphaned with nothing to clear them. Reset on
            // the next user message via addUserMessage.
            if (this._lastCompletedAt !== undefined) {
                return;
            }
            // Show as a replaceable status line — each new temporary replaces the last
            this._removeTemporary();
            const el = document.createElement("div");
            el.className = "message system temporary";
            const text = this._renderDisplayContent(content);
            el.innerHTML = text;
            this._messagesEl.appendChild(el);
            this._scrollToBottom();
            return;
        }

        // Permanent content — keep temporary status visible (shows agent progress)
        const rendered = this._renderDisplayContent(content);

        // Dedup: skip if this exact content was just appended
        if (rendered === this._lastAppendedContent && rendered.length > 0) {
            return;
        }
        this._lastAppendedContent = rendered;

        // Remove temporary when first real content arrives (either no bubble
        // yet, or an empty bubble that was pre-created by setDisplayInfo).
        const existingBubble =
            requestId && this._agentBubblesByRequestId.has(requestId)
                ? this._agentBubblesByRequestId.get(requestId)!
                : this._activeResponseEl;
        const existingContent =
            existingBubble?.querySelector(".agent-content")?.innerHTML ?? "";
        if (existingContent.trim() === "") {
            this._removeTemporary();
        }
        const bubble = this._getOrCreateAgentBubble(source, timestamp, requestId);
        const contentEl = bubble.querySelector(".agent-content");
        if (contentEl) {
            // Defensive dedup: if the bubble's current content already ends
            // with this rendered chunk, skip. Catches cases where setDisplay
            // and a follow-up appendDisplay carry the same payload.
            const existing = contentEl.innerHTML;
            if (
                rendered.length > 0 &&
                existing.length >= rendered.length &&
                existing.endsWith(rendered)
            ) {
                return;
            }
            contentEl.innerHTML += rendered;
            if (rendered && rendered.trim().length > 0) {
                bubble.classList.remove("empty");
            }
        }
        this._scrollToBottom();
    }

    private _getOrCreateAgentBubble(
        source?: string,
        timestamp?: number,
        requestId?: string,
    ): HTMLElement {
        if (requestId && this._agentBubblesByRequestId.has(requestId)) {
            return this._agentBubblesByRequestId.get(requestId)!;
        }
        if (!requestId && this._activeResponseEl) {
            return this._activeResponseEl;
        }
        const bubble = this._createAgentBubble(source, timestamp, requestId);
        this._activeResponseEl = bubble;
        if (requestId) {
            this._agentBubblesByRequestId.set(requestId, bubble);
        }
        return bubble;
    }

    /**
     * setDisplayInfo: update the agent bubble for this request to show
     * the action that's being executed. The header label becomes a
     * clickable "schemaName.actionName" — clicking it expands a JSON
     * panel with the action payload.
     */
    public setDisplayInfo(
        source: string,
        action?: any,
        requestId?: string,
    ): void {
        if (!source && !action) return;

        const bubble = this._getOrCreateAgentBubble(source, undefined, requestId);
        const label = bubble.querySelector(".source-label") as HTMLElement | null;
        if (!label) return;

        let actionLabel: string | undefined;
        if (Array.isArray(action)) {
            actionLabel = `${source} ${action.join(" ")}`;
        } else if (action && typeof action === "object" && action.actionName) {
            actionLabel = action.schemaName
                ? `${action.schemaName}.${action.actionName}`
                : action.actionName;
        }

        if (actionLabel) {
            label.textContent = actionLabel;
            label.classList.add("has-action", "clickable");
            label.title = "Click to view action JSON";

            // Toggle a JSON panel below the bubble's content
            const handler = () => {
                const body = bubble.querySelector(".message-body");
                if (!body) return;
                let pre = body.querySelector(".action-json") as HTMLElement | null;
                if (pre) {
                    pre.remove();
                } else {
                    pre = document.createElement("pre");
                    pre.className = "action-json";
                    pre.innerHTML = ChatUI._highlightJson(
                        JSON.stringify(action, null, 2),
                    );
                    body.appendChild(pre);
                }
                this._scrollToBottom();
            };
            // Replace any prior listener by cloning is overkill — store
            // the handler on the element so we can detach if needed
            label.onclick = handler;
        } else if (source) {
            label.textContent = source;
        }
        this._scrollToBottom();
    }

    public clearMessages(): void {
        this._messagesEl.innerHTML = "";
        this._activeResponseEl = undefined;
        this._statusIndicatorEl = undefined;
        this._pendingUserBubbles.clear();
        this._agentBubblesByRequestId.clear();
    }

    /**
     * Called when a command finishes processing.
     * Cleans up temporary status messages and applies timing metrics
     * (visible as a hover tooltip on the bubbles for this request).
     */
    public onCommandComplete(requestId?: string, result?: any): void {
        this._removeTemporary();
        this._removeStatusIndicator();
        this._activeResponseEl = undefined;
        this._lastAppendedContent = undefined;
        this._lastCompletedAt = Date.now();

        if (requestId) {
            const agentBubble = this._agentBubblesByRequestId.get(requestId);
            if (agentBubble) {
                this._renderMetrics(agentBubble, result?.metrics, "agent");
            }
            const userBubble = this._pendingUserBubbles.get(requestId);
            if (userBubble) {
                this._renderMetrics(userBubble, result?.metrics, "user");
            }
            this._pendingUserBubbles.delete(requestId);
            this._agentBubblesByRequestId.delete(requestId);
        }
    }

    /**
     * Apply timing metrics for a request that originated in a peer tab.
     * Renders metrics like onCommandComplete, and also clears any
     * lingering temporary status + engages the late-temp guard, since
     * the originator has finished and any further temporary status for
     * this request would be stale.
     */
    public applyPeerMetrics(requestId: string, result: any): void {
        if (!requestId) return;
        this._removeTemporary();
        this._lastCompletedAt = Date.now();
        const agentBubble = this._agentBubblesByRequestId.get(requestId);
        if (agentBubble) {
            this._renderMetrics(agentBubble, result?.metrics, "agent");
        }
        const userRow = this._messagesEl.querySelector(
            `.message.user[data-request-id="${CSS.escape(requestId)}"]`,
        ) as HTMLElement | null;
        if (userRow) {
            this._renderMetrics(userRow, result?.metrics, "user");
        }
    }

    private _renderMetrics(
        bubbleRow: HTMLElement,
        metrics: any,
        kind: "user" | "agent",
    ): void {
        if (!metrics || typeof metrics !== "object") return;

        const bubble = bubbleRow.querySelector(".bubble") as HTMLElement | null;
        if (!bubble) return;

        // Remove any prior metrics row (idempotent)
        bubble.querySelector(".bubble-metrics")?.remove();

        const fmt = (ms?: number) => {
            if (typeof ms !== "number") return undefined;
            if (ms < 1) return `${ms.toFixed(3)}ms`;
            if (ms > 1000) return `${(ms / 1000).toFixed(1)}s`;
            return `${ms.toFixed(1)}ms`;
        };
        const item = (label: string, value?: string) =>
            value ? `${label}: <b>${value}</b>` : "";

        const left: string[] = [];
        const right: string[] = [];

        if (kind === "user") {
            // Mirror the shell's user-bubble metrics: Translation phase.
            if (metrics.parse?.duration != null) {
                left.push(item("Translation", fmt(metrics.parse.duration))!);
            }
        } else {
            // Agent bubble: Action time (sum of per-action durations or
            // command phase) + Total elapsed time.
            let actionTotal: number | undefined;
            if (
                Array.isArray(metrics.actions) &&
                metrics.actions.length > 0
            ) {
                actionTotal = metrics.actions.reduce(
                    (acc: number, a: any) =>
                        acc +
                        (typeof a?.duration === "number" ? a.duration : 0),
                    0,
                );
            } else if (metrics.command?.duration != null) {
                actionTotal = metrics.command.duration;
            }
            if (actionTotal != null && actionTotal > 0) {
                left.push(item("Action Elapsed Time", fmt(actionTotal))!);
            }
            if (metrics.duration != null) {
                right.push(item("Total Elapsed Time", fmt(metrics.duration))!);
            }
        }

        if (left.length === 0 && right.length === 0) return;

        const row = document.createElement("div");
        row.className = "bubble-metrics";
        const leftEl = document.createElement("div");
        leftEl.className = "metrics-left";
        leftEl.innerHTML = left.filter(Boolean).join("<br>");
        const rightEl = document.createElement("div");
        rightEl.className = "metrics-right";
        rightEl.innerHTML = right.filter(Boolean).join("<br>");
        row.append(leftEl, rightEl);
        bubble.appendChild(row);
        this._scrollToBottom();
    }

    /**
     * Handle a clientIO notify event. Returns true if the event was
     * consumed (and so should NOT be shown as a system message).
     */
    public onNotify(
        event: string,
        data: any,
        _source: string,
        requestId?: string,
    ): boolean {
        if (event === "explained") {
            this._applyExplained(requestId, data);
            return true;
        }
        if (event === "grammarRule") {
            this._applyGrammarRule(requestId, data);
            return true;
        }
        if (event === "commandComplete") {
            // Server-broadcast completion: lets peer tabs (which didn't
            // await processCommand locally) clear lingering temporary
            // status messages and render timing metrics.
            this.onCommandComplete(requestId, data?.result);
            return true;
        }
        return false;
    }

    private _findUserBubble(requestId?: string): HTMLElement | undefined {
        if (!requestId) return undefined;
        if (this._pendingUserBubbles.has(requestId)) {
            return this._pendingUserBubbles.get(requestId);
        }
        const sel = `.message.user[data-request-id="${CSS.escape(requestId)}"]`;
        return (this._messagesEl.querySelector(sel) as HTMLElement) ?? undefined;
    }

    private _applyExplained(requestId: string | undefined, data: any): void {
        const bubble = this._findUserBubble(requestId);
        if (!bubble) return;
        const icon = bubble.querySelector(".roadrunner") as HTMLElement | null;
        if (!icon) return;

        const fromCache: string | undefined = data?.fromCache;
        const time: string | undefined = data?.time;
        const error: string | undefined = data?.error;

        const cachePart = fromCache
            ? `Translated by ${fromCache}`
            : "Translated by model";
        let tooltip: string;
        let colorVar: string;
        if (error === undefined) {
            tooltip = `${cachePart}. Explained at ${time ?? "now"}`;
            // green = cache hit, gold = model translation
            colorVar = fromCache ? "#00c000" : "#c0c000";
        } else {
            tooltip = `${cachePart}. Nothing to put in cache: ${error}`;
            colorVar = "lightblue";
        }

        icon.classList.remove("hidden");
        icon.style.color = colorVar;
        icon.title = tooltip;
    }

    private _applyGrammarRule(requestId: string | undefined, data: any): void {
        const bubble = this._findUserBubble(requestId);
        if (!bubble) return;
        const icon = bubble.querySelector(".roadrunner") as HTMLElement | null;
        if (!icon) return;
        if (data?.success === false) {
            icon.style.color = "cornflowerblue";
            const existing = icon.title || "";
            const reason = data?.message ? ` (${data.message})` : "";
            icon.title = `${existing}. No fast-path cached${reason}`;
        }
    }

    public addNotification(event: string, _data: any, source: string): void {
        const el = document.createElement("div");
        el.className = "message system";
        el.textContent = `[${source}] ${event}`;
        this._messagesEl.appendChild(el);
        this._scrollToBottom();
    }

    public addErrorMessage(text: string): void {
        const el = document.createElement("div");
        el.className = "message error";
        el.textContent = `Error: ${text}`;
        this._messagesEl.appendChild(el);
        this._scrollToBottom();
    }

    public setStatus(
        connected: boolean,
        sessionId?: string,
        sessionName?: string,
    ): void {
        if (connected) {
            this._statusEl.className = "status connected";
            const label = sessionName || sessionId?.substring(0, 8) || "";
            this._statusEl.textContent = label
                ? `Connected · ${label}`
                : "Connected to TypeAgent";
            // Don't re-enable input if a switch is in progress
            if (!this._isSwitching) {
                this._inputEl.disabled = false;
                this._sendBtn.disabled = false;
            }
        } else {
            this._statusEl.className = "status disconnected";
            this._statusEl.textContent = "Disconnected";
            this._inputEl.disabled = true;
            this._sendBtn.disabled = true;
        }
    }

    /**
     * Disable input and show a status message while a conversation switch
     * is in progress.
     */
    public setSwitching(switching: boolean, targetName?: string): void {
        this._isSwitching = switching;
        if (switching) {
            this._inputEl.disabled = true;
            this._sendBtn.disabled = true;
            const label = targetName
                ? `Switching to conversation "${targetName}"…`
                : "Switching conversation…";
            this._statusEl.className = "status switching";
            this._statusEl.textContent = label;
            this._inputEl.placeholder = label;
        } else {
            this._inputEl.disabled = false;
            this._sendBtn.disabled = false;
            this._inputEl.placeholder = "";
            // Status will be refreshed by the next "status" message
        }
    }

    /**
     * Disable input and show a "loading history" placeholder until the
     * extension host finishes replaying past messages on (re)connect.
     */
    public setHistoryLoading(loading: boolean): void {
        if (loading) {
            this._inputEl.disabled = true;
            this._sendBtn.disabled = true;
            this._inputEl.placeholder = "Loading history…";
        } else if (!this._isSwitching) {
            this._inputEl.disabled = false;
            this._sendBtn.disabled = false;
            this._inputEl.placeholder = "";
        }
    }

    /**
     * Called when the user switches to a different conversation.
     * Just clears the UI — history will be replayed via beginHistory/endHistory.
     */
    public onSessionChanged(_sessionName: string): void {
        this.clearMessages();
    }

    /**
     * Replay the given display history entries atomically.  Processing is
     * done synchronously so no live message can be interleaved mid-replay,
     * and all replayed bubbles are marked with the `.history` class for
     * muted styling.
     */
    public replayHistory(entries: Array<any>): void {
        if (!entries || entries.length === 0) {
            return;
        }
        // Track where history begins so we can mark only those bubbles
        const firstHistoryIdx = this._messagesEl.children.length;

        this._activeResponseEl = undefined;
        this._lastAppendedContent = undefined;

        const clientId = (rid: any): string | undefined => {
            if (!rid) return undefined;
            if (typeof rid === "string") return rid;
            return rid.clientRequestId as string | undefined;
        };

        for (const e of entries) {
            switch (e.type) {
                case "user-request": {
                    const rid = clientId(e.requestId);
                    this.addUserMessage(e.command, e.timestamp, "pending", rid);
                    // Reset active agent bubble between turns so a new one
                    // is created for each user request during replay.
                    this._activeResponseEl = undefined;
                    this._lastAppendedContent = undefined;
                    break;
                }
                case "set-display":
                    this.setAgentDisplay(
                        e.message?.message,
                        e.message?.source,
                        e.timestamp,
                        clientId(e.message?.requestId),
                    );
                    break;
                case "append-display":
                    // Skip temporary status messages (e.g. "Translating...",
                    // "Executing action ..."). They're meant to be ephemeral
                    // and were already replaced by real content during the
                    // original interaction. Replaying them leaves orphan
                    // status lines in the transcript.
                    if (e.mode === "temporary") {
                        break;
                    }
                    this.appendAgentDisplay(
                        e.message?.message,
                        e.message?.source,
                        e.mode,
                        e.timestamp,
                        clientId(e.message?.requestId),
                    );
                    break;
                case "set-display-info":
                    // Apply during replay so historical action labels are
                    // also clickable + reveal their JSON.
                    this.setDisplayInfo(
                        e.source,
                        e.action,
                        clientId(e.requestId),
                    );
                    break;
                case "command-result": {
                    // Render timing footer for this historical request on
                    // both its agent bubble and user bubble (if known).
                    const rid = clientId(e.requestId);
                    if (rid) {
                        const agent =
                            this._agentBubblesByRequestId.get(rid);
                        if (agent)
                            this._renderMetrics(agent, e.metrics, "agent");
                        const user = this._pendingUserBubbles.get(rid);
                        if (user)
                            this._renderMetrics(user, e.metrics, "user");
                    }
                    break;
                }
            }
        }

        // Mark everything we just appended as history
        for (let i = firstHistoryIdx; i < this._messagesEl.children.length; i++) {
            this._messagesEl.children[i].classList.add("history");
        }

        // Reset state so the next live message starts a fresh bubble
        this._activeResponseEl = undefined;
        this._lastAppendedContent = undefined;
        // Drop tracking maps — history entries shouldn't intercept future
        // live commandComplete events.
        this._pendingUserBubbles.clear();
        this._agentBubblesByRequestId.clear();
        this._removeTemporary();
        this._removeStatusIndicator();
        this._scrollToBottom();
    }

    public addSystemMessage(text: string): void {
        const el = document.createElement("div");
        el.className = "message system";
        el.textContent = text;
        this._messagesEl.appendChild(el);
        this._scrollToBottom();
    }

    private _handleSend(): void {
        const text = this._inputEl.value.trim();
        if (!text) return;
        const requestId = `webview-${this._nextRequestId++}-${Date.now()}`;
        // Show user message immediately (don't wait for server echo)
        this.addUserMessage(text, undefined, "pending", requestId);
        this._inputEl.value = "";
        this._inputEl.style.height = "auto";
        this._partial?.reset();
        this._sendCallback?.(text, requestId);
    }

    private _createAgentBubble(
        source?: string,
        timestamp?: number,
        requestId?: string,
    ): HTMLElement {
        const row = document.createElement("div");
        row.className = "message agent empty";
        if (requestId) row.dataset.requestId = requestId;

        row.appendChild(this._createAvatar("agent", source));

        const body = document.createElement("div");
        body.className = "message-body";

        const header = this._createHeader(source ?? "", timestamp);
        body.appendChild(header);

        const bubble = document.createElement("div");
        bubble.className = "bubble";
        const contentEl = document.createElement("span");
        contentEl.className = "agent-content";
        bubble.appendChild(contentEl);
        body.appendChild(bubble);

        row.appendChild(body);
        this._messagesEl.appendChild(row);
        return row;
    }

    private _createHeader(
        label: string,
        timestamp?: number,
    ): HTMLElement {
        const header = document.createElement("div");
        header.className = "message-header";
        const labelEl = document.createElement("span");
        labelEl.className = "source-label";
        if (label) labelEl.textContent = label;
        header.appendChild(labelEl);
        const tsEl = this._createTimestampEl(timestamp);
        header.appendChild(tsEl);
        return header;
    }

    private _createAvatar(
        kind: "user" | "agent",
        source?: string,
    ): HTMLElement {
        const el = document.createElement("div");
        el.className = `avatar avatar-${kind}`;
        if (kind === "user") {
            el.textContent = this._userInitial;
            el.title = this._userName;
        } else {
            el.textContent = this._avatarForSource(source);
            if (source) el.title = source;
        }
        return el;
    }

    private static _escapeHtml(s: string): string {
        return s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    /**
     * Tokenize a JSON.stringify(obj, null, 2) string and wrap tokens in
     * spans with classes (json-key, json-string, json-number, json-bool,
     * json-null, json-punct) for CSS styling.
     */
    private static _highlightJson(json: string): string {
        const escaped = ChatUI._escapeHtml(json);
        // Order matters: match strings (and following ":" => key) before numbers.
        const re =
            /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|(-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g;
        return escaped.replace(
            re,
            (
                _m,
                strLit?: string,
                colon?: string,
                bool?: string,
                num?: string,
            ) => {
                if (strLit) {
                    if (colon) {
                        return `<span class="json-key">${strLit}</span><span class="json-punct">${colon}</span>`;
                    }
                    return `<span class="json-string">${strLit}</span>`;
                }
                if (bool) return `<span class="json-bool">${bool}</span>`;
                if (num) return `<span class="json-number">${num}</span>`;
                return `<span class="json-null">null</span>`;
            },
        );
    }

    private _avatarForSource(source?: string): string {
        if (!source) return "✦";
        const root = source.split(".")[0].toLowerCase();
        // Emoji per agent, sourced from the manifest emojiChar values
        // (ts/packages/agents/*/src/*Manifest.json).
        const map: Record<string, string> = {
            androidmobile: "📱",
            browser: "🌐",
            calendar: "📅",
            chat: "💬",
            code: "⚛️",
            desktop: "🪟",
            email: "📩",
            "github-cli": "🐙",
            greeting: "🖐️",
            image: "🖼️",
            list: "📝",
            markdown: "🗎",
            montage: "🎞",
            onboarding: "🛠️",
            photo: "📷",
            player: "🎧",
            localplayer: "🎵",
            music: "🎵",
            scriptflow: "🔁",
            settings: "⚙️",
            taskflow: "📜",
            test: "➕",
            turtle: "🐢",
            utility: "🔧",
            video: "📹",
            weather: "⛅",
            word: "📄",
            spelunker: "⛏",
            system: "⚙",
            shell: "🐚",
            dispatcher: "🤖",
        };
        return map[root] ?? root.charAt(0).toUpperCase();
    }

    private _createTimestampEl(timestamp?: number): HTMLElement {
        const ts = timestamp ?? Date.now();
        const el = document.createElement("span");
        el.className = "message-timestamp";
        el.textContent = this._formatTimestamp(ts);
        // Tooltip with full date/time on hover
        el.title = new Date(ts).toLocaleString();
        return el;
    }

    /**
     * Format timestamp as time-of-day for today, "Yesterday HH:MM" for
     * yesterday, or short date+time for older messages.
     */
    private _formatTimestamp(timestamp: number): string {
        const d = new Date(timestamp);
        const now = new Date();
        const time = d.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
        });
        const sameDay =
            d.getFullYear() === now.getFullYear() &&
            d.getMonth() === now.getMonth() &&
            d.getDate() === now.getDate();
        if (sameDay) {
            return time;
        }
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const isYesterday =
            d.getFullYear() === yesterday.getFullYear() &&
            d.getMonth() === yesterday.getMonth() &&
            d.getDate() === yesterday.getDate();
        if (isYesterday) {
            return `Yesterday ${time}`;
        }
        return `${d.toLocaleDateString([], {
            month: "short",
            day: "numeric",
        })} ${time}`;
    }

    private _removeStatusIndicator(): void {
        if (this._statusIndicatorEl) {
            this._statusIndicatorEl.remove();
            this._statusIndicatorEl = undefined;
        }
    }

    private _removeTemporary(): void {
        const temps = this._messagesEl.querySelectorAll(".temporary");
        temps.forEach((el) => el.remove());
    }

    /**
     * Convert DisplayContent (string | string[] | string[][] | TypedDisplayContent)
     * into an HTML string for rendering. Handles ANSI escape codes and
     * markdown the same way the Electron shell does.
     */
    private _renderDisplayContent(content: any): string {
        if (content === null || content === undefined) {
            return "";
        }
        // Plain string: text type — convert ANSI to HTML, escape rest
        if (typeof content === "string") {
            return this._renderText(content);
        }
        // string[] / string[][]
        if (Array.isArray(content)) {
            if (content.length === 0) return "";
            if (Array.isArray(content[0])) {
                // 2-D: render as a markdown table
                return this._renderMarkdown(this._tableToMarkdown(content));
            }
            return this._renderText((content as string[]).join("\n"));
        }
        // TypedDisplayContent: { type, content, alternates? }
        if (typeof content === "object") {
            // Prefer html alternate when present (richer rendering with
            // emojis, layout, etc).  We strip hard-coded inline color
            // styles so the content inherits theme-aware colors instead
            // of light-theme defaults baked in by some agents.
            const htmlAlt = content.alternates?.find(
                (a: any) => a.type === "html",
            );
            if (htmlAlt && content.type !== "html") {
                return this._sanitizeHtml(
                    this._stripInlineColors(
                        this._stringifyMessage(htmlAlt.content),
                    ),
                );
            }
            const inner = content.content;
            switch (content.type) {
                case "html":
                    return this._sanitizeHtml(this._stringifyMessage(inner));
                case "markdown":
                    return this._renderMarkdown(this._stringifyMessage(inner));
                case "text":
                default:
                    return this._renderDisplayContent(inner);
            }
        }
        return this._renderText(String(content));
    }

    private _stringifyMessage(message: any): string {
        if (typeof message === "string") return message;
        if (Array.isArray(message)) {
            if (message.length === 0) return "";
            if (Array.isArray(message[0])) {
                return this._tableToMarkdown(message as string[][]);
            }
            return (message as string[]).join("\n");
        }
        return String(message);
    }

    private _renderText(text: string): string {
        const html = ansiText.ansi_to_html(text);
        return html.replace(/\n/g, "<br>");
    }

    private _renderMarkdown(text: string): string {
        const rendered = md.render(text);
        const withAnsi = ansiMarkdown.ansi_to_html(rendered);
        return this._sanitizeHtml(withAnsi);
    }

    private _sanitizeHtml(html: string): string {
        return DOMPurify.sanitize(html, purifyConfig);
    }

    /**
     * Remove hard-coded color / background / border-color from inline
     * style attributes so theme variables can take over. Many agents
     * emit HTML with light-theme baked colors which are unreadable on
     * a dark theme; this neutralizes those without losing other style
     * properties (padding, font-weight, alignment, etc).
     */
    private _stripInlineColors(html: string): string {
        return html.replace(
            /style\s*=\s*"([^"]*)"/gi,
            (_match, body: string) => {
                const cleaned = body
                    .split(";")
                    .map((decl) => decl.trim())
                    .filter((decl) => {
                        if (!decl) return false;
                        const prop = decl.split(":")[0]?.trim().toLowerCase();
                        return (
                            prop !== "color" &&
                            prop !== "background" &&
                            prop !== "background-color" &&
                            prop !== "border-color" &&
                            prop !== "border-bottom-color" &&
                            prop !== "border-top-color" &&
                            prop !== "border-left-color" &&
                            prop !== "border-right-color"
                        );
                    })
                    .join("; ");
                return cleaned ? `style="${cleaned}"` : "";
            },
        );
    }

    private _tableToMarkdown(table: string[][]): string {
        if (table.length === 0) return "";
        const rows: string[] = [];
        rows.push("| " + table[0].join(" | ") + " |");
        rows.push("| " + table[0].map(() => "---").join(" | ") + " |");
        for (let i = 1; i < table.length; i++) {
            rows.push("| " + table[i].join(" | ") + " |");
        }
        return rows.join("\n");
    }

    private _escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    private _scrollToBottom(): void {
        this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
    }
}
