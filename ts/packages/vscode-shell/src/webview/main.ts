// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Webview entry point — runs in the browser sandbox inside VS Code.
// Communicates with the extension host via postMessage.
// The extension host manages the actual RPC connection to the agent server.
//
// Renders the shared `chat-ui` ChatPanel plus the host-managed session bar.

import {
    ChatPanel,
    ConversationBar,
    HistoryEntry,
    formatHistorySeparatorLabel,
    handleClipboardShortcut,
    STATUS_NOTICE_EVENT,
    parseStatusNotice,
    type ConnectionStatus,
} from "chat-ui";
import type {
    TemplateEditServices,
    DynamicDisplayResult,
    ImageCaptureProvider,
} from "chat-ui";
import { VsCodeAzureSpeechProvider } from "./azureSpeechProvider.js";
import { CameraView } from "./cameraView.js";
import { injectStyle } from "./injectStyle.js";
import type { SpeechToken } from "@typeagent/agent-server-protocol";
import chatPanelStyles from "chat-ui/styles";
import completionUiStyles from "@typeagent/completion-ui/styles.css";
import vscodeThemeStyles from "./vscode-theme.css";
import { QueueStateMirror } from "@typeagent/dispatcher-types";
import type {
    PendingInteractionRequest,
    PendingInteractionResponse,
    QueuedRequest,
    QueueSnapshot,
} from "@typeagent/dispatcher-types";

// Inject the chat-ui base styles first, then the completion-ui dropdown
// styles, then the VS Code theme overlay so it can override defaults via
// --vscode-* CSS variables.
injectStyle(chatPanelStyles as unknown as string);
injectStyle(completionUiStyles as unknown as string);
injectStyle(vscodeThemeStyles as unknown as string);

const vscode = acquireVsCodeApi();

const conversationBarRootEl = document.getElementById("conversation-bar-root")!;
const rootEl = document.getElementById("chat-root")!;

// Track the higher-level disabled reasons so we can reconcile them when
// any one of them flips. ChatPanel.setEnabled honors switching/history
// loading internally. Connection state does NOT gate the input: the user
// may type while disconnected, and the extension host queues those sends
// (AgentServerBridge.pendingSends) and flushes them once a session is
// ready — mirroring the Electron shell's pre-init send queue.
let isConnected = false;
let isSwitching = false;
let currentSessionId: string | undefined;

const conversationBar = new ConversationBar(conversationBarRootEl, {
    controller: {
        requestConversations: () => requestSessionList(),
        createConversation: (name: string) => {
            vscode.postMessage({ type: "createSession", name });
        },
        switchConversation: (conversationId: string) => {
            vscode.postMessage({
                type: "switchSession",
                sessionId: conversationId,
            });
        },
        renameConversation: (conversationId: string, name: string) => {
            vscode.postMessage({
                type: "renameSession",
                sessionId: conversationId,
                name,
            });
        },
        deleteConversation: (conversationId: string) => {
            vscode.postMessage({
                type: "deleteSession",
                sessionId: conversationId,
            });
        },
        connectionAction: (action) => {
            // Manual recovery from the "stopped" reconnect ribbon. The host
            // (AgentServerBridge) owns the actual retry / server-start logic.
            if (action === "retry") {
                vscode.postMessage({ type: "retryConnection" });
            } else if (action === "start") {
                vscode.postMessage({ type: "startServer" });
            }
        },
    },
    icons: {
        rename: { className: "codicon codicon-edit" },
        delete: { className: "codicon codicon-trash" },
        save: { className: "codicon codicon-check" },
        cancel: { className: "codicon codicon-close" },
    },
});

window.addEventListener("beforeunload", () => conversationBar.dispose());

// Azure Speech token round-trip: the mic provider asks the extension host
// (which relays to the agent server that owns the `speech:` config) for a
// short-lived token. Correlated by `id`; see "speechTokenResponse" below.
let nextSpeechTokenId = 1;
const pendingSpeechToken = new Map<
    number,
    (token: SpeechToken | undefined) => void
>();
function requestSpeechToken(
    timeoutMs = 15_000,
): Promise<SpeechToken | undefined> {
    const id = nextSpeechTokenId++;
    return new Promise<SpeechToken | undefined>((resolve) => {
        const timer = setTimeout(() => {
            if (pendingSpeechToken.delete(id)) resolve(undefined);
        }, timeoutMs);
        pendingSpeechToken.set(id, (token) => {
            clearTimeout(timer);
            resolve(token);
        });
        vscode.postMessage({ type: "getSpeechToken", id });
    });
}

// VS Code webviews cannot use getUserMedia: the webview-content iframe is
// created without `camera`/`microphone` in its Permissions-Policy `allow`
// attribute (only autoplay/clipboard/etc.), and an extension cannot change that
// attribute. This blocks BOTH the mic (Azure speech) and the in-webview camera
// capture. The affordances below are kept in the codebase but gated off until
// VS Code ships the proposed opt-in media API for webviews
// (microsoft/vscode#323602). Flip this to true to re-enable the mic + camera
// buttons once that lands.
//
// TODO: re-enable mic + camera when microsoft/vscode#323602 (opt-in webview
// media access) ships. Set this to true, adopt whatever opt-in the API
// requires, and verify getUserMedia works; the CameraView, speech provider,
// camera CSS, and CSP media-src are already in place.
const WEBVIEW_MEDIA_CAPTURE_SUPPORTED: boolean = false;

