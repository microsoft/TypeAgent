// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Simplified chat panel component for the Chrome extension side panel.
 *
 * Uses the same CSS class names as the shell's ChatView for visual
 * consistency, but without TTS, metrics, template editor, or speech
 * recognition dependencies.
 */

import {
    DisplayAppendMode,
    DisplayContent,
} from "@typeagent/agent-sdk";
import { setContent } from "./setContent.js";
import {
    PlatformAdapter,
    ChatSettingsView,
    defaultChatSettings,
} from "./platformAdapter.js";

export interface ChatPanelOptions {
    platformAdapter: PlatformAdapter;
    settingsView?: ChatSettingsView;
    /** Callback when user sends a message. */
    onSend?: (text: string) => void;
}

/**
 * A lightweight chat panel that renders user and agent messages.
 * Designed for embedding in a Chrome extension side panel or any
 * standalone web page.
 */
export class ChatPanel {
    private readonly messageDiv: HTMLDivElement;
    private readonly inputArea: HTMLDivElement;
    private readonly textInput: HTMLSpanElement;
    private readonly sendButton: HTMLButtonElement;
    private readonly platformAdapter: PlatformAdapter;
    private readonly settingsView: ChatSettingsView;

    private currentAgentContainer: AgentMessageContainer | undefined;
    private statusContainer: AgentMessageContainer | undefined;
    private commandHistory: string[] = [];
    private historyIndex = -1;

    public onSend?: (text: string) => void;

    constructor(
        private readonly rootElement: HTMLElement,
        options: ChatPanelOptions,
    ) {
        this.platformAdapter = options.platformAdapter;
        this.settingsView = options.settingsView ?? defaultChatSettings;
        this.onSend = options.onSend;

        // Build DOM structure
        const wrapper = document.createElement("div");
        wrapper.className = "chat-panel-wrapper";

        // Scrollable message area
        this.messageDiv = document.createElement("div");
        this.messageDiv.className = "chat";
        this.messageDiv.id = "chat-window";

        // Sentinel div for reverse flex ordering
        const sentinel = document.createElement("div");
        sentinel.className = "chat-sentinel";
        this.messageDiv.appendChild(sentinel);

        wrapper.appendChild(this.messageDiv);

        // Input area
        this.inputArea = document.createElement("div");
        this.inputArea.className = "chat-input";

        this.textInput = document.createElement("span");
        this.textInput.className = "user-textarea";
        this.textInput.role = "textbox";
        this.textInput.contentEditable = "true";
        this.textInput.setAttribute("data-placeholder", "Type a message...");

        this.sendButton = document.createElement("button");
        this.sendButton.id = "sendbutton";
        this.sendButton.className = "chat-input-button";
        this.sendButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 2048 2048"><path d="M2048 960q0 19-10 34t-27 24L91 1914q-12 6-27 6-28 0-46-18t-18-47v-9q0-4 2-8l251-878L2 82q-2-4-2-8t0-9q0-28 18-46T64 0q15 0 27 6l1920 896q37 17 37 58zM164 1739l1669-779L164 181l205 715h847q26 0 45 19t19 45q0 26-19 45t-45 19H369l-205 715z"/></svg>`;
        this.sendButton.disabled = true;

        this.inputArea.appendChild(this.textInput);
        this.inputArea.appendChild(this.sendButton);

        wrapper.appendChild(this.inputArea);
        rootElement.appendChild(wrapper);

        this.setupInputHandlers();
    }

