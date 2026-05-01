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
import {
    PartialCompletion,
    type PcCompletionState,
    type PcPost,
} from "./partialCompletion.js";

/**
 * Default per-agent emoji map used when a host calls add/replaceAgentMessage
 * without an explicit `sourceIcon`. Sourced from the manifest emojiChar values
 * in ts/packages/agents/* /src/*Manifest.json. Hosts can extend or override
 * via `ChatPanel.setAvatarMap`.
 */
export const DEFAULT_AVATAR_MAP: Readonly<Record<string, string>> = {
    androidmobile: "📱",
    browser: "🌐",
    calendar: "📅",
    chat: "💬",
    code: "⚛️",
    desktop: "🪟",
    dispatcher: "🤖",
    email: "📩",
    "github-cli": "🐙",
    greeting: "🖐️",
    image: "🖼️",
    list: "📝",
    localplayer: "🎵",
    markdown: "🗎",
    montage: "🎞",
    music: "🎵",
    onboarding: "🛠️",
    photo: "📷",
    player: "🎧",
    scriptflow: "🔁",
    settings: "⚙️",
    shell: "🐚",
    spelunker: "⛏",
    system: "⚙",
    taskflow: "📜",
    test: "➕",
    turtle: "🐢",
    utility: "🔧",
    video: "📹",
    weather: "⛅",
    word: "📄",
};

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
    marks?: Record<string, { duration: number; count: number }>;
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

/**
 * One entry in a session history transcript replayed via
 * `ChatPanel.replayHistory`. Discriminated by `kind`. Hosts construct
 * these from whatever persisted format they use (file, IndexedDB,
 * VS Code globalState, etc.) and hand them to the panel.
 */
export type HistoryEntry =
    | { kind: "user"; text: string; requestId?: string; timestamp?: string }
    | {
          kind: "agent-replace";
          content: DisplayContent;
          source?: string;
          sourceIcon?: string;
          requestId?: string;
          timestamp?: string;
      }
    | {
          kind: "agent-append";
          content: DisplayContent;
          source?: string;
          sourceIcon?: string;
          mode?: DisplayAppendMode;
          requestId?: string;
          timestamp?: string;
      }
    | {
          kind: "display-info";
          source: string;
          sourceIcon?: string;
          action?: unknown;
          requestId?: string;
      }
    | {
          kind: "command-result";
          requestId?: string;
          actionPhase?: PhaseTiming;
          totalDuration?: number;
          tokenUsage?: CompletionUsageStats;
          parsePhase?: PhaseTiming;
          firstMessageMs?: number;
      }
    | { kind: "system"; text: string };

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

