// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Simplified chat panel component for the Chrome extension side panel.
 *
 * Uses the same CSS class names as the shell's ChatView for visual
 * consistency, but without TTS, metrics, template editor, or speech
 * recognition dependencies.
 */

import DOMPurify from "dompurify";
import { DisplayAppendMode, DisplayContent } from "@typeagent/agent-sdk";
import type {
    PhaseTiming,
    CompletionUsageStats,
    NotifyExplainedData,
    RequestId,
    UserFeedbackCategory,
    UserFeedbackEntry,
    UserFeedbackRating,
} from "@typeagent/dispatcher-types";
import { setContent } from "./setContent.js";
import {
    FEEDBACK_VARIANTS,
    FeedbackController,
    FeedbackUIVariant,
    FeedbackWidget,
} from "./feedbackWidget.js";
import { ChatContextMenu } from "./contextMenu.js";
import {
    renderConnectionStatus,
    type ConnectionStatus,
    type ConnectionActionHandler,
} from "./connectionStatus.js";

// Restrictive sanitize config used at .innerHTML sinks below. The HTML
// passed in is built from values that, while in practice come from
// trusted dispatcher metadata (timing labels, JSON action data,
// per-color SVG fills), is treated by CodeQL as "library input". Running
// the final string through DOMPurify gives us defence-in-depth and
// satisfies js/xss / js/html-constructed-from-input.
const SANITIZE_CONFIG = {
    ALLOWED_TAGS: ["div", "span", "b", "i", "br", "pre", "svg", "path"],
    ALLOWED_ATTR: ["class", "xmlns", "width", "height", "viewBox", "fill", "d"],
};
function sanitize(html: string): string {
    return DOMPurify.sanitize(html, SANITIZE_CONFIG) as string;
}
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
import type {
    ChoiceOption,
    HelpPanelContent,
    ImageCaptureProvider,
    SettingsPanelSchema,
    SpeechInputProvider,
    SpeechState,
    TtsProvider,
} from "./providers.js";
import { openSettingsPopup, openHelpPopup } from "./popups.js";
import { TemplateEditor, type TemplateEditServices } from "./templateEditor.js";
import type { TemplateEditConfig } from "@typeagent/dispatcher-types";
import { iconX, iconJumpQueue, iconStop } from "./icons.js";

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
    studio: "🎨",
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

