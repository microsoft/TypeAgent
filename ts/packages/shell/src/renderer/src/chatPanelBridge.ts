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
    type TemplateEditServices,
    QueueChipController,
    attachDoubleEscape,
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
    // Drive chat-ui's queue-chip surface from the dispatcher's four
    // `ClientIO` queue events. Almost all logic (mirror lifecycle,
    // deferred-chip stash, snapshot reconcile, × button wiring) lives
    // in chat-ui's QueueChipController; the bridge only supplies the
    // cancellation transport (dispatcher.cancelCommand). The controller
    // is constructed below once `chatPanel` exists; forward-declared
    // here so the `ClientIO` handlers and helpers can reference it
    // through closures.
    let queueChips!: QueueChipController;

    /**
     * Best-effort cancellation by server id. Used by the chip's `×`
     * button (via QueueChipController.cancelById) and the double-Esc
     * gesture's cancel-all sweep. Running cancellations triggered via
     * the input-level Esc / stop button on chat-ui still flow through
     * `cancelCommandByClientId`.
     */
    async function cancelByServerId(serverId: string): Promise<void> {
        const d = dispatcher;
        if (!d) return;
        try {
            await d.cancelCommand(serverId);
        } catch (e) {
            console.warn("cancelCommand failed for", serverId, e);
        }
    }

    /**
     * Cancel every queued and running entry on the current conversation.
     * Driven by the double-Escape gesture and called against the
     * controller's mirror snapshot so a no-snapshot client is a silent
     * no-op.
     */
    async function cancelAllQueuedAndRunning(): Promise<void> {
        const snap = queueChips.snapshot;
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
                    // Best-effort: one dead call shouldn't strand the rest.
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

    // --- ChatPanel -------------------------------------------------------
    const chatPanel = new ChatPanel(rootElement, {
        platformAdapter: {
            handleLinkClick: (href: string) => {
                getClientAPI().openUrlExternal(href);
            },
        },
        onSend: (text, attachments, requestId) => {
            if (dispatcher === undefined) {
                chatPanel.addSystemMessage("Dispatcher not ready.");
                chatPanel.setIdle();
                return;
            }
            void (async () => {
                try {
                    const result = await awaitCommand(
                        dispatcher!,
                        text,
                        attachments,
                        undefined,
                        requestId,
                    );
                    chatPanel.completeRequest(requestId, mapResult(result));
                } catch (e: any) {
                    chatPanel.addSystemMessage(
                        `Error: ${e?.message ?? String(e)}`,
                    );
                } finally {
                    chatPanel.setIdle();
                }
            })();
        },
        onCancel: (requestId) => {
            // requestId is the client-assigned id passed to submitCommand.
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
        onFeedbackHidden: (requestId, target, hidden) => {
            void dispatcher?.recordUserHide(requestId, hidden, target);
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

    // Construct the queue-chip controller now that `chatPanel` exists.
    // Forward-declared above so the `ClientIO` queue handlers and
    // cancelAllQueuedAndRunning helper can reference it.
    queueChips = new QueueChipController({
        chatPanel,
        cancelById: (serverId) => {
            void cancelByServerId(serverId);
        },
    });

    // Document-level Escape gesture (single Esc → cancel running request,
    // double Esc within 1s → cancel all queued + running). Wired through
    // chat-ui's `attachDoubleEscape` so the gesture logic stays in one
    // place across hosts. The active-id fallback (chat-ui's
    // getActiveRequestId() ?? mirror snapshot) is the default behavior.
    attachDoubleEscape(chatPanel, queueChips, {
        onCancelActive: (activeId) => {
            try {
                dispatcher?.cancelCommandByClientId(activeId);
            } catch {
                // Best-effort — channel may be gone (server killed).
            }
        },
        onCancelAll: () => {
            void cancelAllQueuedAndRunning();
        },
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
            queueChips.reset();
        },
        exit: () => window.close(),
        shutdown: () => window.close(),
        setUserRequest: (requestId, command) => {
            afterReplay(() => {
                const rid = ridStr(requestId);
                // Local requests already rendered their bubble at send time;
                // only render peer/replayed requests we haven't seen.
                if (rid && !chatPanel.hasUserMessage(rid)) {
                    chatPanel.addUserMessage(command, rid);
                }
                // If a queue chip arrived before this bubble (e.g. a
                // peer-originated `requestQueued` raced ahead of
                // `setUserRequest`), apply it now so the chip appears
                // immediately instead of waiting for the next
                // `queueStateChanged` reconcile.
                if (rid) queueChips.flushPending(rid);
            });
        },
        setDisplayInfo: (requestId, source, _actionIndex, action) => {
            afterReplay(() => {
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
                case AppAgentEvent.Toast:
                    chatPanel.showToast(data, source);
                    if (source !== "osNotifications") {
                        notifications.push({
                            event,
                            source,
                            data,
                            read: false,
                            requestId,
                        });
                    }
                    break;
                case "osDismiss":
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
        requestChoice: (requestId, choiceId, type, message, choices) => {
            void (async () => {
                if (type === "yesNo") {
                    const yes = await chatPanel.askYesNo(message);
                    await dispatcher?.respondToChoice(choiceId, yes);
                } else {
                    const index = await chatPanel.addChoicePrompt<number>(
                        message,
                        choices.map((label, i) => ({ label, value: i })),
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
                            { defaultValue: interaction.defaultId },
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
            }
        },
        interactionCancelled: (interactionId) => {
            const ac = activeInteractions.get(interactionId);
            if (ac) {
                activeInteractions.delete(interactionId);
                ac.abort("cancelled");
            }
        },
        takeAction: (requestId, action, data) => {
            handleTakeAction(action, data, ridStr(requestId));
        },
        onUserFeedback: (entry) => {
            chatPanel.applyFeedback(entry);
        },
        onUserHide: () => {
            // Hidden-state mirroring across peers is deferred.
        },
        requestQueued: (entry, version) => {
            queueChips.onRequestQueued(entry, version);
        },
        requestStarted: (entry, version) => {
            queueChips.onRequestStarted(entry, version);
        },
        requestCancelled: (
            requestId: string,
            _reason: QueueCancelReason,
            version: number,
        ) => {
            queueChips.onRequestCancelled(requestId, version);
        },
        queueStateChanged: (snapshot) => {
            queueChips.onQueueStateChanged(snapshot);
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

    function handleTakeAction(
        action: string,
        data: unknown,
        requestId: string | undefined,
    ) {
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
                    void handleManageConversation(d, requestId).catch((e) =>
                        showConversationMessage(
                            `❌ ${escapeHtml(e?.message ?? String(e))}`,
                            requestId,
                            "warning",
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

    // Escape user-supplied text so it's safe to interpolate into HTML emitted
    // into chat-ui bubbles.  Mirrors the renderer's old `escapeHtml` helper.
    function escapeHtml(s: string): string {
        return s.replace(
            /[&<>"']/g,
            (c) =>
                ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#39;",
                })[c] ?? c,
        );
    }

    // Resolve a conversation argument to a list entry.  Tries exact id
    // match first, then case-insensitive name match.  Returns undefined if
    // neither matches — matches the CLI's `resolveByName` behavior so the
    // documented `<id|name>` arg shape works in both clients.
    function resolveConversation<
        T extends { conversationId: string; name: string },
    >(sessions: T[], idOrName: string): T | undefined {
        return (
            sessions.find((s) => s.conversationId === idOrName) ??
            sessions.find(
                (s) => s.name.toLowerCase() === idOrName.toLowerCase(),
            )
        );
    }

    // Render a single conversation message bubble.  Uses the request's
    // existing thread when a requestId is supplied (so the response lands
    // under the user's `@conversation` bubble); otherwise renders as a
    // standalone bubble.  `kind` switches between an info bubble and an
    // inline warning row for error/help-text surfaces.
    function showConversationMessage(
        html: string,
        requestId: string | undefined,
        kind: "info" | "warning" = "info",
    ): void {
        if (kind === "warning") {
            chatPanel.showInline(
                { type: "html", content: html, kind: "warning" },
                "conversation",
            );
            return;
        }
        chatPanel.addAgentMessage(
            { type: "html", content: html },
            "conversation",
            // Pass undefined so chat-ui's iconForSource() looks up
            // "conversation" in DEFAULT_AVATAR_MAP (💬) instead of
            // the literal "❓" emoji which rendered as a missing-glyph
            // red question mark on some platforms.
            undefined,
            undefined,
            requestId,
        );
    }

    async function handleManageConversation(
        payload: {
            subcommand: string;
            name?: string;
            newName?: string;
        },
        requestId: string | undefined,
    ) {
        const api = getClientAPI();
        const showInfo = (html: string) =>
            showConversationMessage(html, requestId, "info");
        const showWarn = (html: string) =>
            showConversationMessage(html, requestId, "warning");

        switch (payload.subcommand) {
            case "help": {
                const lines = [
                    "<b>Conversation Commands</b>",
                    "<code>/conversation list</code> — List all conversations",
                    "<code>/conversation new [name]</code> — Create a new conversation",
                    "<code>/conversation switch &lt;id|name&gt;</code> — Switch to a conversation",
                    "<code>/conversation rename &lt;id&gt; &lt;name&gt;</code> — Rename a conversation",
                    "<code>/conversation delete &lt;id|name&gt;</code> — Delete a conversation",
                    "",
                    "Tip: <code>@conversation</code> is accepted as an alias for <code>/conversation</code>.",
                ];
                showInfo(lines.join("<br>"));
                break;
            }
            case "new": {
                let newName = payload.name;
                if (!newName) {
                    const dt = new Date();
                    const pad = (n: number) => n.toString().padStart(2, "0");
                    newName = `Conversation ${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
                }
                const created = await api.conversationCreate(newName);
                const switchResult = await api.conversationSwitch(
                    created.conversationId,
                );
                showInfo(
                    switchResult.success
                        ? `✅ Created and switched to conversation "<b>${escapeHtml(created.name)}</b>"`
                        : `✅ Created conversation "<b>${escapeHtml(created.name)}</b>" but could not switch: ${escapeHtml(switchResult.error ?? "unknown error")}`,
                );
                break;
            }
            case "list": {
                const sessions = await api.conversationList();
                const current = await api.conversationGetCurrent();
                if (sessions.length === 0) {
                    showInfo("No conversations found.");
                    break;
                }
                const lines = sessions.map((s) => {
                    const isCurrent =
                        current && s.conversationId === current.conversationId;
                    const marker = isCurrent ? " ← <b>current</b>" : "";
                    const date = new Date(s.createdAt).toLocaleDateString();
                    return `• <b>${escapeHtml(s.name)}</b> (${escapeHtml(s.conversationId)}) — ${s.clientCount} client(s), created ${date}${marker}`;
                });
                showInfo(
                    `<b>Conversations (${sessions.length})</b><br>${lines.join("<br>")}`,
                );
                break;
            }
            case "info": {
                const cur = await api.conversationGetCurrent();
                showInfo(
                    cur
                        ? `Current conversation: <b>${escapeHtml(cur.name)}</b> (${escapeHtml(cur.conversationId)})`
                        : "No active conversation.",
                );
                break;
            }
            case "switch": {
                if (!payload.name) {
                    showWarn("A conversation name is required to switch.");
                    break;
                }
                const sessions = await api.conversationList();
                const match = resolveConversation(sessions, payload.name);
                if (!match) {
                    showWarn(
                        `No conversation named "<b>${escapeHtml(payload.name)}</b>" found.`,
                    );
                    break;
                }
                const result = await api.conversationSwitch(
                    match.conversationId,
                );
                if (!result.success) {
                    showWarn(
                        `❌ ${escapeHtml(result.error ?? "Failed to switch conversation")}`,
                    );
                } else {
                    showInfo(
                        `✅ Switched to conversation "<b>${escapeHtml(match.name)}</b>"`,
                    );
                }
                break;
            }
            case "prev":
            case "next": {
                const sessions = await api.conversationList();
                if (sessions.length === 0) {
                    showWarn("No conversations to switch to.");
                    break;
                }
                const cur = await api.conversationGetCurrent();
                const curIdx = cur
                    ? sessions.findIndex(
                          (s) => s.conversationId === cur.conversationId,
                      )
                    : -1;
                const delta = payload.subcommand === "next" ? 1 : -1;
                const nextIdx =
                    curIdx === -1
                        ? 0
                        : (curIdx + delta + sessions.length) % sessions.length;
                const target = sessions[nextIdx];
                if (target.conversationId === cur?.conversationId) {
                    // Only one conversation — surface a warning so users in
                    // self-hosted mode (single default conversation) don't
                    // think the command silently failed.
                    showWarn(
                        "Only one conversation is available — nothing to switch to. Connect to the Agent Server to use multiple conversations.",
                    );
                    break;
                }
                const result = await api.conversationSwitch(
                    target.conversationId,
                );
                if (!result.success) {
                    showWarn(
                        `❌ ${escapeHtml(result.error ?? "Failed to switch conversation")}`,
                    );
                } else {
                    showInfo(
                        `✅ Switched to conversation "<b>${escapeHtml(target.name)}</b>"`,
                    );
                }
                break;
            }
            case "rename": {
                if (!payload.newName) {
                    showWarn(
                        "A new name is required to rename the conversation.",
                    );
                    break;
                }
                let conversationId: string | undefined;
                if (payload.name) {
                    const sessions = await api.conversationList();
                    const match = resolveConversation(sessions, payload.name);
                    if (!match) {
                        showWarn(
                            `No conversation named "<b>${escapeHtml(payload.name)}</b>" found.`,
                        );
                        break;
                    }
                    conversationId = match.conversationId;
                } else {
                    const cur = await api.conversationGetCurrent();
                    if (!cur) {
                        showWarn("No active conversation to rename.");
                        break;
                    }
                    conversationId = cur.conversationId;
                }
                await api.conversationRename(conversationId, payload.newName);
                showInfo(
                    `✅ Renamed conversation to "<b>${escapeHtml(payload.newName)}</b>"`,
                );
                break;
            }
            case "delete": {
                if (!payload.name) {
                    showWarn("A conversation name is required to delete.");
                    break;
                }
                const sessions = await api.conversationList();
                const match = resolveConversation(sessions, payload.name);
                if (!match) {
                    showWarn(
                        `❌ Conversation "<b>${escapeHtml(payload.name)}</b>" not found.`,
                    );
                    break;
                }
                await api.conversationDelete(match.conversationId);
                showInfo(
                    `🗑️ Deleted conversation "<b>${escapeHtml(match.name)}</b>"`,
                );
                break;
            }
            default:
                showWarn(
                    `Unknown manage-conversation subcommand: "<b>${escapeHtml(payload.subcommand)}</b>"`,
                );
                break;
        }
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
            chatPanel.replayHistory(toHistoryEntries(entries));
            // Divider between replayed history and live messages. Only show
            // it when there was actually prior history to separate from.
            if (entries.length > 0) {
                chatPanel.addHistorySeparator("now");
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
        dispatcherInitialized(d: Dispatcher, _snapshot, cutoffSeq): void {
            dispatcher = d;
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
            // Reset the queue mirror to the new conversation's baseline
            // so the version watermark doesn't reject this conversation's
            // first few lifecycle events (each `RequestQueue` is per-
            // conversation and starts at version 0). When no snapshot
            // is supplied the controller resets to empty.
            queueChips.reset(queueSnapshot);
            void replayDisplayHistory();
        },
        markHistoryEntries(): void {
            // Structured history replay marks entries; no-op here.
        },
        requestCompleted(clientRequestId: string, result: any): void {
            // A main-process-dispatched request (e.g. the startup @greeting)
            // finished. Finalize its metrics bubble — these requests never
            // flow through the renderer's onSend → completeRequest path.
            afterReplay(() => {
                chatPanel.completeRequest(clientRequestId, mapResult(result));
            });
        },
        demoStateChanged(state: "running" | "paused" | "idle"): void {
            chatPanel.setDemoRunning(state !== "idle");
            chatPanel.setDemoPaused(state === "paused");
        },
        reconnectStatusChanged(message: string | undefined): void {
            chatPanel.setReconnectStatus(message);
        },
    };

    return { client, chatPanel, cameraView };
}
