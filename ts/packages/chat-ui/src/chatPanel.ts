// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Simplified chat panel component for the Chrome extension side panel.
 *
 * Uses the same CSS class names as the shell's ChatView for visual
 * consistency, but without TTS, metrics, template editor, or speech
 * recognition dependencies.
 */

import { DisplayAppendMode, DisplayContent } from "@typeagent/agent-sdk";
import { setContent } from "./setContent.js";
import {
    PlatformAdapter,
    ChatSettingsView,
    defaultChatSettings,
} from "./platformAdapter.js";

export interface CompletionResult {
    completions: string[];
    startIndex: number;
    prefix: string;
}

export interface DynamicDisplayResult {
    content: DisplayContent;
    nextRefreshMs: number;
}

// Local mirror of dispatcher-types PhaseTiming — kept here to avoid
// pulling the full dispatcher-types dependency into chat-ui.
export interface PhaseTiming {
    duration?: number;
}

// Local mirror of dispatcher-types CompletionUsageStats.
export interface CompletionUsageStats {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
}

// Local mirror of dispatcher-types NotifyExplainedData — kept here to avoid
// pulling the full dispatcher-types dependency into chat-ui.
export interface NotifyExplainedData {
    error?: string | undefined;
    fromCache: "construction" | "grammar" | false;
    fromUser: boolean;
    time: string;
}