    private setupInputHandlers() {
        this.textInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.send();
            } else if (e.key === "Escape") {
                this.textInput.textContent = "";
                this.sendButton.disabled = true;
            } else if (e.key === "ArrowUp" && !this.textInput.textContent) {
                e.preventDefault();
                this.navigateHistory(-1);
            } else if (e.key === "ArrowDown" && !this.textInput.textContent) {
                e.preventDefault();
                this.navigateHistory(1);
            }
        });

        this.textInput.addEventListener("input", () => {
            this.sendButton.disabled = !this.textInput.textContent?.trim();
        });

        this.sendButton.addEventListener("click", () => this.send());
    }

    private navigateHistory(delta: number) {
        if (this.commandHistory.length === 0) return;
        this.historyIndex = Math.max(
            -1,
            Math.min(
                this.commandHistory.length - 1,
                this.historyIndex + delta,
            ),
        );
        if (this.historyIndex >= 0) {
            this.textInput.textContent =
                this.commandHistory[this.historyIndex];
        } else {
            this.textInput.textContent = "";
        }
        this.sendButton.disabled = !this.textInput.textContent?.trim();
    }

    private send() {
        const text = this.textInput.textContent?.trim();
        if (!text) return;

        this.commandHistory.unshift(text);
        this.historyIndex = -1;
        this.textInput.textContent = "";
        this.sendButton.disabled = true;

        this.addUserMessage(text);
        this.onSend?.(text);
    }

    /** Display a user message bubble. */
    public addUserMessage(text: string) {
        const sentinel = this.messageDiv.firstElementChild!;
        const container = document.createElement("div");
        container.className = "chat-message-container-user";

        const timestamp = this.createTimestamp("user", "You");
        container.appendChild(timestamp);

        const iconDiv = document.createElement("div");
        iconDiv.className = "user-icon";
        iconDiv.textContent = "U";
        container.appendChild(iconDiv);

        const bodyDiv = document.createElement("div");
        bodyDiv.className = "chat-message-body-hide-metrics chat-message-user";

        const messageDiv = document.createElement("div");
        messageDiv.className = "chat-message-content";

        const span = document.createElement("span");
        span.className = "chat-message-user-text";
        span.textContent = text;
        messageDiv.appendChild(span);

        bodyDiv.appendChild(messageDiv);
        container.appendChild(bodyDiv);

        sentinel.before(container);
        this.scrollToBottom();

        // Reset current agent container for the new request
        this.currentAgentContainer = undefined;
    }

    /**
     * Display or append an agent message.
     * Call with appendMode to add to the current agent message.
     */
    public addAgentMessage(
        content: DisplayContent,
        source?: string,
        sourceIcon?: string,
        appendMode?: DisplayAppendMode,
    ) {
        // Remove lingering status message when a real response arrives
        if (this.statusContainer) {
            this.statusContainer.remove();
            this.statusContainer = undefined;
        }

        if (!this.currentAgentContainer || !appendMode) {
            this.currentAgentContainer = this.createAgentContainer(
                source ?? "assistant",
                sourceIcon ?? "🤖",
            );
        }

        this.currentAgentContainer.setMessage(
            content,
            source,
            appendMode,
        );

        this.scrollToBottom();
    }

    /** Update the source/agent label on the current agent message. */
    public setDisplayInfo(source: string, sourceIcon?: string) {
        if (this.currentAgentContainer) {
            this.currentAgentContainer.updateSource(source, sourceIcon);
        }
    }

    /** Clear all messages. */
    public clear() {
        while (this.messageDiv.children.length > 1) {
            this.messageDiv.removeChild(this.messageDiv.lastChild!);
        }
        this.currentAgentContainer = undefined;
    }

    /** Show a status message (temporary, removed when the next real message arrives). */
    public showStatus(text: string) {
        // Remove any previous status
        if (this.statusContainer) {
            this.statusContainer.remove();
        }
        this.statusContainer = this.createAgentContainer("", "");
        this.statusContainer.setMessage(
            { type: "text", content: text, kind: "status" },
            undefined,
            undefined,
        );
        this.scrollToBottom();
    }

    /** Focus the text input. */
    public focus() {
        this.textInput.focus();
    }

    /** Enable or disable the input. */
    public setEnabled(enabled: boolean) {
        this.textInput.contentEditable = enabled ? "true" : "false";
        this.sendButton.disabled = !enabled;
        if (enabled) {
            this.inputArea.classList.remove("chat-input-disabled");
        } else {
            this.inputArea.classList.add("chat-input-disabled");
        }
    }

    private createAgentContainer(
        source: string,
        icon: string,
    ): AgentMessageContainer {
        const sentinel = this.messageDiv.firstElementChild!;
        const container = new AgentMessageContainer(
            sentinel,
            source,
            icon,
            this.settingsView,
            this.platformAdapter,
        );
        return container;
    }

    private createTimestamp(
        type: "agent" | "user",
        name: string,
    ): HTMLDivElement {
        const div = document.createElement("div");
        div.className = `chat-timestamp-${type}`;

        const nameSpan = document.createElement("span");
        nameSpan.className = "agent-name";
        nameSpan.textContent = name;
        div.appendChild(nameSpan);

        const dateSpan = document.createElement("span");
        dateSpan.className = "timestring";
        dateSpan.textContent = "- " + new Date().toLocaleTimeString();
        div.appendChild(dateSpan);

        return div;
    }

    private scrollToBottom() {
        // With column-reverse flex, scrollTop 0 = bottom
        this.messageDiv.scrollTop = 0;
    }
}

/**
 * Manages a single agent message container within the chat panel.
 */
class AgentMessageContainer {
    private readonly div: HTMLDivElement;
    private readonly messageDiv: HTMLDivElement;
    private readonly detailsDiv: HTMLDivElement;
    private readonly nameSpan: HTMLSpanElement;
    private readonly iconDiv: HTMLDivElement;
    private lastAppendMode?: DisplayAppendMode;