// Speech (mic) provider. Omitted while capture is unsupported so the mic button
// is not rendered; the Azure-backed provider (overriding the non-functional
// browser Web Speech API) is preserved for when it works again.
const speechProvider = WEBVIEW_MEDIA_CAPTURE_SUPPORTED
    ? new VsCodeAzureSpeechProvider(requestSpeechToken)
    : undefined;

// In-webview camera capture. chat-ui renders the camera button only when the
// host supplies imageCaptureProvider.openCamera; we mount a CameraView overlay
// and resolve openCamera() with the captured data URL. Gated off with the mic
// (see above) until getUserMedia is permitted. pickFile is intentionally left
// unset so the attach button keeps chat-ui's web-native file picker, which is
// NOT permissions-policy gated and works today.
let imageCaptureProvider: ImageCaptureProvider | undefined;
if (WEBVIEW_MEDIA_CAPTURE_SUPPORTED) {
    let pendingCapture: ((url: string | undefined) => void) | undefined;
    const cameraView = new CameraView((dataUrl) => {
        const resolve = pendingCapture;
        pendingCapture = undefined;
        resolve?.(dataUrl);
    });
    document.body.appendChild(cameraView.getContainer());
    imageCaptureProvider = {
        openCamera: () =>
            new Promise<string | undefined>((resolve) => {
                // Resolve any prior outstanding capture first (defensive; the
                // overlay is modal so overlap shouldn't normally happen).
                pendingCapture?.(undefined);
                pendingCapture = resolve;
                cameraView.show();
            }),
    };
}

const chatPanel = new ChatPanel(rootEl, {
    platformAdapter: {
        // Open links via the extension host — webviews can't call window.open
        // for arbitrary URLs in a useful way.
        handleLinkClick: (href: string, _target: string | null) => {
            vscode.postMessage({ type: "openExternal", href });
        },
        // Open the message in a new VS Code editor panel (movable / snappable)
        // rather than an in-page overlay. The extension host owns the panel; it
        // re-sanitizes the content before rendering.
        openMessageInWindow: (html: string, title?: string) => {
            vscode.postMessage({ type: "openMessageWindow", html, title });
            return true;
        },
    },
    // Mic + camera providers (see WEBVIEW_MEDIA_CAPTURE_SUPPORTED). Both are
    // undefined while getUserMedia is blocked in VS Code webviews, so neither
    // button renders; the attach-file button (web-native) still appears.
    speechProvider,
    imageCaptureProvider,
    onSend: (text: string, attachments, requestId: string) => {
        vscode.postMessage({
            type: "sendCommand",
            command: text,
            requestId,
            attachments,
        });
    },
    onCancel: (requestId: string) => {
        vscode.postMessage({ type: "cancelCommand", requestId });
    },
    onDeleteMessage: (requestId, target, permanent) => {
        vscode.postMessage({
            type: "deleteMessage",
            requestId: requestId.requestId,
            target,
            permanent,
        });
    },
    // Refresh callback for live-updating ("dynamic") displays. chat-ui's
    // setDynamicDisplay schedules the timer; each tick calls this to fetch
    // fresh content, routed through the host to dispatcher.getDynamicDisplay.
    // "html" is the render format (same choice as the visualStudio and
    // browser webview hosts).
    getDynamicDisplay: (source: string, displayId: string) =>
        bridgeRpc("getDynamicDisplay", [
            source,
            "html",
            displayId,
        ]) as Promise<DynamicDisplayResult>,
    // User rated an agent message (thumbs up/down). Forward to the host,
    // which calls dispatcher.recordUserFeedback; the resulting broadcast
    // (userFeedback) updates the bubble via applyFeedback.
    onFeedback: (requestId, rating, category, comment, includeContext) => {
        vscode.postMessage({
            type: "recordUserFeedback",
            requestId: requestId.requestId,
            rating,
            category,
            comment,
            includeContext,
        });
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

// ─── Server-driven interactions (dev-mode action confirmation / questions) ───
// The dispatcher (via the agent-server) can block a request on an interactive
// prompt: `@config dev on --confirm` confirms each translated action before it
// runs, and agents can ask questions. The host forwards these as
// `requestInteraction`; we render them with chat-ui and reply via
// `interactionResponse`. Without this the request blocks on the server until
// the 10-minute proposeAction timeout. In-flight prompts are tracked by
// interactionId so `interactionResolved` / `interactionCancelled` (another
// client answered, or a server timeout) can tear the local UI down.
const activeInteractions = new Map<string, AbortController>();

// Template-editor services (schema refresh + per-field completion) for the
// proposeAction edit flow. chat-ui is framework-free, so these are injected;
// each call is routed through the host to the dispatcher and correlated by id.
let nextBridgeRpcId = 1;
const pendingBridgeRpc = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
>();
function bridgeRpc(
    method: "getTemplateSchema" | "getTemplateCompletion" | "getDynamicDisplay",
    args: unknown[],
    timeoutMs = 30_000,
): Promise<unknown> {
    const id = nextBridgeRpcId++;
    return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
            if (pendingBridgeRpc.delete(id)) {
                reject(new Error(`bridgeRpc '${method}' timed out`));
            }
        }, timeoutMs);
        pendingBridgeRpc.set(id, {
            resolve: (v) => {
                clearTimeout(timer);
                resolve(v);
            },
            reject: (e) => {
                clearTimeout(timer);
                reject(e);
            },
        });
        vscode.postMessage({ type: "bridgeRpcRequest", id, method, args });
    });
}
const templateServices: TemplateEditServices = {
    getTemplateSchema: (templateAgentName, templateName, data) =>
        bridgeRpc("getTemplateSchema", [
            templateAgentName,
            templateName,
            data,
        ]) as ReturnType<TemplateEditServices["getTemplateSchema"]>,
    getTemplateCompletion: (
        templateAgentName,
        templateName,
        data,
        propertyName,
    ) =>
        bridgeRpc("getTemplateCompletion", [
            templateAgentName,
            templateName,
            data,
            propertyName,
        ]) as ReturnType<TemplateEditServices["getTemplateCompletion"]>,
};