function formatDuration(ms: number): string {
    if (ms < 1) return `${ms.toFixed(2)}ms`;
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${ms.toFixed(0)}ms`;
}

function metricsLine(label: string, duration: number): string {
    return `${label}: <b>${formatDuration(duration)}</b>`;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Generates a UUID for tagging user-message bubbles. Falls back to a
// time + random hex blend when crypto.randomUUID is unavailable (older
// browsers, non-secure contexts).
function generateRequestId(): string {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.randomUUID === "function") {
        return c.randomUUID();
    }
    return (
        Date.now().toString(36) +
        "-" +
        Math.floor(Math.random() * 0xffffffff)
            .toString(16)
            .padStart(8, "0")
    );
}

// Inline SVG roadrunner icon used by `notifyExplained` / `updateGrammarResult`
// to mark a user bubble as "translated by ...". Color is supplied per call:
// green for cached/grammar paths, gold for model translations, blue for
// failures, cornflowerblue for "no grammar rule cached". Mirrors the shape
// in shell/src/renderer/src/icon.ts.
const ROADRUNNER_SVG_PATH =
    "M554.918,215.052c-2.068,0.322-4.12,0.718-6.16,1.175c-2.199,0.49-4.37-0.653-5.847-1.848c-0.861-0.698-1.938-1.191-3.109-1.371c-2.896-0.449-6.16,0.784-8.936,1.424c-3.965,0.914-7.931,1.832-11.896,2.75c-11.354,2.624-22.714,5.247-34.072,7.871c-60.73,13.223-122.47,19.984-183.938,28.462c-16.753,2.31-33.203-0.147-48.74-6.703c-29.499-12.44-59.76-21.208-91.943-23.208c-20.294-1.26-31.583-15.977-39.796-32.093c-0.473-0.931-0.542-2.053-0.343-3.301c0.29-1.84,1.636-4.431,2.632-5.818c0.6-0.832,1.232-1.648,1.901-2.444c0.184-0.22,0.302-0.465,0.363-0.718c0.106-0.437,0.661-1.159,1.534-1.31c0.498-0.085,1.032-0.11,1.599-0.069c0.938,0.069,1.469-0.498,1.604-1.187c0.229-1.196,0.171-2.607,1.338-3.439c0.706-0.502,1.408-1.004,2.113-1.506c0.714-0.51,0.902-1.33,0.702-2.011c-0.359-1.208-0.804-1.869,0.347-2.746c0.697-0.53,1.391-1.057,2.089-1.587c0.485-0.367,0.75-0.873,0.795-1.375c0.078-0.897,0.163-1.546,1.146-1.661c0.596-0.069,1.191-0.13,1.791-0.184c1.877-0.163,2.371-2.766,0.453-3.35c0,0-0.767-0.232-1.718-0.522c-0.946-0.29,0.017-0.571,2.134-0.853c1.269-0.167,2.534-0.4,3.803-0.689c1.742-0.404,1.514-2.778,0-3.292c-1.122-0.379-2.24-0.755-3.362-1.126c-1.861-0.616-3.419-1.689-3.913-2.093c-0.265-0.216-0.624-0.343-1.081-0.322c-0.469,0.024-0.938,0.029-1.403,0.012c-0.775-0.024-3.146-0.648-5.3-1.306c-3.745-1.142-7.507-2.244-11.285-3.296c-0.224-0.061-0.437-0.082-0.628-0.061c-0.347,0.032-2.415-0.196-4.663-0.049c-0.139,0.008-0.278,0.021-0.417,0.033c-2.244,0.212-5.773,1.065-7.997,1.432c-1.783,0.293-3.574,0.718-5.381,1.301c-4.088,1.314-7.944,3.309-11.408,5.834c-1.824,1.326-4.733,3.521-6.561,4.839c-7.009,5.051-13.154,11.571-18.433,19.348c-8.152,12.003-18.185,18.213-32.122,20.494c-10.877,1.783-21.795,4.325-30.045,13.672c-1.489,1.689-0.71,3.02,1.53,2.787c5.051-0.526,10.102-1.077,15.166-1.485c10.212-0.828,20.433-1.595,30.661-2.17c1.856-0.106,4.133,0.322,5.594,1.367c10.151,7.283,19.931,15.096,30.245,22.134c7.752,5.292,11.51,12.464,12.893,21.367c0.355,2.285,1.302,4.488,1.542,6.777c3.289,31.343,22.077,49.548,50.013,61.009c9.314,3.823,17.723,9.849,27.629,15.929c1.922,1.179,2.248,3.439,0.734,5.111c-5.418,5.985-9.559,10.976-14.37,15.198c-12.938,11.363-26.193,22.375-39.56,33.236c-8.131,6.609-17.168,9.049-27.895,6.201c-3.154-0.837-6.536-0.804-9.959-0.62c-2.252,0.122-5.854-0.429-8.099-0.249c-1.668,0.135-3.301,0.686-4.77,1.641c-0.445,0.289-0.461,1.142,0.163,1.248c0.922,0.155,1.844,0.311,2.767,0.461c1.53,0.257,3.533,1.045,4.476,1.759s0.045,2.056-2.003,2.994c-1.269,0.58-2.509,1.146-3.733,1.706c-2.048,0.934-5.561,1.207-7.769,1.648c-2.248,0.444-4.223,1.685-5.577,3.517c-1.342,1.812-1.849,4.235-1.457,4.627c0.241,0.236,0.604,0.298,0.889-0.013c2.171-2.354,5.312-2.477,8.327-2.974c2.224-0.367,5.712-1.354,7.952-1.596c8.107-0.873,16.238-1.648,24.109-3.517c12.419-2.95,23.741-2.75,35.749,2.501c5.181,2.264,11.028,2.999,17.115,3.729c2.236,0.27,5.708,1.27,7.817,2.064c2.754,1.037,5.582,1.865,8.482,2.477c0.657,0.139,1.159-0.632,0.665-1.142c-0.473-0.486-0.942-0.976-1.408-1.469c-0.771-0.816-1.408-1.612-1.493-1.751c-0.049-0.077-0.114-0.146-0.204-0.208c-0.065-0.045-0.135-0.09-0.2-0.131c-0.114-0.069-0.89-0.844-1.775-1.705c-0.535-0.522-1.082-1.028-1.645-1.514c-0.608-0.526-1.261-0.906-1.942-1.126c-1.183-0.388-3.19-1.742-4.721-3.398c-6.091-6.61-14.521-7.769-23.766-7.186c-2.249,0.144-4.251-0.277-4.488-1.057c-0.232-0.779,1.053-2.488,2.873-3.818c11.204-8.201,22.378-16.438,33.644-24.554c10.955-7.891,22.04-15.602,33.036-23.436c1.053-0.751,1.722-2.126,2.832-2.701c9.519-4.908,40.384,1.783,47.189,10.188c5.426,6.703,10.465,13.745,16.247,20.118c5.483,6.042,12.036,11.118,17.511,17.169c5.055,5.581,9.637,11.673,13.823,17.939c4.818,7.218,4.794,7.128,14.113,6.638c1.656-0.085,3.35,0.498,5.055,1.253c2.057,0.918,5.243,2.791,7.43,3.329c2.456,0.604,5.022,0.29,7.602-1.619c0.293-0.221,0.343-0.556,0.248-0.833c-0.167-0.489-0.767-0.497-0.849-0.53c-0.045-0.017-0.094-0.028-0.146-0.037c-1.322-0.191-2.644-0.379-3.97-0.566c-2.191-0.314-5.279-1.84-6.896-3.411c-9.266-8.992-18.548-18.005-27.993-27.173c-1.615-1.57-1.844-4.312-0.493-6.116c2.795-3.729,5.847-7.764,8.698-11.938c1.612-2.358,3.15-4.762,4.651-7.148c1.195-1.909,3.814-4.288,6.026-4.721c2.321-0.453,4.716-0.408,7.128,0.155c0.22,0.053,0.407,0.004,0.547-0.102c0.253-0.192,0.583-0.571,0.693-0.869c0.061-0.159,0.045-0.347-0.103-0.539c-0.334-0.433-0.701-0.824-1.093-1.175c-0.665-0.592-1.363-1.105-1.53-1.204c-0.167-0.098-1.734-0.836-3.615-0.971s-5.182,0.118-7.434,0.151c-12.815,0.175-17.055,10.954-21.302,21.31c-0.856,2.085-3.296,3.125-5.279,2.057c-7.728-4.17-13.876-11.963-30.375-37.043c-1.236-1.881-0.784-4.508,0.987-5.903c9.2-7.279,18.001-15.365,28.242-20.686c10.151-5.275,21.771-7.736,33.432-11.18c2.162-0.636,2.656-2.529,1.122-4.178c-0.416-0.448-0.841-0.905-1.265-1.358c-1.534-1.648-1.682-4.451-0.131-6.088c13.333-14.117,31.946-12.75,49.389-14.268c18.474-1.611,35.794-6.65,53.378-12.378c7.577-2.468,15.337-4.374,23.167-6.059c20.607-3.562,41.216-7.124,61.824-10.686c2.219-0.383,5.817-1.008,8.041-1.391c12.049-2.081,24.097-4.166,36.149-6.247c3.357-0.579,9.139-2.428,8.755-6.985c-0.073-0.857-0.313-1.648-0.685-2.333c-0.649-1.188-1.678-1.865-1.73-1.955s0.828-0.437,1.971-0.824c0.689-0.232,1.371-0.477,2.053-0.738c3.464-1.155,6.874-2.46,10.24-3.868c1.922-0.804,5.528-1.925,6.088-4.382C569.3,211.686,558.357,214.513,554.918,215.052z";

function iconRoadrunner(fill: string): HTMLElement {
    const wrapper = document.createElement("i");
    wrapper.className = "chat-message-explained-icon";
    wrapper.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 567.896 567.896"><path fill="${fill}" d="${ROADRUNNER_SVG_PATH}"/></svg>`;
    return wrapper;
}

