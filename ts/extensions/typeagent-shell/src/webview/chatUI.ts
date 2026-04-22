// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AnsiUp } from "ansi_up";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

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

/**
 * Manages the chat UI elements in the webview.
 * Groups messages by requestId to match the shell's behavior.
 */
export class ChatUI {
    private _messagesEl: HTMLElement;
    private _inputEl: HTMLTextAreaElement;
    private _sendBtn: HTMLButtonElement;
    private _statusEl: HTMLElement;
    private _sendCallback?: (text: string) => void;

    // Track the active response bubble for setDisplay/appendDisplay
    private _activeResponseEl?: HTMLElement;
    // Track the status indicator element
    private _statusIndicatorEl?: HTMLElement;
    // Dedup: track last appended content to avoid duplicates
    private _lastAppendedContent?: string;

    // Track switching state to keep input disabled
    private _isSwitching = false;

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

    public onSend(callback: (text: string) => void): void {
        this._sendCallback = callback;
    }

    public addUserMessage(text: string, timestamp?: number): void {
        this._removeStatusIndicator();
        this._removeTemporary();
        this._activeResponseEl = undefined;
        this._lastAppendedContent = undefined;
        const el = document.createElement("div");
        el.className = "message user";
        const tsEl = this._createTimestampEl(timestamp);
        el.appendChild(tsEl);
        const textEl = document.createElement("span");
        textEl.className = "message-content";
        textEl.textContent = text;
        el.appendChild(textEl);
        this._messagesEl.appendChild(el);
        this._scrollToBottom();
    }

    /**
     * setDisplay: replace the content of the active agent bubble.
     */
    public setAgentDisplay(
        content: any,
        source?: string,
        timestamp?: number,
    ): void {
        this._removeStatusIndicator();
        this._removeTemporary();
        if (!this._activeResponseEl) {
            this._activeResponseEl = this._createAgentBubble(source, timestamp);
        }
        if (source) {
            const sourceEl = this._activeResponseEl.querySelector(".source-label");
            if (sourceEl) {
                sourceEl.textContent = source;
            }
        }
        const contentEl =
            this._activeResponseEl.querySelector(".agent-content");
        if (contentEl) {
            contentEl.innerHTML = this._renderDisplayContent(content);
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
    ): void {
        this._removeStatusIndicator();

        if (mode === "temporary") {
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

        if (!this._activeResponseEl) {
            // Remove temporary when first real content arrives
            this._removeTemporary();
            this._activeResponseEl = this._createAgentBubble(source, timestamp);
        }
        const contentEl =
            this._activeResponseEl.querySelector(".agent-content");
        if (contentEl) {
            contentEl.innerHTML += rendered;
        }
        this._scrollToBottom();
    }

    /**
     * setDisplayInfo: show which agent is processing (status indicator).
     * Replaces previous status indicator rather than accumulating.
     */
    public setDisplayInfo(source: string, action?: any): void {
        if (!source) return;

        if (!this._statusIndicatorEl) {
            this._statusIndicatorEl = document.createElement("div");
            this._statusIndicatorEl.className = "message system status-indicator";
            this._messagesEl.appendChild(this._statusIndicatorEl);
        }
        const label = action ? `[${source}] processing...` : `[${source}] processing...`;
        this._statusIndicatorEl.textContent = label;
        this._scrollToBottom();
    }

    public clearMessages(): void {
        this._messagesEl.innerHTML = "";
        this._activeResponseEl = undefined;
        this._statusIndicatorEl = undefined;
    }

    /**
     * Called when a command finishes processing.
     * Cleans up temporary status messages.
     */
    public onCommandComplete(): void {
        this._removeTemporary();
        this._removeStatusIndicator();
        this._activeResponseEl = undefined;
        this._lastAppendedContent = undefined;
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

        for (const e of entries) {
            switch (e.type) {
                case "user-request":
                    this.addUserMessage(e.command, e.timestamp);
                    break;
                case "set-display":
                    this.setAgentDisplay(
                        e.message?.message,
                        e.message?.source,
                        e.timestamp,
                    );
                    break;
                case "append-display":
                    this.appendAgentDisplay(
                        e.message?.message,
                        e.message?.source,
                        e.mode,
                        e.timestamp,
                    );
                    break;
                case "set-display-info":
                    // Skip status indicators during replay — they'd pollute
                    // the rendered history with transient "processing..." text
                    break;
            }
        }

        // Mark everything we just appended as history
        for (let i = firstHistoryIdx; i < this._messagesEl.children.length; i++) {
            this._messagesEl.children[i].classList.add("history");
        }

        // Reset state so the next live message starts a fresh bubble
        this._activeResponseEl = undefined;
        this._lastAppendedContent = undefined;
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
        // Show user message immediately (don't wait for server echo)
        this.addUserMessage(text);
        this._inputEl.value = "";
        this._inputEl.style.height = "auto";
        this._sendCallback?.(text);
    }

    private _createAgentBubble(
        source?: string,
        timestamp?: number,
    ): HTMLElement {
        const el = document.createElement("div");
        el.className = "message agent";
        const tsEl = this._createTimestampEl(timestamp);
        el.appendChild(tsEl);
        if (source) {
            const sourceEl = document.createElement("span");
            sourceEl.className = "source-label";
            sourceEl.textContent = source;
            el.appendChild(sourceEl);
        }
        const contentEl = document.createElement("span");
        contentEl.className = "agent-content";
        el.appendChild(contentEl);
        this._messagesEl.appendChild(el);
        return el;
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
            hour: "2-digit",
            minute: "2-digit",
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