// Render a server-driven interaction and reply with the user's response.
// Mirrors the Electron shell (chatPanelBridge.ts requestInteraction).
function handleRequestInteraction(
    interaction: PendingInteractionRequest,
): void {
    const ac = new AbortController();
    activeInteractions.set(interaction.interactionId, ac);
    void (async () => {
        let response: PendingInteractionResponse;
        try {
            if (interaction.type === "question") {
                const value = await chatPanel.addChoicePrompt<number>(
                    interaction.message,
                    interaction.choices.map((label, index) => ({
                        label,
                        value: index,
                    })),
                    { defaultValue: interaction.defaultId, signal: ac.signal },
                );
                response = {
                    interactionId: interaction.interactionId,
                    type: "question",
                    value,
                };
            } else {
                const value = await chatPanel.proposeActionEdit(
                    interaction.actionTemplates,
                    interaction.source,
                    templateServices,
                );
                response = {
                    interactionId: interaction.interactionId,
                    type: "proposeAction",
                    value,
                };
            }
        } catch (e) {
            // Aborted (resolved/cancelled by another client or server timeout)
            // — nothing to send.
            activeInteractions.delete(interaction.interactionId);
            if (!ac.signal.aborted) {
                console.error("[requestInteraction] failed", e);
            }
            return;
        }
        if (ac.signal.aborted) {
            activeInteractions.delete(interaction.interactionId);
            return;
        }
        activeInteractions.delete(interaction.interactionId);
        if (ac.signal.aborted) return;
        vscode.postMessage({ type: "interactionResponse", response });
    })().catch((e) => console.error("[requestInteraction] failed", e));
}

// Render a non-blocking choice card (yes/no, multi-select, or pick+remember)
// and reply with the user's response. Mirrors the Electron shell
// (chatPanelBridge.ts requestChoice). The prompt text is already rendered as
// the action's displayContent, so `showMessage:false` suppresses the card's
// duplicate copy and `requestId` anchors the buttons onto that agent bubble so
// the message and the buttons read as one card.
function handleRequestChoice(msg: {
    choiceId: string;
    choiceType: "yesNo" | "multiChoice" | "pickRemember";
    message: string;
    choices: string[];
    checkboxLabel?: string;
    requestId?: string;
}): void {
    void (async () => {
        const opts = { showMessage: false, requestId: msg.requestId };
        let response:
            | boolean
            | number[]
            | { selected: number; remember: boolean };
        if (msg.choiceType === "yesNo") {
            response = await chatPanel.askYesNo(msg.message, undefined, opts);
        } else if (msg.choiceType === "pickRemember") {
            response = await chatPanel.addPickRememberPrompt(
                msg.message,
                msg.choices,
                msg.checkboxLabel ?? "Remember this for next time",
                opts,
            );
        } else {
            const index = await chatPanel.addChoicePrompt<number>(
                msg.message,
                msg.choices.map((label, i) => ({ label, value: i })),
                opts,
            );
            response = [index];
        }
        vscode.postMessage({
            type: "choiceResponse",
            choiceId: msg.choiceId,
            response,
        });
    })().catch((e) => console.error("[requestChoice] failed", e));
}

// Mirror of dispatcher's queue lifecycle (requestQueued / requestStarted
// / requestCancelled / queueStateChanged) so we can dedupe "⚠ Cancelled"
// across paths and support double-Esc cancel-all without round-tripping.
// Two sets, intentionally separate:
//   * `cancelledRequests` — flagged cancelled (drops late setDisplay
//     stragglers).
//   * `cancelledRendered` — affordance already painted (one-shot claim
//     to avoid double-stamping).
// Merging them would have `markCancelled` race ahead of
// `claimCancelledRender` and suppress the affordance. Both wiped on
// sessionChanged / clear.
const queueMirror = new QueueStateMirror();
const cancelledRequests = new Set<string>();
const cancelledRendered = new Set<string>();

// Chips deferred until their bubble materializes. Keyed by targetRid
// (clientRid for local, serverRid for remote-only). `serverId` is the
// canonical id sent on user × click; needed because targetRid may BE
// the serverId.
const pendingQueueStatus = new Map<
    string,
    { status: "queued" | "running"; serverId: string }
>();

/**
 * Resolve the chat-ui bubble key for a queue entry. Local entries use
 * clientRequestId; peer entries fall back to the canonical server UUID
 * (the key used by `addRemoteUserMessage`).
 */
function chipTargetRid(
    entry: QueuedRequest,
    msgClientRequestId: string | undefined,
): string {
    return (
        (entry.clientRequestId as string | undefined) ??
        msgClientRequestId ??
        entry.requestId
    );
}

/**
 * Materialize a peer-originated user bubble so a chip has something
 * to attach to. No-op when the bubble already exists or `entry.text`
 * is missing.
 */
function materializeQueueBubbleIfMissing(
    entry: QueuedRequest,
    targetRid: string,
): void {
    if (chatPanel.hasUserMessage(targetRid)) return;
    if (entry.text) {
        chatPanel.addRemoteUserMessage(entry.text, targetRid);
    }
}

/**
 * Stamp a chip on the bubble for `targetRid` if it exists; otherwise
 * stash for later application. The × button cancels via the canonical
 * server id (the bridge accepts this as serverId when no client→server
 * mapping matches).
 */
