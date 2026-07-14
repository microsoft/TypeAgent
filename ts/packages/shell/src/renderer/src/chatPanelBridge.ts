// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shell renderer bridge that hosts the shared `chat-ui` ChatPanel and adapts
 * the Electron shell's dispatcher `ClientIO` + `Client` interfaces onto it.
 *
 * This replaces the bespoke `ChatView` UI: ClientIO display/notify/interaction
 * calls are mapped to ChatPanel methods, and ChatPanel's host callbacks
 * (onSend/onCancel/onFeedback) are routed back to the dispatcher. Electron
 * capability code (speech / TTS / camera / file picker) is injected via the
 * chat-ui provider interfaces (see electronProviders.ts).
 *
 * Completion (PartialCompletion) and the rich action template editor are
 * intentionally deferred to later phases; the bridge wires the core message,
 * notification, and interaction flows.
 */

import {
    ChatPanel,
    HistoryEntry,
    SettingsPanelSchema,
    HelpPanelContent,
    formatHistorySeparatorLabel,
    type TemplateEditServices,
    type ConnectionStatus,
} from "chat-ui";
import { AppAgentEvent } from "@typeagent/agent-sdk";
import {
    ClientIO,
    Dispatcher,
    PendingInteractionRequest,
    PendingInteractionResponse,
    RequestId,
} from "agent-dispatcher";
import {
    awaitCommand,
    QueueCancelReason,
    QueueStateMirror,
    type QueuedRequest,
    type QueueSnapshot,
} from "@typeagent/dispatcher-types";
import {
    createCompletionController,
    type CompletionController,
} from "agent-dispatcher/helpers/completion";
import {
    Client,
    NotifyCommands,
    SearchMenuItem,
    ShellUserSettings,
    SpeechToken,
    UserExpression,
} from "../../preload/electronTypes";
import type { ManageConversationPayload } from "@typeagent/agent-server-client/conversation";
import { defaultUserSettings } from "../../preload/shellSettingsType";
import { getClientAPI } from "./main";
import { setSpeechToken } from "./speechToken";
import {
    ElectronImageCaptureProvider,
    ElectronSpeechProvider,
    ElectronTtsProvider,
} from "./electronProviders";
import { CameraView } from "./cameraView";
import { getTTSProviders, getTTSVoices } from "./tts/tts";
import { enumerateMicrophones } from "./speech";

// Buffered @notify entries surfaced via `@notify show`.
type NotificationEntry = {
    event: string;
    source: string;
    data: any;
    read: boolean;
    requestId: RequestId | string | undefined;
};

/**
 * Normalize a dispatcher RequestId (object or string) to the string key the
 * ChatPanel uses for its per-request bubble threads. Prefers the
 * client-assigned id (which equals the requestId ChatPanel generated at send
 * time) and falls back to the server UUID for peer/replayed requests.
 */
function ridStr(requestId: RequestId | string | undefined): string | undefined {
    if (requestId === undefined) return undefined;
    if (typeof requestId === "string") return requestId;
    return (
        (requestId.clientRequestId as string | undefined) ?? requestId.requestId
    );
}

// Map dispatcher's CommandResult metrics to chat-ui's completeRequest shape.
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

// Convert the dispatcher's structured DisplayLogEntry[] into chat-ui
// HistoryEntry[] for replayHistory(). Mirrors vscode-shell's
// toHistoryReplayMessage + toChatPanelHistory, but works directly off the
// DisplayLogEntry shape (using ridStr to normalize RequestId → client id).
// code-complexity-allow: history-event replay mapper; one branch per DisplayLogEntry type
function toHistoryEntries(entries: any[]): HistoryEntry[] {
    // First pass: derive per-request "first message" timing (elapsed ms from
    // the user request to the first real agent display message).
    const userRequestTs = new Map<string, number>();
    const firstAgentTs = new Map<string, number>();
    for (const e of entries) {
        const rid =
            e.type === "set-display" || e.type === "append-display"
                ? ridStr(e.message?.requestId)
                : ridStr(e.requestId);
        if (!rid || typeof e.timestamp !== "number") continue;
        if (e.type === "user-request") {
            if (!userRequestTs.has(rid)) userRequestTs.set(rid, e.timestamp);
        } else if (e.type === "set-display" || e.type === "append-display") {
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
                    requestId: ridStr(e.requestId),
                    timestamp:
                        typeof e.timestamp === "number"
                            ? new Date(e.timestamp).toISOString()
                            : undefined,
                });
                break;
            case "set-display":
                out.push({
                    kind: "agent-replace",
                    content: e.message?.message,
                    source: e.message?.source,
                    requestId: ridStr(e.message?.requestId),
                    timestamp:
                        typeof e.timestamp === "number"
                            ? new Date(e.timestamp).toISOString()
                            : undefined,
                });
                break;
            case "append-display":
                // Skip ephemeral status lines — already superseded by real
                // content during the original interaction.
                if (e.mode === "temporary") break;
                out.push({
                    kind: "agent-append",
                    content: e.message?.message,
                    source: e.message?.source,
                    mode: e.mode,
                    requestId: ridStr(e.message?.requestId),
                    timestamp:
                        typeof e.timestamp === "number"
                            ? new Date(e.timestamp).toISOString()
                            : undefined,
                });
                break;
            case "set-display-info":
                out.push({
                    kind: "display-info",
                    source: e.source ?? "",
                    action: e.action,
                    requestId: ridStr(e.requestId),
                });
                break;
            case "command-result": {
                const m = e.metrics;
                const actions: any[] | undefined = m?.actions;
                const lastAction =
                    actions && actions.length > 0
                        ? actions[actions.length - 1]
                        : undefined;
                const rid = ridStr(e.requestId);
                out.push({
                    kind: "command-result",
                    requestId: rid,
                    actionPhase: lastAction ?? m?.command,
                    totalDuration: m?.duration,
                    tokenUsage: e.tokenUsage,
                    actionTokenUsage: e.actionTokenUsage,
                    parsePhase: m?.parse,
                    firstMessageMs: rid
                        ? firstMessageMsByRequestId.get(rid)
                        : undefined,
                });
                break;
            }
        }
    }
    return out;
}

