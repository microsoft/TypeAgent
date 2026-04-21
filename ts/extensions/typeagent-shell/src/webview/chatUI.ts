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

    public addAgentMessage(text: string): void {
        this._appendMessage(text, "agent");
    }

    public updatePartialMessage(text: string): void {
        let partial = this._messagesEl.querySelector(
            ".message.agent.partial",
        );
        if (!partial) {
            partial = document.createElement("div");
            partial.className = "message agent partial";
            this._messagesEl.appendChild(partial);
        }
        partial.textContent = text;
        this._scrollToBottom();
    }

    public finalizePartialMessage(): void {
        const partial = this._messagesEl.querySelector(
            ".message.agent.partial",
        );
        if (partial) {
            partial.classList.remove("partial");
        }
    }

    public setStatus(
        state: "connected" | "connecting" | "disconnected",
        detail?: string,
    ): void {
        this._statusEl.className = "status " + state;
        switch (state) {
            case "connected":
                this._statusEl.textContent =
                    detail ?? "Connected to TypeAgent";
                this._inputEl.disabled = false;
                this._sendBtn.disabled = false;
                break;
            case "connecting":
                this._statusEl.textContent = detail ?? "Connecting…";
                this._inputEl.disabled = true;
                this._sendBtn.disabled = true;
                break;
            case "disconnected":
                this._statusEl.textContent = detail ?? "Disconnected";
                this._inputEl.disabled = true;
                this._sendBtn.disabled = true;
                break;
        }
    }

    public addSystemMessage(text: string): void {
        this._appendMessage(text, "system");
    }

    private _handleSend(): void {
        const text = this._inputEl.value.trim();
        if (!text) return;
        this._inputEl.value = "";
        this._inputEl.style.height = "auto";
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