function applyQueueChip(
    targetRid: string,
    serverId: string,
    status: "queued" | "running",
): void {
    if (!chatPanel.hasUserMessage(targetRid)) {
        pendingQueueStatus.set(targetRid, { status, serverId });
        return;
    }
    const onCancel =
        status === "queued"
            ? () =>
                  vscode.postMessage({
                      type: "cancelCommand",
                      requestId: serverId,
                  })
            : undefined;
    const onPromote =
        status === "queued"
            ? () =>
                  vscode.postMessage({
                      type: "promoteCommand",
                      requestId: serverId,
                  })
            : undefined;
    chatPanel.setUserBubbleQueueStatus(targetRid, status, onCancel, onPromote);
    pendingQueueStatus.delete(targetRid);
}

/** Clear chip and any pending stash. */
function clearQueueChip(targetRid: string): void {
    pendingQueueStatus.delete(targetRid);
    chatPanel.setUserBubbleQueueStatus(targetRid, null);
}

/**
 * Reapply chip state to match an authoritative snapshot. Snapshots are
 * the source of truth; fine-grained queue events are incremental hints.
 */
function reconcileQueueChips(
    prev: QueueSnapshot | undefined,
    next: QueueSnapshot | undefined,
): void {
    const live = new Set<string>();
    if (next?.running) {
        const targetRid = chipTargetRid(next.running, undefined);
        materializeQueueBubbleIfMissing(next.running, targetRid);
        live.add(targetRid);
        applyQueueChip(targetRid, next.running.requestId, "running");
    }
    for (const entry of next?.queued ?? []) {
        const targetRid = chipTargetRid(entry, undefined);
        materializeQueueBubbleIfMissing(entry, targetRid);
        live.add(targetRid);
        applyQueueChip(targetRid, entry.requestId, "queued");
    }
    const prevIds = new Set<string>();
    if (prev?.running) prevIds.add(chipTargetRid(prev.running, undefined));
    for (const e of prev?.queued ?? [])
        prevIds.add(chipTargetRid(e, undefined));
    for (const id of prevIds) {
        if (live.has(id)) continue;
        clearQueueChip(id);
    }
    for (const id of Array.from(pendingQueueStatus.keys())) {
        if (!live.has(id)) pendingQueueStatus.delete(id);
    }
}

/** Window (ms) for the double-Escape "cancel everything" gesture. */
const DOUBLE_ESCAPE_WINDOW_MS = 1000;
let lastEscapeTime = 0;

/**
 * Flag a request as cancelled. Variadic because the bridge surfaces
 * both client rid and server UUID; downstream payloads may key by either.
 */
function markCancelled(...rids: Array<string | undefined>): void {
    for (const rid of rids) {
        if (rid) cancelledRequests.add(rid);
    }
}

/** True if this request has ever been flagged as cancelled. */
function isCancelledRequest(rid: string | undefined): boolean {
    return rid !== undefined && cancelledRequests.has(rid);
}

/**
 * Idempotently claim the "⚠ Cancelled" render slot for a request.
 * Variadic — all supplied id forms (client rid, server UUID, aliases)
 * are added to the dedupe set on every call so a later event that
 * knows only one form still hits the dedupe. Returns true on first
 * claim, false thereafter.
 */
function claimCancelledRender(...rids: Array<string | undefined>): boolean {
    // Two-pass: read membership before adding so a call like
    // claim("X", "X") doesn't have arg 1's add() trip arg 2's has().
    let alreadyClaimed = false;
    let anyValid = false;
    for (const rid of rids) {
        if (!rid) continue;
        anyValid = true;
        if (cancelledRendered.has(rid)) alreadyClaimed = true;
    }
    for (const rid of rids) {
        if (rid) cancelledRendered.add(rid);
    }
    return anyValid && !alreadyClaimed;
}