    constructor(
        beforeElement: Element,
        source: string,
        icon: string,
        private readonly settingsView: ChatSettingsView,
        private readonly platformAdapter: PlatformAdapter,
    ) {
        this.div = document.createElement("div");
        this.div.className = "chat-message-container-agent";

        // Timestamp (clickable to toggle action details)
        const timestampDiv = document.createElement("div");
        timestampDiv.className = "chat-timestamp-agent chat-timestamp-toggle";
        timestampDiv.title = "Click to show/hide action details";
        timestampDiv.addEventListener("click", () => {
            this.detailsDiv.classList.toggle("chat-details-visible");
        });

        this.nameSpan = document.createElement("span");
        this.nameSpan.className = "agent-name";
        this.nameSpan.textContent = source;
        timestampDiv.appendChild(this.nameSpan);

        const dateSpan = document.createElement("span");
        dateSpan.className = "timestring";
        dateSpan.textContent = "- " + new Date().toLocaleTimeString();
        timestampDiv.appendChild(dateSpan);

        this.div.appendChild(timestampDiv);

        // Icon
        this.iconDiv = document.createElement("div");
        this.iconDiv.className = "agent-icon";
        this.iconDiv.textContent = icon;
        this.div.appendChild(this.iconDiv);

        // Message body
        const bodyDiv = document.createElement("div");
        bodyDiv.className =
            "chat-message-body-hide-metrics chat-message-agent";

        this.messageDiv = document.createElement("div");
        this.messageDiv.className = "chat-message-content";
        bodyDiv.appendChild(this.messageDiv);

        // Collapsible action details (hidden by default)
        this.detailsDiv = document.createElement("div");
        this.detailsDiv.className = "chat-message-details";
        bodyDiv.appendChild(this.detailsDiv);

        this.div.appendChild(bodyDiv);

        // Insert into DOM (column-reverse order)
        beforeElement.before(this.div);
    }

    public setMessage(
        content: DisplayContent,
        source?: string,
        appendMode?: DisplayAppendMode,
    ) {
        if (source) {
            this.nameSpan.textContent = source;
        }

        // Flush last temporary
        if (this.lastAppendMode === "temporary") {
            this.messageDiv.lastChild?.remove();
            this.lastAppendMode = undefined;
        }

        // Try to split action data (summary + JSON) into main + details
        const split = this.splitActionContent(content);
        if (split) {
            setContent(
                this.messageDiv,
                split.summary,
                this.settingsView,
                "agent",
                this.platformAdapter,
                appendMode === "inline" && this.lastAppendMode !== "inline"
                    ? "block"
                    : appendMode,
            );
            setContent(
                this.detailsDiv,
                split.details,
                this.settingsView,
                "agent",
                this.platformAdapter,
                appendMode,
            );
            this.lastAppendMode = appendMode;
            this.div.classList.remove("chat-message-hidden");
            return;
        }

        setContent(
            this.messageDiv,
            content,
            this.settingsView,
            "agent",
            this.platformAdapter,
            appendMode === "inline" && this.lastAppendMode !== "inline"
                ? "block"
                : appendMode,
        );

        this.lastAppendMode = appendMode;
        this.div.classList.remove("chat-message-hidden");
    }

    public updateSource(source: string, icon?: string) {
        this.nameSpan.textContent = source;
        if (icon) {
            this.iconDiv.textContent = icon;
        }
    }

    /** Remove this container from the DOM. */
    public remove() {
        this.div.remove();
    }

    /**
     * If the content contains a summary line followed by a JSON block,
     * split it into summary (shown) and details (collapsible).
     */
    private splitActionContent(
        content: DisplayContent,
    ): { summary: DisplayContent; details: DisplayContent } | undefined {
        // Get the raw text from any DisplayContent shape
        let text: string | undefined;
        if (typeof content === "string") {
            text = content;
        } else if (!Array.isArray(content) && typeof content.content === "string") {
            text = content.content;
        } else if (!Array.isArray(content) && Array.isArray(content.content) &&
                   content.content.length > 0 && typeof content.content[0] === "string") {
            text = (content.content as string[]).join("\n");
        }
        if (!text) return undefined;

        // Strip ANSI to find the JSON boundary
        const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
        const lines = stripped.split("\n");

        // Find the first line that starts a JSON array or object
        let jsonStart = -1;
        for (let i = 0; i < lines.length; i++) {
            const t = lines[i].trim();
            if (t === "[" || t === "{" || t.startsWith("[{") || t.startsWith("{\"")) {
                jsonStart = i;
                break;
            }
        }

        // Must have at least one summary line before the JSON
        if (jsonStart <= 0) return undefined;

        // Split the original text (with ANSI codes) at the same line boundary
        const originalLines = text.split("\n");
        const summaryText = originalLines.slice(0, jsonStart).join("\n");
        const detailsText = originalLines.slice(jsonStart).join("\n");

        if (typeof content === "object" && !Array.isArray(content)) {
            return {
                summary: { ...content, content: summaryText },
                details: { ...content, content: detailsText, kind: undefined },
            };
        }
        return { summary: summaryText, details: detailsText };
    }
}