export interface ChatPanelOptions {
    platformAdapter: PlatformAdapter;
    settingsView?: ChatSettingsView;
    /**
     * Callback when user sends a message. The `requestId` is a UUID
     * generated by the panel for this submission — pass it through to the
     * dispatcher (e.g. as `processCommand`'s `clientRequestId`) so that
     * subsequent `notifyExplained` / `updateGrammarResult` calls can
     * address the same user-message bubble.
     */
    onSend?: (
        text: string,
        attachments: string[] | undefined,
        requestId: string,
    ) => void;
    /** Callback when user clicks stop or presses Escape during processing. */
    onCancel?: (requestId: string) => void;
    /** Callback to fetch command completions for the current input. */
    getCompletions?: (input: string) => Promise<CompletionResult | null>;
    /** Callback to fetch refreshed dynamic display content. */
    getDynamicDisplay?: (
        source: string,
        displayId: string,
    ) => Promise<DynamicDisplayResult>;
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

    private readonly stopButton: HTMLButtonElement;
    private readonly ghostSpan: HTMLSpanElement;
    private currentAgentContainer: AgentMessageContainer | undefined;
    private statusContainer: AgentMessageContainer | undefined;
    private historyAgentContainer: AgentMessageContainer | undefined;
    private pendingDisplayInfo:
        | { source: string; sourceIcon?: string; action?: unknown }
        | undefined;
    private commandHistory: string[] = [];
    private historyIndex = -1;
    private activeRequestId?: string;

    // Completion state
    private completions: string[] = [];
    private completionIndex = 0;
    private completionPrefix = "";
    private completionFilterStart = 0;
    private completionTimer: ReturnType<typeof setTimeout> | undefined;

    // Dynamic display refresh state
    private dynamicDisplays: {
        source: string;
        displayId: string;
        nextRefreshTime: number;
    }[] = [];
    private dynamicTimer?: ReturnType<typeof setTimeout>;
    private dynamicContainers = new Map<string, AgentMessageContainer>();

    // Pending image attachments (base64 data URLs)
    private pendingAttachments: string[] = [];

    // User-message containers indexed by the requestId generated at send
    // time. Used by notifyExplained / updateGrammarResult to attach the
    // roadrunner icon and tooltip to the correct bubble after the
    // dispatcher reports back. Cleared by clear().
    private userMessageById = new Map<string, HTMLElement>();

    public onSend?: (
        text: string,
        attachments: string[] | undefined,
        requestId: string,
    ) => void;
    public onCancel?: (requestId: string) => void;
    public getCompletions?: (input: string) => Promise<CompletionResult | null>;
    public getDynamicDisplay?: (
        source: string,
        displayId: string,
    ) => Promise<DynamicDisplayResult>;

    constructor(
        private readonly rootElement: HTMLElement,
        options: ChatPanelOptions,
    ) {
        this.platformAdapter = options.platformAdapter;
        this.settingsView = options.settingsView ?? defaultChatSettings;
        this.onSend = options.onSend;
        this.onCancel = options.onCancel;
        this.getCompletions = options.getCompletions;
        this.getDynamicDisplay = options.getDynamicDisplay;

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

        this.stopButton = document.createElement("button");
        this.stopButton.className = "chat-input-button chat-stop-button";
        this.stopButton.innerHTML = "■";
        this.stopButton.style.display = "none";
        this.stopButton.addEventListener("click", () => {
            if (this.activeRequestId) {
                this.onCancel?.(this.activeRequestId);
            }
        });

        // Ghost text for inline completion preview
        this.ghostSpan = document.createElement("span");
        this.ghostSpan.className = "chat-input-ghost";

        // Wrap textarea + ghost in a container so ghost flows inline after typed text
        const textWrapper = document.createElement("div");
        textWrapper.className = "chat-input-text-wrapper";
        textWrapper.appendChild(this.textInput);
        textWrapper.appendChild(this.ghostSpan);

        this.inputArea.appendChild(textWrapper);
        this.inputArea.appendChild(this.sendButton);
        this.inputArea.appendChild(this.stopButton);

        wrapper.appendChild(this.inputArea);
        rootElement.appendChild(wrapper);

        this.setupInputHandlers();
    }