// Lightweight JSON syntax highlighter — returns HTML with span wrappers
// around tokens. Operates on the raw JSON.stringify output (so the
// regex can match `"`), then escapes <,>,& in each segment. Token
// classes: json-key, json-string, json-number, json-bool, json-null.
// Avoids pulling in highlight.js / Prism just to colorize the action
// JSON popup.
function highlightJson(json: string): string {
    const escapeText = (s: string): string =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return json.replace(
        /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(\b(?:true|false)\b)|(\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
        (
            _m,
            key?: string,
            str?: string,
            bool?: string,
            nul?: string,
            num?: string,
        ): string => {
            if (key)
                return `<span class="json-key">${escapeText(key)}</span>`;
            if (str)
                return `<span class="json-string">${escapeText(str)}</span>`;
            if (bool)
                return `<span class="json-bool">${escapeText(bool)}</span>`;
            if (nul)
                return `<span class="json-null">${escapeText(nul)}</span>`;
            if (num)
                return `<span class="json-number">${escapeText(num)}</span>`;
            return escapeText(_m);
        },
    );
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

/**
 * Wire the hover-push behavior onto a chat bubble's body element.
 *
 * When the user hovers a bubble that has populated metrics (signaled by
 * the `chat-message-has-metrics` class on `containerDiv`), the metrics
 * tooltip overlay reveals via CSS — but it would otherwise cover the
 * next bubble. To make room, we translate every DOM-earlier sibling
 * (= visually-lower bubble in the column-reverse `.chat` layout) DOWN
 * by the actual measured overlay height.
 *
 * We use the individual `translate` CSS property (not `transform`) so
 * the translation isn't clobbered by the container's appearance
 * `animation: message ... forwards` which locks `transform: scale(1)`.
 * Per CSS Transforms Level 2, `translate` composes independently.
 */
function attachHoverPush(
    bodyDiv: HTMLElement,
    containerDiv: HTMLElement,
    metricsDiv: HTMLElement,
) {
    bodyDiv.addEventListener("mouseenter", () => {
        if (!containerDiv.classList.contains("chat-message-has-metrics")) {
            return;
        }
        // Measure on demand — wrap heights vary per bubble.
        metricsDiv.style.visibility = "hidden";
        metricsDiv.style.display = "block";
        const overlayH = metricsDiv.offsetHeight;
        metricsDiv.style.display = "";
        metricsDiv.style.visibility = "";
        const offset = `${overlayH + 4}px`;
        const hasEarlier = containerDiv.previousElementSibling !== null;
        if (hasEarlier) {
            // Normal case: hovered bubble is NOT the bottommost. Push
            // visually-lower (DOM-earlier) bubbles DOWN to make room
            // for the overlay rendered below this bubble.
            let sibling: Element | null =
                containerDiv.previousElementSibling;
            while (sibling) {
                (sibling as HTMLElement).style.translate = `0 ${offset}`;
                (sibling as HTMLElement).style.transition =
                    "translate 0.15s ease-out";
                sibling = sibling.previousElementSibling;
            }
        } else {
            // Bottommost bubble: there's nothing visually below it to
            // push down, AND the overlay would be clipped by the input
            // area. Slide the bubble itself (plus all visually-higher
            // = DOM-later siblings) UP by the overlay height so the
            // overlay renders above the input. We translate all of
            // them together so the chat's vertical stacking stays
            // intact.
            (containerDiv as HTMLElement).style.translate = `0 -${offset}`;
            (containerDiv as HTMLElement).style.transition =
                "translate 0.15s ease-out";
            let sibling: Element | null = containerDiv.nextElementSibling;
            while (sibling) {
                (sibling as HTMLElement).style.translate = `0 -${offset}`;
                (sibling as HTMLElement).style.transition =
                    "translate 0.15s ease-out";
                sibling = sibling.nextElementSibling;
            }
        }
    });
    bodyDiv.addEventListener("mouseleave", () => {
        (containerDiv as HTMLElement).style.translate = "";
        let sibling: Element | null = containerDiv.previousElementSibling;
        while (sibling) {
            (sibling as HTMLElement).style.translate = "";
            sibling = sibling.previousElementSibling;
        }
        sibling = containerDiv.nextElementSibling;
        while (sibling) {
            (sibling as HTMLElement).style.translate = "";
            sibling = sibling.nextElementSibling;
        }
    });
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
     * generated by the panel (or supplied by the host via
     * `typeAndSend(text, requestId)`) — pass it through to the dispatcher
     * (e.g. as `processCommand`'s `clientRequestId`) so subsequent calls
     * (`notifyExplained` / `updateGrammarResult` / metrics) can target
     * the same user-message bubble.
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
    /**
     * Per-requestId agent bubble lookup. Populated when add/replaceAgentMessage
     * is called with a requestId. Allows out-of-order or concurrent flows to
     * route follow-up content to the correct bubble (instead of always
     * appending to the most recent one).
     */
    private agentContainersByRequestId = new Map<
        string,
        AgentMessageContainer
    >();
    private pendingDisplayInfo:
        | { source: string; sourceIcon?: string; action?: unknown }
        | undefined;
    private commandHistory: string[] = [];
    private historyIndex = -1;
    /** Local user's display name + initial used in user-bubble headers. */
    private userName = "You";
    private userInitial = "U";
    /**
     * Optional host-driven command-completion controller. Mounted by
     * attachCompletion(); pcState messages are forwarded via applyPcState().
     */
    private partialCompletion: PartialCompletion | undefined;
    private activeRequestId?: string;
    private isSwitching = false;
    private isHistoryLoading = false;
    private isDemoPaused = false;
    private isDemoRunning = false;
    private inputHint?: string;
    private demoKeyHandler?: (e: KeyboardEvent) => void;
    private avatarMap: Record<string, string> = { ...DEFAULT_AVATAR_MAP };

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

    // Timestamp (ms since epoch) when the user sent each requestId. Used
    // to compute the "First Message" elapsed time when the agent's first
    // bubble for that request is created. Cleared on completeRequest().
    private requestStartByRequestId = new Map<string, number>();
    // Elapsed ms from request send to first agent message for each
    // requestId (populated when the first agent bubble appears).
    private firstMessageMsByRequestId = new Map<string, number>();
    // Disables the requestStart/firstMessage timestamp capture during
    // history replay (those timestamps would reflect replay speed, not
    // the original interaction).
    private suppressFirstMessageTracking = false;

    public onSend?: (
        text: string,
        attachments: string[] | undefined,
        requestId: string,
    ) => void;
    public onCancel?: (requestId: string) => void;
    /**
     * Fired when the user presses Ctrl/Meta+→ ("continue") or Esc
     * ("cancel") while a demo script is paused. Hosts wire this to
     * their own demo-runner to advance or abort the script. The panel
     * owns the keystroke capture so the input field doesn't swallow it.
     */
    public onDemoAction?: (action: "continue" | "cancel") => void;
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
        // The contentEditable .user-textarea has display:inline and
        // min-width:1px, so when empty its native click target is a
        // 1px stripe at the top-left of the wrapper. Clicking
        // elsewhere in the wrapper would land on the flex container
        // and never focus the input — leaving no caret. Forward those
        // clicks to focus the input and place the caret at the end.
        textWrapper.addEventListener("mousedown", (event) => {
            const target = event.target as Node | null;
            if (target === this.textInput) return;
            if (target && this.textInput.contains(target)) return;
            event.preventDefault();
            this.textInput.focus();
            const range = document.createRange();
            range.selectNodeContents(this.textInput);
            range.collapse(false);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        });

        this.inputArea.appendChild(textWrapper);
        this.inputArea.appendChild(this.sendButton);
        this.inputArea.appendChild(this.stopButton);

        wrapper.appendChild(this.inputArea);
        rootElement.appendChild(wrapper);

        this.setupInputHandlers();
    }

    private setupInputHandlers() {
        this.textInput.addEventListener("keydown", (e) => {
            // Give the partial-completion (host-driven) controller first
            // crack at the keystroke so its Tab/Enter/Esc/Arrow handling
            // wins over chat-ui's local completions and history nav.
            if (this.partialCompletion?.handleKeyDownPreSend(e)) {
                return;
            }
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
            this.applyInputHint();
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

    private send(requestId?: string) {
        const text = this.textInput.textContent?.trim();
        if (!text) return;

        this.commandHistory.unshift(text);
        this.historyIndex = -1;
        this.textInput.textContent = "";
        this.sendButton.disabled = true;
        // Tell the host-driven completion controller that the input has
        // been consumed so the next typed char registers as forward.
        this.partialCompletion?.reset();

        const attachments =
            this.pendingAttachments.length > 0
                ? [...this.pendingAttachments]
                : undefined;
        this.pendingAttachments = [];
        this.clearAttachmentPreview();

        const id = requestId ?? generateRequestId();
        this.addUserMessage(text, id);
        // Toggle input controls into "processing" state — swaps the
        // send button for the stop button so the user can cancel an
        // in-flight command. setIdle() is invoked by the host on
        // commandComplete.
        this.setProcessing(id);
        this.onSend?.(text, attachments, id);
    }

    /**
     * Programmatically type `text` into the input character-by-character
     * (25-40ms per char, matching the Electron shell's expandableTextArea)
     * and submit it via the same path as a manual Enter press, using the
     * supplied `requestId` so the user bubble and the host's command share
     * the same id.
     *
     * Used by demo replay drivers to produce a natural typing animation
     * instead of an instant paste-and-send.
     *
     * Resolves once the message has been submitted (after onSend fires).
     */
    public async typeAndSend(text: string, requestId: string): Promise<void> {
        // Wait for any in-flight disable (e.g., session loading) to clear.
        for (
            let i = 0;
            this.textInput.contentEditable !== "true" && i < 50;
            i++
        ) {
            await new Promise((r) => setTimeout(r, 100));
        }
        this.textInput.focus();
        this.textInput.textContent = "";
        // Block manual input while we animate so a keystroke (e.g. Esc to
        // cancel a demo) doesn't clobber the in-flight typed text. The
        // demo orchestrator owns the input during this window.
        const wasEditable = this.textInput.contentEditable;
        this.textInput.contentEditable = "false";
        try {
            for (let i = 0; i < text.length; i++) {
                this.textInput.textContent =
                    (this.textInput.textContent ?? "") + text[i];
                // 25-40ms per char (random within range), matches Electron shell.
                const delay = 25 + Math.floor(Math.random() * 15);
                await new Promise((r) => setTimeout(r, delay));
            }
        } finally {
            this.textInput.contentEditable = wasEditable;
        }
        // Defer to send() so all bookkeeping (command history, attachments,
        // user-bubble creation, sendButton/ghost reset) stays in one place.
        this.send(requestId);
    }

    /**
     * Toggle "demo running" mode. While running, the input ghost-hint
     * shown via `setInputHint` is preserved across input events so the
     * Ctrl+→/Esc reminder stays visible at the pause point.
     */
    public setDemoRunning(running: boolean): void {
        this.isDemoRunning = running;
        this.refreshDemoKeyHandler();
        if (!running) {
            this.setInputHint(undefined);
        }
    }

    /**
     * Show a host-supplied hint string in the input box's ghost span
     * when the textbox is empty. Used to display "Ctrl+→ continue ·
     * Esc cancel" while the demo is paused. Pass `undefined` to clear.
     */
    public setInputHint(hint: string | undefined): void {
        this.inputHint = hint;
        this.applyInputHint();
    }

    private applyInputHint(): void {
        // The hint shares the ghost span with completion previews. Show
        // it only when the input is empty AND no completion suggestion
        // is currently rendered (completion text takes precedence).
        const hasText = (this.textInput.textContent ?? "").length > 0;
        const hasCompletionGhost =
            this.completions.length > 0 ||
            (this.partialCompletion !== undefined &&
                this.ghostSpan.textContent !== this.inputHint &&
                (this.ghostSpan.textContent ?? "").length > 0);
        if (this.inputHint && !hasText && !hasCompletionGhost) {
            this.ghostSpan.textContent = this.inputHint;
        } else if (this.ghostSpan.textContent === this.inputHint) {
            // Clear stale hint without disturbing a completion preview.
            this.ghostSpan.textContent = "";
        }
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
     * `requestId` is stamped on the container as `data-request-id` so later
     * targeting (metrics, explained overlays, peer updates) can find it.
     * The container is also indexed in `userMessageById` so subsequent
     * `notifyExplained` / `updateGrammarResult` calls keyed by the same id
     * can attach decorations to this bubble. `send()` always supplies one;
     * external callers can omit it for fire-and-forget messages.
     */
    public addUserMessage(text: string, requestId?: string) {
        const sentinel = this.messageDiv.firstElementChild!;
        const container = document.createElement("div");
        container.className = "chat-message-container-user";
        container.dataset.requestId = requestId ?? generateRequestId();
        // A new user request invalidates the previous "current" agent bubble so
        // a follow-up addAgentMessage with no requestId starts a fresh one.
        this.currentAgentContainer = undefined;

        const timestamp = this.createTimestamp("user", this.userName);
        container.appendChild(timestamp);

        const iconDiv = document.createElement("div");
        iconDiv.className = "user-icon";
        iconDiv.textContent = this.userInitial;
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

        // Empty user-side metrics strip — populated later by
        // applyUserMetrics() when the dispatcher reports `metrics.parse`.
        const userMetricsDiv = document.createElement("div");
        userMetricsDiv.className = "chat-message-metrics chat-message-metrics-user";
        bodyDiv.appendChild(userMetricsDiv);

        container.appendChild(bodyDiv);

        attachHoverPush(bodyDiv, container, userMetricsDiv);

        sentinel.before(container);
        this.scrollToBottom();

        const id = container.dataset.requestId!;
        this.userMessageById.set(id, container);
        if (!this.suppressFirstMessageTracking) {
            this.requestStartByRequestId.set(id, Date.now());
        }
    }

    /**
     * Stamp a metrics tooltip (hover-revealed) onto the user bubble.
     * Used to display the dispatcher's `metrics.parse` (Translation) timing
     * on the user side of the conversation.
     */
    public applyUserMetrics(
        requestId: string,
        label: string,
        phase?: PhaseTiming,
        totalDuration?: number,
    ) {
        const container = this.userMessageById.get(requestId);
        // Note: do NOT bail when phase has no duration — chat-only requests
        // sometimes return a parse PhaseTiming with marks but no duration,
        // and we still want to render those marks. We bail only if there
        // is genuinely nothing to show.
        const hasContent =
            (phase?.duration !== undefined && phase.duration !== null) ||
            (phase?.marks && Object.keys(phase.marks).length > 0) ||
            totalDuration !== undefined;
        // eslint-disable-next-line no-console
        console.debug(
            "[chat-ui] applyUserMetrics",
            requestId,
            "found?",
            !!container,
            "hasContent?",
            hasContent,
            "phase=",
            phase,
        );
        if (!container || !hasContent) return;
        const metricsDiv = container.querySelector(
            ".chat-message-metrics-user",
        ) as HTMLElement | null;
        if (!metricsDiv) return;
        const mainLines: string[] = [];
        if (phase?.duration !== undefined) {
            mainLines.push(metricsLine(`${label} Elapsed`, phase.duration));
        }
        if (totalDuration !== undefined) {
            mainLines.push(metricsLine("Total Elapsed", totalDuration));
        }
        const markLines: string[] = [];
        if (phase?.marks) {
            for (const [key, value] of Object.entries(phase.marks)) {
                const avg = value.duration / Math.max(value.count, 1);
                const suffix =
                    value.count !== 1 ? `(out of ${value.count})` : "";
                markLines.push(`${key}: <b>${formatDuration(avg)}${suffix}</b>`);
            }
        }
        metricsDiv.innerHTML =
            `<div class="metrics-details">` +
            `<div>${markLines.join("<br>")}</div>` +
            `<div></div>` +
            `<div>${mainLines.join("<br>")}</div>` +
            `</div>`;
        // Mark the container as having metrics so the hover-push handler
        // (attached in addUserMessage) actually fires for user bubbles.
        container.classList.add("chat-message-has-metrics");
    }

    /**
     * Replace the current agent message content (reuses existing container).
     * If no container exists, creates one.
     * If `requestId` is supplied, the per-request bubble is targeted; otherwise
     * the most recently created agent bubble is used.
     */
    public replaceAgentMessage(
        content: DisplayContent,
        source?: string,
        sourceIcon?: string,
        requestId?: string,
    ) {
        if (this.statusContainer) {
            this.statusContainer.remove();
            this.statusContainer = undefined;
        }

        const container = this.getOrCreateAgentContainer(
            source,
            sourceIcon,
            requestId,
        );
        container.setMessage(content, source, undefined);
        this.scrollToBottom();
    }

    /**
     * Display or append an agent message.
     * Call with appendMode to add to the current agent message.
     * If `requestId` is supplied, the per-request bubble is targeted; otherwise
     * the most recently created agent bubble is used.
     */
    public addAgentMessage(
        content: DisplayContent,
        source?: string,
        sourceIcon?: string,
        appendMode?: DisplayAppendMode,
        requestId?: string,
    ) {
        // "temporary" mode = transient status (e.g. dispatcher's
        // "Executing action X" indicator). Route to a dedicated status
        // container so it doesn't stamp the main agent bubble with the
        // status emitter's source and doesn't linger after the real
        // response arrives.
        if (appendMode === "temporary") {
            // Reuse the existing status container if present — recreating
            // it on every status update causes visible flicker when an
            // agent (e.g. reasoning) streams many sub-step messages
            // ("Tool: foo", "Tool: bar", ...) in rapid succession.
            if (!this.statusContainer) {
                this.statusContainer = this.createAgentContainer(
                    source ?? "",
                    sourceIcon ?? "",
                );
            }
            this.statusContainer.setMessage(content, source, undefined);
            this.scrollToBottom();
            return;
        }

        // Remove lingering status message when a real response arrives
        if (this.statusContainer) {
            this.statusContainer.remove();
            this.statusContainer = undefined;
        }

        const icon = sourceIcon ?? this.iconForSource(source);

        let container: AgentMessageContainer;
        if (requestId && this.agentContainersByRequestId.has(requestId)) {
            container = this.agentContainersByRequestId.get(requestId)!;
        } else if (!appendMode || !this.currentAgentContainer) {
            container = this.createAgentContainer(source ?? "assistant", icon);
            this.currentAgentContainer = container;
            if (requestId) {
                this.agentContainersByRequestId.set(requestId, container);
                // Capture the elapsed time from request send to first agent
                // bubble for this request — drives the "First Message"
                // metric line on the agent metrics tooltip.
                if (!this.firstMessageMsByRequestId.has(requestId)) {
                    const start = this.requestStartByRequestId.get(requestId);
                    if (start !== undefined) {
                        this.firstMessageMsByRequestId.set(
                            requestId,
                            Date.now() - start,
                        );
                    }
                }
            }
            // Apply any action metadata that arrived via setDisplayInfo
            // before the first render — the dispatcher fires it before
            // the agent's first setDisplay/appendDisplay.
            if (this.pendingDisplayInfo?.action !== undefined) {
                container.setActionData(this.pendingDisplayInfo.action);
            }
            this.pendingDisplayInfo = undefined;
        } else {
            container = this.currentAgentContainer;
        }

        container.setMessage(content, source, appendMode);

        this.scrollToBottom();
    }

    /**
     * Drop the bubble association for a completed request id. Future
     * add/replaceAgentMessage calls with this id will create a fresh bubble.
     * Called by hosts when a request completes; safe to call for unknown ids.
     */
    public clearRequest(requestId: string): void {
        this.agentContainersByRequestId.delete(requestId);
    }

    private getOrCreateAgentContainer(
        source: string | undefined,
        sourceIcon: string | undefined,
        requestId: string | undefined,
    ): AgentMessageContainer {
        if (requestId && this.agentContainersByRequestId.has(requestId)) {
            return this.agentContainersByRequestId.get(requestId)!;
        }
        if (!requestId && this.currentAgentContainer) {
            return this.currentAgentContainer;
        }
        const container = this.createAgentContainer(
            source ?? "assistant",
            sourceIcon ?? this.iconForSource(source),
        );
        this.currentAgentContainer = container;
        if (requestId) {
            this.agentContainersByRequestId.set(requestId, container);
            if (!this.firstMessageMsByRequestId.has(requestId)) {
                const start = this.requestStartByRequestId.get(requestId);
                if (start !== undefined) {
                    this.firstMessageMsByRequestId.set(
                        requestId,
                        Date.now() - start,
                    );
                }
            }
        }
        return container;
    }

    /**
     * Look up the avatar emoji/icon for a given agent source name. Falls back
     * to "🤖" if the source is unknown. Source names are matched
     * case-insensitively against the first dot-separated segment, so
     * "code.code-editor" looks up "code".
     */
    public iconForSource(source?: string): string {
        if (!source) return "🤖";
        const root = source.split(".")[0].toLowerCase();
        return this.avatarMap[root] ?? "🤖";
    }

    /**
     * Override or extend the per-source avatar map. Passed entries are merged
     * over DEFAULT_AVATAR_MAP. Pass an entry with value "" to suppress a
     * default mapping.
     */
    public setAvatarMap(map: Record<string, string>): void {
        this.avatarMap = { ...DEFAULT_AVATAR_MAP, ...map };
    }

    /**
     * Add a non-conversational system message styled distinctly from agent
     * messages (no avatar, no source label, no timestamp). Use for `@`-config
     * confirmations, session lifecycle events, and similar host notices.
     */
    public addSystemMessage(text: string): void {
        const sentinel = this.messageDiv.firstElementChild!;
        const el = document.createElement("div");
        el.className = "chat-message-system";
        el.textContent = text;
        sentinel.before(el);
        this.scrollToBottom();
    }

    /**
     * Atomically replay a list of past entries from a session history.
     * Each replayed DOM element is marked with the `.history` class so
     * hosts can style replayed turns differently (e.g. dimmed).
     *
     * Recognized entry kinds:
     * - `{ kind: "user", text, requestId?, timestamp? }`
     * - `{ kind: "agent-replace", content, source?, sourceIcon?, requestId?, timestamp? }`
     * - `{ kind: "agent-append", content, source?, sourceIcon?, mode?, requestId?, timestamp? }`
     * - `{ kind: "system", text }`
     *
     * Temporary append entries (`mode === "temporary"`) are skipped — they're
     * ephemeral status text from the original interaction and would otherwise
     * appear as orphan status lines in the replayed transcript.
     *
     * After replay, the per-request bubble map is cleared so future live
     * messages don't accidentally route into history bubbles.
     */
    public replayHistory(entries: HistoryEntry[]): void {
        if (!entries || entries.length === 0) return;

        const firstHistoryIdx = this.messageDiv.children.length;

        // Reset live state so replay starts fresh.
        this.currentAgentContainer = undefined;

        // Suppress first-message timing tracking during replay — those
        // timestamps would reflect the speed of replay, not the original
        // request-to-first-response time.
        this.suppressFirstMessageTracking = true;
        try {
            for (const entry of entries) {
            switch (entry.kind) {
                case "user":
                    this.addUserMessage(entry.text, entry.requestId);
                    break;
                case "agent-replace":
                    this.replaceAgentMessage(
                        entry.content,
                        entry.source,
                        entry.sourceIcon,
                        entry.requestId,
                    );
                    break;
                case "agent-append":
                    if (entry.mode === "temporary") break;
                    this.addAgentMessage(
                        entry.content,
                        entry.source,
                        entry.sourceIcon,
                        entry.mode,
                        entry.requestId,
                    );
                    break;
                case "system":
                    this.addSystemMessage(entry.text);
                    break;
                case "display-info":
                    this.setDisplayInfo(
                        entry.source,
                        entry.sourceIcon,
                        entry.action,
                        entry.requestId,
                    );
                    break;
                case "command-result":
                    if (entry.requestId) {
                        // Pre-seed the per-request firstMessageMs so the
                        // metrics tooltip can show "First Message" on
                        // history-replayed bubbles (live tracking is
                        // suppressed during replay).
                        if (entry.firstMessageMs !== undefined) {
                            this.firstMessageMsByRequestId.set(
                                entry.requestId,
                                entry.firstMessageMs,
                            );
                        }
                        this.completeRequest(entry.requestId, {
                            actionPhase: entry.actionPhase,
                            totalDuration: entry.totalDuration,
                            tokenUsage: entry.tokenUsage,
                            parsePhase: entry.parsePhase,
                        });
                    }
                    break;
            }
        }
        } finally {
            this.suppressFirstMessageTracking = false;
        }

        // Mark everything just appended as history. Iteration is over the
        // live NodeList so `children.length` reflects current count.
        for (
            let i = firstHistoryIdx;
            i < this.messageDiv.children.length;
            i++
        ) {
            this.messageDiv.children[i].classList.add("history");
        }

        // Reset state so the next live message starts a fresh bubble and
        // doesn't reuse a history bubble via the requestId map.
        this.currentAgentContainer = undefined;
        this.agentContainersByRequestId.clear();
        this.scrollToBottom();
    }

    /** Update the source/agent label on the current agent message. */
    public setDisplayInfo(
        source: string,
        sourceIcon?: string,
        action?: unknown,
        requestId?: string,
    ) {
        const target =
            (requestId && this.agentContainersByRequestId.get(requestId)) ||
            this.currentAgentContainer;
        if (target) {
            target.updateSource(source, sourceIcon);
            if (action !== undefined) {
                target.setActionData(action);
            }
            return;
        }
        // No container yet — stash so the next one gets the action JSON
        // attached (the dispatcher fires setDisplayInfo before the
        // agent's first setDisplay/appendDisplay).
        this.pendingDisplayInfo = { source, sourceIcon, action };
    }

    /** Returns true if a user-message bubble for `requestId` already exists. */
    public hasUserMessage(requestId: string): boolean {
        return this.userMessageById.has(requestId);
    }

    /** Clear all messages. */
    public clear() {
        // Wipe everything then re-create the sticky scroll-anchor
        // sentinel that the constructor installs as messageDiv's first
        // child. addUserMessage / replaceAgentMessage / showSeparator /
        // historyReplay all depend on `messageDiv.firstElementChild`
        // being that sentinel and call `sentinel.before(...)`; without
        // it they throw and the next command surfaces as a dispatcher
        // error in the UI.
        while (this.messageDiv.firstChild) {
            this.messageDiv.removeChild(this.messageDiv.firstChild);
        }
        const sentinel = document.createElement("div");
        sentinel.className = "chat-sentinel";
        this.messageDiv.appendChild(sentinel);
        this.currentAgentContainer = undefined;
        this.agentContainersByRequestId.clear();
        this.userMessageById.clear();
        this.requestStartByRequestId.clear();
        this.firstMessageMsByRequestId.clear();
        this.pendingDisplayInfo = undefined;
        if (this.statusContainer) {
            this.statusContainer.remove();
            this.statusContainer = undefined;
        }
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
     * agent's real response. If `result` is provided, finalize the target
     * agent bubble's hover-reveal metrics with overall duration and token
     * usage. If `requestId` is supplied, that bubble is finalized;
     * otherwise the most recently created bubble is used. Also resets the
     * current agent container so the next request starts a fresh bubble.
     */
    public completeRequest(
        requestId?: string,
        result?: {
            actionPhase?: PhaseTiming;
            totalDuration?: number;
            tokenUsage?: CompletionUsageStats;
            parsePhase?: PhaseTiming;
            cancelled?: boolean;
        },
    ) {
        if (this.statusContainer) {
            this.statusContainer.remove();
            this.statusContainer = undefined;
        }
        const target =
            (requestId && this.agentContainersByRequestId.get(requestId)) ||
            this.currentAgentContainer;
        const firstMessageMs =
            requestId !== undefined
                ? this.firstMessageMsByRequestId.get(requestId)
                : undefined;
        if (result?.cancelled) {
            // Mirror the Electron shell's "⚠ Cancelled" status line so the
            // user has visible confirmation that Stop / Esc cancelled the
            // in-flight command. If no agent bubble was created yet (cancel
            // landed before any agent output), spin up a minimal one so
            // the status is still visible.
            const cancelTarget =
                target ??
                this.createAgentContainer("shell", "");
            cancelTarget.setMessage(
                {
                    type: "text",
                    content: "⚠ Cancelled",
                    kind: "status",
                },
                "shell",
                "block",
            );
        }
        if (result && target) {
            target.updateMetrics(
                "Action",
                result.actionPhase,
                result.totalDuration,
                result.tokenUsage,
                firstMessageMs,
            );
        }
        if (result && requestId) {
            // Always attempt to populate user-side metrics. Even when the
            // request had no parse phase (e.g. cached translations or
            // chat-only paths), we still show the total elapsed so the
            // user bubble gets a metrics tooltip just like the agent's.
            this.applyUserMetrics(
                requestId,
                "Translation",
                result.parsePhase,
                result.totalDuration,
            );
        }
        if (requestId) {
            this.agentContainersByRequestId.delete(requestId);
            this.requestStartByRequestId.delete(requestId);
            this.firstMessageMsByRequestId.delete(requestId);
        }
        // If we just finalized the active bubble, reset it so the next
        // request starts fresh.
        if (!requestId || target === this.currentAgentContainer) {
            this.currentAgentContainer = undefined;
        }
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
     *  @param requestId Optional request id; one is generated if not supplied.
     */
    public injectCommand(
        command: string,
        displayText?: string,
        requestId?: string,
    ) {
        this.commandHistory.unshift(command);
        this.historyIndex = -1;
        const id = requestId ?? generateRequestId();
        this.addUserMessage(displayText ?? command, id);
        this.onSend?.(command, undefined, id);
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

    /**
     * Set the local user's display name (and optional initial). Used in the
     * user-bubble timestamp label and the round avatar to the right of the
     * bubble. Affects bubbles created AFTER this call; existing bubbles are
     * not retroactively updated. The initial defaults to the first
     * non-whitespace character of `name` (uppercased).
     */
    public setUserInfo(name: string, initial?: string) {
        const trimmed = (name ?? "").trim();
        if (trimmed.length > 0) {
            this.userName = trimmed;
        }
        if (initial !== undefined) {
            const trimmedInitial = initial.trim();
            if (trimmedInitial.length > 0) {
                this.userInitial = trimmedInitial.charAt(0).toUpperCase();
            }
        } else if (trimmed.length > 0) {
            this.userInitial = trimmed.charAt(0).toUpperCase();
        }
    }

    /**
     * Mount inline + dropdown command-completion driven by the host. The
     * `post` callback receives messages (`pcUpdate` / `pcAccept` /
     * `pcDismiss` / `pcHide` / `pcDispose`) which the host should forward
     * to its CompletionController. The host pushes state updates back via
     * `applyPcState(state)`.
     *
     * Returns the underlying PartialCompletion instance for callers that
     * need direct access (e.g. to call `reset()` on session change).
     * Re-attaching disposes the previous instance.
     */
    public attachCompletion(
        post: PcPost,
        opts?: { inline?: boolean },
    ): PartialCompletion {
        this.partialCompletion?.dispose();
        // The textInput is wrapped in `chat-input-text-wrapper`; mount the
        // toggle button on the wrapper so it sits flush with the input.
        const wrapper =
            (this.textInput.parentElement as HTMLElement | null) ??
            this.inputArea;
        this.partialCompletion = new PartialCompletion(
            wrapper,
            this.textInput,
            this.ghostSpan,
            post,
            opts,
        );
        return this.partialCompletion;
    }

    /** Forward a host-pushed completion state update to the controller. */
    public applyPcState(state: PcCompletionState | undefined) {
        this.partialCompletion?.applyState(state);
    }

    /** Enable or disable the input. */
    public setEnabled(enabled: boolean) {
        // setSwitching/setHistoryLoading take precedence: if either is active,
        // the host should not be able to re-enable the input until they clear.
        if (enabled && (this.isSwitching || this.isHistoryLoading)) {
            return;
        }
        this.textInput.contentEditable = enabled ? "true" : "false";
        this.sendButton.disabled = !enabled;
        if (enabled) {
            this.inputArea.classList.remove("chat-input-disabled");
        } else {
            this.inputArea.classList.add("chat-input-disabled");
        }
    }

    /**
     * Disable input and show a placeholder while a conversation switch is in
     * progress. Re-enables input on `setSwitching(false)` (unless history is
     * still loading).
     */
    public setSwitching(switching: boolean, targetName?: string) {
        this.isSwitching = switching;
        if (switching) {
            this.setEnabledInternal(false);
            const label = targetName
                ? `Switching to conversation "${targetName}"…`
                : "Switching conversation…";
            this.textInput.setAttribute("data-placeholder", label);
            this.inputArea.classList.add("chat-input-switching");
        } else {
            this.inputArea.classList.remove("chat-input-switching");
            if (!this.isHistoryLoading) {
                this.setEnabledInternal(true);
                this.textInput.setAttribute(
                    "data-placeholder",
                    "Type a message...",
                );
            }
        }
    }

    /**
     * Disable input and show a "Loading history…" placeholder until the host
     * finishes replaying past messages on (re)connect or session restore.
     * Re-enables input on `setHistoryLoading(false)` (unless a switch is
     * still in progress).
     */
    public setHistoryLoading(loading: boolean) {
        this.isHistoryLoading = loading;
        if (loading) {
            this.setEnabledInternal(false);
            this.textInput.setAttribute(
                "data-placeholder",
                "Loading history…",
            );
            this.inputArea.classList.add("chat-input-history-loading");
        } else {
            this.inputArea.classList.remove("chat-input-history-loading");
            if (!this.isSwitching) {
                this.setEnabledInternal(true);
                this.textInput.setAttribute(
                    "data-placeholder",
                    "Type a message...",
                );
            }
        }
    }

    /**
     * Toggle "demo paused" mode. While paused, the panel installs a
     * window-level capture-phase keydown listener that swallows
     * Ctrl/Meta+→ (continue) and Esc (cancel) before the focused input
     * field sees them, and forwards the action via `onDemoAction`.
     *
     * The host is responsible for any user-facing "Demo paused" indicator
     * (e.g., status ribbon suffix) — chat-ui no longer renders its own
     * banner so the host can integrate the state into its existing UI
     * without an extra component getting in the way.
     */
    public setDemoPaused(paused: boolean, _message?: string): void {
        this.isDemoPaused = paused;
        this.refreshDemoKeyHandler();
    }

    private refreshDemoKeyHandler(): void {
        const wantHandler = this.isDemoPaused || this.isDemoRunning;
        if (wantHandler && !this.demoKeyHandler) {
            this.demoKeyHandler = (e: KeyboardEvent) => {
                if (!this.isDemoPaused && !this.isDemoRunning) return;
                if (
                    e.key === "ArrowRight" &&
                    (e.ctrlKey || e.metaKey) &&
                    this.isDemoPaused
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.onDemoAction?.("continue");
                } else if (e.key === "Escape") {
                    // Esc cancels the demo whether it's currently
                    // paused at @pauseForInput or actively running a
                    // line. The host's requestDemoCancel() sets a
                    // sticky flag so the loop sees it on the next
                    // iteration even mid-line.
                    e.preventDefault();
                    e.stopPropagation();
                    this.onDemoAction?.("cancel");
                }
            };
            window.addEventListener("keydown", this.demoKeyHandler, true);
        } else if (!wantHandler && this.demoKeyHandler) {
            window.removeEventListener(
                "keydown",
                this.demoKeyHandler,
                true,
            );
            this.demoKeyHandler = undefined;
        }
    }

    /**
     * Internal enable/disable that bypasses the isSwitching/isHistoryLoading
     * guard in setEnabled. Used by setSwitching and setHistoryLoading
     * themselves to actually toggle input state.
     */
    private setEnabledInternal(enabled: boolean) {
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
    // When setActionData receives an action with schemaName/actionName,
    // we display "schema.action" as the bubble title instead of the raw
    // source agent name. setMessage's source-driven label-update is then
    // suppressed so the action label doesn't get clobbered by later
    // setDisplay calls.
    private actionDerivedName?: string;

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

        attachHoverPush(bodyDiv, this.div, this.metricsDiv);

        // Insert into DOM (column-reverse order)
        beforeElement.before(this.div);
    }

    public updateMetrics(
        actionLabel: string,
        phase?: PhaseTiming,
        totalDuration?: number,
        tokenUsage?: CompletionUsageStats,
        firstMessageMs?: number,
    ) {
        // Layout: .metrics-details flex row with three columns
        //   left   — "First Message" + phase.marks (one line each)
        //   middle — (reserved; tts metrics in the future)
        //   right  — main metrics (Action Elapsed / Total Elapsed / Tokens)
        // This mirrors the Electron shell's MessageContainer layout so the
        // tooltip reads as "marks on the left, totals on the right".
        const mainLines: string[] = [];
        if (phase?.duration !== undefined) {
            mainLines.push(metricsLine(`${actionLabel} Elapsed`, phase.duration));
        }
        if (totalDuration !== undefined) {
            mainLines.push(metricsLine("Total Elapsed", totalDuration));
        }
        if (tokenUsage) {
            // Compact form: "Tokens: 14356 (14257+99)" — the long
            // "(prompt N, completion M)" form overflowed the metrics
            // tooltip in narrow webview sidebars.
            mainLines.push(
                `Tokens: <b>${tokenUsage.total_tokens}</b> ` +
                    `(${tokenUsage.prompt_tokens}+${tokenUsage.completion_tokens})`,
            );
        }
        const leftLines: string[] = [];
        if (firstMessageMs !== undefined) {
            leftLines.push(metricsLine("First Message", firstMessageMs));
        }
        if (phase?.marks) {
            for (const [key, value] of Object.entries(phase.marks)) {
                const avg = value.duration / Math.max(value.count, 1);
                const suffix =
                    value.count !== 1 ? `(out of ${value.count})` : "";
                leftLines.push(`${key}: <b>${formatDuration(avg)}${suffix}</b>`);
            }
        }
        this.metricsDiv.innerHTML =
            `<div class="metrics-details">` +
            `<div>${leftLines.join("<br>")}</div>` +
            `<div></div>` +
            `<div>${mainLines.join("<br>")}</div>` +
            `</div>`;
        // Flag the container so the chat-level selector that pushes
        // visually-below bubbles down on hover can target it without
        // relying on a nested `:has()` chain (which proved unreliable in
        // some webview versions).
        if (leftLines.length > 0 || mainLines.length > 0) {
            this.div.classList.add("chat-message-has-metrics");
        } else {
            this.div.classList.remove("chat-message-has-metrics");
        }
    }

    /**
     * Attach an action JSON payload to this bubble. Makes the agent
     * name clickable; each click toggles the message body between the
     * rendered response and a pretty-printed JSON view.
     */
    public setActionData(action: unknown) {
        if (action === undefined || action === null) return;
        let html: string;
        let label: string | undefined;
        if (Array.isArray(action)) {
            // Skip arrays-of-primitives (e.g. dispatcher's ['request']
            // housekeeping events) and empty arrays — making the agent
            // name clickable here would produce a no-op popup.
            const objectEntries = action.filter(
                (v) => typeof v === "object" && v !== null,
            );
            if (objectEntries.length === 0) return;
            // Skip arrays whose objects are all empty `{}` — same
            // rationale (some agents emit `[{}]` placeholder events).
            if (
                objectEntries.every(
                    (v) => Object.keys(v as object).length === 0,
                )
            ) {
                return;
            }
            // Derive a label from the first object that carries a
            // schema/action name (matches Electron shell behavior).
            for (const entry of objectEntries) {
                const o = entry as {
                    schemaName?: unknown;
                    actionName?: unknown;
                };
                if (
                    typeof o.schemaName === "string" &&
                    typeof o.actionName === "string"
                ) {
                    label = `${o.schemaName}.${o.actionName}`;
                    break;
                }
            }
            html = `<pre class="chat-json">${highlightJson(
                JSON.stringify(action, undefined, 2),
            )}</pre>`;
        } else if (typeof action === "object") {
            // Skip empty objects — the popup would show only `{}` which
            // is misleading (looks broken to the user).
            if (Object.keys(action as object).length === 0) return;
            const obj = action as {
                schemaName?: unknown;
                actionName?: unknown;
            };
            if (
                typeof obj.schemaName === "string" &&
                typeof obj.actionName === "string"
            ) {
                label = `${obj.schemaName}.${obj.actionName}`;
            }
            const json = JSON.stringify(action, undefined, 2);
            html = `<pre class="chat-json">${highlightJson(json)}</pre>`;
        } else {
            // Primitives (string/number/bool) aren't useful as a JSON
            // popup. Don't make the bubble clickable for them.
            return;
        }
        // Render the JSON below the message in the collapsible details
        // area, instead of swapping out the message body. The agent name
        // becomes a click affordance to toggle the details panel.
        this.detailsDiv.innerHTML = html;
        this.actionDataHtml = html;
        if (label) {
            this.nameSpan.textContent = label;
            this.actionDerivedName = label;
        }
        this.nameSpan.classList.add("clickable");
        this.nameSpan.title = "Click to show / hide action JSON";
    }

    private toggleActionData() {
        if (this.actionDataHtml === undefined) return;
        this.detailsDiv.classList.toggle("chat-details-visible");
    }

    public setMessage(
        content: DisplayContent,
        source?: string,
        appendMode?: DisplayAppendMode,
    ) {
        if (source && !this.actionDerivedName) {
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
        if (!this.actionDerivedName) {
            this.nameSpan.textContent = source;
        }
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