export type ChatPanelClient = {
    client: Client;
    chatPanel: ChatPanel;
    cameraView: CameraView;
};

/**
 * Build the ChatPanel + provider stack, wire it to the dispatcher, and return
 * the dispatcher `Client` (already containing its `ClientIO`). The caller is
 * responsible for calling `getClientAPI().registerClient(client)`.
 */
export function createChatPanelClient(
    rootElement: HTMLElement,
    agents: Map<string, string>,
): ChatPanelClient {
    let dispatcher: Dispatcher | undefined;
    // Requests the user submitted before the dispatcher finished
    // initializing. Buffered here (rather than dropped with a "not ready"
    // notice) and flushed by dispatcherInitialized() once the dispatcher is
    // live — after the main process has enqueued the startup `@greeting`, so
    // the greeting stays at the head of the queue and these follow in the
    // order they were typed.
    const pendingSends: Array<{
        text: string;
        attachments: string[] | undefined;
        requestId: string;
    }> = [];
    let settings: ShellUserSettings = defaultUserSettings;
    const notifications: NotificationEntry[] = [];

    // Replay gate: history replay (triggered by `dispatcher-initialized`)
    // runs asynchronously while the main process may already be streaming
    // live content (e.g. the startup `@greeting`). If a live agent message
    // creates a per-request bubble and then `replayHistory()` clears the
    // thread-container map mid-flight, the follow-up reply lands in a fresh
    // container — producing a duplicate bubble. Buffer live display
    // mutations until replay has finished so they render on the post-replay
    // slate in call order.
    let replayDone = false;
    const pendingDisplayOps: Array<() => void> = [];
    const afterReplay = (op: () => void) => {
        if (replayDone) {
            op();
        } else {
            pendingDisplayOps.push(op);
        }
    };
    const flushPendingDisplayOps = () => {
        replayDone = true;
        const ops = pendingDisplayOps.splice(0);
        for (const op of ops) {
            op();
        }
    };

    // Toggle the `dark-mode` class on the document body so the shell's
    // theme styles (styles.less) and chat-ui CSS variables switch theme.
    const applyDarkMode = (enabled: boolean) => {
        document.body.classList.toggle("dark-mode", enabled);
    };

    // Tracks open deferred interaction prompts so they can be dismissed when
    // another client answers or the server cancels the interaction.
    const activeInteractions = new Map<string, AbortController>();

    // ─── Per-bubble queue chips ────────────────────────────────────────
    // Mirrors `vscode-shell/src/webview/main.ts`. Drives chat-ui's chip
    // surface off the dispatcher's four queue ClientIO events + a local
    // QueueStateMirror.
    //
    // Two cancel sets, intentionally separate:
    //   * cancelledRequests — drops late setDisplay stragglers.
    //   * cancelledRendered — one-shot claim to avoid double-stamping
    //     the "⚠ Cancelled" affordance.
    // Both wiped on clear / conversationChanged.
    const queueMirror = new QueueStateMirror();
    const cancelledRequests = new Set<string>();
    const cancelledRendered = new Set<string>();

    // Chips deferred until their bubble materializes. serverId is the
    // canonical id sent on × click (targetRid may BE the serverId for
    // peer-originated entries).
    const pendingQueueStatus = new Map<
        string,
        { status: "queued" | "running"; serverId: string }
    >();

    // Local entries key off clientRequestId; peer entries fall back to
    // the server UUID (same key as addRemoteUserMessage).
    function chipTargetRid(entry: QueuedRequest): string {
        return typeof entry.clientRequestId === "string"
            ? entry.clientRequestId
            : entry.requestId;
    }

    function markCancelled(...rids: Array<string | undefined>): void {
        for (const rid of rids) {
            if (rid) cancelledRequests.add(rid);
        }
    }

    function isCancelledRequest(rid: string | undefined): boolean {
        return rid !== undefined && cancelledRequests.has(rid);
    }

    // Two-pass so claim("X","X") doesn't have arg 1's add() trip arg 2's
    // membership check. Returns true on first claim.
    function claimCancelledRender(...rids: Array<string | undefined>): boolean {
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

    function materializeQueueBubbleIfMissing(
        entry: QueuedRequest,
        targetRid: string,
    ): void {
        if (chatPanel.hasUserMessage(targetRid)) return;
        if (entry.text) {
            chatPanel.addRemoteUserMessage(entry.text, targetRid);
        }
    }

    async function cancelByServerId(serverId: string): Promise<void> {
        const d = dispatcher;
        if (!d) return;
        try {
            await d.cancelCommand(serverId);
        } catch (e) {
            console.warn("cancelCommand failed for", serverId, e);
        }
    }

    async function promoteByServerId(serverId: string): Promise<void> {
        const d = dispatcher;
        if (!d) return;
        try {
            await d.promoteCommand(serverId);
        } catch (e) {
            console.warn("promoteCommand failed for", serverId, e);
        }
    }

    // Stash when the bubble isn't there yet; setUserRequest flushes.
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
                ? () => void cancelByServerId(serverId)
                : undefined;
        const onPromote =
            status === "queued"
                ? () => void promoteByServerId(serverId)
                : undefined;
        chatPanel.setUserBubbleQueueStatus(
            targetRid,
            status,
            onCancel,
            onPromote,
        );
        pendingQueueStatus.delete(targetRid);
    }

    function clearQueueChip(targetRid: string): void {
        pendingQueueStatus.delete(targetRid);
        chatPanel.setUserBubbleQueueStatus(targetRid, null);
    }

    // Snapshots are authoritative; fine-grained events are hints.
    function reconcileQueueChips(
        prev: QueueSnapshot | undefined,
        next: QueueSnapshot | undefined,
    ): void {
        const live = new Set<string>();
        if (next?.running) {
            const targetRid = chipTargetRid(next.running);
            materializeQueueBubbleIfMissing(next.running, targetRid);
            live.add(targetRid);
            applyQueueChip(targetRid, next.running.requestId, "running");
        }
        for (const entry of next?.queued ?? []) {
            const targetRid = chipTargetRid(entry);
            materializeQueueBubbleIfMissing(entry, targetRid);
            live.add(targetRid);
            applyQueueChip(targetRid, entry.requestId, "queued");
        }
        const prevIds = new Set<string>();
        if (prev?.running) prevIds.add(chipTargetRid(prev.running));
        for (const e of prev?.queued ?? []) prevIds.add(chipTargetRid(e));
        for (const id of prevIds) {
            if (live.has(id)) continue;
            clearQueueChip(id);
        }
        for (const id of Array.from(pendingQueueStatus.keys())) {
            if (!live.has(id)) pendingQueueStatus.delete(id);
        }
    }

    function resetQueueChipState(snapshot?: QueueSnapshot): void {
        for (const id of Array.from(pendingQueueStatus.keys())) {
            chatPanel.setUserBubbleQueueStatus(id, null);
        }
        pendingQueueStatus.clear();
        cancelledRequests.clear();
        cancelledRendered.clear();
        const prev = queueMirror.snapshot;
        queueMirror.reset(snapshot);
        if (snapshot) reconcileQueueChips(prev, snapshot);
    }

    // Driven by double-Escape. Reads from the local mirror so a
    // no-snapshot client is a silent no-op.
    async function cancelAllQueuedAndRunning(): Promise<void> {
        const snap = queueMirror.snapshot;
        const d = dispatcher;
        if (!d || !snap) return;
        const ids: string[] = [];
        if (snap.running) ids.push(snap.running.requestId);
        for (const entry of snap.queued) ids.push(entry.requestId);
        if (ids.length === 0) return;
        await Promise.all(
            ids.map(async (id) => {
                try {
                    await d.cancelCommand(id);
                } catch (e) {
                    console.warn("cancelCommand failed for", id, e);
                }
            }),
        );
    }
    // ────────────────────────────────────────────────────────────────────

    // Template-editor services backed by the live dispatcher (read the
    // `dispatcher` closure each call so it stays reconnect-safe).
    const templateServices: TemplateEditServices = {
        getTemplateSchema: (agentName, name, data) =>
            dispatcher!.getTemplateSchema(agentName, name, data),
        getTemplateCompletion: (agentName, name, data, propertyName) =>
            dispatcher!.getTemplateCompletion(
                agentName,
                name,
                data,
                propertyName,
            ),
    };

    // --- Providers -------------------------------------------------------
    const speechProvider = new ElectronSpeechProvider();
    const ttsProvider = new ElectronTtsProvider(() => settings);

    // Camera capture resolves a deferred promise with the captured image's
    // data URL so it fits the ImageCaptureProvider.openCamera contract.
    let pendingCapture: ((url: string | undefined) => void) | undefined;
    const cameraView = new CameraView((image: HTMLImageElement) => {
        const resolve = pendingCapture;
        pendingCapture = undefined;
        cameraView.hide();
        resolve?.(image.src);
    });
    const imageCaptureProvider = new ElectronImageCaptureProvider(
        () =>
            new Promise<string | undefined>((resolve) => {
                pendingCapture?.(undefined);
                pendingCapture = resolve;
                cameraView.show();
            }),
    );

    // --- Settings / help popups (minimal; enriched in a later phase) -----
    const settingsPanel: SettingsPanelSchema = {
        sections: [
            {
                title: "Speech & Audio",
                fields: [
                    {
                        id: "tts",
                        label: "Text-to-speech",
                        type: "toggle",
                        value: settings.tts,
                        onChange: (v) => {
                            settings.tts = v as boolean;
                            getClientAPI().saveSettings(settings);
                        },
                    },
                    {
                        id: "ttsProvider",
                        label: "TTS provider",
                        type: "select",
                        value: settings.ttsSettings.provider ?? "",
                        getOptions: async () =>
                            getTTSProviders().map((p) => ({
                                label: p,
                                value: p,
                            })),
                        onChange: (v) => {
                            settings.ttsSettings.provider = v as string;
                            getClientAPI().saveSettings(settings);
                        },
                    },
                    {
                        id: "ttsVoice",
                        label: "TTS voice",
                        type: "select",
                        value: settings.ttsSettings.voice ?? "",
                        getOptions: async () => {
                            const voices = await getTTSVoices(
                                settings.ttsSettings.provider ?? "",
                            );
                            return voices.map((v) =>
                                Array.isArray(v)
                                    ? { label: v[0], value: v[1] }
                                    : { label: v, value: v },
                            );
                        },
                        onChange: (v) => {
                            settings.ttsSettings.voice = v as string;
                            getClientAPI().saveSettings(settings);
                        },
                    },
                    {
                        id: "microphone",
                        label: "Microphone",
                        type: "select",
                        value: settings.microphoneId ?? "",
                        getOptions: async () => {
                            const mics = await enumerateMicrophones();
                            return mics.map((m) => ({
                                label: m[0],
                                value: m[1],
                            }));
                        },
                        onChange: (v) => {
                            settings.microphoneId = v as string;
                            getClientAPI().saveSettings(settings);
                        },
                    },
                ],
            },
            {
                title: "Appearance",
                fields: [
                    {
                        id: "darkMode",
                        label: "Dark mode",
                        type: "toggle",
                        value: settings.ui.darkMode,
                        onChange: (v) => {
                            settings.ui.darkMode = v as boolean;
                            applyDarkMode(settings.ui.darkMode);
                            getClientAPI().saveSettings(settings);
                        },
                    },
                ],
            },
        ],
    };

    const helpPanel: HelpPanelContent = {
        sections: [
            {
                title: "TypeAgent Shell",
                html: "Type a natural-language request, or prefix a command with @ (e.g. @help). Use the microphone button for voice input.",
            },
        ],
    };

    // Submit a user command to the dispatcher and finalize its bubble on
    // completion. Extracted from `onSend` so requests buffered before the
    // dispatcher was ready can be replayed through the identical path.
    function submitUserCommand(
        text: string,
        attachments: string[] | undefined,
        requestId: string,
    ): void {
        void (async () => {
            try {
                const result = await awaitCommand(
                    dispatcher!,
                    text,
                    attachments,
                    undefined,
                    requestId,
                );
                const mapped = mapResult(result);
                // Dedupe with queueRequestCancelled to avoid
                // double-stamping the affordance.
                const cancelled =
                    mapped?.cancelled === true &&
                    claimCancelledRender(requestId);
                chatPanel.completeRequest(
                    requestId,
                    mapped ? { ...mapped, cancelled } : undefined,
                );
                clearQueueChip(requestId);
            } catch (e: any) {
                // Drop rejection-from-cancel stragglers (affordance
                // already painted by queueRequestCancelled).
                if (!isCancelledRequest(requestId)) {
                    chatPanel.addSystemMessage(
                        `Error: ${e?.message ?? String(e)}`,
                    );
                }
                clearQueueChip(requestId);
            } finally {
                chatPanel.setIdle();
            }
        })();
    }

    // --- ChatPanel -------------------------------------------------------
    const chatPanel = new ChatPanel(rootElement, {
        platformAdapter: {
            handleLinkClick: (href: string) => {
                getClientAPI().openUrlExternal(href);
            },
        },
        onSend: (text, attachments, requestId) => {
            if (dispatcher === undefined) {
                // Dispatcher still initializing — queue the request instead
                // of dropping it. dispatcherInitialized() flushes these once
                // the dispatcher is live (after the startup `@greeting`). The
                // bubble stays in its processing state so it reads as pending.
                pendingSends.push({ text, attachments, requestId });
                return;
            }
            submitUserCommand(text, attachments, requestId);
        },
        onCancel: (requestId) => {
            dispatcher?.cancelCommandByClientId(requestId);
        },
        onFeedback: async (requestId, rating, category, comment, ctx) => {
            await dispatcher?.recordUserFeedback(
                requestId,
                rating,
                category,
                comment,
                ctx,
            );
        },
        onDeleteMessage: (requestId, target, permanent) => {
            // Developer-mode per-message delete. Reuse the feedback "hide"
            // RPC: permanent=true is a non-recoverable hard delete;
            // permanent=false is a recoverable soft delete (trash).
            void dispatcher?.recordUserHide(requestId, true, target, permanent);
        },
        speechProvider,
        ttsProvider,
        imageCaptureProvider,
        settingsPanel,
        helpPanel,
    });

    // Apply the initial theme from current settings (subsequent changes
    // flow through updateSettings / the dark-mode toggle).
    applyDarkMode(settings.ui.darkMode);

    // Document-level Escape: single Esc cancels active request; two
    // within DOUBLE_ESCAPE_WINDOW_MS cancel ALL queued + running.
    // Honors e.defaultPrevented so we don't double-count when chat-ui's
    // input handler already consumed the keystroke.
    const DOUBLE_ESCAPE_WINDOW_MS = 1000;
    let lastEscapeTime = 0;
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (e.defaultPrevented) {
            const now = Date.now();
            const isDouble = now - lastEscapeTime <= DOUBLE_ESCAPE_WINDOW_MS;
            lastEscapeTime = now;
            if (isDouble) {
                lastEscapeTime = 0;
                void cancelAllQueuedAndRunning();
            }
            return;
        }
        const now = Date.now();
        const isDouble = now - lastEscapeTime <= DOUBLE_ESCAPE_WINDOW_MS;
        lastEscapeTime = now;
        const activeClientId = chatPanel.getActiveRequestId();
        const fallbackServerId = queueMirror.snapshot?.running?.requestId;
        const activeId = activeClientId ?? fallbackServerId;
        if (activeId) {
            e.preventDefault();
            try {
                // Prefer clientId path; fall back to server-id for
                // peer-originated running requests.
                if (activeClientId !== undefined) {
                    dispatcher?.cancelCommandByClientId(activeClientId);
                } else {
                    void dispatcher?.cancelCommand(activeId);
                }
            } catch {
                // Channel may be gone (server killed).
            }
        }
        if (isDouble) {
            lastEscapeTime = 0;
            e.preventDefault();
            void cancelAllQueuedAndRunning();
        }
    });

    // Recognized speech is fed into the input by ChatPanel itself (it
    // registers speechProvider.onResult internally); no wiring needed here.

    // --- Command completion ---------------------------------------------
    // ChatPanel owns the inline ghost-text + dropdown UI (PartialCompletion)
    // and drives it via the pc* message protocol. We answer those messages
    // in-process with a CompletionController backed by the dispatcher (the
    // same controller the CLI and the agent-server host use), feeding state
    // changes back through chatPanel.applyPcState().
    let completionController: CompletionController | undefined;
    const ensureCompletionController = (): CompletionController | undefined => {
        if (dispatcher === undefined) {
            return undefined;
        }
        if (completionController === undefined) {
            completionController = createCompletionController(
                {
                    getCommandCompletion: (input, direction) =>
                        dispatcher!.getCommandCompletion(input, direction),
                },
                {
                    onUpdate: () => {
                        chatPanel.applyPcState(
                            completionController?.getCompletionState(),
                        );
                    },
                },
            );
        }
        return completionController;
    };
    chatPanel.attachCompletion((msg) => {
        switch (msg.type) {
            case "pcUpdate":
                ensureCompletionController()?.update(msg.input, msg.direction);
                break;
            case "pcAccept":
                completionController?.accept();
                break;
            case "pcDismiss":
                completionController?.dismiss(msg.input, msg.direction);
                break;
            case "pcHide":
                completionController?.hide();
                break;
            case "pcDispose":
                completionController?.dispose();
                completionController = undefined;
                break;
        }
    });

    // --- ClientIO --------------------------------------------------------
    const clientIO: ClientIO = {
        clear: () => {
            chatPanel.clear();
            resetQueueChipState();
        },
        exit: () => window.close(),
        shutdown: () => window.close(),
        setUserRequest: (requestId, command) => {
            afterReplay(() => {
                const rid = ridStr(requestId);
                if (rid && !chatPanel.hasUserMessage(rid)) {
                    chatPanel.addUserMessage(command, rid);
                }
                // Flush any chip stashed by a `requestQueued` race.
                if (rid) {
                    const pending = pendingQueueStatus.get(rid);
                    if (pending) {
                        applyQueueChip(rid, pending.serverId, pending.status);
                    }
                }
            });
        },
        setDisplayInfo: (requestId, source, _actionIndex, action) => {
            afterReplay(() => {
                if (isCancelledRequest(ridStr(requestId))) return;
                chatPanel.setDisplayInfo(
                    source,
                    undefined,
                    action,
                    ridStr(requestId),
                );
            });
        },
        setDisplay: (message) => {
            afterReplay(() => {
                if (isCancelledRequest(ridStr(message.requestId))) return;
                if (message.kind === "toast" || message.kind === "inline") {
                    chatPanel.showInline(message.message, message.source);
                    return;
                }
                chatPanel.replaceAgentMessage(
                    message.message,
                    message.source,
                    message.sourceIcon,
                    ridStr(message.requestId),
                );
            });
        },
        appendDisplay: (message, mode) => {
            afterReplay(() => {
                if (isCancelledRequest(ridStr(message.requestId))) return;
                if (message.kind === "toast" || message.kind === "inline") {
                    chatPanel.showInline(message.message, message.source);
                    return;
                }
                chatPanel.addAgentMessage(
                    message.message,
                    message.source,
                    message.sourceIcon,
                    mode,
                    ridStr(message.requestId),
                );
            });
        },
        appendDiagnosticData: () => {
            // Diagnostic data has no ChatPanel surface yet (deferred).
        },
        setDynamicDisplay: (
            _requestId,
            source,
            _actionIndex,
            displayId,
            nextRefreshMs,
        ) => {
            chatPanel.setDynamicDisplay(source, displayId, nextRefreshMs);
        },
        question: async (requestId, message, choices, defaultId) => {
            if (requestId === undefined) {
                throw new Error(
                    "Main process should have handled question with no requestId",
                );
            }
            return chatPanel.addChoicePrompt<number>(
                message,
                choices.map((label, index) => ({ label, value: index })),
                { defaultValue: defaultId },
            );
        },
        proposeAction: async (_requestId, actionTemplates, source) => {
            // undefined = accept as-is, null = cancel, array = edited actions.
            return chatPanel.proposeActionEdit(
                actionTemplates,
                source,
                templateServices,
            );
        },
        notify: (requestId, event, data, source) => {
            switch (event) {
                case "explained":
                    chatPanel.notifyExplained(ridStr(requestId)!, data);
                    break;
                case "developerMode":
                    // Toggle dev-only UI affordances (per-message delete).
                    chatPanel.setDeveloperMode(data?.enabled === true);
                    break;
                case "randomCommandSelected":
                    break;
                case "grammarRule":
                    chatPanel.updateGrammarResult(
                        ridStr(requestId)!,
                        data.success,
                        data.message,
                    );
                    break;
                case "showNotifications":
                    handleShowNotifications(data);
                    break;
                case AppAgentEvent.Error:
                case AppAgentEvent.Warning:
                case AppAgentEvent.Info:
                    notifications.push({
                        event,
                        source,
                        data,
                        read: false,
                        requestId,
                    });
                    break;
                case AppAgentEvent.Inline:
                    if (source === "osNotifications") {
                        // OS notifications render as persistent, dismissable
                        // bubbles (removed on osDismiss), NOT ephemeral
                        // toast/inline rows. The notificationId ("os:<id>")
                        // arrives as the notify requestId.
                        chatPanel.addNotification(
                            data,
                            source,
                            ridStr(requestId)!,
                        );
                        break;
                    }
                    chatPanel.showInline(data, source);
                    notifications.push({
                        event,
                        source,
                        data,
                        read: false,
                        requestId,
                    });
                    break;
                case AppAgentEvent.Toast:
                    if (source === "osNotifications") {
                        chatPanel.addNotification(
                            data,
                            source,
                            ridStr(requestId)!,
                        );
                        break;
                    }
                    chatPanel.showToast(data, source);
                    notifications.push({
                        event,
                        source,
                        data,
                        read: false,
                        requestId,
                    });
                    break;
                case "osDismiss":
                    // The OS notification left the action center — drop the
                    // corresponding persistent bubble. data.id matches the
                    // notificationId ("os:<id>") used on the "added" event.
                    if (data && typeof data.id === "string") {
                        chatPanel.removeNotification(data.id);
                    }
                    break;
                default:
                    break;
            }
        },
        openLocalView: async () => {
            throw new Error("Main process should have handled openLocalView");
        },
        closeLocalView: async () => {
            throw new Error("Main process should have handled closeLocalView");
        },
        requestChoice: (
            requestId,
            choiceId,
            type,
            message,
            choices,
            _source,
            checkboxLabel,
        ) => {
            void (async () => {
                // The prompt text is already rendered as the agent's
                // displayContent (emitActionResult appends it before
                // requesting the choice), so suppress the card's duplicate
                // copy and show just the buttons. Pass the requestId so the
                // buttons attach to that agent bubble instead of a separate
                // box. See the option-2 TODO in
                // agentSdk/src/helpers/actionHelpers.ts for the source-side
                // dedup that would let every host drop this workaround.
                const rid = ridStr(requestId);
                if (type === "yesNo") {
                    const yes = await chatPanel.askYesNo(message, undefined, {
                        showMessage: false,
                        requestId: rid,
                    });
                    await dispatcher?.respondToChoice(choiceId, yes);
                } else if (type === "pickRemember") {
                    const result = await chatPanel.addPickRememberPrompt(
                        message,
                        choices,
                        checkboxLabel ?? "Remember this for next time",
                        { showMessage: false, requestId: rid },
                    );
                    await dispatcher?.respondToChoice(choiceId, result);
                } else {
                    const index = await chatPanel.addChoicePrompt<number>(
                        message,
                        choices.map((label, i) => ({ label, value: i })),
                        { showMessage: false, requestId: rid },
                    );
                    await dispatcher?.respondToChoice(choiceId, [index]);
                }
            })().catch((e) =>
                console.error("[requestChoice] failed", e, requestId),
            );
        },
        requestInteraction: (interaction: PendingInteractionRequest) => {
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
                            {
                                defaultValue: interaction.defaultId,
                                signal: ac.signal,
                            },
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
                    activeInteractions.delete(interaction.interactionId);
                    return;
                }
                activeInteractions.delete(interaction.interactionId);
                try {
                    await dispatcher?.respondToInteraction(response);
                } catch {
                    // Interaction may have already timed out on the server.
                }
            })();
        },
        interactionResolved: (interactionId) => {
            const ac = activeInteractions.get(interactionId);
            if (ac) {
                activeInteractions.delete(interactionId);
                ac.abort({ kind: "resolved-by-other" });
                chatPanel.addSystemMessage(
                    "Interaction answered by another client.",
                );
            }
        },
        interactionCancelled: (interactionId) => {
            const ac = activeInteractions.get(interactionId);
            if (ac) {
                activeInteractions.delete(interactionId);
                ac.abort("cancelled");
                chatPanel.addSystemMessage("Interaction cancelled.");
            }
        },
        takeAction: (_requestId, action, data) => {
            handleTakeAction(action, data);
        },
        onUserFeedback: (entry) => {
            chatPanel.applyFeedback(entry);
        },
        onUserHide: () => {
            // Hidden-state mirroring across peers is deferred.
        },
        requestQueued: (entry, version) => {
            const result = queueMirror.applyQueued(entry, version);
            if (!result.admitted) return;
            const targetRid = chipTargetRid(entry);
            // Mirror updates sync (version watermark); DOM defers until
            // replay finishes (replayHistory clears userMessageById).
            afterReplay(() => {
                materializeQueueBubbleIfMissing(entry, targetRid);
                applyQueueChip(targetRid, entry.requestId, "queued");
            });
        },
        requestStarted: (entry, version) => {
            const result = queueMirror.applyStarted(entry, version);
            if (!result.admitted) return;
            const previousRunningTarget = result.previousRunning
                ? chipTargetRid(result.previousRunning)
                : undefined;
            const targetRid = chipTargetRid(entry);
            afterReplay(() => {
                if (previousRunningTarget) {
                    clearQueueChip(previousRunningTarget);
                }
                materializeQueueBubbleIfMissing(entry, targetRid);
                applyQueueChip(targetRid, entry.requestId, "running");
            });
        },
        requestCancelled: (
            requestId: string,
            _reason: QueueCancelReason,
            version: number,
        ) => {
            // Capture target BEFORE applyCancelled mutates the snapshot.
            const snapBefore = queueMirror.snapshot;
            let preTargetRid: string | undefined;
            if (snapBefore?.running?.requestId === requestId) {
                preTargetRid = chipTargetRid(snapBefore.running);
            } else {
                const queued = snapBefore?.queued.find(
                    (e) => e.requestId === requestId,
                );
                if (queued) preTargetRid = chipTargetRid(queued);
            }
            // Mark sync (not behind afterReplay) so display guards see it
            // immediately. Stale-version cancels still mark — user intent
            // is authoritative.
            markCancelled(requestId, preTargetRid);
            const result = queueMirror.applyCancelled(requestId, version);
            const targetRid = preTargetRid ?? requestId;
            afterReplay(() => {
                // Clear chip even on stale versions.
                clearQueueChip(targetRid);
                if (targetRid !== requestId) clearQueueChip(requestId);
                if (!result.admitted) return;
                // No bubble = peer-originated queued item cancelled
                // before our setUserRequest fired; skip the affordance.
                if (!chatPanel.hasUserMessage(targetRid)) {
                    if (chatPanel.getActiveRequestId() === targetRid) {
                        chatPanel.setIdle();
                    }
                    return;
                }
                // Dedupe against awaitCommand's completeRequest path.
                if (claimCancelledRender(requestId, preTargetRid)) {
                    chatPanel.completeRequest(targetRid, { cancelled: true });
                }
                if (chatPanel.getActiveRequestId() === targetRid) {
                    chatPanel.setIdle();
                }
            });
        },
        queueStateChanged: (snapshot) => {
            const result = queueMirror.applyQueueStateChanged(snapshot);
            if (!result.admitted) return;
            const previous = result.previous;
            afterReplay(() => reconcileQueueChips(previous, snapshot));
        },
    };

    function handleShowNotifications(data: NotifyCommands) {
        switch (data) {
            case NotifyCommands.Clear:
                notifications.length = 0;
                break;
            case NotifyCommands.ShowAll:
            case NotifyCommands.ShowUnread: {
                const showAll = data === NotifyCommands.ShowAll;
                const items = notifications.filter((n) => showAll || !n.read);
                const html = items.length
                    ? `<ul>${items
                          .map((n) => {
                              n.read = true;
                              return `<li class="notification-${n.event}">${n.event} ${String(n.data)}</li>`;
                          })
                          .join("")}</ul>`
                    : "No notifications.";
                chatPanel.showInline({ type: "html", content: html }, "shell");
                break;
            }
            case NotifyCommands.ShowSummary: {
                const unread = notifications.filter((n) => !n.read).length;
                chatPanel.showInline(
                    {
                        type: "html",
                        content: `There are <b>${unread}</b> unread and <b>${notifications.length}</b> total notifications.`,
                    },
                    "shell",
                );
                break;
            }
            default:
                break;
        }
    }

    function handleTakeAction(action: string, data: unknown) {
        try {
            const d: any = data;
            switch (action) {
                case "show-camera":
                    cameraView.show();
                    break;
                case "trash-restore":
                    dispatcher
                        ?.restoreAllHidden()
                        .catch((e) =>
                            console.error("restoreAllHidden failed", e),
                        );
                    break;
                case "trash-flush":
                    dispatcher
                        ?.flushHidden()
                        .catch((e) => console.error("flushHidden failed", e));
                    break;
                case "open-folder":
                    getClientAPI().openFolder(data as string);
                    break;
                case "manage-conversation":
                    void handleManageConversation(d).catch((e) =>
                        chatPanel.showInline(
                            {
                                type: "html",
                                content: `❌ ${e?.message ?? String(e)}`,
                                kind: "warning",
                            },
                            "conversation",
                        ),
                    );
                    break;
                default:
                    // Android-only actions (set-alarm, call-phonenumber, etc.)
                    // are not supported in the Electron shell.
                    break;
            }
        } catch (e) {
            console.error("[takeAction] failed", e);
        }
    }

    async function handleManageConversation(
        payload: ManageConversationPayload,
    ) {
        const result = await getClientAPI().conversationManageAction(payload);
        chatPanel.showInline(
            { type: "html", content: result.html, kind: result.kind },
            "conversation",
        );
    }

    // Fetch the dispatcher's structured display history and replay it into
    // the ChatPanel. Replaces the old innerHTML chat-history persistence.
    //
    // `cutoffSeq` (when provided) is the last display-log sequence number
    // that existed at the moment the main process captured the connect-time
    // snapshot — i.e. before it dispatched any startup commands such as the
    // `@greeting`. We only replay entries up to that point so a startup
    // greeting that races the (async) `getDisplayHistory()` fetch is not
    // pulled into the grayed history; it instead renders live below the
    // "now" separator. Without provided cutoff (e.g. conversation switch),
    // the full history is replayed.
    async function replayDisplayHistory(cutoffSeq?: number): Promise<void> {
        const d = dispatcher;
        if (d === undefined) return;
        // Gate live display mutations until replay completes so startup
        // greeting / streamed content renders after history, on a clean
        // thread-container slate (avoids duplicate per-request bubbles).
        replayDone = false;
        try {
            chatPanel.setHistoryLoading(true);
            let entries = await d.getDisplayHistory();
            if (cutoffSeq !== undefined) {
                entries = entries.filter((e) => e.seq <= cutoffSeq);
            }
            await chatPanel.replayHistoryStreaming(toHistoryEntries(entries));
            // Divider between replayed history and live messages. Only show
            // it when there was actually prior history to separate from.
            if (entries.length > 0) {
                chatPanel.addHistorySeparator(
                    formatHistorySeparatorLabel(entries),
                );
            }
        } catch {
            // Ignore — replay is best-effort.
        } finally {
            chatPanel.setHistoryLoading(false);
            flushPendingDisplayOps();
            // Signal that the dispatcher is initialized and the initial
            // display-log replay has completed (messages marked .history).
            // Automated tests wait for `.chat[data-dispatcher-ready='true']`
            // before sending requests.
            chatPanel.markDispatcherReady();
        }
    }

    // --- Client ----------------------------------------------------------
    const client: Client = {
        clientIO,
        dispatcherInitialized(
            d: Dispatcher,
            initialQueueSnapshot: QueueSnapshot | undefined,
            cutoffSeq: number | undefined,
        ): void {
            dispatcher = d;
            // Seed dev-mode state so the per-message delete button reflects a
            // server started with `--dev` on connect, without waiting for a
            // `@config dev` toggle. Best-effort (older servers lack the RPC).
            if (typeof d.getDeveloperMode === "function") {
                void d
                    .getDeveloperMode()
                    .then((enabled) => chatPanel.setDeveloperMode(enabled))
                    .catch(() => {});
            }
            // Seed mirror sync; defer DOM reconcile until replay finishes.
            if (initialQueueSnapshot) {
                const prev = queueMirror.snapshot;
                queueMirror.reset(initialQueueSnapshot);
                const snapshot = initialQueueSnapshot;
                afterReplay(() => reconcileQueueChips(prev, snapshot));
            }
            // Flush any requests the user typed before the dispatcher was
            // ready. Deferred behind replay (same gate as the queue-chip
            // reconcile) so it runs after history settles and after the main
            // process has enqueued the startup `@greeting` — keeping the
            // greeting at the head of the dispatcher queue, followed by these
            // in the order they were typed.
            if (pendingSends.length > 0) {
                const buffered = pendingSends.splice(0);
                afterReplay(() => {
                    for (const { text, attachments, requestId } of buffered) {
                        submitUserCommand(text, attachments, requestId);
                    }
                });
            }
            void replayDisplayHistory(cutoffSeq);
        },
        updateRegisterAgents(updatedAgents: [string, string][]): void {
            agents.clear();
            for (const [key, value] of updatedAgents) {
                agents.set(key, value);
            }
        },
        async showInputText(message: string): Promise<void> {
            chatPanel.injectCommand(message);
        },
        showDialog(key: string): void {
            if (key.toLocaleLowerCase() === "settings") {
                chatPanel.openSettings();
            } else if (key.toLocaleLowerCase() === "help") {
                chatPanel.openHelp();
            }
        },
        updateSettings(updated: ShellUserSettings): void {
            settings = updated;
            applyDarkMode(settings.ui.darkMode);
        },
        fileSelected(fileName: string, fileContent: string): void {
            // `fileContent` arrives as a bare base64 string from the main
            // process (readFileSync(..., "base64")). Wrap it in a proper
            // data URL so it can be rendered in an <img> preview/bubble.
            const ext = fileName.split(".").pop()?.toLowerCase();
            const mime =
                ext === "jpg" || ext === "jpeg"
                    ? "image/jpeg"
                    : ext === "gif"
                      ? "image/gif"
                      : "image/png";
            const dataUrl = fileContent.startsWith("data:")
                ? fileContent
                : `data:${mime};base64,${fileContent}`;
            imageCaptureProvider.resolvePickedFile(dataUrl);
        },
        listen(token: SpeechToken | undefined): void {
            if (token !== undefined) {
                setSpeechToken(token);
            }
            speechProvider.start();
        },
        toggleAlwaysListen(waitforWakeWord: boolean): void {
            const on = speechProvider.getState() === "idle";
            speechProvider.setContinuous(on, waitforWakeWord);
        },
        focusInput(): void {
            chatPanel.focus();
        },
        searchMenuCompletion(_id: number, _item: SearchMenuItem): void {
            // Native search menu dropped in favor of LocalSearchMenuUI.
        },
        searchMenuSelectionChanged(): void {},
        titleUpdated(title: string): void {
            document.title = title;
        },
        continuousSpeechProcessed(expressions: UserExpression[]): void {
            for (const expression of expressions) {
                if (expression.complete_statement) {
                    chatPanel.injectCommand(expression.text);
                }
            }
        },
        tabRestoreStatus(count: number): void {
            chatPanel.showInline(
                count > 0
                    ? `Restoring ${count} browser tab${count > 1 ? "s" : ""}...`
                    : "Browser tabs restored.",
                "shell",
            );
        },
        systemNotification(message: string): void {
            chatPanel.showToast(message, "shell");
        },
        conversationChanged(
            _conversationId: string,
            _name: string,
            queueSnapshot?: QueueSnapshot,
        ): void {
            chatPanel.clear();
            // Reset state sync (watermark must be right for events that
            // arrive during the new conversation's replay). Defer DOM
            // until after replay — replayHistory wipes userMessageById
            // at the end, orphaning any bubble materialized here.
            pendingQueueStatus.clear();
            cancelledRequests.clear();
            cancelledRendered.clear();
            const prev = queueMirror.snapshot;
            queueMirror.reset(queueSnapshot);
            // Re-arm replay gate so display events during the new
            // conversation's history fetch also buffer.
            replayDone = false;
            if (queueSnapshot) {
                const snapshot = queueSnapshot;
                afterReplay(() => reconcileQueueChips(prev, snapshot));
            }
            void replayDisplayHistory();
        },
        markHistoryEntries(): void {
            // Structured history replay marks entries; no-op here.
        },
        requestCompleted(clientRequestId: string, result: any): void {
            // Main-process-dispatched requests (e.g. startup @greeting)
            // bypass the renderer's onSend → completeRequest path.
            afterReplay(() => {
                const mapped = mapResult(result);
                const cancelled =
                    mapped?.cancelled === true &&
                    claimCancelledRender(clientRequestId);
                chatPanel.completeRequest(
                    clientRequestId,
                    mapped ? { ...mapped, cancelled } : undefined,
                );
                clearQueueChip(clientRequestId);
            });
        },
        demoStateChanged(state: "running" | "paused" | "idle"): void {
            chatPanel.setDemoRunning(state !== "idle");
            chatPanel.setDemoPaused(state === "paused");
        },
        reconnectStatusChanged(status: ConnectionStatus | undefined): void {
            chatPanel.setConnectionStatus(status, (action) => {
                // Manual recovery from the "stopped" banner — main owns the
                // retry / server-start logic.
                if (action === "retry") {
                    void getClientAPI().reconnectRetry();
                } else if (action === "start") {
                    void getClientAPI().reconnectStartServer();
                }
            });
        },
    };

    return { client, chatPanel, cameraView };
}