// Map dispatcher's CommandResult to chat-ui's completeRequest result shape.
// dispatcher: { metrics: { actions: PhaseTiming[], command, parse, duration },
//               tokenUsage, actionTokenUsage, ... }
// chat-ui:    { actionPhase?, totalDuration?, tokenUsage?, actionTokenUsage?,
//               parsePhase? }
// We pick the last action's phase (or the command phase) as actionPhase, the
// overall duration as totalDuration, the parse phase as parsePhase (drives
// the "Translation" tooltip on the user bubble), and pass both the
// translation tokenUsage (user bubble) and actionTokenUsage (agent bubble)
// through.
function mapResult(result: any):
    | {
          actionPhase?: any;
          totalDuration?: number;
          tokenUsage?: any;
          actionTokenUsage?: any;
          parsePhase?: any;
          cancelled?: boolean;
      }
    | undefined {
    if (!result) return undefined;
    const metrics = result.metrics;
    const actions: any[] | undefined = metrics?.actions;
    const lastAction =
        actions && actions.length > 0 ? actions[actions.length - 1] : undefined;
    return {
        actionPhase: lastAction ?? metrics?.command,
        totalDuration: metrics?.duration,
        tokenUsage: result.tokenUsage,
        actionTokenUsage: result.actionTokenUsage,
        parsePhase: metrics?.parse,
        cancelled: result.cancelled === true,
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
// code-complexity-allow: history-event replay mapper; one branch per DisplayLogEntry type
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
                    actionTokenUsage: e.actionTokenUsage,
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

// Last-known connection state so demoPaused can re-render the status
// ribbon with a "[Demo paused]" suffix without re-issuing a status
// broadcast from the host.
let lastConnected = false;
let demoSuffix: string | undefined;
// Agent-server endpoint (host:port) surfaced in the connected indicator's
// tooltip. Cached from `status` messages that carry it so it survives status
// updates that omit it.
let serverEndpoint: string | undefined;
// Reconnect ribbon overlay shown while disconnected. Replaces the old
// per-attempt error spam in the chat area with a single in-place
// updating status (countdown, or a "stopped" state with Retry / Start
// links once auto-reconnect gives up).
let connectionStatus: ConnectionStatus | undefined;

function requestSessionList(): void {
    vscode.postMessage({ type: "requestSessions" });
}

function updateConversationBarStatus(): void {
    conversationBar.setStatus({
        connected: isConnected,
        switching: isSwitching,
        connection: connectionStatus,
        demoSuffix,
        endpoint: isConnected ? serverEndpoint : undefined,
    });
}

function setStatus(
    connected: boolean,
    sessionId?: string,
    sessionName?: string,
): void {
    isConnected = connected;
    lastConnected = connected;
    currentSessionId = sessionId ?? currentSessionId;
    if (sessionId || sessionName) {
        conversationBar.setCurrentConversation(sessionId, sessionName);
    }
    // Back online — drop any lingering reconnect/stopped ribbon state.
    if (connected) {
        connectionStatus = undefined;
    }
    updateConversationBarStatus();
    // Keep the input usable regardless of connection so the user can type
    // while (re)connecting; the host queues sends until a session is ready.
    chatPanel.setEnabled(true);
}

// code-complexity-allow: webview message router; single switch over all host message types
window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
        case "status":
            if (msg.endpoint !== undefined) {
                serverEndpoint = msg.endpoint;
            }
            setStatus(msg.connected, msg.sessionId, msg.sessionName);
            if (msg.connected && msg.sessionId) {
                currentSessionId = msg.sessionId;
                vscode.setState({
                    sessionId: msg.sessionId,
                    sessionName: msg.sessionName,
                });
                requestSessionList();
            }
            break;
        case "activateNewSessionInput":
            conversationBar.activateCreateInput();
            break;
        case "reconnectStatus": {
            // Single in-place reconnect indicator. Phases:
            //   waiting     -> "Disconnected — retrying in Ns (attempt N)"
            //   connecting  -> "Disconnected — connecting..."
            //   stopped     -> "Disconnected — stopped" + Retry / Start links
            //   cleared     -> hide overlay (back online or user disconnected)
            if (msg.phase === "cleared") {
                connectionStatus = undefined;
            } else {
                connectionStatus = {
                    phase: msg.phase,
                    attempt: msg.attempt,
                    secondsRemaining: msg.secondsRemaining,
                    error: msg.error,
                    actions: msg.actions,
                };
            }
            updateConversationBarStatus();
            break;
        }
        case "userInfo":
            chatPanel.setUserInfo(msg.name);
            break;
        case "developerMode":
            chatPanel.setDeveloperMode(msg.enabled);
            break;
        case "sessionChanged":
            currentSessionId = msg.sessionId;
            isSwitching = false;
            conversationBar.setCurrentConversation(
                msg.sessionId,
                msg.sessionName || msg.sessionId.substring(0, 8),
            );
            conversationBar.setStatus({
                switching: false,
                targetName: undefined,
            });
            conversationBar.setError(undefined);
            chatPanel.clear();
            cancelledRequests.clear();
            cancelledRendered.clear();
            pendingQueueStatus.clear();
            queueMirror.reset(undefined);
            requestSessionList();
            break;
        case "sessionList":
            conversationBar.setConversations(
                msg.sessions.map(
                    (session: {
                        sessionId: string;
                        name: string;
                        clientCount: number;
                        createdAt?: string;
                        source?: "copilot";
                    }) => ({
                        conversationId: session.sessionId,
                        name: session.name,
                        clientCount: session.clientCount,
                        createdAt: session.createdAt,
                        source: session.source,
                    }),
                ),
                msg.currentSessionId,
            );
            break;
        case "sessionError":
            conversationBar.setError(msg.message);
            break;
        case "setDisplay":
            // Drop display updates that arrive AFTER cancellation —
            // dispatcher status messages often race with the abort.
            if (isCancelledRequest(msg.requestId)) break;
            chatPanel.replaceAgentMessage(
                msg.message.message,
                msg.message.source,
                msg.message.sourceIcon,
                msg.requestId,
            );
            break;
        case "appendDisplay":
            if (isCancelledRequest(msg.requestId)) break;
            chatPanel.addAgentMessage(
                msg.message.message,
                msg.message.source,
                msg.message.sourceIcon,
                msg.mode,
                msg.requestId,
            );
            break;
        case "setUserRequest": {
            // Echo from server. If we already rendered locally, skip;
            // otherwise render as a peer bubble (don't hijack local
            // thread-routing state).
            const rid = msg.requestId;
            if (rid && !chatPanel.hasUserMessage(rid)) {
                chatPanel.addRemoteUserMessage(msg.command, rid);
                // Apply any chip status received before the bubble existed.
                const pending = pendingQueueStatus.get(rid);
                if (pending) {
                    applyQueueChip(rid, pending.serverId, pending.status);
                }
            }
            break;
        }
        case "setDisplayInfo":
            // Same rationale as the setDisplay guard above.
            if (isCancelledRequest(msg.requestId)) break;
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
            cancelledRequests.clear();
            cancelledRendered.clear();
            pendingQueueStatus.clear();
            break;
        case "notify": {
            const rid = msg.requestId;
            if (msg.event === "explained" && rid) {
                chatPanel.notifyExplained(rid, msg.data);
            } else if (msg.event === "grammarRule" && rid) {
                chatPanel.updateGrammarResult(rid, msg.data);
            } else if (msg.event === "commandComplete" && rid) {
                // Strip cancelled flag if already claimed elsewhere to
                // avoid double-stamping the affordance.
                const result = mapResult(msg.data?.result);
                const cancelled =
                    result?.cancelled === true &&
                    claimCancelledRender(rid, msg.aliasRequestId);
                chatPanel.completeRequest(
                    rid,
                    result ? { ...result, cancelled } : undefined,
                );
                // Defensive chip clear (see direct `commandComplete` case).
                clearQueueChip(rid);
                if (msg.aliasRequestId) clearQueueChip(msg.aliasRequestId);
            } else if (msg.event === "inline") {
                if (msg.source === "osNotifications" && rid) {
                    // OS notifications render as persistent, dismissable
                    // bubbles (removed on osDismiss), not ephemeral rows.
                    // The notificationId ("os:<id>") arrives as requestId.
                    chatPanel.addNotification(msg.data, msg.source, rid);
                } else {
                    chatPanel.showInline(msg.data, msg.source);
                }
            } else if (msg.event === "toast") {
                if (msg.source === "osNotifications" && rid) {
                    chatPanel.addNotification(msg.data, msg.source, rid);
                } else {
                    chatPanel.showToast(msg.data, msg.source);
                }
            } else if (msg.event === "osDismiss") {
                // The OS notification left the action center — drop the
                // matching persistent bubble. data.id is the "os:<id>"
                // notificationId used on the corresponding "added" event.
                if (msg.data && typeof msg.data.id === "string") {
                    chatPanel.removeNotification(msg.data.id);
                }
            } else if (msg.event === STATUS_NOTICE_EVENT) {
                const notice = parseStatusNotice(msg.data);
                if (notice) {
                    chatPanel.showStatusNotice(notice);
                }
            } else {
                chatPanel.addSystemMessage(`[${msg.source}] ${msg.event}`);
            }
            break;
        }
        case "error":
            // Drop awaitCommand rejection-from-cancel stragglers; the
            // "⚠ Cancelled" affordance is already on screen.
            if (isCancelledRequest(msg.requestId)) break;
            chatPanel.addSystemMessage(`Error: ${msg.message}`);
            break;
        case "commandResult":
            // Legacy — no-op
            break;
        case "commandComplete": {
            const rid = msg.requestId;
            const result = mapResult(msg.result);
            if (rid) {
                const cancelled =
                    result?.cancelled === true &&
                    claimCancelledRender(rid, msg.aliasRequestId);
                chatPanel.completeRequest(
                    rid,
                    result ? { ...result, cancelled } : undefined,
                );
                // Defensive: clear any lingering "running"/"queued"
                // chip on the local bubble. `queueStateChanged` will
                // also reconcile this on the next snapshot, but
                // clearing here makes the running indicator disappear
                // immediately on completion (and covers the case
                // where no follow-up snapshot fires).
                clearQueueChip(rid);
                if (msg.aliasRequestId) clearQueueChip(msg.aliasRequestId);
            }
            // Restore the send button (was swapped for the stop button
            // by send()/setProcessing). Done unconditionally so a
            // missing/garbled requestId still gets the input back.
            chatPanel.setIdle();
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
            isSwitching = msg.switching;
            conversationBar.setStatus({
                switching: msg.switching,
                statusLabel: msg.switching
                    ? (msg.statusLabel ?? "Connecting")
                    : undefined,
                targetName: msg.switching ? msg.targetName : undefined,
                errorText: undefined,
            });
            chatPanel.setSwitching(msg.switching, msg.targetName);
            // Re-enable input when the switch ends (connection state no
            // longer gates input — sends queue on the host while offline).
            if (!msg.switching) chatPanel.setEnabled(true);
            break;
        case "historyReplay": {
            // Stream the replay in chunks so the browser can paint between
            // batches. setHistoryLoading(false) comes from the extension
            // host after the entries are sent; also clear it here so replay
            // completion always re-enables input even if the host message
            // races or is lost.
            const replayEntries = toChatPanelHistory(msg.entries);
            void chatPanel.replayHistoryStreaming(replayEntries).then(() => {
                // Divider between replayed history and live messages,
                // matching the Electron shell. The bridge only sends
                // historyReplay when prior history exists, but guard
                // defensively.
                if (msg.entries.length > 0) {
                    chatPanel.addHistorySeparator(
                        formatHistorySeparatorLabel(msg.entries),
                    );
                }
                chatPanel.setHistoryLoading(false);
                chatPanel.setEnabled(true);
            });
            break;
        }
        case "setActive":
            document.body.classList.toggle("chat-inactive", !msg.active);
            break;
        case "historyLoading":
            chatPanel.setHistoryLoading(msg.loading);
            if (!msg.loading) chatPanel.setEnabled(true);
            break;
        case "conversationNotification":
            // Conversation-management feedback. We add a fresh agent
            // bubble rather than reusing the user request's bubble
            // because for switch/new/prev/next the request belongs to
            // the OLD conversation and `chatPanel.clear()` ran on
            // sessionChanged before this message arrived.
            chatPanel.addAgentMessage(
                { type: "html", content: msg.content, kind: msg.kind },
                "conversation",
            );
            break;
        case "pcState":
            chatPanel.applyPcState(msg.state);
            break;
        case "demoState":
            // Reflect demo state in the connection ribbon. The chat-ui
            // chatPanel still installs its capture-phase keyhandler
            // when paused (Esc cancels, Alt+→ continues) and a
            // dedicated input-ghost hint shows the controls.
            if (!msg.running) {
                demoSuffix = undefined;
            } else if (msg.paused) {
                demoSuffix = `[Demo Mode (Paused)${msg.message ? ` — ${msg.message}` : ""}]`;
            } else {
                demoSuffix = `[Demo Mode (Running)]`;
            }
            updateConversationBarStatus();
            chatPanel.setDemoPaused(msg.paused, msg.message);
            chatPanel.setDemoRunning(msg.running);
            chatPanel.setInputHint(
                msg.paused ? "Alt+→ continue · Esc cancel" : undefined,
            );
            break;
        case "demoTypeAndSend":
            // Animate typing into the chat input then submit, so demo
            // playback in the extension matches the Electron shell's
            // natural-keystroke effect. If cancelled mid-animation,
            // notify the host so it can release its waiter on this
            // requestId and let the demo loop see the cancel.
            void chatPanel
                .typeAndSend(msg.command, msg.requestId)
                .then((sent) => {
                    if (!sent) {
                        vscode.postMessage({
                            type: "demoLineCancelled",
                            requestId: msg.requestId,
                        });
                    }
                });
            break;
        case "demoCancelTyping":
            chatPanel.cancelTypingAnimation();
            break;
        // Per-conversation queue lifecycle events forwarded from the bridge.
        // The mirror keeps a local snapshot so the cancellation affordance
        // and the double-Esc gesture have authoritative state without
        // polling. Fine-grained events are admitted via QueueStateMirror's
        // version watermark so stragglers from before a newer snapshot
        // can't resurrect stale chips; `queueStateChanged` carries the
        // authoritative reconciliation.
        case "queueRequestQueued": {
            const result = queueMirror.applyQueued(msg.entry, msg.version);
            if (!result.admitted) break;
            const targetRid = chipTargetRid(msg.entry, msg.clientRequestId);
            materializeQueueBubbleIfMissing(msg.entry, targetRid);
            applyQueueChip(targetRid, msg.entry.requestId, "queued");
            break;
        }
        case "queueRequestStarted": {
            const result = queueMirror.applyStarted(msg.entry, msg.version);
            if (!result.admitted) break;
            if (result.previousRunning) {
                clearQueueChip(
                    chipTargetRid(result.previousRunning, undefined),
                );
            }
            const targetRid = chipTargetRid(msg.entry, msg.clientRequestId);
            materializeQueueBubbleIfMissing(msg.entry, targetRid);
            applyQueueChip(targetRid, msg.entry.requestId, "running");
            break;
        }
        case "queueRequestCancelled": {
            const mirrorResult = queueMirror.applyCancelled(
                msg.requestId,
                msg.version,
            );
            // Mark BOTH the server UUID and (if resolved) the
            // clientRequestId so subsequent display messages keyed by
            // either form are recognised as cancelled. The bridge
            // resolves the alias via `lookupClientRequestId`, but
            // belt-and-suspenders marking both protects against the
            // rare case where the lookup misses for a peer-originated
            // request that arrived before setUserRequest populated the
            // reverse map.
            markCancelled(msg.requestId, msg.clientRequestId);
            // Resolve which UI key to target. chat-ui keys bubbles by
            // clientRequestId (when known via the bridge's reverse map);
            // peer-originated requests fall back to the canonical server
            // id, which only has a matching bubble if a setUserRequest
            // already promoted it.
            const targetRid = msg.clientRequestId ?? msg.requestId;
            // Clear chip and any pending stash even if the version was
            // stale — the user's authoritative intent is "this is
            // cancelled", and a leftover chip would be misleading.
            clearQueueChip(targetRid);
            if (msg.clientRequestId !== msg.requestId) {
                clearQueueChip(msg.requestId);
            }
            // Stale events don't get to paint the cancellation
            // affordance — that would conflict with a newer snapshot.
            if (!mirrorResult.admitted) break;
            // Mirror the Electron shell guard
            // (chatView.ts:1089-1094: only notifyCancelled when
            // idToMessageGroup has the entry). For peer-originated
            // queued items that were cancelled BEFORE setUserRequest
            // ever fired in this tab — no user bubble was ever
            // rendered, so painting a stand-alone "⚠ Cancelled" agent
            // bubble would be a floating affordance with no anchor.
            // For our own requests, send() registers the user message
            // before any cancel can land, so this gate passes.
            if (!chatPanel.hasUserMessage(targetRid)) {
                if (chatPanel.getActiveRequestId() === targetRid) {
                    chatPanel.setIdle();
                }
                break;
            }
            // Dedupe against any prior commandComplete render. Pass BOTH
            // id forms so claim mirrors `markCancelled` — without this,
            // a later commandComplete keyed by the OTHER id form would
            // pass its own claim check and paint a second "⚠ Cancelled".
            if (claimCancelledRender(msg.requestId, msg.clientRequestId)) {
                chatPanel.completeRequest(targetRid, { cancelled: true });
            }
            // If the bubble that just cancelled is OUR active request,
            // pop the stop button back to the send button. setIdle()
            // is itself idempotent so it's safe to call regardless.
            if (chatPanel.getActiveRequestId() === targetRid) {
                chatPanel.setIdle();
            }
            break;
        }
        case "queueStateChanged": {
            const result = queueMirror.applyQueueStateChanged(msg.snapshot);
            if (!result.admitted) break;
            reconcileQueueChips(result.previous, msg.snapshot);
            break;
        }
        case "requestStatusUnknown":
            // Connection dropped mid-request — show a muted "status unknown"
            // rail instead of a stuck "working" spinner. Resolved on reconnect
            // via requestStatusResume / commandComplete.
            chatPanel.setRequestUnknown(msg.requestId);
            break;
        case "requestStatusResume":
            // Reconnect confirmed the request is still live: restore the
            // working rail (running) or just clear the unknown rail (queued —
            // its user-bubble chip is reconciled from the pushed snapshot).
            if (msg.status === "running") {
                chatPanel.resumeRunning(msg.requestId);
            } else {
                chatPanel.clearRequestUnknown(msg.requestId);
            }
            break;
        case "queuePending":
            // Offline send buffered in the host's pendingSends — mark the
            // bubble "queued" right away; the dispatcher snapshot reconciles
            // it (running / still queued / done) once it flushes on reconnect.
            chatPanel.setUserBubbleQueueStatus(msg.requestId, "queued");
            break;
        case "requestInteraction":
            handleRequestInteraction(msg.interaction);
            break;
        case "requestChoice":
            handleRequestChoice(msg);
            break;
        case "setDynamicDisplay":
            // Register/refresh a live-updating display. chat-ui owns the
            // refresh timer and calls back via the getDynamicDisplay option
            // wired at construction.
            chatPanel.setDynamicDisplay(
                msg.source,
                msg.displayId,
                msg.nextRefreshMs,
            );
            break;
        case "userFeedback":
            // A rating was recorded (by us or a peer) — mirror it onto the
            // matching bubble.
            chatPanel.applyFeedback(msg.entry);
            break;
        case "interactionResolved":
        case "interactionCancelled": {
            // Another client answered, or the server cancelled/timed out the
            // interaction — abort our local prompt so it stops waiting.
            const ac = activeInteractions.get(msg.interactionId);
            if (ac) {
                activeInteractions.delete(msg.interactionId);
                ac.abort();
            }
            break;
        }
        case "bridgeRpcResponse": {
            const pending = pendingBridgeRpc.get(msg.id);
            if (pending) {
                pendingBridgeRpc.delete(msg.id);
                if (msg.error !== undefined) {
                    pending.reject(new Error(msg.error));
                } else {
                    pending.resolve(msg.result);
                }
            }
            break;
        }
        case "speechTokenResponse": {
            const resolve = pendingSpeechToken.get(msg.id);
            if (typeof resolve === "function") {
                pendingSpeechToken.delete(msg.id);
                resolve(msg.token);
            }
            break;
        }
    }
});