// Re-exported from @typeagent/dispatcher-types so consumers of chat-ui that
// already have a dispatcher-types dependency get a single canonical type
// (and so we don't drift). Previously these were locally mirrored to avoid
// pulling dispatcher-types in; the rationale is stale now that
// dispatcher-types is a small types package with minimal dependencies (just
// @typeagent/agent-sdk, which chat-ui already depends on).
export type { PhaseTiming, CompletionUsageStats, NotifyExplainedData };

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
          actionTokenUsage?: CompletionUsageStats;
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
    return `${escapeHtml(label)}: <b>${formatDuration(duration)}</b>`;
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
// around tokens. Implemented as a hand-rolled scanner rather than a
// single tokenizing regex so we have no chance of polynomial backtracking
// on adversarial input (the JSON comes from action data which can carry
// arbitrary user content). Also escapes <, >, & in any character that
// passes through.
// Avoids pulling in highlight.js / Prism just to colorize the action
// JSON popup.
function highlightJson(json: string): string {
    const escapeChar = (c: string): string =>
        c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c;
    const wrap = (cls: string, text: string): string =>
        `<span class="${cls}">${text}</span>`;

    let out = "";
    let i = 0;
    const n = json.length;
    while (i < n) {
        const ch = json[i];
        if (ch === '"') {
            // Linear scan to the matching closing quote, honoring `\\`
            // and `\"` escapes. Each character is consumed at most once,
            // so this is O(n) worst case.
            let j = i + 1;
            let raw = '"';
            while (j < n) {
                const cj = json[j];
                if (cj === "\\" && j + 1 < n) {
                    raw += "\\" + escapeChar(json[j + 1]);
                    j += 2;
                    continue;
                }
                raw += escapeChar(cj);
                j++;
                if (cj === '"') break;
            }
            i = j;
            // If a colon follows (optionally with whitespace), this is a
            // JSON object key; otherwise a string value.
            let k = i;
            while (k < n && (json[k] === " " || json[k] === "\t")) k++;
            if (json[k] === ":") {
                out += wrap("json-key", raw + json.slice(i, k + 1));
                i = k + 1;
            } else {
                out += wrap("json-string", raw);
            }
        } else if (
            (ch >= "0" && ch <= "9") ||
            (ch === "-" &&
                i + 1 < n &&
                json[i + 1] >= "0" &&
                json[i + 1] <= "9")
        ) {
            let j = i + 1;
            while (
                j < n &&
                ((json[j] >= "0" && json[j] <= "9") ||
                    json[j] === "." ||
                    json[j] === "e" ||
                    json[j] === "E" ||
                    json[j] === "+" ||
                    json[j] === "-")
            ) {
                j++;
            }
            out += wrap("json-number", json.slice(i, j));
            i = j;
        } else if (json.startsWith("true", i)) {
            out += wrap("json-bool", "true");
            i += 4;
        } else if (json.startsWith("false", i)) {
            out += wrap("json-bool", "false");
            i += 5;
        } else if (json.startsWith("null", i)) {
            out += wrap("json-null", "null");
            i += 4;
        } else {
            out += escapeChar(ch);
            i++;
        }
    }
    return out;
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
    // No-op: metrics overlay appears without pushing sibling messages.
    // The overlay is positioned absolutely, so it won't affect layout.
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
    // Build the SVG via DOM nodes instead of innerHTML so the per-call
    // `fill` color cannot be construed as an XSS sink.
    const SVG_NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("xmlns", SVG_NS);
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("viewBox", "0 0 567.896 567.896");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("fill", fill);
    path.setAttribute("d", ROADRUNNER_SVG_PATH);
    svg.appendChild(path);
    wrapper.appendChild(svg);
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
    /**
     * Optional callback fired when the user rates an agent message via the
     * feedback widget. The host should call dispatcher.recordUserFeedback
     * (or its own equivalent) so the rating is persisted and broadcast.
     */
    onFeedback?: (
        requestId: RequestId,
        rating: UserFeedbackRating,
        category?: UserFeedbackCategory,
        comment?: string,
        includeContext?: boolean,
    ) => Promise<void> | void;
    /**
     * Initial feedback widget placement variant. Defaults to "footer-always".
     * Change at runtime via ChatPanel.setFeedbackUIVariant.
     */
    feedbackUIVariant?: FeedbackUIVariant;

    /**
     * Optional speech-to-text provider. When supplied, ChatPanel renders a
     * microphone button (reflecting the provider's state) and a "listening"
     * banner, and inserts recognized text into the input.
     */
    speechProvider?: SpeechInputProvider;
    /**
     * Optional text-to-speech provider. When supplied (and enabled),
     * ChatPanel speaks agent "block" messages as they arrive.
     */
    ttsProvider?: TtsProvider;
    /**
     * Optional image-capture provider. When supplied, ChatPanel renders an
     * attach-file button (if pickFile present) and a camera button (if
     * openCamera present) that feed the next message's attachments.
     */
    imageCaptureProvider?: ImageCaptureProvider;
    /**
     * Optional data-driven settings popup descriptor. When supplied,
     * ChatPanel.openSettings() renders a modal from it.
     */
    settingsPanel?: SettingsPanelSchema;
    /**
     * Optional help popup content. When supplied, ChatPanel.openHelp()
     * renders a modal from it.
     */
    helpPanel?: HelpPanelContent;
    /**
     * Optional soft-hide ("trash") hook for the feedback widget. When
     * supplied, the feedback footer shows a trash button that toggles the
     * hidden state of the user or agent message for the given request.
     */
    onFeedbackHidden?: (
        requestId: RequestId,
        target: "user" | "agent",
        hidden: boolean,
    ) => void;
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
    private reconnectBanner: HTMLDivElement | undefined;
    private statusContainer: AgentMessageContainer | undefined;
    private historyAgentContainer: AgentMessageContainer | undefined;
    /**
     * Per-thread agent message containers. A thread is keyed by either the
     * user-generated requestId (user-driven thread) or a dispatcher-supplied
     * synthetic id (e.g. "agent-N") for agent-initiated flows. Decoupling
     * threads fixes the bug where an agent-initiated message arriving
     * mid-conversation would glomm onto the previous user request's bubble.
     * Toast and inline rows do NOT participate in this map.
     */
    private threadContainers = new Map<string, AgentMessageContainer>();
    /**
     * All agent bubbles ever created for a request/thread id, in creation
     * order. Step-mode reasoning intentionally creates multiple bubbles per
     * request; this lets us clear stale running rails and still finalize
     * metrics/token counts even after `threadContainers` is rotated.
     */
    private requestAgentContainers = new Map<string, AgentMessageContainer[]>();
    /**
     * Thread ids whose request is currently being processed. Drives the
     * agent bubble's "working" status rail + Stop button. An id is added on
     * `setProcessing` and removed on `completeRequest` / `setIdle`. The rail
     * is applied lazily when the agent bubble materializes (so the Stop only
     * appears once there's a visible bubble to anchor it to).
     */
    private agentRunningRequestIds = new Set<string>();
    /**
     * The threadId of the most-recent user request. Methods that take an
     * optional requestId/threadId default to this when no explicit id is
     * supplied.
     */
    private currentUserThreadId: string | undefined;
    /**
     * Counter for ad-hoc thread ids — used as a last-resort fallback when a
     * caller invokes a thread-bearing method with no id AND no current user
     * thread (e.g. agent-initiated message arriving before any user input
     * via an embedder that hasn't been updated to pass an id yet).
     */
    private nextAdHocThreadId = 0;
    /**
     * Per-thread setDisplayInfo metadata stashed when it arrives before the
     * first setDisplay/appendDisplay for the thread; consumed by
     * getOrCreateAgentContainer when it creates the container.
     */
    private pendingThreadDisplayInfo = new Map<
        string,
        { source: string; sourceIcon?: string; action?: unknown }
    >();
    /**
     * Floating overlay surface for showToast() — fixed-positioned above the
     * chat in rootElement, lazily created on first toast.
     */
    private toastStack: HTMLDivElement | undefined;
    private commandHistory: string[] = [];
    private historyIndex = -1;
    /** Local user's display name + initial used in user-bubble headers. */
    private userName = "You";
    private userInitial = "U";
    /**
     * Whether the local user has signed in to a Microsoft / Graph identity
     * (set via setUserSignedIn after `@calendar login` / `@email login`).
     * The avatar's click handler reads this at click time and no-ops when
     * true so signed-in users don't re-trigger the login flow.
     */
    private isUserSignedIn = false;
    private signedInEmail?: string;
    /**
     * Base64 data URL of the signed-in user's MS Graph profile photo, when
     * available. Rendered as the user-icon avatar background; falls back to
     * the letter initial when undefined.
     */
    private userPhoto?: string;
    /**
     * Optional host-driven command-completion controller. Mounted by
     * attachCompletion(); pcState messages are forwarded via applyPcState().
     */
    private partialCompletion: PartialCompletion | undefined;
    private activeRequestId?: string;
    private isSwitching = false;
    private isHistoryLoading = false;
    private historyLoadingPlaceholder: HTMLElement | undefined;
    private pendingHistoryEntries: HistoryEntry[] = [];
    private loadMoreHistoryEl: HTMLElement | undefined;
    private loadMoreObserver: IntersectionObserver | undefined;
    private isLoadingMoreHistory = false;
    /**
     * When non-null, all add* methods insert before this element instead of
     * before messageDiv.firstElementChild. Set during paginated history loads
     * so older entries land at the correct visual position (just above the
     * existing oldest history, not at the live-message bottom).
     */
    private replayInsertAnchor: Element | null = null;

    /** Returns the element before which new messages are inserted. */
    private get insertionAnchor(): Element {
        return this.replayInsertAnchor ?? this.messageDiv.firstElementChild!;
    }
    private isDemoPaused = false;
    private isDemoRunning = false;
    // Flipped by `cancelTypingAnimation()` (called from the host when the
    // user cancels the demo). `typeAndSend` checks this on every iteration
    // of its character loop so a cancel mid-typing actually halts the
    // current line instead of typing it out before we honor the cancel.
    private demoTypingCancelled = false;
    private inputHint?: string;
    // Tracks the hint string most recently rendered into the ghost span
    // so setInputHint(undefined) (or a hint change) can identify and
    // clear the prior ghost without disturbing a completion preview.
    private lastAppliedInputHint?: string;
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

    // New messages pill state — shown when user scrolls away from bottom
    private newMessagesPill: HTMLDivElement | undefined;
    private userHasManuallyScrolled = false;
    private hasUnseenNewMessages = false;

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
    public onFeedback?: (
        requestId: RequestId,
        rating: UserFeedbackRating,
        category?: UserFeedbackCategory,
        comment?: string,
        includeContext?: boolean,
    ) => Promise<void> | void;
    private _feedbackUIVariant: FeedbackUIVariant = "footer-always";
    // Tracks the current rating per requestId so re-rendering / replay
    // can apply the latest state. Keyed by RequestId.requestId (UUID).
    private feedbackByRequestId = new Map<string, UserFeedbackEntry>();

    // Optional host-supplied capability providers (see providers.ts).
    private speechProvider?: SpeechInputProvider;
    private ttsProvider?: TtsProvider;
    private imageCaptureProvider?: ImageCaptureProvider;
    private settingsPanel?: SettingsPanelSchema;
    private helpPanel?: HelpPanelContent;
    public onFeedbackHidden?: (
        requestId: RequestId,
        target: "user" | "agent",
        hidden: boolean,
    ) => void;
    // Input-bar affordances created only when the matching provider exists.
    private micButton?: HTMLButtonElement;
    private attachButton?: HTMLButtonElement;
    private cameraButton?: HTMLButtonElement;
    private voiceBanner?: HTMLDivElement;
    private lightboxOverlay?: HTMLDivElement;
    private lightboxKeyHandler?: (ev: KeyboardEvent) => void;
    private speechState: SpeechState = "idle";

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
        this.onFeedback = options.onFeedback;
        this._feedbackUIVariant = options.feedbackUIVariant ?? "footer-always";

        this.speechProvider = options.speechProvider;
        this.ttsProvider = options.ttsProvider;
        this.imageCaptureProvider = options.imageCaptureProvider;
        this.settingsPanel = options.settingsPanel;
        this.helpPanel = options.helpPanel;
        this.onFeedbackHidden = options.onFeedbackHidden;

        // Build DOM structure
        const wrapper = document.createElement("div");
        wrapper.className = "chat-panel-wrapper";

        // Reconnect banner — hidden by default. Hosts call setConnectionStatus()
        // (structured: countdown / stopped + Retry/Start links) or the legacy
        // setReconnectStatus() (plain string) to surface reconnect state instead
        // of a silent UI.
        this.reconnectBanner = document.createElement("div");
        this.reconnectBanner.className = "chat-reconnect-banner";
        this.reconnectBanner.style.display = "none";
        wrapper.appendChild(this.reconnectBanner);

        // Voice/listening banner — only created when a speech provider is
        // present. Hidden until the provider reports a listening state.
        if (this.speechProvider) {
            this.voiceBanner = document.createElement("div");
            this.voiceBanner.className = "chat-voice-banner";
            this.voiceBanner.style.display = "none";
            wrapper.appendChild(this.voiceBanner);
        }

        // Scrollable message area
        this.messageDiv = document.createElement("div");
        this.messageDiv.className = "chat";
        this.messageDiv.id = "chat-window";

        // Sentinel div for reverse flex ordering
        const sentinel = document.createElement("div");
        sentinel.className = "chat-sentinel";
        this.messageDiv.appendChild(sentinel);

        wrapper.appendChild(this.messageDiv);

        // New messages pill — shown when user scrolls away from bottom
        // Positioned outside messageDiv to avoid column-reverse layout issues
        this.newMessagesPill = document.createElement("div");
        this.newMessagesPill.className = "chat-new-messages-pill";
        this.newMessagesPill.style.display = "none";
        this.newMessagesPill.innerHTML = "↓ New messages";
        wrapper.appendChild(this.newMessagesPill);

        // Setup scroll tracking to detect when user scrolls away from bottom
        this.messageDiv.addEventListener("scroll", () => {
            this.updateScrollState();
        });

        // Input area
        this.inputArea = document.createElement("div");
        this.inputArea.className = "chat-input";

        this.textInput = document.createElement("span");
        this.textInput.id = "phraseDiv";
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
        this.setupContextMenu();
        this.setupProviderAffordances();
        this.setupImageLightbox();
    }

    /**
     * Wire a delegated click handler so that clicking any image inside a
     * chat bubble opens a full-window lightbox (translucent backdrop, the
     * image centered) supporting mouse-wheel zoom, drag-to-pan, double-click
     * to toggle zoom and Esc / backdrop-click to dismiss.
     */
    private setupImageLightbox() {
        this.messageDiv.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            if (target.tagName !== "IMG") return;
            // Ignore tiny inline icons/avatars — only open for real content
            // images (user attachments or agent-rendered images).
            const img = target as HTMLImageElement;
            const rect = img.getBoundingClientRect();
            if (rect.width < 32 && rect.height < 32) return;
            this.openImageLightbox(img.currentSrc || img.src);
        });
    }

    /**
     * Open a full-window image viewer overlaying the chat. Supports
     * wheel-zoom centered on the cursor, drag-to-pan, double-click toggle,
     * +/- controls and Esc / backdrop dismissal.
     */
    public openImageLightbox(src: string) {
        // Only one lightbox at a time.
        this.closeImageLightbox();

        const overlay = document.createElement("div");
        overlay.className = "chat-lightbox-overlay";
        overlay.tabIndex = -1;

        const img = document.createElement("img");
        img.className = "chat-lightbox-img";
        img.src = src;
        img.draggable = false;
        overlay.appendChild(img);

        // Control bar (zoom in / out / reset / close).
        const controls = document.createElement("div");
        controls.className = "chat-lightbox-controls";
        const makeBtn = (html: string, title: string) => {
            const b = document.createElement("button");
            b.className = "chat-lightbox-button";
            b.innerHTML = html;
            b.title = title;
            controls.appendChild(b);
            return b;
        };
        // Magnifier-glass glyphs for zoom out (−) and zoom in (+).
        const magMinus = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><circle cx="10" cy="10" r="7"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="7" y1="10" x2="13" y2="10"/></svg>`;
        const magPlus = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><circle cx="10" cy="10" r="7"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="7" y1="10" x2="13" y2="10"/><line x1="10" y1="7" x2="10" y2="13"/></svg>`;
        const zoomOutBtn = makeBtn(magMinus, "Zoom out");
        const resetBtn = makeBtn("\u21BA", "Reset");
        const zoomInBtn = makeBtn(magPlus, "Zoom in");
        const closeBtn = makeBtn("\u00D7", "Close (Esc)");
        overlay.appendChild(controls);

        // View transform state.
        let scale = 1;
        let tx = 0;
        let ty = 0;
        const minScale = 1;
        const maxScale = 10;

        const apply = () => {
            img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
            img.style.cursor =
                scale > 1 ? (dragging ? "grabbing" : "grab") : "default";
            // Disable the zoom controls at their respective limits.
            zoomOutBtn.disabled = scale <= minScale + 1e-3;
            zoomInBtn.disabled = scale >= maxScale - 1e-3;
        };

        const reset = () => {
            scale = 1;
            tx = 0;
            ty = 0;
            apply();
        };

        // Zoom toward a point (cx, cy) in viewport coords by factor.
        const zoomAt = (cx: number, cy: number, factor: number) => {
            const prev = scale;
            scale = Math.min(maxScale, Math.max(minScale, scale * factor));
            if (scale === prev) return;
            const rect = img.getBoundingClientRect();
            // Center of the image in viewport coords.
            const ox = rect.left + rect.width / 2;
            const oy = rect.top + rect.height / 2;
            const ratio = scale / prev;
            tx += (ox - cx) * (ratio - 1);
            ty += (oy - cy) * (ratio - 1);
            if (scale === minScale) {
                tx = 0;
                ty = 0;
            }
            apply();
        };

        let dragging = false;
        let startX = 0;
        let startY = 0;
        let startTx = 0;
        let startTy = 0;

        const onWheel = (ev: WheelEvent) => {
            ev.preventDefault();
            const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
            zoomAt(ev.clientX, ev.clientY, factor);
        };

        const onPointerDown = (ev: PointerEvent) => {
            if (scale <= 1) return;
            dragging = true;
            startX = ev.clientX;
            startY = ev.clientY;
            startTx = tx;
            startTy = ty;
            img.setPointerCapture(ev.pointerId);
            apply();
        };
        const onPointerMove = (ev: PointerEvent) => {
            if (!dragging) return;
            tx = startTx + (ev.clientX - startX);
            ty = startTy + (ev.clientY - startY);
            apply();
        };
        const onPointerUp = (ev: PointerEvent) => {
            if (!dragging) return;
            dragging = false;
            try {
                img.releasePointerCapture(ev.pointerId);
            } catch {
                // pointer may already be released
            }
            apply();
        };

        const onKey = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") {
                ev.preventDefault();
                this.closeImageLightbox();
            } else if (ev.key === "+" || ev.key === "=") {
                zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.2);
            } else if (ev.key === "-" || ev.key === "_") {
                zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.2);
            } else if (ev.key === "0") {
                reset();
            }
        };

        // Wire events.
        overlay.addEventListener("wheel", onWheel, { passive: false });
        img.addEventListener("pointerdown", onPointerDown);
        img.addEventListener("pointermove", onPointerMove);
        img.addEventListener("pointerup", onPointerUp);
        img.addEventListener("dblclick", (ev) => {
            ev.preventDefault();
            if (scale > 1) {
                reset();
            } else {
                zoomAt(ev.clientX, ev.clientY, 2.5);
            }
        });
        // Click on the backdrop (not the image/controls) dismisses.
        overlay.addEventListener("click", (ev) => {
            if (ev.target === overlay) this.closeImageLightbox();
        });
        zoomInBtn.addEventListener("click", () =>
            zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.3),
        );
        zoomOutBtn.addEventListener("click", () =>
            zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.3),
        );
        resetBtn.addEventListener("click", reset);
        closeBtn.addEventListener("click", () => this.closeImageLightbox());
        document.addEventListener("keydown", onKey);

        this.lightboxOverlay = overlay;
        this.lightboxKeyHandler = onKey;
        this.rootElement.appendChild(overlay);
        overlay.focus();
        apply();
    }

    /** Tear down the image lightbox if it is open. */
    public closeImageLightbox() {
        if (this.lightboxKeyHandler) {
            document.removeEventListener("keydown", this.lightboxKeyHandler);
            this.lightboxKeyHandler = undefined;
        }
        if (this.lightboxOverlay) {
            this.lightboxOverlay.remove();
            this.lightboxOverlay = undefined;
        }
    }

    /**
     * Create the mic / attach / camera buttons and wire the speech
     * provider's state callbacks. Only the affordances whose providers are
     * present get rendered, so hosts that omit a provider see no change.
     */
    private setupProviderAffordances() {
        // Attach-file + camera buttons (image capture provider).
        if (this.imageCaptureProvider?.pickFile) {
            this.attachButton = document.createElement("button");
            this.attachButton.className =
                "chat-input-button chat-attach-button";
            this.attachButton.title = "Attach image";
            this.attachButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6z"/></svg>`;
            this.attachButton.addEventListener("click", () =>
                this.handleAttachFile(),
            );
            this.inputArea.insertBefore(this.attachButton, this.sendButton);
        }
        if (this.imageCaptureProvider?.openCamera) {
            this.cameraButton = document.createElement("button");
            this.cameraButton.className =
                "chat-input-button chat-camera-button";
            this.cameraButton.title = "Capture image";
            this.cameraButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M9.4 4 8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4l-1.4-2zm2.6 5.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8m0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4"/></svg>`;
            this.cameraButton.addEventListener("click", () =>
                this.handleCameraCapture(),
            );
            this.inputArea.insertBefore(this.cameraButton, this.sendButton);
        }

        // Microphone button + speech state wiring (speech provider).
        if (this.speechProvider) {
            this.micButton = document.createElement("button");
            this.micButton.className = "chat-input-button chat-mic-button";
            this.micButton.title = "Speak";
            this.micButton.addEventListener("click", () =>
                this.handleMicClick(),
            );
            this.inputArea.insertBefore(this.micButton, this.sendButton);

            this.speechState = this.speechProvider.getState();
            this.renderMicState();
            this.speechProvider.onStateChange((state) => {
                this.speechState = state;
                this.renderMicState();
                this.renderVoiceBanner();
            });
            this.speechProvider.onResult((text, final) => {
                this.handleSpeechResult(text, final);
            });
        }
    }

    private renderMicState() {
        if (!this.micButton) return;
        const listening =
            this.speechState === "listening" ||
            this.speechState === "always-on" ||
            this.speechState === "wake-word";
        this.micButton.classList.toggle("listening", listening);
        this.micButton.disabled = this.speechState === "disabled";
        // Filled mic glyph; the `listening` class drives the pulse styling.
        this.micButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3m5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z"/></svg>`;
    }

    private renderVoiceBanner() {
        if (!this.voiceBanner) return;
        const listening =
            this.speechState === "listening" ||
            this.speechState === "always-on" ||
            this.speechState === "wake-word";
        if (listening) {
            this.voiceBanner.textContent =
                this.speechState === "wake-word"
                    ? "Waiting for wake word…"
                    : "Listening…";
            this.voiceBanner.style.display = "";
        } else {
            this.voiceBanner.style.display = "none";
        }
    }

    private handleMicClick() {
        if (!this.speechProvider) return;
        if (
            this.speechState === "listening" ||
            this.speechState === "always-on" ||
            this.speechState === "wake-word"
        ) {
            this.speechProvider.stop();
        } else {
            this.speechProvider.start();
        }
    }

    private handleSpeechResult(text: string, final: boolean) {
        // Interim results replace the input text live; the committed
        // utterance is left in the input for the user to edit/send.
        this.textInput.textContent = text;
        this.sendButton.disabled = !text.trim();
        if (final) {
            this.placeCaretAtEnd();
        }
    }

    private async handleAttachFile() {
        const urls = await this.imageCaptureProvider?.pickFile();
        if (urls && urls.length > 0) {
            for (const url of urls) {
                this.pendingAttachments.push(url);
                this.showAttachmentPreview(url);
            }
        }
    }

    private async handleCameraCapture() {
        const url = await this.imageCaptureProvider?.openCamera?.();
        if (url) {
            this.pendingAttachments.push(url);
            this.showAttachmentPreview(url);
        }
    }

    private placeCaretAtEnd() {
        this.textInput.focus();
        const range = document.createRange();
        range.selectNodeContents(this.textInput);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    }

    /**
     * Open the data-driven settings popup built from `options.settingsPanel`.
     * No-op when no settings schema was supplied.
     */
    public openSettings() {
        if (this.settingsPanel) {
            openSettingsPopup(this.rootElement, this.settingsPanel);
        }
    }

    /**
     * Open the help popup built from `options.helpPanel`. No-op when no
     * help content was supplied.
     */
    public openHelp() {
        if (this.helpPanel) {
            openHelpPopup(this.rootElement, this.helpPanel);
        }
    }

    private setupContextMenu() {
        const menu = new ChatContextMenu();
        // Editable input: Cut / Copy / Paste / Select All.
        menu.attach(this.textInput, { editable: true });
        // Read-only message stream: Copy / Select All.
        menu.attach(this.messageDiv, { editable: false });
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
                    // preventDefault so host's doc-level Esc handler doesn't double-handle.
                    e.preventDefault();
                    this.clearCompletions();
                    return;
                }
                if (this.activeRequestId) {
                    e.preventDefault();
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
                this.navigateHistory(1);
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                this.navigateHistory(-1);
            }
        });

        this.textInput.addEventListener("input", () => {
            this.updateSendButtonState();
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
            this.updateSendButtonState();
        });
        const wrapper = document.createElement("span");
        wrapper.className = "chat-attachment-item";
        wrapper.appendChild(img);
        wrapper.appendChild(removeBtn);
        preview.appendChild(wrapper);
        // An attached image makes the message sendable even with no text.
        this.updateSendButtonState();
    }

    /**
     * Recompute the send button's enabled state. The message is sendable
     * when there is non-empty text OR at least one pending image attachment.
     */
    private updateSendButtonState() {
        const hasText = !!this.textInput.textContent?.trim();
        this.sendButton.disabled =
            !hasText && this.pendingAttachments.length === 0;
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

    private shouldAddToHistory(text: string) {
        return !/^@exit(?:\s|$)/i.test(text.trim());
    }

    private send(requestId?: string) {
        const text = this.textInput.textContent?.trim() ?? "";
        // Allow sending when there is text OR at least one pending image
        // attachment (image-only requests are valid — e.g. "what is this?").
        if (!text && this.pendingAttachments.length === 0) return;

        if (text && this.shouldAddToHistory(text)) {
            this.commandHistory.unshift(text);
        }
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
        this.addUserMessage(text, id, attachments);
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
     * Returns `true` if submitted, `false` if cancellation was requested
     * mid-animation (in which case `send()` is NOT invoked and the host
     * must release any waiters of its own).
     */
    public async typeAndSend(
        text: string,
        requestId: string,
    ): Promise<boolean> {
        // Each new typeAndSend starts fresh — a stale cancel from a prior
        // line shouldn't suppress this one.
        this.demoTypingCancelled = false;
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
                if (this.demoTypingCancelled) {
                    // Wipe whatever we typed so the input doesn't keep a
                    // partial command for the user to inadvertently send,
                    // then bail without firing send().
                    this.textInput.textContent = "";
                    return false;
                }
                this.textInput.textContent =
                    (this.textInput.textContent ?? "") + text[i];
                // 25-40ms per char (random within range), matches Electron shell.
                const delay = 25 + Math.floor(Math.random() * 15);
                await new Promise((r) => setTimeout(r, delay));
            }
        } finally {
            this.textInput.contentEditable = wasEditable;
        }
        if (this.demoTypingCancelled) {
            this.textInput.textContent = "";
            return false;
        }
        // Defer to send() so all bookkeeping (command history, attachments,
        // user-bubble creation, sendButton/ghost reset) stays in one place.
        this.send(requestId);
        return true;
    }

    /**
     * Signal `typeAndSend()` to stop typing the current line. Safe to call
     * when no animation is in flight — the flag is reset at the start of
     * each `typeAndSend()`. Use this from the host on demo cancel so the
     * remainder of the current line isn't typed out before the cancel
     * takes effect.
     */
    public cancelTypingAnimation(): void {
        this.demoTypingCancelled = true;
    }

    /**
     * Toggle "demo running" mode. While running, the input ghost-hint
     * shown via `setInputHint` is preserved across input events so the
     * Alt+→/Esc reminder stays visible at the pause point.
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
     * when the textbox is empty. Used to display "Alt+→ continue ·
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
                this.ghostSpan.textContent !== this.lastAppliedInputHint &&
                this.ghostSpan.textContent !== this.inputHint &&
                (this.ghostSpan.textContent ?? "").length > 0);
        if (this.inputHint && !hasText && !hasCompletionGhost) {
            this.ghostSpan.textContent = this.inputHint;
            this.lastAppliedInputHint = this.inputHint;
        } else if (
            this.lastAppliedInputHint !== undefined &&
            this.ghostSpan.textContent === this.lastAppliedInputHint
        ) {
            // Clear the previously-rendered hint when it should no longer
            // be shown (hint cleared, hint changed to a value that doesn't
            // currently apply, or the input is no longer empty). Comparing
            // against `lastAppliedInputHint` (not the current `inputHint`)
            // is essential — by the time we get here the caller may have
            // already set `inputHint = undefined`, so a comparison against
            // `inputHint` would never match and the stale text would
            // linger in the ghost span.
            this.ghostSpan.textContent = "";
            this.lastAppliedInputHint = undefined;
        }
    }

    /** Set the active request ID and show the stop button. */
    public setProcessing(requestId: string) {
        this.activeRequestId = requestId;
        this.sendButton.style.display = "none";
        this.stopButton.style.display = "";
        // Mark this request as in-flight so the agent bubble shows a
        // "working" rail + Stop button once it materializes. If the bubble
        // already exists (re-processing), apply immediately.
        this.agentRunningRequestIds.add(requestId);
        this.applyAgentRunning(requestId);
    }

    /** Clear the active request and restore the send button. */
    public setIdle() {
        if (this.activeRequestId !== undefined) {
            this.clearAgentRunning(this.activeRequestId);
        }
        this.activeRequestId = undefined;
        this.stopButton.style.display = "none";
        this.sendButton.style.display = "";
    }

    /**
     * Apply the "working" status rail + Stop button to the agent bubble for
     * `threadId`, if the request is still in-flight and its bubble exists.
     * Called both when the request starts (bubble may not exist yet — no-op)
     * and when the bubble materializes in `getOrCreateAgentContainer`.
     */
    private applyAgentRunning(threadId: string): void {
        if (!this.agentRunningRequestIds.has(threadId)) return;
        const container = this.threadContainers.get(threadId);
        container?.setRunning(() => this.onCancel?.(threadId));
    }

    /**
     * Clear the in-flight marker and remove the "working" rail from the
     * agent bubble for `threadId` (if any). Idempotent.
     */
    private clearAgentRunning(threadId: string): void {
        this.agentRunningRequestIds.delete(threadId);
        this.threadContainers.get(threadId)?.clearRunning();
        const all = this.requestAgentContainers.get(threadId);
        if (all) {
            for (const container of all) {
                container.clearRunning();
            }
        }
    }

    /**
     * Returns the in-flight requestId, or undefined when idle. Used by
     * hosts to gate document-level interrupt gestures.
     */
    public getActiveRequestId(): string | undefined {
        return this.activeRequestId;
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
    public addUserMessage(
        text: string,
        requestId?: string,
        attachments?: string[],
    ) {
        this._addUserMessageImpl(text, requestId, false, attachments);
    }

    /**
     * Add a peer-originated user bubble. Same DOM as `addUserMessage`
     * but skips side-effects that re-route local thread state. Idempotent.
     */
    public addRemoteUserMessage(text: string, requestId: string) {
        if (this.userMessageById.has(requestId)) return;
        this._addUserMessageImpl(text, requestId, true);
    }

    /**
     * Ensure the user bubble's status rail exists and return its zones.
     * The rail is a slim strip across the top of the bubble with a left
     * "state" zone (queued/sent label) and a right "controls" zone. It is
     * created on demand only when there's a queue state to show — there is
     * no persistent/idle rail (an empty title row), matching the agent
     * bubble. Returns `undefined` if the bubble is gone.
     */
    private ensureUserStatusRail(requestId: string):
        | {
              rail: HTMLDivElement;
              stateZone: HTMLElement;
              controls: HTMLElement;
          }
        | undefined {
        const container = this.userMessageById.get(requestId);
        if (!container) return undefined;
        const bodyDiv =
            container.querySelector<HTMLElement>(".chat-message-user");
        if (!bodyDiv) return undefined;
        let rail = bodyDiv.querySelector<HTMLDivElement>(
            ":scope > .chat-message-status-rail",
        );
        if (!rail) {
            rail = document.createElement("div");
            rail.className = "chat-message-status-rail";
            const stateZone = document.createElement("span");
            stateZone.className = "chat-status-state-zone";
            const controls = document.createElement("span");
            controls.className = "chat-status-rail-controls";
            rail.append(stateZone, controls);
            bodyDiv.insertBefore(rail, bodyDiv.firstChild);
        }
        const stateZone = rail.querySelector<HTMLElement>(
            ":scope > .chat-status-state-zone",
        )!;
        const controls = rail.querySelector<HTMLElement>(
            ":scope > .chat-status-rail-controls",
        )!;
        return { rail, stateZone, controls };
    }

    /**
     * Stamp / clear the queue state on the user bubble's status rail. The
     * rail carries a de-emphasized, state-tinted label ("sent" while the
     * request is being processed, "queued" while it waits) on the left and
     * controls on the right.
     *
     * For queued entries, `onCancel` (when provided) renders a Remove (×)
     * button and `onPromote` renders a "run next" jump-the-queue button.
     * The running ("sent") state intentionally carries no queue controls:
     * once the request is dispatched, cancelling its in-flight action
     * belongs on the agent message, not the user bubble.
     *
     * The rail is created on demand and removed when the state clears, so an
     * idle user bubble shows no empty title row (matching the agent bubble).
     * It lives at the top so it never collides with the hover-revealed
     * metrics strip that slides out of the bubble's bottom edge, and the
     * roadrunner ("explained") icon sits inside the content corner rather
     * than this rail.
     */
    public setUserBubbleQueueStatus(
        requestId: string,
        status: "queued" | "running" | null,
        onCancel?: () => void,
        onPromote?: () => void,
    ): void {
        // Nothing to do on a clear when no rail exists — avoids creating an
        // empty rail just to remove it.
        if (status === null) {
            const container = this.userMessageById.get(requestId);
            container
                ?.querySelector(
                    ".chat-message-user > .chat-message-status-rail",
                )
                ?.remove();
            return;
        }

        const parts = this.ensureUserStatusRail(requestId);
        if (!parts) return;
        const { rail, stateZone, controls } = parts;

        // Reset the state label and any prior queue controls.
        stateZone.replaceChildren();
        controls.replaceChildren();

        rail.dataset.status = status;

        // De-emphasized, state-tinted label: a spinner while running, a
        // small dot while queued. "running" reads as "sent" to the user —
        // the request has left the queue and is being handled.
        const state = document.createElement("span");
        state.className = "chat-status-state";
        state.dataset.status = status;
        const indicator = document.createElement("span");
        indicator.className =
            status === "running" ? "chat-status-spinner" : "chat-status-dot";
        indicator.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.textContent = status === "running" ? "sent" : "queued";
        state.append(indicator, label);
        stateZone.appendChild(state);

        // Queued entries can be promoted ("run next") or removed.
        if (status === "queued") {
            if (onPromote) {
                const jump = document.createElement("button");
                jump.type = "button";
                jump.className = "chat-action-button chat-queue-jump-button";
                jump.dataset.action = "jump-queue";
                jump.title = "Run this next";
                jump.setAttribute("aria-label", "Run this request next");
                jump.appendChild(iconJumpQueue());
                jump.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onPromote();
                });
                controls.appendChild(jump);
            }
            if (onCancel) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className =
                    "chat-action-button danger chat-queue-cancel-button";
                btn.dataset.action = "remove-from-queue";
                btn.title = "Remove from queue";
                btn.setAttribute("aria-label", "Remove queued request");
                btn.appendChild(iconX());
                btn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onCancel();
                });
                controls.appendChild(btn);
            }
        }
    }

    /**
     * Shared DOM construction for both `addUserMessage` (local sends)
     * and `addRemoteUserMessage` (peer-conversation echoes). `isRemote`
     * gates the side-effects that would inappropriately re-route the
     * local thread state when a peer-originated bubble is added.
     */
    private _addUserMessageImpl(
        text: string,
        requestId: string | undefined,
        isRemote: boolean,
        attachments?: string[],
    ) {
        const sentinel = this.insertionAnchor;
        const container = document.createElement("div");
        container.className = "chat-message-container-user";
        container.dataset.requestId = requestId ?? generateRequestId();
        // Do NOT clear threadContainers / pendingThreadDisplayInfo here:
        // with queued requests, an earlier request may still be in flight
        // when a new user message is submitted, and clearing would drop
        // its container reference (producing duplicate bubbles on late
        // updates). Full clears happen on session change.

        const timestamp = this.createTimestamp("user", this.userName);
        container.appendChild(timestamp);

        const iconDiv = document.createElement("div");
        iconDiv.className = "user-icon";
        iconDiv.textContent = this.userInitial;
        // Click avatar to start MS sign-in via the normal send path
        // (`@calendar login` covers both calendar + email — shared MS
        // Graph identity). Handler reads `isUserSignedIn` at click
        // time so historic bubbles become inert post-signin.
        this.applyUserIconState(iconDiv);
        iconDiv.addEventListener("click", () => {
            if (this.isUserSignedIn) return;
            this.injectCommand("@calendar login");
        });
        container.appendChild(iconDiv);

        const bodyDiv = document.createElement("div");
        bodyDiv.className = "chat-message-body-hide-metrics chat-message-user";

        const messageDiv = document.createElement("div");
        messageDiv.className = "chat-message-content";

        const span = document.createElement("span");
        span.className = "chat-message-user-text";
        span.textContent = text;
        messageDiv.appendChild(span);

        // Render any attached images inline in the user bubble so the user
        // sees what they sent (camera capture, file attach, drag-drop).
        if (attachments && attachments.length > 0) {
            const imagesDiv = document.createElement("div");
            imagesDiv.className = "chat-message-user-images";
            for (const url of attachments) {
                const img = document.createElement("img");
                img.src = url;
                img.className = "chat-message-user-image";
                imagesDiv.appendChild(img);
            }
            messageDiv.appendChild(imagesDiv);
        }

        bodyDiv.appendChild(messageDiv);

        // Empty user-side metrics strip — populated later by
        // applyUserMetrics() when the dispatcher reports `metrics.parse`.
        const userMetricsDiv = document.createElement("div");
        userMetricsDiv.className =
            "chat-message-metrics chat-message-metrics-user";
        bodyDiv.appendChild(userMetricsDiv);

        container.appendChild(bodyDiv);

        attachHoverPush(bodyDiv, container, userMetricsDiv);

        sentinel.before(container);
        this.scrollToBottom();

        const id = container.dataset.requestId!;
        this.userMessageById.set(id, container);
        if (!isRemote) {
            if (!this.suppressFirstMessageTracking) {
                this.requestStartByRequestId.set(id, Date.now());
            }
            // New request becomes default thread for setDisplay calls
            // without a requestId. Remote bubbles must NOT take over
            // thread routing — they belong to peers.
            this.currentUserThreadId = id;
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
        tokenUsage?: CompletionUsageStats,
    ) {
        const container = this.userMessageById.get(requestId);
        // The user bubble shows only the translation totals (Translation
        // Elapsed / Total Elapsed / Translation Tokens). Phase marks such as
        // the translation's "First Token" belong to the agent/translation
        // internals and are intentionally NOT rendered here — they were
        // appearing on the user bubble (and even on @-commands with no
        // translation), which is misleading.
        const hasContent =
            (phase?.duration !== undefined && phase.duration !== null) ||
            totalDuration !== undefined ||
            tokenUsage !== undefined;
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
        // Translation tokens: unlike action tokens on the agent bubble, an
        // absent value here means "no translation happened" (an @-command or
        // a cached translation), which is an expected/known state — so we
        // simply omit the line rather than printing "not reported".
        const leftLines: string[] = [];
        if (tokenUsage) {
            leftLines.push(
                `${label} Tokens: <b>${tokenUsage.total_tokens}</b> ` +
                    `(${tokenUsage.prompt_tokens}+${tokenUsage.completion_tokens})`,
            );
        }
        metricsDiv.innerHTML = sanitize(
            `<div class="metrics-details">` +
                `<div>${leftLines.join("<br>")}</div>` +
                `<div></div>` +
                `<div>${mainLines.join("<br>")}</div>` +
                `</div>`,
        );
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
        // "Executing action X" indicator, reasoning's streaming "Thinking…"
        // chunks). Route into the per-request bubble itself: the bubble
        // starts as a status indicator and "upgrades" in place when the
        // real reply arrives. AgentMessageContainer.setMessage already
        // handles this — temporary content is appended as a last-child
        // div tagged via lastAppendMode and flushed before the next
        // non-temporary append. This avoids a separate status bubble
        // appearing alongside the real reply (which looked like a duplicate).
        //
        // The free-standing `statusContainer` is kept only as a fallback
        // for host-driven `showStatus()` calls that have no request context.
        if (
            appendMode === "temporary" &&
            (requestId !== undefined || this.currentUserThreadId !== undefined)
        ) {
            const tempContainer = this.getOrCreateAgentContainer(
                source,
                sourceIcon,
                requestId,
            );
            tempContainer.setMessage(content, source, "temporary");
            this.scrollToBottom();
            return;
        }

        if (appendMode === "temporary") {
            // No request context — fall back to a floating, visually-
            // distinct status bubble (e.g. used by host-driven showStatus).
            if (!this.statusContainer) {
                this.statusContainer = this.createAgentContainer("", "");
                this.statusContainer.markAsStatusBubble();
            }
            this.statusContainer.setMessage(content, undefined, undefined);
            this.scrollToBottom();
            return;
        }

        // Remove any lingering free-standing status bubble when a real
        // response arrives.
        if (this.statusContainer) {
            this.statusContainer.remove();
            this.statusContainer = undefined;
        }

        // "step" mode — force a new bubble for each reasoning phase so
        // thinking, tool calls, tool results, and final text each appear
        // as distinct first-class chat messages instead of being appended
        // into a single monolithic bubble.
        if (appendMode === "step") {
            // Detach the existing container for this request (if any) so
            // getOrCreateAgentContainer will spin up a fresh one.
            if (requestId) {
                const threadId = this.resolveThreadId(requestId);
                // Mark the previous step bubble as done immediately when we
                // advance to the next phase, rather than waiting for the
                // whole command to complete.
                this.threadContainers.get(threadId)?.clearRunning();
                this.threadContainers.delete(threadId);
            }
        }

        const container = this.getOrCreateAgentContainer(
            source,
            sourceIcon,
            requestId,
        );

        // For step bubbles, stamp elapsed time since the request started.
        if (appendMode === "step" && requestId) {
            const start = this.requestStartByRequestId.get(requestId);
            if (start !== undefined) {
                const elapsed = Date.now() - start;
                container.setElapsedBadge(elapsed);
            }
        }

        container.setMessage(
            content,
            source,
            appendMode === "step" ? "block" : appendMode,
        );

        // Speak the agent's reply when a TTS provider is enabled. Only
        // "block" (full reply) content is spoken — inline/temporary status
        // chunks are skipped to avoid reading partial/streamed fragments.
        if (appendMode === undefined || appendMode === "block") {
            this.maybeSpeak(content);
        }

        // After the agent's HTML lands in the DOM, lift any embedded
        // user-signed-in marker into ChatPanel state. The marker is emitted
        // by the calendar/email login handlers on success.
        this.extractUserMarker(this.messageDiv);

        this.scrollToBottom();
    }

    /**
     * Drop the bubble association for a completed thread/request id. Future
     * add/replaceAgentMessage calls with this id will create a fresh bubble.
     * Called by hosts when a request completes; safe to call for unknown ids.
     */
    public clearRequest(requestId: string): void {
        this.threadContainers.delete(requestId);
        this.requestAgentContainers.delete(requestId);
        this.pendingThreadDisplayInfo.delete(requestId);
        if (this.currentUserThreadId === requestId) {
            this.currentUserThreadId = undefined;
        }
    }

    /**
     * Resolve a threadId for a thread-bearing call. Caller-supplied id wins;
     * otherwise default to the current user-driven thread; otherwise mint an
     * ad-hoc id so a misconfigured embedder still produces sensible (if
     * uncorrelated) output instead of glomming onto an unrelated bubble.
     */
    private resolveThreadId(requestId?: string): string {
        if (requestId !== undefined) return requestId;
        if (this.currentUserThreadId !== undefined) {
            return this.currentUserThreadId;
        }
        return `ad-hoc-${this.nextAdHocThreadId++}`;
    }

    private getOrCreateAgentContainer(
        source: string | undefined,
        sourceIcon: string | undefined,
        requestId: string | undefined,
    ): AgentMessageContainer {
        const threadId = this.resolveThreadId(requestId);
        const existing = this.threadContainers.get(threadId);
        if (existing) {
            return existing;
        }
        // sourceIcon="🤖"). Without this, the bubble would be created with
        // the dispatcher robot avatar and stay that way (subsequent
        // setMessage calls only update the name label, not the icon).
        //
        // When pending source info is present we treat it as authoritative:
        // even though setDisplayInfo doesn't carry sourceIcon, we resolve
        // the icon from pending.source via iconForSource so the dispatcher's
        // 🤖 from the "Executing action ..." caller doesn't win the fallback
        // chain.
        const pending = this.pendingThreadDisplayInfo.get(threadId);
        const effectiveSource = pending?.source ?? source;
        const effectiveIcon = pending
            ? (pending.sourceIcon ?? this.iconForSource(effectiveSource))
            : (sourceIcon ?? this.iconForSource(effectiveSource));
        // Anchor on the user bubble so the agent's response renders
        // directly below it (column-reverse: DOM-before = visually-after).
        // Liveness check guards against detached anchors. Falls through
        // to default placement for ad-hoc / system / agent-N threads
        // with no user bubble.
        const mappedBubble = this.userMessageById.get(threadId);
        const anchor =
            mappedBubble?.parentElement === this.messageDiv
                ? mappedBubble
                : undefined;
        const container = this.createAgentContainer(
            effectiveSource ?? "assistant",
            effectiveIcon,
            threadId,
            anchor,
        );
        this.threadContainers.set(threadId, container);
        const requestContainers =
            this.requestAgentContainers.get(threadId) ?? [];
        requestContainers.push(container);
        this.requestAgentContainers.set(threadId, requestContainers);
        // If this request is in-flight, stamp the "working" rail + Stop now
        // that there's a visible bubble to anchor it to.
        this.applyAgentRunning(threadId);
        // Capture the elapsed time from request send to first agent
        // bubble for this thread — drives the "First Message"
        // metric line on the agent metrics tooltip.
        if (!this.firstMessageMsByRequestId.has(threadId)) {
            const start = this.requestStartByRequestId.get(threadId);
            if (start !== undefined) {
                this.firstMessageMsByRequestId.set(
                    threadId,
                    Date.now() - start,
                );
            }
        }
        // Apply any action metadata that arrived via setDisplayInfo
        // before the first render — the dispatcher fires it before
        // the agent's first setDisplay/appendDisplay (including the
        // "Executing action ..." temporary status emitted via displayStatus).
        if (pending?.action !== undefined) {
            container.setActionData(pending.action);
        }
        this.pendingThreadDisplayInfo.delete(threadId);
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
     * Show a floating toast overlay (auto-dismisses after ~5s, click to
     * dismiss). Lives outside the chat scroll. Toasts do NOT participate in
     * the thread map — each call is fire-and-forget.
     */
    public showToast(
        content: DisplayContent,
        source?: string,
        _sourceIcon?: string,
    ) {
        if (!this.toastStack) {
            const stack = document.createElement("div");
            stack.className = "chat-toast-stack";
            stack.style.cssText =
                "position: absolute; top: 12px; right: 12px; z-index: 1000; " +
                "display: flex; flex-direction: column; gap: 8px; " +
                "pointer-events: none; max-width: 320px;";
            // Append to messageDiv's parent (the chat-panel-wrapper) so the
            // overlay is bounded to the panel rather than the whole document.
            (this.messageDiv.parentElement ?? this.rootElement).appendChild(
                stack,
            );
            this.toastStack = stack;
        }

        const toast = document.createElement("div");
        toast.className = "chat-toast";
        toast.style.cssText =
            "background: rgba(40,42,54,0.96); color: #f8f8f2; " +
            "padding: 10px 14px; border-radius: 6px; " +
            "box-shadow: 0 4px 12px rgba(0,0,0,0.25); " +
            "pointer-events: auto; cursor: pointer; " +
            "font-size: 13px; line-height: 1.4; " +
            "transition: opacity 0.3s ease;";

        if (source) {
            const header = document.createElement("div");
            header.style.cssText =
                "font-size: 11px; opacity: 0.65; margin-bottom: 4px;";
            header.textContent = source;
            toast.appendChild(header);
        }

        const body = document.createElement("div");
        setContent(
            body,
            content,
            this.settingsView,
            "agent",
            this.platformAdapter,
        );
        toast.appendChild(body);

        let dismissed = false;
        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            toast.style.opacity = "0";
            window.setTimeout(() => toast.remove(), 300);
        };
        toast.addEventListener("click", dismiss);
        window.setTimeout(dismiss, 5000);

        this.toastStack.appendChild(toast);
    }

    /**
     * Show a compact inline row in the chat scroll (no bubble chrome,
     * single line, dim styling). Persists in scroll history. Does NOT
     * participate in the thread map — fire-and-forget.
     */
    public showInline(content: DisplayContent, source?: string) {
        const sentinel = this.insertionAnchor;
        const row = document.createElement("div");
        row.className = "chat-message-inline";
        row.style.cssText =
            "padding: 4px 12px; font-size: 12px; color: #888; " +
            "border-left: 2px solid #aaa; margin: 4px 12px; " +
            "display: flex; gap: 6px; align-items: baseline;";

        if (source) {
            const sourceSpan = document.createElement("span");
            sourceSpan.style.cssText = "font-weight: 600; flex-shrink: 0;";
            sourceSpan.textContent = `${source}:`;
            row.appendChild(sourceSpan);
        }

        const body = document.createElement("span");
        setContent(
            body,
            content,
            this.settingsView,
            "agent",
            this.platformAdapter,
        );
        row.appendChild(body);

        sentinel.before(row);
        this.scrollToBottom();
    }

    /**
     * Add a non-conversational system message styled distinctly from agent
     * messages (no avatar, no source label, no timestamp). Use for `@`-config
     * confirmations, session lifecycle events, and similar host notices.
     */
    public addSystemMessage(text: string): void {
        const sentinel = this.insertionAnchor;
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
        this.threadContainers.clear();
        this.requestAgentContainers.clear();
        this.currentUserThreadId = undefined;
        this.pendingThreadDisplayInfo.clear();
        this.agentRunningRequestIds.clear();

        // Suppress first-message timing tracking during replay — those
        // timestamps would reflect the speed of replay, not the original
        // request-to-first-response time.
        this.suppressFirstMessageTracking = true;
        try {
            for (const entry of entries) {
                this._processHistoryEntry(entry);
            }
        } finally {
            this.suppressFirstMessageTracking = false;
        }

        // Mark everything just appended as history. Messages are *prepended*
        // (each insert goes to DOM index 0 via `sentinel.before(...)`), so the
        // replayed entries occupy the first `added` children — the pre-existing
        // children (e.g. the sentinel) were pushed to the end. Iterating from
        // `firstHistoryIdx` would skip the newest history message (index 0,
        // visually right above the "now" separator) and uselessly gray the
        // sentinel instead.
        const added = this.messageDiv.children.length - firstHistoryIdx;
        for (let i = 0; i < added; i++) {
            this.messageDiv.children[i].classList.add("history");
        }

        // Reset state so the next live message starts a fresh bubble and
        // doesn't reuse a history bubble via the thread map.
        // Also clear userMessageById: clientRequestIds from prior sessions
        // (e.g. the shell's cmd-N counter resets each launch) can collide
        // with new live requests, causing hasUserMessage() to return a
        // false positive and silently drop the live user-message bubble.
        this.threadContainers.clear();
        this.requestAgentContainers.clear();
        this.currentUserThreadId = undefined;
        this.pendingThreadDisplayInfo.clear();
        this.userMessageById.clear();
        this.scrollToBottom();
    }

    /**
     * Stream-replay history in chunks so the browser can paint between
     * batches. Only renders the last `pageSize` entries initially; older
     * entries are stored in `pendingHistoryEntries` and loaded on demand
     * when the user clicks "Load earlier messages".
     * The host should call `setHistoryLoading(true)` before and
     * `setHistoryLoading(false)` after (or chain on the returned promise).
     */
    public async replayHistoryStreaming(
        entries: HistoryEntry[],
        chunkSize: number = 20,
        pageSize: number = 200,
    ): Promise<void> {
        if (!entries || entries.length === 0) return;

        // Slice to the last pageSize entries; stash the rest for paging.
        if (entries.length > pageSize) {
            this.pendingHistoryEntries = entries.slice(
                0,
                entries.length - pageSize,
            );
            entries = entries.slice(-pageSize);
        } else {
            this.pendingHistoryEntries = [];
        }

        this.threadContainers.clear();
        this.requestAgentContainers.clear();
        this.currentUserThreadId = undefined;
        this.pendingThreadDisplayInfo.clear();
        this.agentRunningRequestIds.clear();
        this.suppressFirstMessageTracking = true;

        try {
            for (let i = 0; i < entries.length; i += chunkSize) {
                const chunkEnd = Math.min(i + chunkSize, entries.length);
                const beforeChunk = this.messageDiv.children.length;

                for (let j = i; j < chunkEnd; j++) {
                    this._processHistoryEntry(entries[j]);
                }

                // Mark this chunk's newly-prepended elements as history.
                // Each entry goes to DOM index 0 (via sentinel.before),
                // so after processing the chunk the first `added` children
                // are the ones we just inserted.
                const chunkAdded =
                    this.messageDiv.children.length - beforeChunk;
                for (let k = 0; k < chunkAdded; k++) {
                    this.messageDiv.children[k].classList.add("history");
                }

                // Yield to the browser so it can paint the chunk.
                if (chunkEnd < entries.length) {
                    await new Promise<void>((resolve) =>
                        setTimeout(resolve, 0),
                    );
                }
            }
        } finally {
            this.suppressFirstMessageTracking = false;
        }

        this.threadContainers.clear();
        this.requestAgentContainers.clear();
        this.currentUserThreadId = undefined;
        this.pendingThreadDisplayInfo.clear();
        this.userMessageById.clear();
        this.scrollToBottom();

        // Show load-more button if older pages remain.
        if (this.pendingHistoryEntries.length > 0) {
            this._showLoadMoreHistory();
        }
    }

    /** Attach an invisible sentinel at the visual top of history; load more when it enters view. */
    private _showLoadMoreHistory(): void {
        if (this.loadMoreHistoryEl) return;
        const el = document.createElement("div");
        el.className = "chat-load-more-history";
        // appendChild puts it at DOM end = visual top (column-reverse).
        this.messageDiv.appendChild(el);
        this.loadMoreHistoryEl = el;

        // IntersectionObserver fires when the sentinel scrolls into view.
        this.loadMoreObserver = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    void this._loadMoreHistory();
                }
            },
            { root: this.messageDiv, threshold: 0 },
        );
        this.loadMoreObserver.observe(el);
    }

    /** Page in the next batch of older history entries. */
    private async _loadMoreHistory(
        chunkSize: number = 20,
        pageSize: number = 200,
    ): Promise<void> {
        if (
            this.isLoadingMoreHistory ||
            this.pendingHistoryEntries.length === 0 ||
            !this.loadMoreHistoryEl
        ) {
            return;
        }
        this.isLoadingMoreHistory = true;

        // Take the next page (newest-of-pending = entries closest to
        // the currently visible oldest history).
        const page = this.pendingHistoryEntries.slice(-pageSize);
        this.pendingHistoryEntries = this.pendingHistoryEntries.slice(
            0,
            -pageSize,
        );

        // Point the insertion anchor to loadMoreHistoryEl so all
        // add* helpers insert before it (visual top of history block)
        // instead of before firstElementChild (visual bottom).
        // Process newest-first within the page so that when inserted
        // before loadMoreEl, the oldest entry ends up highest visually
        // (column-reverse: last DOM position = visual top).
        this.replayInsertAnchor = this.loadMoreHistoryEl;
        this.suppressFirstMessageTracking = true;
        try {
            // Iterate from newest (end of page) to oldest (start).
            for (let i = page.length - 1; i >= 0; i -= chunkSize) {
                const chunkStart = Math.max(0, i - chunkSize + 1);

                // Snapshot what's just before loadMoreEl so we can
                // mark newly inserted elements as .history afterwards.
                const markerBefore =
                    this.loadMoreHistoryEl.previousElementSibling;

                for (let j = i; j >= chunkStart; j--) {
                    this._processHistoryEntry(page[j]);
                }

                // Walk from loadMoreEl backward to markerBefore and
                // mark every newly inserted element as .history.
                let cur = this.loadMoreHistoryEl.previousElementSibling;
                while (cur && cur !== markerBefore) {
                    cur.classList.add("history");
                    cur = cur.previousElementSibling;
                }

                // Yield to the browser between chunks.
                if (chunkStart > 0) {
                    await new Promise<void>((resolve) =>
                        setTimeout(resolve, 0),
                    );
                }
            }
        } finally {
            this.replayInsertAnchor = null;
            this.suppressFirstMessageTracking = false;
        }

        this.isLoadingMoreHistory = false;

        if (this.pendingHistoryEntries.length === 0) {
            this.loadMoreObserver?.disconnect();
            this.loadMoreObserver = undefined;
            this.loadMoreHistoryEl?.remove();
            this.loadMoreHistoryEl = undefined;
        }
        // If more pages remain, the observer keeps watching the sentinel
        // and will fire again when the user scrolls to the top.
    }

    /** Process a single HistoryEntry into the DOM (shared by sync and streaming replay). */
    private _processHistoryEntry(entry: HistoryEntry): void {
        switch (entry.kind) {
            case "user":
                this.addUserMessage(entry.text, entry.requestId);
                // Seed the up-arrow command history with replayed
                // user commands so it recalls prior-session input.
                // Entries arrive oldest-first; unshift keeps the
                // most recent command at index 0.
                if (
                    entry.text &&
                    entry.text.trim() &&
                    this.shouldAddToHistory(entry.text)
                ) {
                    this.commandHistory.unshift(entry.text);
                }
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
                        actionTokenUsage: entry.actionTokenUsage,
                        parsePhase: entry.parsePhase,
                    });
                }
                break;
        }
    }

    /** Update the source/agent label on the targeted thread's bubble. */
    public setDisplayInfo(
        source: string,
        sourceIcon?: string,
        action?: unknown,
        requestId?: string,
    ) {
        const threadId = this.resolveThreadId(requestId);
        const target = this.threadContainers.get(threadId);
        if (target) {
            // Fall back to the avatar map when the host doesn't pass an
            // icon — matches the create-path in getOrCreateAgentContainer
            // (effectiveIcon ?? iconForSource(effectiveSource)). Without
            // this, a bubble that was first created by the dispatcher's
            // "Translating ..." / "Executing action ..." status (source
            // "dispatcher", icon 🤖) and is later re-tagged via
            // setDisplayInfo to the real agent source would keep the
            // robot icon — updateSource is a no-op on icon when called
            // with undefined.
            target.updateSource(
                source,
                sourceIcon ?? this.iconForSource(source),
            );
            if (action !== undefined) {
                target.setActionData(action);
            }
            return;
        }
        // No container yet — stash so the next one gets the action JSON
        // attached (the dispatcher fires setDisplayInfo before the
        // agent's first setDisplay/appendDisplay for this thread).
        this.pendingThreadDisplayInfo.set(threadId, {
            source,
            sourceIcon,
            action,
        });
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
        this.threadContainers.clear();
        this.requestAgentContainers.clear();
        this.currentUserThreadId = undefined;
        this.pendingThreadDisplayInfo.clear();
        this.userMessageById.clear();
        this.requestStartByRequestId.clear();
        this.firstMessageMsByRequestId.clear();
        this.agentRunningRequestIds.clear();
        // Reset the up-arrow back stack too — `@clear` resets the chat, which
        // includes the command recall history seeded from prior-session
        // replayed commands. After clearing, recall starts empty until the
        // user issues new commands.
        this.commandHistory = [];
        this.historyIndex = -1;
        this.userHasManuallyScrolled = false;
        this.hasUnseenNewMessages = false;
        this.hideNewMessagesPill();
        if (this.statusContainer) {
            this.statusContainer.remove();
            this.statusContainer = undefined;
        }
        // Drop any active toasts as well — clear() means "reset the chat".
        if (this.toastStack) {
            this.toastStack.replaceChildren();
        }
        // Reset scroll state and pill
        this.userHasManuallyScrolled = false;
        this.hideNewMessagesPill();
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
        // Anchor the roadrunner inside the content bubble (top-right corner)
        // so it sits with the command text instead of floating in the
        // container's corner where it collided with the avatar / actions.
        // The hover tooltip is hosted on the bubble body (which doesn't clip
        // overflow), while the icon itself is positioned within the content.
        const bodyDiv =
            container.querySelector<HTMLElement>(".chat-message-user");
        const content = container.querySelector<HTMLElement>(
            ".chat-message-content",
        );
        const tooltipHost = bodyDiv ?? container;
        const iconHost = content ?? container;
        iconHost.classList.add("chat-message-explained-host");
        tooltipHost.classList.add("chat-message-explained");
        tooltipHost.setAttribute("data-expl", message);
        iconHost.appendChild(iconRoadrunner(color));
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
            actionTokenUsage?: CompletionUsageStats;
            parsePhase?: PhaseTiming;
            cancelled?: boolean;
        },
    ) {
        if (this.statusContainer) {
            this.statusContainer.remove();
            this.statusContainer = undefined;
        }
        const threadId = this.resolveThreadId(requestId);
        // The request is done — drop the in-flight marker and remove the
        // "working" rail + Stop from its agent bubble.
        this.clearAgentRunning(threadId);
        const requestContainers =
            this.requestAgentContainers.get(threadId) ?? [];
        const target =
            this.threadContainers.get(threadId) ??
            (requestContainers.length > 0
                ? requestContainers[requestContainers.length - 1]
                : undefined);
        const firstMessageMs = this.firstMessageMsByRequestId.get(threadId);
        if (result?.cancelled) {
            // Mirror Electron's "⚠ Cancelled" status, anchored to the
            // user bubble (column-reverse: DOM-before = visually-after).
            // Liveness check guards against detached anchors.
            const mappedBubble = this.userMessageById.get(threadId);
            const userBubble =
                mappedBubble && mappedBubble.parentElement === this.messageDiv
                    ? mappedBubble
                    : undefined;
            // Drop unknown explicit requestIds (post-clear stragglers)
            // rather than orphan them at the chat bottom.
            if (!target && requestId !== undefined && !userBubble) {
                // Orphan: chip already cleared by the queue path.
            } else {
                const cancelTarget =
                    target ??
                    this.createAgentContainer(
                        "shell",
                        this.iconForSource("shell"),
                        undefined,
                        userBubble,
                    );
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
        }
        if (result && target) {
            // Agent bubble shows ACTION token usage (the tokens the agent
            // consumed executing the action/command). `actionTokenUsage` is
            // passed through as-is: `undefined` => "not reported / unknown",
            // a present all-zero value => the agent ran but made no LLM call.
            target.updateMetrics(
                "Action",
                result.actionPhase,
                result.totalDuration,
                result.actionTokenUsage,
                firstMessageMs,
            );
        }
        // Request is finalized; future updates for this id should start with
        // a clean container list.
        this.requestAgentContainers.delete(threadId);
        if (result && requestId) {
            // Always attempt to populate user-side metrics. Even when the
            // request had no parse phase (e.g. cached translations or
            // chat-only paths), we still show the total elapsed so the
            // user bubble gets a metrics tooltip just like the agent's.
            // The user bubble shows TRANSLATION token usage (the LLM cost of
            // turning the request into actions); `undefined` for @-commands
            // and cached translations.
            this.applyUserMetrics(
                requestId,
                "Translation",
                result.parsePhase,
                result.totalDuration,
                result.tokenUsage,
            );
        }
        // Keep the thread's bubble in the map after completion so late
        // setDisplay calls (e.g. validation results from a host's takeAction
        // handler that runs out-of-band with the action's own ActionResult)
        // can still target the existing bubble instead of creating a new
        // empty one. addUserMessage() reaps stale entries when the next
        // user request starts.
        this.requestStartByRequestId.delete(threadId);
        this.firstMessageMsByRequestId.delete(threadId);
        if (this.currentUserThreadId === threadId) {
            this.currentUserThreadId = undefined;
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
     * Extract a plain-text rendering of DisplayContent for speech. Returns
     * undefined when there's nothing speakable.
     */
    private displayContentToText(content: DisplayContent): string | undefined {
        if (typeof content === "string") return content;
        if (content && typeof content === "object" && "content" in content) {
            const inner = (content as { content: unknown }).content;
            if (typeof inner === "string") return inner;
        }
        return undefined;
    }

    /** Speak `content` when a TTS provider is present and enabled. */
    private maybeSpeak(content: DisplayContent): void {
        if (!this.ttsProvider || !this.ttsProvider.isEnabled()) return;
        const text = this.displayContentToText(content);
        if (text && text.trim()) {
            void this.ttsProvider.speak(text);
        }
    }

    /**
     * Present a set of mutually-exclusive choices below a system message and
     * resolve with the chosen option's `value`. Generalizes askYesNo to an
     * arbitrary list with optional per-choice keyboard accelerators. Maps
     * directly from ClientIO.question / requestChoice.
     *
     * Set `opts.showMessage = false` to render only the choice buttons
     * without the prompt text — used by hosts that already display the
     * prompt separately (e.g. the shell renders the agent's `displayContent`
     * for `createYesNoChoiceResult`, so repeating it on the card would
     * duplicate the message).
     */
    public addChoicePrompt<T>(
        message: string,
        choices: ChoiceOption<T>[],
        opts?: {
            defaultValue?: T;
            signal?: AbortSignal;
            showMessage?: boolean;
            requestId?: string;
        },
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const signal = opts?.signal;
            // The host may abort before we even render (e.g. another connected
            // client answered the broadcast interaction first).
            if (signal?.aborted) {
                reject(
                    signal.reason ?? new DOMException("Aborted", "AbortError"),
                );
                return;
            }

            // When a requestId is supplied, append the buttons to that
            // request's existing agent bubble (the one already showing the
            // agent's displayContent / prompt) so the message and the choice
            // buttons render as a single card instead of two stacked boxes.
            const container = this.choicePromptContainer(opts?.requestId);
            if (opts?.showMessage !== false) {
                container.setMessage(
                    { type: "text", content: message },
                    undefined,
                    undefined,
                );
            }

            const buttonDiv = document.createElement("div");
            buttonDiv.className = "chat-prompt-buttons choice-panel";

            const cleanup = () => {
                buttonDiv.remove();
                document.removeEventListener("keydown", keyHandler);
                signal?.removeEventListener("abort", onAbort);
            };

            const choose = (value: T) => {
                cleanup();
                resolve(value);
            };

            // Allow the host to dismiss the prompt externally (another client
            // answered, or the server cancelled/timed out the interaction).
            const onAbort = () => {
                cleanup();
                reject(
                    signal?.reason ?? new DOMException("Aborted", "AbortError"),
                );
            };

            const keyHandler = (e: KeyboardEvent) => {
                const choice = choices.find((c) => c.keys?.includes(e.key));
                if (choice) {
                    e.preventDefault();
                    choose(choice.value);
                    return;
                }
                if (e.key === "Escape" && opts?.defaultValue !== undefined) {
                    e.preventDefault();
                    choose(opts.defaultValue);
                }
            };

            for (const choice of choices) {
                const btn = document.createElement("button");
                btn.className = "chat-prompt-button choice-button";
                if (choice.icon) btn.appendChild(choice.icon);
                btn.appendChild(document.createTextNode(choice.label));
                btn.addEventListener("click", () => choose(choice.value));
                buttonDiv.appendChild(btn);
            }

            signal?.addEventListener("abort", onAbort, { once: true });
            document.addEventListener("keydown", keyHandler);
            container.appendElement(buttonDiv);
            this.scrollToBottom();
        });
    }

    /**
     * Present a single-select radio list plus a "remember this" checkbox
     * below a system message and resolve with `{ selected, remember }`.
     * `selected` is the chosen index, or -1 when cancelled. Maps from
     * ClientIO.requestChoice with type "pickRemember".
     *
     * Set `opts.showMessage = false` to render only the panel without the
     * prompt text — used by hosts that already display the prompt separately
     * (the shell renders the agent's `displayContent` before requesting the
     * choice, so repeating it here would duplicate the message).
     */
    public addPickRememberPrompt(
        message: string,
        labels: string[],
        checkboxLabel: string,
        opts?: {
            signal?: AbortSignal;
            showMessage?: boolean;
            requestId?: string;
        },
    ): Promise<{ selected: number; remember: boolean }> {
        return new Promise((resolve, reject) => {
            const signal = opts?.signal;
            // The host may abort before we even render (e.g. another connected
            // client answered the broadcast interaction first).
            if (signal?.aborted) {
                reject(
                    signal.reason ?? new DOMException("Aborted", "AbortError"),
                );
                return;
            }

            // See addChoicePrompt: a requestId anchors the panel onto the
            // request's existing agent bubble so the prompt and the pick /
            // remember controls share one card.
            const container = this.choicePromptContainer(opts?.requestId);
            if (opts?.showMessage !== false) {
                container.setMessage(
                    { type: "text", content: message },
                    undefined,
                    undefined,
                );
            }

            const panelDiv = document.createElement("div");
            panelDiv.className = "pick-remember-panel";

            // Single-select candidate radio group.
            const radios: HTMLInputElement[] = [];
            const groupName = `pick-remember-${Date.now()}`;
            for (let i = 0; i < labels.length; i++) {
                const label = document.createElement("label");
                label.className = "pick-remember-choice";
                const radio = document.createElement("input");
                radio.type = "radio";
                radio.name = groupName;
                radio.dataset.index = String(i);
                if (i === 0) {
                    radio.checked = true;
                }
                radios.push(radio);
                label.appendChild(radio);
                const span = document.createElement("span");
                span.textContent = labels[i];
                label.appendChild(span);
                panelDiv.appendChild(label);
            }

            // Single "remember this" checkbox.
            const rememberLabel = document.createElement("label");
            rememberLabel.className = "pick-remember-toggle";
            const rememberCb = document.createElement("input");
            rememberCb.type = "checkbox";
            rememberLabel.appendChild(rememberCb);
            const rememberSpan = document.createElement("span");
            rememberSpan.textContent = checkboxLabel;
            rememberLabel.appendChild(rememberSpan);
            panelDiv.appendChild(rememberLabel);

            const cleanup = () => {
                panelDiv.remove();
                document.removeEventListener("keydown", keyHandler);
                signal?.removeEventListener("abort", onAbort);
            };

            const submit = () => {
                const picked = radios.find((r) => r.checked) ?? radios[0];
                const selected = picked
                    ? parseInt(picked.dataset.index!, 10)
                    : 0;
                const remember = rememberCb.checked;
                cleanup();
                resolve({ selected, remember });
            };

            const cancel = () => {
                cleanup();
                // -1 signals no selection / cancelled.
                resolve({ selected: -1, remember: false });
            };

            // Allow the host to dismiss the prompt externally (another client
            // answered, or the server cancelled/timed out the interaction).
            const onAbort = () => {
                cleanup();
                reject(
                    signal?.reason ?? new DOMException("Aborted", "AbortError"),
                );
            };

            const keyHandler = (e: KeyboardEvent) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                } else if (e.key === "Delete") {
                    e.preventDefault();
                    cancel();
                }
            };

            const buttonDiv = document.createElement("div");
            buttonDiv.className = "checkbox-buttons";

            const confirmBtn = document.createElement("button");
            confirmBtn.className = "choice-button";
            confirmBtn.textContent = "Confirm (Enter)";
            confirmBtn.addEventListener("click", () => submit());

            const cancelBtn = document.createElement("button");
            cancelBtn.className = "choice-button";
            cancelBtn.textContent = "Cancel (Del)";
            cancelBtn.addEventListener("click", () => cancel());

            buttonDiv.appendChild(confirmBtn);
            buttonDiv.appendChild(cancelBtn);
            panelDiv.appendChild(buttonDiv);

            signal?.addEventListener("abort", onAbort, { once: true });
            document.addEventListener("keydown", keyHandler);
            container.appendElement(panelDiv);
            this.scrollToBottom();
        });
    }

    /**
     * Show a Yes/No prompt and return the user's choice.
     *
     * Set `opts.showMessage = false` to render only the Yes/No buttons
     * without the prompt text — used by hosts that already display the
     * prompt separately (e.g. the shell renders the agent's `displayContent`
     * for `createYesNoChoiceResult`, so repeating it here would duplicate
     * the message).
     */
    public askYesNo(
        message: string,
        defaultValue?: boolean,
        opts?: { showMessage?: boolean; requestId?: string },
    ): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            // See addChoicePrompt: a requestId anchors the Yes/No buttons onto
            // the request's existing agent bubble so the prompt message and
            // the buttons render as a single card.
            const container = this.choicePromptContainer(opts?.requestId);
            if (opts?.showMessage !== false) {
                container.setMessage(
                    { type: "text", content: message },
                    undefined,
                    undefined,
                );
            }

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
     * Full template-editor action proposal (ported from the shell). Renders
     * the proposed action(s) as an editable field cascade with an
     * Accept/Edit/Cancel flow:
     *  - Accept  → resolves `undefined` (run the action(s) as-is).
     *  - Cancel  → resolves `null` (cancel the request).
     *  - Edit    → switches to edit mode (Replace/Cancel); Replace resolves the
     *              edited action data array, Cancel returns to Accept/Edit/Cancel.
     *
     * `services` is injected by the host (shell) so chat-ui needs no
     * agent-dispatcher dependency.
     */
    public proposeActionEdit(
        actionTemplates: TemplateEditConfig,
        source: string,
        services: TemplateEditServices,
    ): Promise<unknown> {
        const container = this.createAgentContainer(source, "");

        const actionContainer = document.createElement("div");
        actionContainer.className = "action-container";
        container.appendElement(actionContainer);

        const actionCascade = new TemplateEditor(
            actionContainer,
            services,
            actionTemplates,
        );

        return new Promise<unknown>((resolve) => {
            let keyHandler: ((e: KeyboardEvent) => void) | undefined;
            const setKeyHandler = (
                h: ((e: KeyboardEvent) => void) | undefined,
            ) => {
                if (keyHandler) {
                    document.removeEventListener("keydown", keyHandler);
                }
                keyHandler = h;
                if (keyHandler) {
                    document.addEventListener("keydown", keyHandler);
                }
            };

            const makeButtons = (
                buttons: { label: string; onClick: () => void }[],
            ): HTMLDivElement => {
                const buttonDiv = document.createElement("div");
                buttonDiv.className = "chat-prompt-buttons";
                for (const b of buttons) {
                    const btn = document.createElement("button");
                    btn.className = "chat-prompt-button";
                    btn.textContent = b.label;
                    btn.addEventListener("click", b.onClick);
                    buttonDiv.appendChild(btn);
                }
                return buttonDiv;
            };

            let buttonDiv: HTMLDivElement | undefined;
            const clearButtons = () => {
                buttonDiv?.remove();
                buttonDiv = undefined;
            };

            const finish = (value: unknown) => {
                setKeyHandler(undefined);
                clearButtons();
                actionContainer.remove();
                resolve(value);
            };

            const confirm = () => {
                clearButtons();
                buttonDiv = makeButtons([
                    { label: "Accept", onClick: () => finish(undefined) },
                    { label: "Edit", onClick: () => edit() },
                    { label: "Cancel", onClick: () => finish(null) },
                ]);
                container.appendElement(buttonDiv);
                setKeyHandler((e: KeyboardEvent) => {
                    if (e.key === "Enter") {
                        finish(undefined);
                    } else if (e.key === "Escape") {
                        finish(null);
                    } else if (e.key === "Delete") {
                        edit();
                    }
                });
                this.scrollToBottom();
            };

            const edit = () => {
                clearButtons();
                actionCascade.setEditMode(true);
                buttonDiv = makeButtons([
                    {
                        label: "Replace",
                        onClick: () => {
                            if (actionCascade.hasErrors) {
                                return;
                            }
                            finish(actionCascade.value);
                        },
                    },
                    {
                        label: "Cancel",
                        onClick: () => {
                            actionCascade.reset();
                            actionCascade.setEditMode(false);
                            confirm();
                        },
                    },
                ]);
                container.appendElement(buttonDiv);
                // No global key accelerators in edit mode — keystrokes go to
                // the field inputs.
                setKeyHandler(undefined);
                this.scrollToBottom();
            };

            confirm();
        });
    }

    /**
     * Register a dynamic display for periodic refresh.
     *
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
        const sentinel = this.insertionAnchor;
        const sep = document.createElement("div");
        sep.className = "chat-separator chat-history-separator";

        const leftLine = document.createElement("div");
        leftLine.className = "chat-separator-line";
        sep.appendChild(leftLine);

        const text = document.createElement("div");
        text.className = "chat-separator-text";
        text.textContent = label;
        sep.appendChild(text);

        const rightLine = document.createElement("div");
        rightLine.className = "chat-separator-line";
        sep.appendChild(rightLine);

        sentinel.before(sep);
    }

    /** Add a dimmed history user message. */
    public addHistoryUserMessage(text: string) {
        const sentinel = this.insertionAnchor;
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
            const sentinel = this.insertionAnchor;
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
     * Mark the local user as signed in to a Microsoft / Graph identity.
     * Updates userName/userInitial (so subsequent bubbles show the real
     * initial), retroactively rewrites every existing user-icon div in the
     * transcript, and flips isUserSignedIn so the avatar's click handler
     * stops triggering sign-in. Called after `@calendar login` succeeds —
     * either by the host directly, or via the embedded HTML marker scanner
     * in addAgentMessage.
     */
    public setUserSignedIn(name: string, email: string, photo?: string) {
        this.setUserInfo(name);
        this.isUserSignedIn = true;
        this.signedInEmail = email;
        this.userPhoto = photo;
        this.refreshAllUserIcons();
    }

    public setUserSignedOut() {
        this.isUserSignedIn = false;
        this.signedInEmail = undefined;
        this.userPhoto = undefined;
        // Reset display name/initial back to the default placeholders so
        // future user bubbles show "U" instead of the previously-signed-in
        // user's initial. Mirrors what setUserSignedIn does on its own
        // path (where it overwrites userName/userInitial via setUserInfo).
        this.userName = "You";
        this.userInitial = "U";
        this.refreshAllUserIcons();
    }

    private applyUserIconState(iconDiv: HTMLElement) {
        if (this.userPhoto) {
            // Render the MS Graph profile photo as a circular avatar; clear
            // the letter so it doesn't overlay the image. Use important
            // priority so it beats themed `background: ... !important` rules.
            iconDiv.classList.add("user-icon-photo");
            iconDiv.style.setProperty(
                "background-image",
                `url("${this.userPhoto}")`,
                "important",
            );
            // Set sizing inline (not just via the .user-icon-photo CSS
            // class) so the photo fills the circle regardless of CSS load
            // order — otherwise background-size stays `auto` and only the
            // native-resolution top-left corner shows, looking blank.
            iconDiv.style.setProperty("background-size", "cover", "important");
            iconDiv.style.setProperty(
                "background-position",
                "center",
                "important",
            );
            iconDiv.style.setProperty(
                "background-repeat",
                "no-repeat",
                "important",
            );
            iconDiv.textContent = "";
        } else {
            iconDiv.classList.remove("user-icon-photo");
            iconDiv.style.removeProperty("background-image");
            iconDiv.style.removeProperty("background-size");
            iconDiv.style.removeProperty("background-position");
            iconDiv.style.removeProperty("background-repeat");
            iconDiv.textContent = this.userInitial;
        }
        if (this.isUserSignedIn) {
            iconDiv.style.cursor = "default";
            iconDiv.title = this.signedInEmail
                ? `Signed in as ${this.userName} <${this.signedInEmail}>`
                : `Signed in as ${this.userName}`;
        } else {
            iconDiv.style.cursor = "pointer";
            iconDiv.title = "Sign in to Microsoft (calendar + email)";
        }
    }

    private refreshAllUserIcons() {
        const icons =
            this.messageDiv.querySelectorAll<HTMLElement>(".user-icon");
        icons.forEach((el) => this.applyUserIconState(el));
    }

    /**
     * Look for the hidden user-signed-in / user-signed-out markers that
     * calendar/email login + logout handlers append to their displays, and
     * lift them into UI state. The shapes are:
     *   <span class="typeagent-user-signed-in" data-name="..." data-email="..." hidden></span>
     *   <span class="typeagent-user-signed-out" hidden></span>
     * Markers are removed from the DOM after extraction so they don't leak
     * into subsequent history replays / copy-as-text.
     */
    private extractUserMarker(root: HTMLElement) {
        const signedIn = root.querySelectorAll<HTMLElement>(
            "span.typeagent-user-signed-in",
        );
        signedIn.forEach((el) => {
            const name = el.getAttribute("data-name");
            const email = el.getAttribute("data-email");
            const photo = el.getAttribute("data-photo") ?? undefined;
            if (name && email) {
                this.setUserSignedIn(name, email, photo);
            }
            el.remove();
        });
        const signedOut = root.querySelectorAll<HTMLElement>(
            "span.typeagent-user-signed-out",
        );
        signedOut.forEach((el) => {
            this.setUserSignedOut();
            el.remove();
        });
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
    /**
     * Tear down the panel's lifetime-bound listeners. Call this when the
     * host (e.g. a VS Code webview) is being disposed so the window-level
     * demo key handler doesn't survive the panel and fire stale callbacks
     * (or leak memory across panel reincarnations).
     *
     * Idempotent. Safe to call even if attachCompletion / setDemoPaused
     * were never invoked.
     */
    public dispose(): void {
        if (this.demoKeyHandler) {
            window.removeEventListener("keydown", this.demoKeyHandler, true);
            this.demoKeyHandler = undefined;
        }
        this.isDemoPaused = false;
        this.isDemoRunning = false;
        this.partialCompletion?.dispose();
        this.partialCompletion = undefined;
    }

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
        if (enabled) {
            // Reflect the current input contents rather than force-enabling:
            // an empty input must keep Send disabled even once the dispatcher
            // re-enables interaction.
            this.updateSendButtonState();
            this.inputArea.classList.remove("chat-input-disabled");
        } else {
            this.sendButton.disabled = true;
            this.inputArea.classList.add("chat-input-disabled");
            // No commands can be in flight when input is disabled (typically
            // because the dispatcher disconnected). Hide the stop button so
            // users can't try to cancel into a dead RPC channel.
            if (this.activeRequestId !== undefined) {
                this.setIdle();
            }
        }
    }

    /**
     * Show or hide the reconnect banner above the chat. Pass `undefined` to
     * hide. The banner is plain text only — hosts format the message
     * (countdown, attempt number, etc.) before passing it in.
     */
    public setReconnectStatus(message: string | undefined): void {
        if (this.reconnectBanner === undefined) return;
        if (message === undefined) {
            this.reconnectBanner.style.display = "none";
            this.reconnectBanner.textContent = "";
        } else {
            this.reconnectBanner.textContent = message;
            this.reconnectBanner.style.display = "";
        }
    }

    /**
     * Structured variant of {@link setReconnectStatus}. Renders the shared
     * connection-status model (reconnect countdown, or the `stopped` state with
     * clickable Retry / Start links) into the reconnect banner. Pass `undefined`
     * to hide it. `onAction` receives clicks on the manual-recovery links.
     */
    public setConnectionStatus(
        status: ConnectionStatus | undefined,
        onAction?: ConnectionActionHandler,
    ): void {
        if (this.reconnectBanner === undefined) return;
        if (status === undefined) {
            this.reconnectBanner.replaceChildren();
            this.reconnectBanner.style.display = "none";
            this.reconnectBanner.classList.remove("stopped");
            return;
        }
        this.reconnectBanner.classList.toggle(
            "stopped",
            status.phase === "stopped",
        );
        renderConnectionStatus(this.reconnectBanner, status, onAction);
        this.reconnectBanner.style.display = "";
    }

    /**
     * Disable input and show a placeholder while a conversation switch is in
     * progress. Re-enables input on `setSwitching(false)` (unless history is
     * still loading).
     */
    public setSwitching(switching: boolean, targetName?: string) {
        this.isSwitching = switching;
        if (switching) {
            // Reset scroll state when switching conversations
            this.userHasManuallyScrolled = false;
            this.hasUnseenNewMessages = false;
            this.hideNewMessagesPill();
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
            // Reset scroll state when loading history
            this.userHasManuallyScrolled = false;
            this.hasUnseenNewMessages = false;
            this.hideNewMessagesPill();
            this.setEnabledInternal(false);
            this.textInput.setAttribute("data-placeholder", "Loading history…");
            this.inputArea.classList.add("chat-input-history-loading");
            if (!this.historyLoadingPlaceholder) {
                const el = document.createElement("div");
                el.className = "chat-history-loading-indicator";
                el.innerHTML =
                    `<span class="chat-history-loading-dot"></span>` +
                    `<span class="chat-history-loading-dot"></span>` +
                    `<span class="chat-history-loading-dot"></span>`;
                this.messageDiv.appendChild(el);
                this.historyLoadingPlaceholder = el;
            }
        } else {
            this.inputArea.classList.remove("chat-input-history-loading");
            if (this.historyLoadingPlaceholder) {
                this.historyLoadingPlaceholder.remove();
                this.historyLoadingPlaceholder = undefined;
            }
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
     * Mark the dispatcher as initialized + display-log replay complete by
     * setting `data-dispatcher-ready="true"` on the scroll container
     * (`.chat`). Hosts call this once the dispatcher is connected and the
     * initial history replay has finished, so automated tests can wait for a
     * stable DOM before sending requests.
     */
    public markDispatcherReady(): void {
        this.messageDiv.setAttribute("data-dispatcher-ready", "true");
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
        // When pausing, ensure the chat input has focus so the
        // window-level demoKeyHandler reliably receives Ctrl+Right /
        // Esc. VS Code's `vscode-shell.chatView.focus` reveals the
        // webview view but doesn't always land focus inside the
        // contenteditable, so without this nudge the key events can
        // be swallowed by the surrounding VS Code UI before the
        // capture-phase handler runs.
        if (paused) {
            try {
                this.textInput.focus();
            } catch {
                // best-effort
            }
        }
    }

    private refreshDemoKeyHandler(): void {
        const wantHandler = this.isDemoPaused || this.isDemoRunning;
        if (wantHandler && !this.demoKeyHandler) {
            this.demoKeyHandler = (e: KeyboardEvent) => {
                if (!this.isDemoPaused && !this.isDemoRunning) return;
                if (
                    e.key === "ArrowRight" &&
                    (e.altKey || e.ctrlKey || e.metaKey) &&
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
            window.removeEventListener("keydown", this.demoKeyHandler, true);
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
        if (enabled) {
            this.updateSendButtonState();
            this.inputArea.classList.remove("chat-input-disabled");
        } else {
            this.sendButton.disabled = true;
            this.inputArea.classList.add("chat-input-disabled");
        }
    }

    /**
     * Pick the container that a choice prompt (Yes/No, multi-choice,
     * pickRemember) should attach its buttons to.
     *
     * With a `requestId` whose agent bubble already exists, reuse it so the
     * agent's prompt text (its `displayContent`) and the choice buttons share
     * a single card — otherwise the buttons would land in a separate
     * standalone "system" box stacked beneath the message. Falls back to a
     * fresh system container when there is no requestId or no bubble yet
     * (e.g. a bare `ClientIO.question` with no preceding displayContent).
     */
    private choicePromptContainer(requestId?: string): AgentMessageContainer {
        if (requestId !== undefined) {
            const existing = this.threadContainers.get(
                this.resolveThreadId(requestId),
            );
            if (existing) {
                return existing;
            }
        }
        return this.createAgentContainer("system", "");
    }

    private createAgentContainer(
        source: string,
        icon: string,
        threadId?: string,
        anchorElement?: Element,
    ): AgentMessageContainer {
        const beforeElement = anchorElement ?? this.insertionAnchor;
        const container = new AgentMessageContainer(
            beforeElement,
            source,
            icon,
            this.settingsView,
            this.platformAdapter,
        );
        if (threadId !== undefined) {
            this.attachFeedbackToContainer(container, threadId);
        }
        return container;
    }

    private attachFeedbackToContainer(
        container: AgentMessageContainer,
        threadId: string,
    ) {
        // The thread id IS the canonical requestId.requestId for user-driven
        // threads. For synthetic agent-N ids we still attach so the UI is
        // consistent; the host can choose to ignore feedback callbacks
        // whose requestId doesn't correspond to a known request.
        const requestId: RequestId = { requestId: threadId };
        const controller: FeedbackController = {
            getCurrentFeedback: () =>
                this.feedbackByRequestId.get(threadId) ?? null,
            submit: async (rating, category, comment, includeContext) => {
                const cb = this.onFeedback;
                if (!cb) return;
                try {
                    await cb(
                        requestId,
                        rating,
                        category,
                        comment,
                        includeContext,
                    );
                } catch (e) {
                    console.error("onFeedback callback failed", e);
                }
            },
        };
        // Only expose the trash affordance when the host supplied a hide hook.
        if (this.onFeedbackHidden) {
            controller.setHidden = async (hidden, target) => {
                this.onFeedbackHidden!(requestId, target ?? "agent", hidden);
            };
        }
        container.attachFeedbackController(controller, this._feedbackUIVariant);
        const existing = this.feedbackByRequestId.get(threadId);
        if (existing) {
            container.setFeedbackState(existing);
        }
    }

    /**
     * Apply a feedback entry to the matching bubble. Hosts call this when
     * the dispatcher broadcasts a UserFeedbackEntry (via ClientIO
     * onUserFeedback) or during replay of historical entries.
     */
    public applyFeedback(entry: UserFeedbackEntry): void {
        const tid = entry.requestId.requestId;
        if (!tid) return;
        this.feedbackByRequestId.set(tid, entry);
        const container = this.threadContainers.get(tid);
        container?.setFeedbackState(entry.rating === null ? null : entry);
    }

    public get feedbackUIVariant(): FeedbackUIVariant {
        return this._feedbackUIVariant;
    }

    /** Switch the variant for every existing agent bubble in the panel. */
    public setFeedbackUIVariant(variant: FeedbackUIVariant): void {
        if (this._feedbackUIVariant === variant) return;
        this._feedbackUIVariant = variant;
        for (const c of this.threadContainers.values()) {
            c.setFeedbackVariant(variant);
        }
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
        const target =
            this.currentUserThreadId !== undefined
                ? this.threadContainers.get(this.currentUserThreadId)
                : undefined;
        if (!target || buttons.length === 0) return;

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

        target.appendElement(buttonDiv);
        this.scrollToBottom();
    }

    private scrollToBottom() {
        // If user has manually scrolled away from bottom, don't auto-scroll.
        // Show the pill instead so they can choose to jump to new messages.
        if (this.userHasManuallyScrolled) {
            if (this.isNewestMessageVisible()) {
                this.hideNewMessagesPill();
                return;
            }
            this.hasUnseenNewMessages = true;
            this.showNewMessagesPill();
            return;
        }

        // With column-reverse flex, scrollTop 0 = bottom
        this.messageDiv.scrollTop = 0;
        this.hasUnseenNewMessages = false;
        this.hideNewMessagesPill();
    }

    /** Returns true when the newest message element is visible in the chat viewport. */
    private isNewestMessageVisible(): boolean {
        let newest = this.messageDiv.firstElementChild as HTMLElement | null;
        while (newest && newest.classList.contains("chat-sentinel")) {
            newest = newest.nextElementSibling as HTMLElement | null;
        }
        if (!newest) return true;

        const viewport = this.messageDiv.getBoundingClientRect();
        const rect = newest.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
    }

    /**
     * Check if the user is at the bottom of the chat.
     * In column-reverse flex, scrollTop = 0 or very small means we're at the bottom.
     */
    private updateScrollState() {
        const threshold = 10; // Allow 10px tolerance for scroll position
        const distanceFromBottom = Math.abs(this.messageDiv.scrollTop);
        const atBottom = distanceFromBottom <= threshold;

        if (atBottom) {
            // User scrolled back to bottom, clear the flag and hide the pill
            this.userHasManuallyScrolled = false;
            this.hasUnseenNewMessages = false;
            this.hideNewMessagesPill();
            return;
        }

        // Any non-trivial distance from bottom means the user intentionally
        // moved away from the live edge; lock out auto-scroll.
        this.userHasManuallyScrolled = true;
        if (!this.hasUnseenNewMessages || this.isNewestMessageVisible()) {
            this.hideNewMessagesPill();
            return;
        }
        this.showNewMessagesPill();
    }

    /** Show the new messages pill at the bottom of the chat */
    private showNewMessagesPill() {
        if (
            !this.newMessagesPill ||
            !this.userHasManuallyScrolled ||
            !this.hasUnseenNewMessages
        ) {
            return;
        }

        this.newMessagesPill.style.display = "flex";
        this.newMessagesPill.onclick = () => {
            // Scroll back to the bottom where new messages appear
            this.messageDiv.scrollTop = 0;
            this.userHasManuallyScrolled = false;
            this.hasUnseenNewMessages = false;
            // Hide the pill after scrolling
            setTimeout(() => {
                this.hideNewMessagesPill();
            }, 100);
        };
    }

    /** Hide the new messages pill and clear tracking */
    private hideNewMessagesPill() {
        if (!this.newMessagesPill) return;

        this.newMessagesPill.style.display = "none";
        this.newMessagesPill.onclick = null;
    }
}

/**
 * Manages a single agent message container within the chat panel.
 */
class AgentMessageContainer {
    public readonly div: HTMLDivElement;
    private readonly messageDiv: HTMLDivElement;
    private readonly bodyDiv: HTMLDivElement;
    private readonly detailsDiv: HTMLDivElement;
    private readonly metricsDiv: HTMLDivElement;
    private readonly nameSpan: HTMLSpanElement;
    private readonly iconDiv: HTMLDivElement;
    private readonly timestampDiv: HTMLDivElement;
    private feedbackWidget?: FeedbackWidget;
    private statusRail?: HTMLDivElement;
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

        this.timestampDiv = timestampDiv;
        this.div.appendChild(timestampDiv);

        // Icon
        this.iconDiv = document.createElement("div");
        this.iconDiv.className = "agent-icon";
        this.iconDiv.textContent = icon;
        this.div.appendChild(this.iconDiv);

        // Message body
        const bodyDiv = document.createElement("div");
        bodyDiv.className = "chat-message-body-hide-metrics chat-message-agent";
        this.bodyDiv = bodyDiv;

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
        this.metricsDiv.className =
            "chat-message-metrics chat-message-metrics-agent";
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
        //   left   — "First Message" + Tokens + phase.marks (one line each)
        //   middle — (reserved; tts metrics in the future)
        //   right  — main metrics (Action Elapsed / Total Elapsed)
        // This mirrors the Electron shell's MessageContainer layout so the
        // tooltip reads as "marks on the left, totals on the right".
        const mainLines: string[] = [];
        if (phase?.duration !== undefined) {
            mainLines.push(
                metricsLine(`${actionLabel} Elapsed`, phase.duration),
            );
        }
        if (totalDuration !== undefined) {
            mainLines.push(metricsLine("Total Elapsed", totalDuration));
        }
        const leftLines: string[] = [];
        if (firstMessageMs !== undefined) {
            leftLines.push(metricsLine("First Message", firstMessageMs));
        }
        // Token usage line. Distinguish three states:
        //   - undefined   => the agent did not report usage. This is NOT the
        //                    same as zero — the agent may have made LLM calls
        //                    we can't observe (esp. out-of-process agents).
        //   - all zero    => the agent ran but made no LLM call.
        //   - positive    => actual usage.
        if (tokenUsage) {
            // Compact form: "Action Tokens: 14356 (14257+99)" — the long
            // "(prompt N, completion M)" form overflowed the metrics
            // tooltip in narrow webview sidebars.
            leftLines.push(
                `${actionLabel} Tokens: <b>${tokenUsage.total_tokens}</b> ` +
                    `(${tokenUsage.prompt_tokens}+${tokenUsage.completion_tokens})`,
            );
        } else {
            leftLines.push(`${actionLabel} Tokens: <b>not reported</b>`);
        }
        if (phase?.marks) {
            for (const [key, value] of Object.entries(phase.marks)) {
                const avg = value.duration / Math.max(value.count, 1);
                const suffix =
                    value.count !== 1 ? `(out of ${value.count})` : "";
                leftLines.push(
                    `${escapeHtml(key)}: <b>${formatDuration(avg)}${suffix}</b>`,
                );
            }
        }
        this.metricsDiv.innerHTML = sanitize(
            `<div class="metrics-details">` +
                `<div>${leftLines.join("<br>")}</div>` +
                `<div></div>` +
                `<div>${mainLines.join("<br>")}</div>` +
                `</div>`,
        );
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
        this.detailsDiv.innerHTML = sanitize(html);
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

    /**
     * Show a small elapsed-time badge on this bubble (e.g. "+3.2s").
     * Used for reasoning step bubbles so the user can see how long
     * into the reasoning loop each phase occurred.
     */
    public setElapsedBadge(elapsedMs: number) {
        const badge = this.div.querySelector(".chat-step-elapsed");
        const text =
            elapsedMs < 1000
                ? `+${elapsedMs}ms`
                : `+${(elapsedMs / 1000).toFixed(1)}s`;
        if (badge) {
            badge.textContent = text;
        } else {
            const span = document.createElement("span");
            span.className = "chat-step-elapsed";
            span.textContent = text;
            // Insert after the agent name in the timestamp row
            this.nameSpan.parentElement?.appendChild(span);
        }
    }

    /**
     * Mark this container as a transient status indicator (used for
     * "Executing action ...", reasoning's streaming "Thinking…" chunks,
     * etc.). Adds a CSS class that styles the bubble as a small italicized
     * indicator with no agent label/avatar/border — so the user can't
     * mistake it for a duplicate of the real reply bubble.
     */
    public markAsStatusBubble() {
        this.div.classList.add("chat-message-status-bubble");
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

    /** Plain-text contents of the rendered message — used by the copy action. */
    public getMessageText(): string {
        return this.messageDiv.innerText;
    }

    public attachFeedbackController(
        controller: FeedbackController,
        variant: FeedbackUIVariant,
    ) {
        if (this.feedbackWidget !== undefined) return;
        this.feedbackWidget = new FeedbackWidget(
            {
                container: this.div,
                // chat-ui doesn't expose the bubble body as a separate
                // element — the message content sits directly inside the
                // container div. For bubble-corner placement we use the
                // messageDiv as the body so the action row anchors to it.
                bodyDiv: this.messageDiv,
                headerDiv: this.timestampDiv,
                messageDiv: this.messageDiv,
            },
            controller,
            variant,
        );
    }

    public setFeedbackState(entry: UserFeedbackEntry | null) {
        this.feedbackWidget?.setFeedbackState(entry);
    }

    public setFeedbackVariant(variant: FeedbackUIVariant) {
        this.feedbackWidget?.setVariant(variant);
    }

    /**
     * Show a "working" status rail at the top of the agent bubble while the
     * request is being processed: a spinner, a de-emphasized state label
     * (default "working"; agents may augment it, e.g. "thinking" while
     * reasoning), and a Stop button wired to `onStop`. Mirrors the user
     * bubble's status rail so the two read as one consistent affordance.
     * Idempotent — repeated calls update the label and re-wire Stop.
     */
    public setRunning(onStop: () => void, label: string = "working") {
        if (!this.statusRail) {
            const rail = document.createElement("div");
            rail.className = "chat-message-status-rail";
            rail.dataset.status = "running";
            const stateZone = document.createElement("span");
            stateZone.className = "chat-status-state-zone";
            const controls = document.createElement("span");
            controls.className = "chat-status-rail-controls";
            rail.append(stateZone, controls);
            // Insert as the body's first child so it sits above the message
            // content (the bottom edge stays free for the hover metrics).
            this.bodyDiv.insertBefore(rail, this.bodyDiv.firstChild);
            this.statusRail = rail;
        }
        const rail = this.statusRail;
        const stateZone = rail.querySelector<HTMLElement>(
            ":scope > .chat-status-state-zone",
        )!;
        const controls = rail.querySelector<HTMLElement>(
            ":scope > .chat-status-rail-controls",
        )!;

        stateZone.replaceChildren();
        const state = document.createElement("span");
        state.className = "chat-status-state";
        state.dataset.status = "running";
        const spinner = document.createElement("span");
        spinner.className = "chat-status-spinner";
        spinner.setAttribute("aria-hidden", "true");
        const labelSpan = document.createElement("span");
        labelSpan.textContent = label;
        state.append(spinner, labelSpan);
        stateZone.appendChild(state);

        controls.replaceChildren();
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = "chat-action-button danger chat-agent-stop-button";
        stop.dataset.action = "stop";
        stop.title = "Stop";
        stop.setAttribute("aria-label", "Stop this request");
        stop.appendChild(iconStop());
        stop.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            onStop();
        });
        controls.appendChild(stop);
    }

    /** Remove the "working" status rail (request finished or cancelled). */
    public clearRunning() {
        this.statusRail?.remove();
        this.statusRail = undefined;
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
