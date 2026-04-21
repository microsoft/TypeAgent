// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Manages the chat UI elements in the webview.
 */
export class ChatUI {
    private _messagesEl: HTMLElement;
    private _inputEl: HTMLTextAreaElement;
    private _sendBtn: HTMLButtonElement;
    private _statusEl: HTMLElement;
    private _sendCallback?: (text: string) => void;
    private _lastAgentEl?: HTMLElement;

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

    public addUserMessage(text: string): void {
        this._appendMessage(text, "user");
    }

    public addAgentMessage(text: string, source?: string): void {
        const el = document.createElement("div");
        el.className = "message agent";
        if (source) {
            const sourceEl = document.createElement("span");
            sourceEl.className = "source-label";
            sourceEl.textContent = source;
            el.appendChild(sourceEl);
        }
        const content = document.createElement("span");
        content.textContent = text;
        el.appendChild(content);
        this._messagesEl.appendChild(el);
        this._lastAgentEl = el;
        this._scrollToBottom();
    }

    public appendAgentMessage(
        text: string,
        source?: string,
        _mode?: string,
    ): void {
        if (this._lastAgentEl) {
            const content = this._lastAgentEl.querySelector(
                "span:last-child",
            );
            if (content) {
                content.textContent += text;
            }
        } else {
            this.addAgentMessage(text, source);
        }
        this._scrollToBottom();
    }

    public setDisplayInfo(source: string, action?: any): void {
        // Show which agent is handling the request
        if (source) {
            const el = document.createElement("div");
            el.className = "message system";
            el.textContent = `[${source}]${action ? " processing..." : ""}`;
            this._messagesEl.appendChild(el);
            this._scrollToBottom();
        }
    }

    public clearMessages(): void {
        this._messagesEl.innerHTML = "";
        this._lastAgentEl = undefined;
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

    public setStatus(connected: boolean, sessionId?: string): void {
        if (connected) {
            this._statusEl.className = "status connected";
            this._statusEl.textContent = sessionId
                ? `Connected (${sessionId.substring(0, 8)}…)`
                : "Connected to TypeAgent";
            this._inputEl.disabled = false;
            this._sendBtn.disabled = false;
        } else {
            this._statusEl.className = "status disconnected";
            this._statusEl.textContent = "Disconnected";
            this._inputEl.disabled = true;
            this._sendBtn.disabled = true;
        }
    }

    public addSystemMessage(text: string): void {
        this._appendMessage(text, "system");
    }

    private _handleSend(): void {
        const text = this._inputEl.value.trim();
        if (!text) return;
        this.addUserMessage(text);
        this._inputEl.value = "";
        this._inputEl.style.height = "auto";
        this._lastAgentEl = undefined;
        this._sendCallback?.(text);
    }

    private _appendMessage(
        text: string,
        role: "user" | "agent" | "system",
    ): void {
        const el = document.createElement("div");
        el.className = "message " + role;
        el.textContent = text;
        this._messagesEl.appendChild(el);
        this._scrollToBottom();
    }

    private _scrollToBottom(): void {
        this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
    }
}