    private setupInputHandlers() {
        this.textInput.addEventListener("keydown", (e) => {
            if (e.key === "Tab" && this.completions.length > 0) {
                e.preventDefault();
                this.acceptCompletion();
                return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.clearCompletions();
                this.send();
            } else if (e.key === "Escape") {
                if (this.completions.length > 0) {
                    this.clearCompletions();
                    return;
                }
                if (this.activeRequestId) {
                    this.onCancel?.(this.activeRequestId);
                    return;
                }
                this.textInput.textContent = "";
                this.sendButton.disabled = true;
            } else if (e.key === "ArrowUp" && this.completions.length > 0) {
                e.preventDefault();
                this.cycleCompletion(-1);
            } else if (e.key === "ArrowDown" && this.completions.length > 0) {
                e.preventDefault();
                this.cycleCompletion(1);
            } else if (e.key === "ArrowUp") {
                // Shell-style history navigation: always respond to ArrowUp
                // regardless of whether the input has content. Replaces the
                // current text with the previous command. (Previously gated
                // on empty input, which forced users to clear first.)
                e.preventDefault();
                this.navigateHistory(-1);
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                this.navigateHistory(1);
            }
        });

        this.textInput.addEventListener("input", () => {
            this.sendButton.disabled = !this.textInput.textContent?.trim();
            this.scheduleCompletionFetch();
        });

        this.sendButton.addEventListener("click", () => this.send());

        // Drag-drop for image files
        this.inputArea.addEventListener("dragover", (e) => {
            e.preventDefault();
            this.inputArea.classList.add("chat-input-dragover");
        });
        this.inputArea.addEventListener("dragleave", () => {
            this.inputArea.classList.remove("chat-input-dragover");
        });
        this.inputArea.addEventListener("drop", (e) => {
            e.preventDefault();
            this.inputArea.classList.remove("chat-input-dragover");
            this.handleFileDrop(e.dataTransfer?.files);
        });
    }