// Ask the extension host to connect
updateConversationBarStatus();
vscode.postMessage({ type: "connect" });

// Document-level Escape gesture — mirrors the Electron shell
// (`packages/shell/src/renderer/src/chat/chatView.ts:404-422`):
//   * Single Esc with an active request → cancel that request.
//   * Two Esc presses within DOUBLE_ESCAPE_WINDOW_MS → cancel ALL
//     queued + running entries on the session.
// Chat-ui's own input-level handler (chatPanel.ts:712) takes care of
// completion-popup dismissal and cancellation when the input is focused,
// and calls `e.preventDefault()` when it consumes the keystroke. We
// honor that flag here so the gesture isn't double-counted.
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (e.defaultPrevented) {
        // chat-ui (or another in-iframe handler) already consumed this
        // Escape — but we still update the double-Esc clock so a paired
        // second press within the window can fire cancelAllQueuedAndRunning.
        const now = Date.now();
        const isDouble = now - lastEscapeTime <= DOUBLE_ESCAPE_WINDOW_MS;
        lastEscapeTime = now;
        if (isDouble) {
            lastEscapeTime = 0;
            vscode.postMessage({ type: "cancelAllQueuedAndRunning" });
        }
        return;
    }
    const now = Date.now();
    const isDouble = now - lastEscapeTime <= DOUBLE_ESCAPE_WINDOW_MS;
    lastEscapeTime = now;
    // Prefer chat-ui's notion of "active" (drives the send/stop button
    // toggle on this view). Fall back to the queue mirror's running
    // entry so an Esc landing in the brief gap between commandComplete
    // and the next requestStarted still cancels what's actually
    // executing on the dispatcher. Also covers peer-originated requests
    // we never tracked locally.
    const activeId =
        chatPanel.getActiveRequestId() ??
        queueMirror.snapshot?.running?.requestId;
    if (activeId) {
        // Cancel just the running request on first Esc — uses the same
        // path the chat-ui input handler would use when focused, so the
        // bridge sees a uniform cancelCommand message.
        e.preventDefault();
        vscode.postMessage({ type: "cancelCommand", requestId: activeId });
    }
    if (isDouble) {
        // Reset so a third press doesn't immediately re-trigger.
        lastEscapeTime = 0;
        e.preventDefault();
        vscode.postMessage({ type: "cancelAllQueuedAndRunning" });
    }
});

// VS Code webviews don't perform the native clipboard action on the DOM
// selection for Ctrl/Cmd+C|X the way the Electron shell does - only the
// JS clipboard path runs, which is why the right-click menu copies but
// the keyboard doesn't. Route these keys through chat-ui's shared
// clipboard logic so keyboard copy/cut work over the chat history and
// the message input.
document.addEventListener("keydown", (e) => {
    if (handleClipboardShortcut(e)) {
        e.preventDefault();
    }
});

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

// Tear down the panel's window-level listeners (demo key handler,
// completion controller) when the webview is being unloaded by VS
// Code. Window-scoped in a webview is per-iframe so the OS will
// reclaim the listeners regardless, but explicit dispose keeps the
// invariant clean for hosts that retain the panel across reloads.
window.addEventListener("pagehide", () => chatPanel.dispose());