    private handleFileDrop(files: FileList | undefined | null) {
        if (!files) return;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file.type.startsWith("image/")) continue;
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result === "string") {
                    this.pendingAttachments.push(reader.result);
                    this.showAttachmentPreview(reader.result);
                }
            };
            reader.readAsDataURL(file);
        }
    }

    private showAttachmentPreview(dataUrl: string) {
        let preview = this.inputArea.querySelector(
            ".chat-attachment-preview",
        ) as HTMLDivElement | null;
        if (!preview) {
            preview = document.createElement("div");
            preview.className = "chat-attachment-preview";
            this.inputArea.insertBefore(preview, this.inputArea.firstChild);
        }
        const img = document.createElement("img");
        img.src = dataUrl;
        img.className = "chat-attachment-thumb";
        const removeBtn = document.createElement("span");
        removeBtn.className = "chat-attachment-remove";
        removeBtn.textContent = "\u00d7";
        removeBtn.addEventListener("click", () => {
            const idx = this.pendingAttachments.indexOf(dataUrl);
            if (idx >= 0) this.pendingAttachments.splice(idx, 1);
            wrapper.remove();
            if (this.pendingAttachments.length === 0 && preview) {
                preview.remove();
            }
        });
        const wrapper = document.createElement("span");
        wrapper.className = "chat-attachment-item";
        wrapper.appendChild(img);
        wrapper.appendChild(removeBtn);
        preview.appendChild(wrapper);
    }

    private clearAttachmentPreview() {
        const preview = this.inputArea.querySelector(
            ".chat-attachment-preview",
        );
        if (preview) preview.remove();
    }

    private scheduleCompletionFetch() {
        if (this.completionTimer) clearTimeout(this.completionTimer);
        if (!this.getCompletions) {
            this.clearCompletions();
            return;
        }
        const input = this.textInput.textContent ?? "";
        if (!input.trim()) {
            this.clearCompletions();
            return;
        }
        this.completionTimer = setTimeout(async () => {
            const current = this.textInput.textContent ?? "";
            if (current !== input) return;
            try {
                const result = await this.getCompletions!(input);
                if ((this.textInput.textContent ?? "") !== input) return;
                if (result && result.completions.length > 0) {
                    this.completions = result.completions;
                    this.completionIndex = 0;
                    this.completionPrefix = result.prefix;
                    this.completionFilterStart = result.startIndex;
                    this.renderGhostText();
                } else {
                    this.clearCompletions();
                }
            } catch {
                this.clearCompletions();
            }
        }, 150);
    }

    private renderGhostText() {
        if (this.completions.length === 0) {
            this.ghostSpan.textContent = "";
            return;
        }
        const input = this.textInput.textContent ?? "";
        const completion = this.completions[this.completionIndex];
        const full = this.completionPrefix + completion;
        if (full.length > input.length && full.startsWith(input)) {
            this.ghostSpan.textContent = full.slice(input.length);
        } else {
            this.ghostSpan.textContent = completion;
        }
    }

    private acceptCompletion() {
        if (this.completions.length === 0) return;
        const completion = this.completions[this.completionIndex];
        const full = this.completionPrefix + completion;
        this.textInput.textContent = full;
        this.sendButton.disabled = !full.trim();
        this.clearCompletions();
        this.moveCursorToEnd();
    }

    private cycleCompletion(delta: number) {
        if (this.completions.length === 0) return;
        this.completionIndex =
            (this.completionIndex + delta + this.completions.length) %
            this.completions.length;
        this.renderGhostText();
    }

    private clearCompletions() {
        this.completions = [];
        this.completionIndex = 0;
        this.ghostSpan.textContent = "";
    }

    private moveCursorToEnd() {
        const range = document.createRange();
        const sel = window.getSelection();
        if (this.textInput.childNodes.length > 0) {
            const lastNode =
                this.textInput.childNodes[this.textInput.childNodes.length - 1];
            range.setStartAfter(lastNode);
        } else {
            range.setStart(this.textInput, 0);
        }
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
    }

    private navigateHistory(delta: number) {
        if (this.commandHistory.length === 0) return;
        this.historyIndex = Math.max(
            -1,
            Math.min(this.commandHistory.length - 1, this.historyIndex + delta),
        );
        if (this.historyIndex >= 0) {
            this.textInput.textContent = this.commandHistory[this.historyIndex];
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

        const attachments =
            this.pendingAttachments.length > 0
                ? [...this.pendingAttachments]
                : undefined;
        this.pendingAttachments = [];
        this.clearAttachmentPreview();

        const requestId = generateRequestId();
        this.addUserMessage(text, requestId);
        this.onSend?.(text, attachments, requestId);
    }

    /** Set the active request ID and show the stop button. */
    public setProcessing(requestId: string) {
        this.activeRequestId = requestId;
        this.sendButton.style.display = "none";
        this.stopButton.style.display = "";
    }

    /** Clear the active request and restore the send button. */
    public setIdle() {
        this.activeRequestId = undefined;
        this.stopButton.style.display = "none";
        this.sendButton.style.display = "";
    }

    /**
     * Display a user message bubble.
     *
     * If `requestId` is provided, the container is indexed so that later
     * `notifyExplained` / `updateGrammarResult` calls keyed by the same
     * id can attach decorations to this bubble. `send()` always supplies
     * one; external callers can omit it for fire-and-forget messages.
     */
    public addUserMessage(text: string, requestId?: string) {
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

        if (requestId !== undefined) {
            container.dataset.requestId = requestId;
            this.userMessageById.set(requestId, container);
        }

        // Reset current agent container for the new request
        this.currentAgentContainer = undefined;
    }

    /**
     * Replace the current agent message content (reuses existing container).
     * If no container exists, creates one.
     */
    public replaceAgentMessage(
        content: DisplayContent,
        source?: string,
        sourceIcon?: string,
    ) {
        if (this.statusContainer) {
            this.statusContainer.remove();
            this.statusContainer = undefined;
        }

        if (!this.currentAgentContainer) {
            this.currentAgentContainer = this.createAgentContainer(
                source ?? "assistant",
                sourceIcon ?? "🤖",
            );
        }
        this.currentAgentContainer.setMessage(content, source, undefined);
        this.scrollToBottom();
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
        // "temporary" mode = transient status (e.g. dispatcher's
        // "Executing action X" indicator). Route to a dedicated status
        // container so it doesn't stamp the main agent bubble with the
        // status emitter's source and doesn't linger after the real
        // response arrives.
        if (appendMode === "temporary") {
            if (this.statusContainer) {
                this.statusContainer.remove();
            }
            this.statusContainer = this.createAgentContainer(
                source ?? "",
                sourceIcon ?? "",
            );
            this.statusContainer.setMessage(content, source, undefined);
            this.scrollToBottom();
            return;
        }

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
            // Apply any action metadata that arrived via setDisplayInfo
            // before the first render — the dispatcher fires it before
            // the agent's first setDisplay/appendDisplay.
            if (this.pendingDisplayInfo?.action !== undefined) {
                this.currentAgentContainer.setActionData(
                    this.pendingDisplayInfo.action,
                );
            }
            this.pendingDisplayInfo = undefined;
        }

        this.currentAgentContainer.setMessage(content, source, appendMode);

        this.scrollToBottom();
    }

    /** Update the source/agent label on the current agent message. */
    public setDisplayInfo(
        source: string,
        sourceIcon?: string,
        action?: unknown,
    ) {
        if (this.currentAgentContainer) {
            this.currentAgentContainer.updateSource(source, sourceIcon);
            if (action !== undefined) {
                this.currentAgentContainer.setActionData(action);
            }
            return;
        }
        // No container yet — stash so the next one gets the action JSON
        // attached (the dispatcher fires setDisplayInfo before the
        // agent's first setDisplay/appendDisplay).
        this.pendingDisplayInfo = { source, sourceIcon, action };
    }

    /** Clear all messages. */
    public clear() {
        while (this.messageDiv.children.length > 1) {
            this.messageDiv.removeChild(this.messageDiv.lastChild!);
        }
        this.currentAgentContainer = undefined;
        this.userMessageById.clear();
    }

    /**
     * Attach the explainer roadrunner icon + tooltip to the user-message
     * bubble for `requestId`. Called when the dispatcher emits its
     * "explained" notification. Mirrors the shell's
     * MessageContainer.notifyExplained.
     */
    public notifyExplained(requestId: string, data: NotifyExplainedData) {
        const container = this.userMessageById.get(requestId);
        if (!container) return;

        const cachePart = data.fromCache
            ? `Translated by ${data.fromCache}`
            : "Translated by model";
        let message: string;
        let color: string;
        if (data.error === undefined) {
            message = `${cachePart}. Explained at ${data.time}`;
            color = data.fromCache ? "#00c000" : "#c0c000";
        } else {
            message = `${cachePart}. Nothing to put in cache: ${data.error}`;
            color = "lightblue";
        }

        // Replace any prior icon (re-explain on reconnect, etc.)
        container
            .querySelectorAll(".chat-message-explained-icon")
            .forEach((n) => n.remove());
        container.classList.add("chat-message-explained");
        container.setAttribute("data-expl", message);
        container.appendChild(iconRoadrunner(color));
    }

    /**
     * Update the roadrunner color and tooltip on the "grammarRule" follow-up
     * notification. If a rule wasn't cached, recolors the icon and extends
     * the tooltip; succeeded rules leave the icon as-is. Mirrors the shell's
     * MessageContainer.updateGrammarResult.
     */
    public updateGrammarResult(
        requestId: string,
        success: boolean,
        message?: string,
    ) {
        if (success) return;
        const container = this.userMessageById.get(requestId);
        if (!container) return;
        const path = container.querySelector(
            ".chat-message-explained-icon svg path",
        ) as SVGPathElement | null;
        if (path) path.setAttribute("fill", "cornflowerblue");
        if (message) {
            const existing = container.getAttribute("data-expl") ?? "";
            container.setAttribute(
                "data-expl",
                `${existing}. No fast-path cached (${message})`,
            );
        }
    }

    /**
     * Signal that the current request has finished. Mirrors the shell's
     * `statusMessage.complete()` hook — clears any lingering status /
     * dispatcher-temporary bubble regardless of the arrival order of the
     * agent's real response. If `result` is provided, finalize the
     * current agent bubble's hover-reveal metrics with overall duration
     * and token usage. Also resets the current agent container so the
     * next request starts a fresh bubble.
     */
    public completeRequest(result?: {
        actionPhase?: PhaseTiming;
        totalDuration?: number;
        tokenUsage?: CompletionUsageStats;
    }) {
        if (this.statusContainer) {
            this.statusContainer.remove();
            this.statusContainer = undefined;
        }
        if (result && this.currentAgentContainer) {
            this.currentAgentContainer.updateMetrics(
                "Action",
                result.actionPhase,
                result.totalDuration,
                result.tokenUsage,
            );
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

    /**
     * Show a Yes/No prompt and return the user's choice.
     */
    public askYesNo(message: string, defaultValue?: boolean): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const container = this.createAgentContainer("system", "");
            container.setMessage(
                { type: "text", content: message },
                undefined,
                undefined,
            );

            const buttonDiv = document.createElement("div");
            buttonDiv.className = "chat-prompt-buttons";

            const yesBtn = document.createElement("button");
            yesBtn.className = "chat-prompt-button chat-prompt-yes";
            yesBtn.textContent = "Yes";

            const noBtn = document.createElement("button");
            noBtn.className = "chat-prompt-button chat-prompt-no";
            noBtn.textContent = "No";

            const cleanup = () => {
                buttonDiv.remove();
                document.removeEventListener("keydown", keyHandler);
            };

            const keyHandler = (e: KeyboardEvent) => {
                if (e.key === "Enter") {
                    cleanup();
                    resolve(true);
                } else if (e.key === "Escape" || e.key === "Delete") {
                    cleanup();
                    resolve(false);
                }
            };

            yesBtn.addEventListener("click", () => {
                cleanup();
                resolve(true);
            });
            noBtn.addEventListener("click", () => {
                cleanup();
                resolve(false);
            });

            document.addEventListener("keydown", keyHandler);

            buttonDiv.appendChild(yesBtn);
            buttonDiv.appendChild(noBtn);

            // Append buttons after the message in the same container
            container.appendElement(buttonDiv);
            this.scrollToBottom();
        });
    }

    /**
     * Show an action proposal with Accept/Cancel buttons.
     * Returns true to accept, false to cancel.
     */
    public proposeAction(actionText: string, source: string): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const container = this.createAgentContainer(source, "");
            container.setMessage(
                { type: "text", content: `Proposed action:\n${actionText}` },
                source,
                undefined,
            );

            const buttonDiv = document.createElement("div");
            buttonDiv.className = "chat-prompt-buttons";

            const acceptBtn = document.createElement("button");
            acceptBtn.className = "chat-prompt-button chat-prompt-yes";
            acceptBtn.textContent = "Accept";

            const cancelBtn = document.createElement("button");
            cancelBtn.className = "chat-prompt-button chat-prompt-no";
            cancelBtn.textContent = "Cancel";

            const cleanup = () => {
                buttonDiv.remove();
                document.removeEventListener("keydown", keyHandler);
            };

            const keyHandler = (e: KeyboardEvent) => {
                if (e.key === "Enter") {
                    cleanup();
                    resolve(true);
                } else if (e.key === "Escape") {
                    cleanup();
                    resolve(false);
                }
            };

            acceptBtn.addEventListener("click", () => {
                cleanup();
                resolve(true);
            });
            cancelBtn.addEventListener("click", () => {
                cleanup();
                resolve(false);
            });

            document.addEventListener("keydown", keyHandler);

            buttonDiv.appendChild(acceptBtn);
            buttonDiv.appendChild(cancelBtn);

            container.appendElement(buttonDiv);
            this.scrollToBottom();
        });
    }

    /**
     * Register a dynamic display for periodic refresh.
     * The agent calls this to indicate content at displayId should be
     * refreshed after nextRefreshMs milliseconds.
     */
    public setDynamicDisplay(
        source: string,
        displayId: string,
        nextRefreshMs: number,
    ) {
        if (!this.getDynamicDisplay) return;
        const MIN_INTERVAL = 500;
        this.dynamicDisplays.push({
            source,
            displayId,
            nextRefreshTime: Date.now() + Math.max(nextRefreshMs, MIN_INTERVAL),
        });
        this.scheduleDynamicRefresh();
    }

    private scheduleDynamicRefresh() {
        if (this.dynamicDisplays.length === 0) return;
        this.dynamicDisplays.sort(
            (a, b) => a.nextRefreshTime - b.nextRefreshTime,
        );
        const delay = Math.max(
            0,
            this.dynamicDisplays[0].nextRefreshTime - Date.now(),
        );
        if (this.dynamicTimer) clearTimeout(this.dynamicTimer);
        this.dynamicTimer = setTimeout(() => {
            this.dynamicTimer = undefined;
            this.refreshDynamicDisplays();
        }, delay);
    }

    private async refreshDynamicDisplays() {
        const now = Date.now();
        while (
            this.dynamicDisplays.length > 0 &&
            this.dynamicDisplays[0].nextRefreshTime <= now
        ) {
            const item = this.dynamicDisplays.shift()!;
            try {
                const result = await this.getDynamicDisplay!(
                    item.source,
                    item.displayId,
                );

                // Reuse the same container so refreshes replace content
                const key = `${item.source}:${item.displayId}`;
                let container = this.dynamicContainers.get(key);
                if (!container) {
                    container = this.createAgentContainer(item.source, "🌐");
                    this.dynamicContainers.set(key, container);
                }
                // Replace content (no append mode = replace)
                container.setMessage(result.content, item.source, undefined);
                this.scrollToBottom();

                if (result.nextRefreshMs > 0) {
                    this.dynamicDisplays.push({
                        source: item.source,
                        displayId: item.displayId,
                        nextRefreshTime:
                            Date.now() + Math.max(result.nextRefreshMs, 500),
                    });
                } else {
                    // Display is done — remove from tracking
                    this.dynamicContainers.delete(key);
                }
            } catch {
                // Refresh failed — don't re-register
            }
        }
        this.scheduleDynamicRefresh();
    }

    /** Focus the text input. */
    public focus() {
        this.textInput.focus();
    }

    /** Programmatically inject and send a command.
     *  @param displayText Optional friendly text shown in the user bubble instead of the raw command.
     */
    public injectCommand(command: string, displayText?: string) {
        this.commandHistory.unshift(command);
        this.historyIndex = -1;
        const requestId = generateRequestId();
        this.addUserMessage(displayText ?? command, requestId);
        this.onSend?.(command, undefined, requestId);
    }

    /** Add a separator for previous session history. */
    public addHistorySeparator(label: string = "previously") {
        const sentinel = this.messageDiv.firstElementChild!;
        const sep = document.createElement("div");
        sep.className = "chat-history-separator";
        sep.textContent = label;
        sentinel.before(sep);
    }

    /** Add a dimmed history user message. */
    public addHistoryUserMessage(text: string) {
        const sentinel = this.messageDiv.firstElementChild!;
        const container = document.createElement("div");
        container.className =
            "chat-message-container-user chat-history-message";

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
    }

    /** Add a dimmed history agent message. */
    public addHistoryAgentMessage(
        content: DisplayContent,
        source?: string,
        sourceIcon?: string,
        appendMode?: DisplayAppendMode,
    ) {
        if (!this.historyAgentContainer || !appendMode) {
            const sentinel = this.messageDiv.firstElementChild!;
            this.historyAgentContainer = new AgentMessageContainer(
                sentinel,
                source ?? "assistant",
                sourceIcon ?? "🤖",
                this.settingsView,
                this.platformAdapter,
            );
            this.historyAgentContainer.setHistoryStyle();
        }
        this.historyAgentContainer.setMessage(content, source, appendMode);
    }

    /** Reset the history agent container (call between separate history entries). */
    public resetHistoryAgent() {
        this.historyAgentContainer = undefined;
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

    /**
     * Add follow-up action buttons below the current agent message.
     * Each button injects the specified command into the chat when clicked.
     */
    public addFollowUpButtons(
        buttons: { label: string; command: string; displayText?: string }[],
    ) {
        if (!this.currentAgentContainer || buttons.length === 0) return;

        const buttonDiv = document.createElement("div");
        buttonDiv.className = "chat-followup-buttons";

        for (const btn of buttons) {
            const el = document.createElement("button");
            el.className = "chat-followup-button";
            el.textContent = btn.label;
            el.addEventListener("click", () => {
                buttonDiv.remove();
                this.injectCommand(btn.command, btn.displayText ?? btn.label);
            });
            buttonDiv.appendChild(el);
        }

        this.currentAgentContainer.appendElement(buttonDiv);
        this.scrollToBottom();
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
    private readonly metricsDiv: HTMLDivElement;
    private readonly nameSpan: HTMLSpanElement;
    private readonly iconDiv: HTMLDivElement;
    private lastAppendMode?: DisplayAppendMode;
    // Mirrors the shell's swapContent pattern: when action JSON is set,
    // clicking the agent name toggles the message body between the
    // rendered response and a <pre> of the action JSON.
    private actionDataHtml?: string;
    private savedMessageHtml?: string;

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
        // Clicking the agent name toggles the message body between the
        // rendered response and the action JSON (when action data is
        // attached). Stop propagation so the outer timestamp handler
        // doesn't also fire.
        this.nameSpan.addEventListener("click", (ev) => {
            if (this.actionDataHtml === undefined) return;
            ev.stopPropagation();
            this.toggleActionData();
        });
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
        bodyDiv.className = "chat-message-body-hide-metrics chat-message-agent";

        this.messageDiv = document.createElement("div");
        this.messageDiv.className = "chat-message-content";
        bodyDiv.appendChild(this.messageDiv);

        // Collapsible action details (hidden by default)
        this.detailsDiv = document.createElement("div");
        this.detailsDiv.className = "chat-message-details";
        bodyDiv.appendChild(this.detailsDiv);

        // Metrics strip (hidden by default, revealed on hover via CSS).
        // Starts empty so the hover area collapses to zero height until
        // updateMetrics() populates it.
        this.metricsDiv = document.createElement("div");
        this.metricsDiv.className = "chat-message-metrics chat-message-metrics-agent";
        bodyDiv.appendChild(this.metricsDiv);

        this.div.appendChild(bodyDiv);

        // Insert into DOM (column-reverse order)
        beforeElement.before(this.div);
    }

    public updateMetrics(
        actionLabel: string,
        phase?: PhaseTiming,
        totalDuration?: number,
        tokenUsage?: CompletionUsageStats,
    ) {
        const lines: string[] = [];
        if (phase?.duration !== undefined) {
            lines.push(metricsLine(`${actionLabel} Elapsed`, phase.duration));
        }
        if (totalDuration !== undefined) {
            lines.push(metricsLine("Total Elapsed", totalDuration));
        }
        if (tokenUsage) {
            lines.push(
                `Tokens: <b>${tokenUsage.total_tokens}</b> ` +
                    `(prompt ${tokenUsage.prompt_tokens}, ` +
                    `completion ${tokenUsage.completion_tokens})`,
            );
        }
        this.metricsDiv.innerHTML = lines.join("<br>");
    }

    /**
     * Attach an action JSON payload to this bubble. Makes the agent
     * name clickable; each click toggles the message body between the
     * rendered response and a pretty-printed JSON view.
     */
    public setActionData(action: unknown) {
        if (action === undefined || action === null) return;
        let html: string;
        if (Array.isArray(action)) {
            html = `<pre>${escapeHtml(action.join(" "))}</pre>`;
        } else if (typeof action === "object") {
            html = `<pre>${escapeHtml(
                JSON.stringify(action, undefined, 2),
            )}</pre>`;
        } else {
            html = `<pre>${escapeHtml(String(action))}</pre>`;
        }
        this.actionDataHtml = html;
        this.nameSpan.classList.add("clickable");
        this.nameSpan.title = "Click to show action JSON";
    }

    private toggleActionData() {
        if (this.actionDataHtml === undefined) return;
        if (this.savedMessageHtml === undefined) {
            this.savedMessageHtml = this.messageDiv.innerHTML;
            this.messageDiv.innerHTML = this.actionDataHtml;
            this.messageDiv.classList.add("chat-message-action-data");
        } else {
            this.messageDiv.innerHTML = this.savedMessageHtml;
            this.savedMessageHtml = undefined;
            this.messageDiv.classList.remove("chat-message-action-data");
        }
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

    /** Mark this container as a dimmed history message. */
    public setHistoryStyle() {
        this.div.classList.add("chat-history-message");
    }

    /** Append a raw DOM element to the message body. */
    public appendElement(element: HTMLElement) {
        this.messageDiv.appendChild(element);
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
        } else if (
            !Array.isArray(content) &&
            typeof content.content === "string"
        ) {
            text = content.content;
        } else if (
            !Array.isArray(content) &&
            Array.isArray(content.content) &&
            content.content.length > 0 &&
            typeof content.content[0] === "string"
        ) {
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
            if (
                t === "[" ||
                t === "{" ||
                t.startsWith("[{") ||
                t.startsWith('{"')
            ) {
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
