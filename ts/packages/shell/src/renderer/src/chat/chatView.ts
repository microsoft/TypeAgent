// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IdGenerator } from "../main";
import { ChatInput } from "./chatInput";
import { ExpandableTextArea } from "./expandableTextArea";
import { iconCheckMarkCircle, iconX } from "../icon";
import { DemoUIState } from "../../../preload/electronTypes";
import {
    DisplayAppendMode,
    DisplayContent,
    DynamicDisplay,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { TTS } from "../tts/tts";
import {
    Dispatcher,
    IAgentMessage,
    NotifyExplainedData,
    PendingInteractionRequest,
    PendingInteractionResponse,
    QueueCancelReason,
    QueuedRequest,
    QueueSnapshot,
    RequestId,
    TemplateEditConfig,
    UserFeedbackEntry,
    UserMessageHiddenEntry,
} from "agent-dispatcher";
// QueueStateMirror is a value import; route through the pure types pkg so vite
// doesn't bundle agent-dispatcher's server-only deps (telemetry, node:fs, ...).
import { QueueStateMirror, awaitCommand } from "@typeagent/dispatcher-types";

import { PartialCompletion } from "../partial";
import { ChoicePanel, InputChoice } from "../choicePanel";
import { MessageGroup } from "./messageGroup";
import { SettingsView } from "../settingsView";
import { uint8ArrayToBase64 } from "@typeagent/common-utils";
import {
    FeedbackController,
    FeedbackUIVariant,
    FeedbackWidget,
} from "../feedbackWidget";
import { iconTrash } from "../icon";

const DynamicDisplayMinRefreshIntervalMs = 15;

/** Window for the double-Escape "clear entire queue" gesture (mirrors the CLI). */
const DOUBLE_ESCAPE_WINDOW_MS = 1000;

// The canonical MessageGroup key is requestId.requestId — a UUID assigned by
// the dispatcher (via randomUUID()). This value is guaranteed to be unique
// within a session, which decouples the keying strategy from the client-assigned
// clientRequestId. Client-side messages (e.g. notifications) set requestId to
// "" and use clientRequestId as the map key instead.
//
// Returns undefined when requestId.requestId is empty (""), which indicates
// the message was generated client-side and has no server-assigned UUID.
function getMessageGroupId(requestId: RequestId): string | undefined {
    return requestId.requestId || undefined;
}

export class ChatView {
    private readonly topDiv: HTMLDivElement;
    private readonly messageDiv: HTMLDivElement;
    // Server-UUID-keyed MessageGroups (promoted from pendingLocalGroups, or
    // created directly for remote replay via addRemoteUserMessage).
    private readonly idToMessageGroup: Map<string, MessageGroup> = new Map();
    // Locally-created MessageGroups waiting for the server-assigned UUID.
    // Keyed by the temp clientRequestId (e.g. "cmd-0"). Moved into
    // idToMessageGroup (under the canonical UUID) when setUserRequest arrives.
    private readonly pendingLocalGroups: Map<string, MessageGroup> = new Map();
    // Client-only MessageGroups that will never receive a server UUID
    // (e.g. notifications, agent-initiated messages). Keyed by clientRequestId.
    private readonly clientMessageGroups: Map<string, MessageGroup> = new Map();
    private inputContainer: HTMLDivElement | undefined;
    private _settingsView: SettingsView | undefined;
    private _dispatcher: Dispatcher | undefined;
    private partialCompletionEnabled: boolean = false;
    private partialCompletionInline: boolean = true;
    private partialCompletion: PartialCompletion | undefined;
    private commandBackStack: string[] = [];
    private commandBackStackIndex = 0;

    private hideMetrics = true;
    private isScrolling = false;

    private _voiceBanner: HTMLElement;
    private _reconnectBanner!: HTMLElement;

    /** Mirror of the server's per-conversation queue. UI side effects live in handlers below. */
    private queueMirror = new QueueStateMirror();
    /** Queue status chips deferred until their MessageGroup is created. */
    private pendingQueueStatus = new Map<string, "queued" | "running">();
    /** Timestamp of the last Escape press; powers the double-Escape gesture. */
    private lastEscapeTime = 0;

    public userGivenName: string = "";
    /**
     * Whether the local user has signed in to a Microsoft / Graph identity
     * (set after `@calendar login` / `@email login` succeeds, either by the
     * host directly or via the embedded HTML marker scanner). Drives the
     * user-icon avatar's click behavior in MessageContainer — when true,
     * the avatar becomes inert so signed-in users don't re-trigger login.
     */
    private signedIn = false;
    private signedInEmail?: string;
    public chatInput: ChatInput | undefined;
    public tts?: TTS | undefined;
    public onRequestComplete?: () => void;
    private activeRequestId?: string;
    private stopButton?: HTMLButtonElement;

    private notificationCount = 0;
    constructor(
        private idGenerator: IdGenerator,
        private readonly agents: Map<string, string>,
        inputOnly: boolean,
    ) {
        // the main container
        this.topDiv = document.createElement("div");
        this.topDiv.className = "chat-container";

        this.messageDiv = document.createElement("div");
        this.messageDiv.className = "chat scroll_enabled";
        this.messageDiv.addEventListener("scrollend", () => {
            if (this.isScrolling) {
                if (this.messageDiv.scrollTop === 0) {
                    this.isScrolling = false;
                    return;
                }
                this.messageDiv.scrollTo(0, 0);
            }
        });
        if (inputOnly) {
            this.messageDiv.style.visibility = "hidden";
        }

        this.topDiv.appendChild(this.messageDiv);

        // Voice mode banner — shown when voice mode is active
        this._voiceBanner = document.createElement("div");
        this._voiceBanner.className = "voice-mode-banner";
        this._voiceBanner.textContent = "Voice Mode";
        this.topDiv.appendChild(this._voiceBanner);

        // Reconnect banner — hidden by default; shown by setReconnectStatus()
        // when the WebSocket to the agent server drops and the host is
        // attempting to reconnect.
        this._reconnectBanner = document.createElement("div");
        this._reconnectBanner.className = "chat-reconnect-banner";
        this._reconnectBanner.style.display = "none";
        this.topDiv.insertBefore(this._reconnectBanner, this.messageDiv);

        // wire up messages from iframes so we can resize them
        window.onmessage = (e) => {
            const source = e.data as string;
            if (
                source.startsWith("slideshow_") ||
                source.startsWith("aivideo_") ||
                source.startsWith("monitorlayout_")
            ) {
                const temp: string[] = source.split("_");
                if (temp.length != 3) {
                    return;
                }

                const name = temp[0];
                const hash = temp[1];
                const size = temp[2];

                // find the iframe from which this message originated
                const iframes = document.getElementsByTagName("iframe");
                for (let i = 0; i < iframes.length; i++) {
                    if (iframes[i].srcdoc.indexOf(`${name}_${hash}`) > -1) {
                        // resize the host iframe to fit the content size as reported by the iframe
                        iframes[i].style.height = size + "px";

                        break;
                    }
                }
            } else {
                console.log("Unknown message received: " + e.data);
            }
        };
    }

    private getDispatcher(): Dispatcher {
        if (this._dispatcher === undefined) {
            throw new Error("Dispatcher is not initialized");
        }
        return this._dispatcher;
    }

    public get dispatcher(): Dispatcher | undefined {
        return this._dispatcher;
    }

    public get feedbackUIVariant(): FeedbackUIVariant {
        return "footer-always";
    }

    /**
     * Restore feedback widgets on agent bubbles that were loaded from the
     * saved chat-history HTML. Those messages don't have backing JS state
     * — only DOM — so the buttons saved in the HTML have no click
     * handlers. For each container that carries a `data-feedback-request-id`
     * (stamped on by MessageGroup when the widget was first attached),
     * strip the stale action-row DOM and rebuild a fresh widget wired to
     * a dispatcher-backed controller. Containers without that attribute
     * (predating this feature) are left alone.
     */
    public rewireHistoricalFeedback() {
        // Only target .history-class containers — that class is added to
        // every node restored from saved chat-history HTML by
        // initializeChatHistory in main.ts. Live JS-managed bubbles
        // don't have it, so they're left alone.

        // Agent bubbles get the full feedback widget rebuilt AND the
        // trash button re-wired.
        const agentContainers = this.messageDiv.querySelectorAll<HTMLElement>(
            ".chat-message-container-agent.history",
        );
        for (const container of Array.from(agentContainers)) {
            const reqId = container.dataset.feedbackRequestId;
            const clientReqId = container.dataset.feedbackClientRequestId;
            if (!reqId && !clientReqId) continue;

            // Remove the saved (handler-less) action row / corner — the
            // new widget will build fresh DOM with click handlers wired.
            container
                .querySelectorAll(
                    ".chat-message-actions, .chat-message-actions-corner",
                )
                .forEach((el) => el.remove());

            const requestId: RequestId = {
                requestId: reqId ?? "",
                clientRequestId: clientReqId,
            };
            const controller = this.buildHistoricalController(requestId);
            const bodyDiv = container.querySelector<HTMLElement>(
                ".chat-message-body, .chat-message-body-hide-metrics, .chat-message-agent",
            );
            const headerDiv = container.querySelector<HTMLElement>(
                ".chat-timestamp-agent",
            );
            const messageDiv = container.querySelector<HTMLElement>(
                ".chat-message-content",
            );
            if (!bodyDiv || !headerDiv || !messageDiv) continue;

            new FeedbackWidget(
                { container, bodyDiv, headerDiv, messageDiv },
                controller,
                "footer-always",
            );
            // Rebuild the trash button (saved HTML has it without
            // any click handler attached).
            this.wireHistoricalTrash(container, requestId, "agent");
        }

        // User bubbles only get the trash button — no feedback widget.
        const userContainers = this.messageDiv.querySelectorAll<HTMLElement>(
            ".chat-message-container-user.history",
        );
        for (const container of Array.from(userContainers)) {
            const reqId = container.dataset.feedbackRequestId;
            const clientReqId = container.dataset.feedbackClientRequestId;
            if (!reqId && !clientReqId) continue;
            const requestId: RequestId = {
                requestId: reqId ?? "",
                clientRequestId: clientReqId,
            };
            this.wireHistoricalTrash(container, requestId, "user");
        }
    }

    /**
     * Replace any (saved, handler-less) trash button inside the
     * container with a fresh one that calls dispatcher.recordUserHide.
     * Also applies the optimistic-hide / undo-on-error semantics used
     * by live trash clicks.
     */
    private wireHistoricalTrash(
        container: HTMLElement,
        requestId: RequestId,
        target: "user" | "agent",
    ) {
        container
            .querySelectorAll(".chat-message-trash")
            .forEach((el) => el.remove());

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chat-action-button chat-message-trash";
        btn.title = "Move to trash";
        btn.setAttribute("aria-label", "Move to trash");
        btn.dataset.action = "trash";
        btn.appendChild(iconTrash());
        btn.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            container.classList.add("chat-message-trashed");
            const dispatcher = this._dispatcher;
            if (!dispatcher) return;
            try {
                await dispatcher.recordUserHide(requestId, true, target);
            } catch (e) {
                container.classList.remove("chat-message-trashed");
                console.error("recordUserHide failed", e);
            }
        });

        // Anchor in the body element (.chat-message-agent or
        // .chat-message-user) which matches how live bubbles are
        // built. Without the body element we can't position the
        // trash; skip.
        const body = container.querySelector<HTMLElement>(
            target === "agent" ? ".chat-message-agent" : ".chat-message-user",
        );
        if (body) {
            body.appendChild(btn);
        }
    }

    /**
     * Build a minimal FeedbackController for a historical message —
     * submits go straight through the dispatcher. We don't try to
     * recover the saved rating state here; the widget starts unrated.
     */
    private buildHistoricalController(
        requestId: RequestId,
    ): FeedbackController {
        return {
            getCurrentFeedback: () => null,
            submit: async (rating, category, comment, includeContext) => {
                const dispatcher = this._dispatcher;
                if (dispatcher === undefined) return;
                try {
                    await dispatcher.recordUserFeedback(
                        requestId,
                        rating,
                        category,
                        comment,
                        includeContext,
                    );
                } catch (e) {
                    console.error("recordUserFeedback failed", e);
                }
            },
            setHidden: async (hidden: boolean, target?: "user" | "agent") => {
                const dispatcher = this._dispatcher;
                if (dispatcher === undefined) return;
                try {
                    await dispatcher.recordUserHide(requestId, hidden, target);
                } catch (e) {
                    console.error("recordUserHide failed", e);
                }
            },
        };
    }

    public initializeDispatcher(
        dispatcher: Dispatcher,
        initialQueueSnapshot?: QueueSnapshot,
    ) {
        if (this._dispatcher !== undefined) {
            throw new Error("Dispatcher already initialized");
        }

        if (this.chatInput === undefined) {
            throw new Error("Chat input is not initialized");
        }

        this._dispatcher = dispatcher;

        // Bootstrap from the join snapshot when provided; otherwise fall back to RPC.
        if (initialQueueSnapshot !== undefined) {
            this.applyQueueSnapshot(initialQueueSnapshot);
        } else if (typeof dispatcher.getQueueSnapshot === "function") {
            dispatcher
                .getQueueSnapshot()
                .then((snap) => this.applyQueueSnapshot(snap))
                .catch(() => {});
        }

        this.chatInput.textarea.enable(true);
        this.chatInput.focus();

        // Create stop button (hidden by default, shares position with send button)
        this.stopButton = document.createElement("button");
        this.stopButton.className = "chat-input-button chat-stop-button";
        this.stopButton.innerHTML = "■";
        this.stopButton.style.display = "none";
        this.stopButton.addEventListener("click", () => this.cancelCommand());
        this.chatInput.sendButton.parentElement?.appendChild(this.stopButton);

        // Wire request completion to toggle buttons back
        this.onRequestComplete = () => {
            this.activeRequestId = undefined;
            this.showStopButton(false);
        };

        // Escape cancels the running request; a second Escape within
        // DOUBLE_ESCAPE_WINDOW_MS clears the entire queue (mirrors the CLI).
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            const now = Date.now();
            const isDouble =
                now - this.lastEscapeTime <= DOUBLE_ESCAPE_WINDOW_MS;
            this.lastEscapeTime = now;
            if (this.activeRequestId) {
                e.preventDefault();
                this.cancelCommand();
            }
            if (isDouble) {
                // Reset so a third Escape doesn't immediately re-trigger.
                this.lastEscapeTime = 0;
                e.preventDefault();
                void this.cancelAllQueuedAndRunning();
            }
        });

        // delay initialization.
        if (this.partialCompletionEnabled) {
            this.ensurePartialCompletion();
        }
    }

    public setActiveRequestId(requestId: string) {
        this.activeRequestId = requestId;
        this.showStopButton(true);
    }

    // Returns true if a command with this requestId was originated by this
    // shell instance (still tracked under pendingLocalGroups by
    // clientRequestId, awaiting lazy promotion on first display message).
    // Used to suppress UI affordances (stop button) for commands mirrored
    // from a peer client like the vscode extension.
    public isLocalRequest(requestId: RequestId): boolean {
        const localId = requestId.clientRequestId as string | undefined;
        return !!localId && this.pendingLocalGroups.has(localId);
    }

    private cancelCommand() {
        if (this.activeRequestId && this._dispatcher) {
            // Defensive try/catch — if the underlying dispatcher channel
            // dropped (server killed) the call can throw synchronously.
            // We hide the stop button regardless so the UI stays consistent.
            try {
                this._dispatcher.cancelCommand(this.activeRequestId);
            } catch {
                // Channel gone; nothing to cancel.
            }
            this.activeRequestId = undefined;
            this.showStopButton(false);
        }
    }

    // Best-effort: per-id RPC errors are swallowed so one dead call doesn't
    // strand the rest. Server `requestCancelled` broadcasts drive the UI.
    private async cancelAllQueuedAndRunning(): Promise<void> {
        const snap = this.queueMirror.snapshot;
        const dispatcher = this._dispatcher;
        if (!dispatcher || !snap) return;
        const ids: string[] = [];
        if (snap.running) ids.push(snap.running.requestId);
        for (const e of snap.queued) ids.push(e.requestId);
        if (ids.length === 0) return;
        await Promise.all(
            ids.map(async (id) => {
                try {
                    await Promise.resolve(dispatcher.cancelCommand(id));
                } catch {}
            }),
        );
    }

    private showStopButton(processing: boolean) {
        if (!this.chatInput || !this.stopButton) return;
        if (processing) {
            this.chatInput.sendButton.style.display = "none";
            this.stopButton.style.display = "";
        } else {
            this.stopButton.style.display = "none";
            this.chatInput.sendButton.style.display = "";
        }
    }

    private ensurePartialCompletion() {
        if (
            this.partialCompletion === undefined &&
            this._dispatcher !== undefined &&
            this.inputContainer !== undefined &&
            this.chatInput !== undefined
        ) {
            this.partialCompletion = new PartialCompletion(
                this.inputContainer,
                this.chatInput.textarea,
                this.getDispatcher(),
                this.partialCompletionInline,
                () => this.toggleCompletionMode(),
            );
        }
    }

    private toggleCompletionMode() {
        const newInline = !this.partialCompletionInline;
        this.partialCompletionInline = newInline;
        this.partialCompletion?.switchMode(newInline);
        this._settingsView?.setInlineCompletions(newInline);
    }

    public enablePartialInput(enabled: boolean, inline: boolean) {
        this.partialCompletionEnabled = enabled;
        if (this.partialCompletionInline !== inline) {
            // Reinitialize partial completion with new mode
            this.partialCompletion?.close();
            this.partialCompletion = undefined;
            this.partialCompletionInline = inline;
        }

        if (enabled) {
            this.ensurePartialCompletion();
        } else {
            this.partialCompletion?.close();
            this.partialCompletion = undefined;
        }
    }

    private dynamicDisplays: {
        source: string;
        id: RequestId;
        actionIndex: number;
        displayId: string;
        nextRefreshTime: number;
    }[] = [];
    private timer: number | undefined = undefined;
    private scheduledRefreshTime: number | undefined = undefined;
    setDynamicDisplay(
        requestId: RequestId,
        source: string,
        actionIndex: number,
        displayId: string,
        nextRefreshMs: number,
    ) {
        const now = Date.now();
        const agentMessage = this.ensureAgentMessage({
            message: "",
            requestId,
            source: source,
            actionIndex: actionIndex,
        });
        if (agentMessage === undefined) {
            return;
        }
        this.dynamicDisplays.push({
            source,
            id: requestId,
            actionIndex,
            displayId,
            nextRefreshTime:
                Math.max(nextRefreshMs, DynamicDisplayMinRefreshIntervalMs) +
                now,
        });

        this.scheduleDynamicDisplayRefresh(now);
    }
    private scheduleDynamicDisplayRefresh(now: number) {
        if (this.dynamicDisplays.length === 0) {
            return;
        }
        this.dynamicDisplays.sort(
            (a, b) => a.nextRefreshTime - b.nextRefreshTime,
        );
        const nextRefreshTime = this.dynamicDisplays[0].nextRefreshTime;
        const scheduledRefreshTime = this.scheduledRefreshTime;
        if (
            scheduledRefreshTime === undefined ||
            nextRefreshTime < scheduledRefreshTime
        ) {
            if (this.timer !== undefined) {
                window.clearInterval(this.timer);
                this.timer = undefined;
            }
            const interval = nextRefreshTime - now;
            this.scheduledRefreshTime = nextRefreshTime;
            this.timer = window.setTimeout(() => {
                this.scheduledRefreshTime = undefined;
                this.timer = undefined;
                this.refreshDynamicDisplays();
            }, interval);
        }
    }

    private async refreshDynamicDisplays() {
        const now = Date.now();
        let item = this.dynamicDisplays[0];
        const currentDisplay = new Map<string, DynamicDisplay>();
        while (item && item.nextRefreshTime <= now) {
            this.dynamicDisplays.shift()!;
            const { id, source, actionIndex, displayId } = item;
            try {
                // Only call getDynamicDisplay once if there are multiple
                let result = currentDisplay.get(`${source}:${displayId}`);
                if (result === undefined) {
                    result = await this.getDispatcher().getDynamicDisplay(
                        source,
                        "html",
                        displayId,
                    );
                    currentDisplay.set(`${source}:${displayId}`, result);
                }
                this.addAgentMessage(
                    {
                        message: result.content,
                        requestId: id,
                        source: source,
                        actionIndex: actionIndex,
                    },
                    { scrollToMessage: true },
                );
                if (result.nextRefreshMs !== -1) {
                    this.dynamicDisplays.push({
                        source,
                        id,
                        actionIndex,
                        displayId,
                        nextRefreshTime:
                            Math.max(
                                result.nextRefreshMs,
                                DynamicDisplayMinRefreshIntervalMs,
                            ) + now,
                    });
                }
            } catch (error: any) {
                currentDisplay.set(`${source}:${displayId}`, {
                    content: error.message,
                    nextRefreshMs: -1,
                });
                this.addAgentMessage(
                    {
                        message: error.message,
                        requestId: id,
                        source: source,
                        actionIndex: actionIndex,
                    },
                    { scrollToMessage: true },
                );
            }

            item = this.dynamicDisplays[0];
        }
        this.scheduleDynamicDisplayRefresh(now);
    }

    private getMessageGroup(requestId: RequestId) {
        const id = getMessageGroupId(requestId);

        // Server-assigned UUID exists — look up directly.
        if (id !== undefined) {
            const messageGroup = this.idToMessageGroup.get(id);
            if (messageGroup !== undefined) {
                return messageGroup;
            }

            // Lazy promotion: check whether the clientRequestId matches a
            // pending local MessageGroup. The first server message carrying
            // both the UUID and the matching clientRequestId promotes the
            // pending entry into idToMessageGroup.
            const clientId = requestId.clientRequestId as string | undefined;
            if (clientId) {
                const pending = this.pendingLocalGroups.get(clientId);
                if (pending) {
                    this.pendingLocalGroups.delete(clientId);
                    this.idToMessageGroup.set(id, pending);
                    // Stamp the canonical requestId on the group now that
                    // it's known — drives the feedback widget.
                    pending.setRequestId(requestId);
                    // Apply any queue chip deferred while the MG was pending.
                    this.applyPendingQueueStatus(id, pending);
                    return pending;
                }
            }

            // "system" is a reserved sentinel set by broadcastSystemMessage on
            // the server (sharedDispatcher.ts).  It can never collide with a
            // real UUID (randomUUID() produces RFC 4122 format).  Auto-create a
            // notification group so join/leave messages are displayed.
            if (id === "system") {
                const mgId = `notification-system-${this.notificationCount++}`;
                const mg: MessageGroup = new MessageGroup(
                    this,
                    this.settingsView!,
                    "",
                    this.messageDiv,
                    undefined,
                    this.agents,
                    this.hideMetrics,
                );
                // Stamp the requestId so the feedback widget attaches to
                // these bubbles too — feedback for system messages is
                // keyed by the synthetic id since there's no server UUID.
                mg.setRequestId({
                    requestId: id,
                    clientRequestId: mgId,
                });
                this.clientMessageGroups.set(mgId, mg);
                mg.hideUserMessage();
                return mg;
            }

            console.error(`Invalid requestId ${id}`);
            return undefined;
        }

        // Client-side message (no server UUID) — use clientRequestId as key.
        const clientId = requestId.clientRequestId as string | undefined;
        if (!clientId) {
            console.error(`Invalid requestId: no id or clientRequestId`);
            return undefined;
        }

        const messageGroup = this.clientMessageGroups.get(clientId);
        if (messageGroup !== undefined) {
            return messageGroup;
        }

        // Auto-create for notification message groups.
        if (
            clientId.startsWith("agent-") ||
            clientId.startsWith("notification-")
        ) {
            const mg: MessageGroup = new MessageGroup(
                this,
                this.settingsView!,
                "",
                this.messageDiv,
                undefined,
                this.agents,
                this.hideMetrics,
            );
            // Stamp the requestId so the feedback widget attaches —
            // notifications use the clientRequestId as the key (no
            // server-side UUID exists for these).
            mg.setRequestId({
                requestId: "",
                clientRequestId: clientId,
            });
            this.clientMessageGroups.set(clientId, mg);
            mg.hideUserMessage();
            return mg;
        }

        console.error(`Invalid clientRequestId ${clientId}`);
        return undefined;
    }

    showStatusMessage(msg: IAgentMessage, temporary: boolean) {
        this.getMessageGroup(msg.requestId)?.addStatusMessage(msg, temporary);
        this.updateScroll();
    }

    clear() {
        this.messageDiv.replaceChildren();
        this.idToMessageGroup.clear();
        this.pendingLocalGroups.clear();
        this.clientMessageGroups.clear();
        this.pendingQueueStatus.clear();
        this.commandBackStackIndex = -1;
        this.commandBackStack = [];
    }

    // Removes a notification message group (created via addNotificationMessage)
    // by its clientRequestId. Used by OS-notification dismiss handling — the
    // OS reports a notification has left the action center and we drop the
    // corresponding chat bubble. No-op if the group doesn't exist.
    public removeNotificationGroup(clientRequestId: string): boolean {
        const group = this.clientMessageGroups.get(clientRequestId);
        if (group === undefined) return false;
        group.dispose();
        this.clientMessageGroups.delete(clientRequestId);
        return true;
    }

    public isUserSignedIn(): boolean {
        return this.signedIn;
    }

    /**
     * Mark the local user as signed in (called after `@calendar login`
     * succeeds). Updates `userGivenName`, retroactively rewrites every
     * existing user-icon in the transcript to show the new initial + a
     * "Signed in as ..." tooltip, and flips signedIn so the avatar's
     * click handler stops triggering sign-in.
     */
    public setUserSignedIn(name: string, email: string) {
        this.userGivenName = name;
        this.signedIn = true;
        this.signedInEmail = email;
        this.refreshAllUserIcons();
    }

    public setUserSignedOut() {
        this.signedIn = false;
        this.signedInEmail = undefined;
        // Reset display name back to placeholder so future user-icon
        // refreshes show "U" instead of the previously-signed-in user's
        // initial. (applyUserIconState falls back to "U" when
        // userGivenName is empty, so clearing is sufficient.)
        this.userGivenName = "";
        this.refreshAllUserIcons();
    }

    /**
     * Apply current signed-in state to a single user-icon div. MessageContainer
     * calls this when constructing the user bubble's avatar so the cursor +
     * tooltip + letter reflect current state without each container needing
     * to know about the marker scanner.
     */
    public applyUserIconState(iconDiv: HTMLElement) {
        const initial = (this.userGivenName || "U")
            .trim()
            .charAt(0)
            .toUpperCase();
        iconDiv.innerText = initial || "U";
        if (this.signedIn) {
            iconDiv.style.cursor = "default";
            iconDiv.title = this.signedInEmail
                ? `Signed in as ${this.userGivenName} <${this.signedInEmail}>`
                : `Signed in as ${this.userGivenName}`;
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
     * Look for the hidden user-signed-in / user-signed-out markers emitted
     * by the calendar/email login + logout handlers and lift them into
     * ChatView state. Marker shapes:
     *   <span class="typeagent-user-signed-in" data-name="..." data-email="..." hidden></span>
     *   <span class="typeagent-user-signed-out" hidden></span>
     * Markers are removed after extraction so they don't leak into copy
     * operations or future scans.
     */
    public extractUserMarker(root: HTMLElement) {
        const signedIn = root.querySelectorAll<HTMLElement>(
            "span.typeagent-user-signed-in",
        );
        signedIn.forEach((el) => {
            const name = el.getAttribute("data-name");
            const email = el.getAttribute("data-email");
            if (name && email) {
                this.setUserSignedIn(name, email);
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

    async addUserMessage(
        request: string | { type: "html"; content: string },
        hidden: boolean = false,
    ) {
        let requestText: string;
        if (typeof request === "string") {
            requestText = request;
        } else if (request.type === "html") {
            let tempDiv: HTMLDivElement = document.createElement("div");
            tempDiv.innerHTML = request.content;
            requestText = tempDiv.innerText;
        } else {
            requestText = request.content;
        }

        // Normalize the legacy `/conversation` slash alias to the
        // canonical `@conversation` agent command.  All conversation
        // command logic lives in the dispatcher (see
        // packages/dispatcher/.../conversationCommandHandlers.ts) and
        // results are surfaced via the `manage-conversation` client
        // action handler in main.ts — keeping that as the single
        // source of truth.
        const trimmed = requestText.trimStart();
        if (trimmed.startsWith("/conversation")) {
            requestText =
                "@conversation" + trimmed.slice("/conversation".length);
        }

        const localId = this.idGenerator.genId();

        let images: string[] = [];
        if (typeof request === "string") {
            // requestText already set above
        } else if (request.type === "html") {
            let tempDiv: HTMLDivElement = document.createElement("div");
            tempDiv.innerHTML = request.content;
            images = await this.extractMultiModalContent(tempDiv);
            requestText = tempDiv.innerText;
            request.content = tempDiv.innerHTML;
        } else {
            requestText = request.content;
        }

        // Start command processing first so we have the promise for MessageGroup.
        // localId becomes clientRequestId in the RequestId; the server assigns
        // a UUID (requestId.requestId) and broadcasts it via setUserRequest.
        const commandResult = awaitCommand(
            this.getDispatcher(),
            requestText,
            images,
            undefined,
            localId,
        );

        const mg: MessageGroup = new MessageGroup(
            this,
            this.settingsView!,
            request,
            this.messageDiv,
            commandResult,
            this.agents,
            this.hideMetrics,
        );

        if (hidden) {
            mg.hideUserMessage();
        }

        // Hold in pending map until setUserRequest arrives with the UUID.
        this.pendingLocalGroups.set(localId, mg);
        this.updateScroll();
        this.commandBackStackIndex = 0;
        this.commandBackStack = [];
    }

    addRemoteUserMessage(requestId: RequestId, command: string) {
        const id = requestId.requestId;
        // LOAD-BEARING IDEMPOTENCE: callers in `getOrMaterializeRemoteMessageGroup`
        // (queue events) and `main.ts/setUserRequest` (processing start) both fire
        // for the same remote requestId; the `idToMessageGroup.has(id)` guard is
        // what prevents duplicate bubbles. Do not remove without replacing.
        if (!id || this.idToMessageGroup.has(id)) {
            return;
        }

        // Don't create a remote MG if this is actually a local command
        // still waiting for promotion (handled lazily by getMessageGroup).
        const localId = requestId.clientRequestId as string | undefined;
        if (localId && this.pendingLocalGroups.has(localId)) {
            return;
        }

        const mg: MessageGroup = new MessageGroup(
            this,
            this.settingsView!,
            command,
            this.messageDiv,
            undefined,
            this.agents,
            this.hideMetrics,
        );
        mg.setRequestId(requestId);

        this.idToMessageGroup.set(id, mg);
        // Apply any queue status deferred until the MG materialized.
        this.applyPendingQueueStatus(id, mg);
        this.updateScroll();
    }

    async extractMultiModalContent(tempDiv: HTMLDivElement): Promise<string[]> {
        let images = tempDiv.querySelectorAll<HTMLImageElement>(
            ".chat-input-dropImage",
        );
        let retVal: string[] = new Array<string>(images.length);
        for (let i = 0; i < images.length; i++) {
            images[i].classList.remove("chat-input-dropImage");
            images[i].classList.add("chat-input-image");

            if (images[i].src.startsWith("data:image")) {
                retVal[i] = images[i].src;
            } else if (images[i].src.startsWith("blob:")) {
                let response = await fetch(images[i].src);
                let blob = await response.blob();
                let ab = await blob.arrayBuffer();
                retVal[i] =
                    `data:image/png;base64,` +
                    uint8ArrayToBase64(new Uint8Array(ab));
            } else {
                console.log("Unknown image source type.");
            }
        }

        return retVal;
    }

    notifyExplained(requestId: RequestId, data: NotifyExplainedData) {
        this.getMessageGroup(requestId)?.notifyExplained(data);
    }

    updateGrammarResult(
        requestId: RequestId,
        success: boolean,
        message?: string,
    ) {
        this.getMessageGroup(requestId)?.updateGrammarResult(success, message);
    }

    randomCommandSelected(requestId: RequestId, message: string) {
        if (message.length > 0) {
            this.getMessageGroup(requestId)?.updateUserMessage(message);
        }
    }

    setDisplayInfo(
        requestId: RequestId,
        source: string,
        actionIndex?: number,
        action?: TypeAgentAction | string[],
    ) {
        this.getMessageGroup(requestId)?.setDisplayInfo(
            source,
            actionIndex,
            action,
        );
    }

    setActionData(requestId: RequestId, data: any) {
        this.getMessageGroup(requestId)?.setActionData(requestId, data);
    }

    appendDiagnosticData(requestId: RequestId, data: any) {
        this.getMessageGroup(requestId)?.appendDiagnosticData(requestId, data);
    }

    /**
     * Apply a user-feedback rating to the matching agent message bubble.
     * Invoked both for live rating updates (via ClientIO.onUserFeedback
     * broadcast) and replay during conversation rejoin.
     */
    applyFeedback(entry: UserFeedbackEntry) {
        this.getMessageGroup(entry.requestId)?.applyFeedback(entry);
    }

    // Server-side queue: drives per-bubble "queued"/"running" chips.

    public applyQueueSnapshot(snapshot: QueueSnapshot | undefined): void {
        const prev = this.queueMirror.snapshot;
        this.queueMirror.reset(snapshot);
        this.reconcileChipsToSnapshot(prev, snapshot);
    }

    public onRequestQueued(entry: QueuedRequest, version: number): void {
        if (!this.queueMirror.applyQueued(entry, version).admitted) return;
        this.tryApplyQueueStatusToGroup(entry, "queued");
    }

    public onRequestStarted(entry: QueuedRequest, version: number): void {
        const result = this.queueMirror.applyStarted(entry, version);
        if (!result.admitted) return;
        if (result.previousRunning) {
            const prevId = result.previousRunning.requestId;
            this.pendingQueueStatus.delete(prevId);
            this.idToMessageGroup.get(prevId)?.setQueueStatus(null);
        }
        this.tryApplyQueueStatusToGroup(entry, "running");
    }

    public onRequestCancelled(
        requestId: string,
        _reason: QueueCancelReason,
        version: number,
    ): void {
        if (!this.queueMirror.applyCancelled(requestId, version).admitted)
            return;
        this.pendingQueueStatus.delete(requestId);
        const mg = this.idToMessageGroup.get(requestId);
        if (mg) {
            mg.setQueueStatus(null);
            // Remote-origin bubbles have no commandResult promise, so this is
            // the only signal that renders the "⚠ Cancelled" affordance.
            // notifyCancelled is idempotent — local-origin bubbles unaffected.
            mg.notifyCancelled();
        }
    }

    public onQueueStateChanged(snapshot: QueueSnapshot): void {
        const result = this.queueMirror.applyQueueStateChanged(snapshot);
        if (!result.admitted) return;
        this.reconcileChipsToSnapshot(result.previous, snapshot);
    }

    /** Stamp/clear chips to match an authoritative snapshot; sweep stale pending entries. */
    private reconcileChipsToSnapshot(
        prev: QueueSnapshot | undefined,
        next: QueueSnapshot | undefined,
    ): void {
        const liveIds = new Set<string>();
        if (next?.running) {
            liveIds.add(next.running.requestId);
            this.tryApplyQueueStatusToGroup(next.running, "running");
        }
        for (const entry of next?.queued ?? []) {
            liveIds.add(entry.requestId);
            this.tryApplyQueueStatusToGroup(entry, "queued");
        }
        // Clear chips on entries the new snapshot dropped.
        const prevIds = new Set<string>();
        if (prev?.running) prevIds.add(prev.running.requestId);
        for (const e of prev?.queued ?? []) prevIds.add(e.requestId);
        for (const id of prevIds) {
            if (liveIds.has(id)) continue;
            this.pendingQueueStatus.delete(id);
            this.idToMessageGroup.get(id)?.setQueueStatus(null);
        }
        // Sweep pending statuses whose entry is no longer live.
        for (const id of Array.from(this.pendingQueueStatus.keys())) {
            if (!liveIds.has(id)) {
                this.pendingQueueStatus.delete(id);
            }
        }
    }

    /**
     * Apply a chip to the matching MessageGroup, or stash the status in
     * `pendingQueueStatus` so it's applied when the MG materializes.
     */
    private tryApplyQueueStatusToGroup(
        entry: QueuedRequest,
        status: "queued" | "running" | null,
    ): void {
        const mg = this.getOrMaterializeRemoteMessageGroup(entry);
        const onCancel =
            status === "queued"
                ? () => this.cancelQueuedById(entry.requestId)
                : undefined;
        if (mg) {
            mg.setQueueStatus(status, onCancel);
            this.pendingQueueStatus.delete(entry.requestId);
            return;
        }
        if (status === null) {
            this.pendingQueueStatus.delete(entry.requestId);
        } else {
            this.pendingQueueStatus.set(entry.requestId, status);
        }
    }

    /**
     * Resolve the MessageGroup for a queue entry, materializing a remote-origin
     * user bubble eagerly from the entry text if needed. Remote entries' bubbles
     * would otherwise only appear on `setUserRequest` (which doesn't fire until
     * processing begins), so peer clients would never see queued/running chips.
     */
    private getOrMaterializeRemoteMessageGroup(
        entry: QueuedRequest,
    ): MessageGroup | undefined {
        const existing = this.idToMessageGroup.get(entry.requestId);
        if (existing) return existing;
        const requestId: RequestId = {
            requestId: entry.requestId,
            clientRequestId: entry.clientRequestId,
        };
        if (entry.text && !this.isLocalRequest(requestId)) {
            this.addRemoteUserMessage(requestId, entry.text);
            const created = this.idToMessageGroup.get(entry.requestId);
            if (created) return created;
        }
        // Falls through for local entries (lazy-promoted in getMessageGroup)
        // and remote entries without text (rare, but possible during replay).
        return this.getMessageGroup(requestId);
    }

    /** Apply any deferred queue status for `requestId` to the now-live MG. */
    private applyPendingQueueStatus(requestId: string, mg: MessageGroup): void {
        const status = this.pendingQueueStatus.get(requestId);
        if (status !== undefined) {
            const onCancel =
                status === "queued"
                    ? () => this.cancelQueuedById(requestId)
                    : undefined;
            mg.setQueueStatus(status, onCancel);
            this.pendingQueueStatus.delete(requestId);
        }
    }

    /**
     * Cancel a single queued entry from the per-bubble X button. The
     * authoritative UI update arrives via the server's `requestCancelled`
     * broadcast; rejection here means the cancel never reached the server.
     */
    private cancelQueuedById(requestId: string): void {
        const dispatcher = this._dispatcher;
        if (!dispatcher) return;
        try {
            // cancelCommand returns Promise<CancelResult>; warn on rejection
            // so a wedged dispatcher doesn't silently drop the user's click.
            dispatcher.cancelCommand(requestId).catch((err) => {
                console.warn(`cancelQueuedById(${requestId}) rejected:`, err);
            });
        } catch (err) {
            // Sync throw — disconnected channel stub.
            console.warn(`cancelQueuedById(${requestId}) threw:`, err);
        }
    }

    /**
     * Apply a hide / restore to the matching agent message bubble.
     * Routes to the live MessageGroup if one exists; otherwise (e.g.
     * the bubble was restored from saved chat-history HTML) toggles
     * the CSS class directly on the matching container by data
     * attribute.
     */
    applyHide(entry: UserMessageHiddenEntry) {
        const mg = this.getMessageGroup(entry.requestId);
        if (mg) {
            mg.applyHide(entry);
            return;
        }
        // Fallback: locate historical containers by data attribute. We
        // walk both user and agent containers since hide is per-side.
        const key =
            entry.requestId.requestId ||
            (entry.requestId.clientRequestId as string | undefined);
        if (!key) return;
        const selectors: string[] = [];
        if (entry.target === undefined || entry.target === "user") {
            selectors.push(".chat-message-container-user");
        }
        if (entry.target === undefined || entry.target === "agent") {
            selectors.push(".chat-message-container-agent");
        }
        const containers = this.messageDiv.querySelectorAll<HTMLElement>(
            selectors.join(", "),
        );
        containers.forEach((c) => {
            if (
                c.dataset.feedbackRequestId === key ||
                c.dataset.feedbackClientRequestId === key
            ) {
                c.classList.toggle("chat-message-trashed", entry.hidden);
            }
        });
    }

    private getNotificationMessageGroupId(
        requestId: string | RequestId | undefined,
        source: string,
    ) {
        if (requestId !== undefined) {
            if (typeof requestId === "string") {
                return `notification-async-${source}-${requestId}`;
            }
            const messageGroupId = getMessageGroupId(requestId);
            if (messageGroupId !== undefined) {
                return `notification-request-${messageGroupId}`;
            }
        }
        return `notification-generic-${this.notificationCount++}`;
    }

    public addNotificationMessage(
        message: string | DisplayContent,
        source: string,
        requestId: string | RequestId | undefined,
    ) {
        const agentMessage: IAgentMessage = {
            message,
            requestId: {
                requestId: "",
                clientRequestId: this.getNotificationMessageGroupId(
                    requestId,
                    source,
                ),
            },
            source,
            actionIndex: 0,
        };
        this.addAgentMessage(agentMessage, {
            appendMode: "temporary",
            notification: true,
            scrollToMessage: typeof requestId === "string",
        });
    }
    addAgentMessage(
        msg: IAgentMessage,
        options?: {
            appendMode?: DisplayAppendMode;
            scrollToMessage?: boolean;
            notification?: boolean;
        },
    ) {
        const scrollToMessage = options?.scrollToMessage ?? false;
        const notification = options?.notification ?? false;
        const content: DisplayContent = msg.message;

        // Consolidate the dispatcher's transient "[X] Executing action ..."
        // status (sent with source="dispatcher", actionIndex=undefined,
        // appendMode="temporary") into the most recently created agent
        // bubble for this request, instead of letting it create a separate
        // dispatcher-sourced status bubble that visually duplicates the
        // upcoming agent reply. Mirrors chat-ui's behavior in chatPanel.ts.
        if (
            options?.appendMode === "temporary" &&
            msg.actionIndex === undefined &&
            msg.source === "dispatcher" &&
            !notification
        ) {
            const mg = this.getMessageGroup(msg.requestId);
            const last = mg?.getLastAgentMessage();
            if (last) {
                last.setMessage(
                    content,
                    msg.source,
                    "temporary",
                    msg.sourceIcon,
                );
                if (!scrollToMessage) {
                    this.updateScroll();
                    this.chatInputFocus();
                }
                return;
            }
        }

        const agentMessage = this.ensureAgentMessage(msg, notification);
        if (agentMessage === undefined) {
            return;
        }

        agentMessage.setMessage(
            content,
            msg.source,
            options?.appendMode,
            msg.sourceIcon,
        );

        if (!scrollToMessage) {
            this.updateScroll();
            this.chatInputFocus();
        }
    }
    updateScroll() {
        // REVIEW: electron 35 (chrome 134) scrollIntoView behavior changed compared to electron 30 (chrome 124)
        // Multiple call to scrollIntoView has no effect for the latter call(?)
        // Switch to use scrollTo instead and keep track of progress.

        if (this.isScrolling) {
            return;
        }
        this.isScrolling = true;

        // Add a delay to allow for element animation to start
        window.setTimeout(() => {
            if (this.messageDiv.scrollTop === 0) {
                this.isScrolling = false;
                return;
            }
            this.messageDiv.scrollTo(0, 0);
        }, 100);
    }
    private ensureAgentMessage(msg: IAgentMessage, notification = false) {
        return this.getMessageGroup(msg.requestId)?.ensureAgentMessage(
            msg,
            notification,
        );
    }
    public chatInputFocus() {
        this.chatInput?.focus();
    }

    public async askYesNo(
        requestId: RequestId,
        message: string,
        source: string,
    ): Promise<boolean> {
        const agentMessage = this.ensureAgentMessage({
            message: "",
            requestId,
            source,
        });
        if (agentMessage === undefined) {
            throw new Error(`Invalid requestId ${requestId}`);
        }
        agentMessage.setMessage(message, source, "inline");
        const choices: InputChoice[] = [
            {
                text: "Yes",
                element: iconCheckMarkCircle(),
                selectKey: ["Enter"],
                value: true,
            },
            {
                text: "No",
                element: iconX(),
                selectKey: ["Delete"],
                value: false,
            },
        ];
        const p = new Promise<boolean>((resolve) => {
            agentMessage.addChoicePanel(choices, (choice) => {
                agentMessage.setMessage(`  ${choice.text}`, source, "inline");
                resolve(choice.value);
            });
        });
        this.updateScroll();
        return p;
    }

    /**
     * Creates a numbered span element for use as a choice button label.
     */
    private static makeNumberSpan(n: number): HTMLSpanElement {
        const span = document.createElement("span");
        span.textContent = String(n);
        return span;
    }

    /**
     * Show an inline choice panel for a deferred interaction question.
     *
     * This is the unified entry point for both yes/no and multi-choice prompts
     * arriving via the `requestInteraction` deferred-broadcast path (connected
     * mode). The former `askYesNoWithContext` / `popupQuestion` distinction no
     * longer exists at the protocol level — both arrive as a `"question"`
     * interaction with an explicit `choices` array.
     *
     * For the binary `["Yes", "No"]` case we reuse the same icon elements as
     * `askYesNo()` for visual consistency.  All other choice sets render a
     * numbered button panel inline.
     *
     * @param interaction The full pending interaction request.
     * @param signal      AbortSignal that dismisses the panel when another
     *                    client answers or the server cancels the interaction.
     */
    public async showInteractionQuestion(
        interaction: Extract<PendingInteractionRequest, { type: "question" }>,
        signal?: AbortSignal,
    ): Promise<number> {
        const { requestId, message, choices, defaultId } = interaction;
        const source = interaction.source ?? "";

        if (choices.length === 0) {
            throw new Error(
                `Interaction ${interaction.interactionId} has no choices`,
            );
        }

        const effectiveRequestId =
            requestId ??
            ({
                requestId: "",
                clientRequestId: `agent-interaction-${interaction.interactionId}`,
            } as RequestId);

        const agentMessage = this.ensureAgentMessage({
            message: "",
            requestId: effectiveRequestId,
            source,
        });
        if (agentMessage === undefined) {
            throw new Error(
                `Could not create agent message for interaction ${interaction.interactionId}`,
            );
        }
        agentMessage.setMessage(message, source, "inline");

        // Build InputChoice[] for all choices.  For the binary ["Yes","No"] case
        // reuse the same icon elements that askYesNo() uses so the panel looks
        // identical — but we keep the panel reference here so the AbortSignal
        // can remove it when another client answers or the server cancels.
        const isYesNo =
            choices.length === 2 && choices[0] === "Yes" && choices[1] === "No";

        const inputChoices: InputChoice[] = isYesNo
            ? [
                  {
                      text: "Yes",
                      element: iconCheckMarkCircle(),
                      selectKey: ["Enter"],
                      value: 0,
                  },
                  {
                      text: "No",
                      element: iconX(),
                      selectKey: ["Delete"],
                      value: 1,
                  },
              ]
            : choices.map((label, index) => ({
                  text: label,
                  element: ChatView.makeNumberSpan(index + 1),
                  selectKey: [String(index + 1)],
                  value: index,
              }));

        // Mark the default choice with an additional Enter key binding.
        if (!isYesNo && defaultId !== undefined && inputChoices[defaultId]) {
            inputChoices[defaultId].selectKey = [
                ...(inputChoices[defaultId].selectKey ?? []),
                "Enter",
            ];
        }

        return new Promise<number>((resolve, reject) => {
            // Capture signal as a non-optional local so onAbort can reference
            // it without a non-null assertion.  onAbort is only reachable when
            // signal is defined (via addEventListener or the aborted early-out).
            const abortSignal = signal!;

            // addChoicePanel removes the panel automatically on selection, but
            // we need the ChoicePanel reference for the abort path.  We capture
            // it by reaching into the ChoicePanel constructor directly here.
            const choicePanel = new ChoicePanel(
                agentMessage.getMessageDiv(),
                inputChoices,
                (choice: InputChoice) => {
                    signal?.removeEventListener("abort", onAbort);
                    choicePanel.remove();
                    agentMessage.setMessage(
                        `  ${choice.text}`,
                        source,
                        "inline",
                    );
                    resolve(choice.value as number);
                },
            );

            const onAbort = () => {
                choicePanel.remove();
                // Append a dismissal notice inline in the message bubble.
                const reason = abortSignal.reason;
                const text =
                    reason &&
                    typeof reason === "object" &&
                    reason.kind === "resolved-by-other"
                        ? "answered by another client"
                        : "interaction cancelled";
                agentMessage.setMessage(`  [${text}]`, source, "inline");
                reject(abortSignal.reason);
            };

            if (signal?.aborted) {
                // Signal was already aborted before we could register — dismiss
                // the panel immediately rather than leaving it permanently open.
                onAbort();
            } else {
                signal?.addEventListener("abort", onAbort, { once: true });
            }

            this.updateScroll();
        });
    }

    public showChoice(
        requestId: RequestId,
        choiceId: string,
        type: "yesNo" | "multiChoice" | "pickRemember",
        _message: string,
        choiceLabels: string[],
        source: string,
        checkboxLabel?: string,
    ) {
        // Append choice UI to the last agent message (the action result bubble)
        const messageGroup = this.getMessageGroup(requestId);
        if (!messageGroup) return;

        const agentMessage =
            messageGroup.getLastAgentMessage() ??
            this.ensureAgentMessage({ message: "", requestId, source });
        if (!agentMessage) return;

        if (type === "yesNo") {
            const choices: InputChoice[] = [
                {
                    text: "Yes (Enter)",
                    element: iconCheckMarkCircle(),
                    selectKey: ["Enter"],
                    value: true,
                },
                {
                    text: "No (Del)",
                    element: iconX(),
                    selectKey: ["Delete"],
                    value: false,
                },
            ];
            agentMessage.addChoicePanel(choices, (choice) => {
                this.getDispatcher().respondToChoice(choiceId, choice.value);
            });
        } else if (type === "pickRemember") {
            agentMessage.addPickRememberPanel(
                choiceLabels,
                checkboxLabel ?? "Remember this for next time",
                (selected: number, remember: boolean) => {
                    this.getDispatcher().respondToChoice(choiceId, {
                        selected,
                        remember,
                    });
                },
            );
        } else {
            // multiChoice — checkboxes
            agentMessage.addCheckboxPanel(
                choiceLabels,
                (selectedIndices: number[]) => {
                    this.getDispatcher().respondToChoice(
                        choiceId,
                        selectedIndices,
                    );
                },
            );
        }
        this.updateScroll();
    }

    public async proposeAction(
        requestId: RequestId,
        actionTemplates: TemplateEditConfig,
        source: string,
    ) {
        const agentMessage = this.ensureAgentMessage({
            message: "",
            requestId,
            source,
        });
        if (agentMessage === undefined) {
            throw new Error(`Invalid requestId ${requestId}`);
        }
        return agentMessage?.proposeAction(
            this.getDispatcher(),
            actionTemplates,
        );
    }

    /**
     * Forwards a client interaction response to the dispatcher.
     * Delegates to `Dispatcher.respondToInteraction` while keeping the
     * dispatcher reference private to ChatView.
     */
    public respondToInteraction(
        response: PendingInteractionResponse,
    ): Promise<void> {
        return this.getDispatcher().respondToInteraction(response);
    }

    public setVoiceMode(enabled: boolean): void {
        if (enabled) {
            document.body.classList.add("voice-mode");
        } else {
            document.body.classList.remove("voice-mode");
        }
        this.chatInput?.setVoiceMode(enabled);
    }

    public setClaudeFocus(active: boolean): void {
        this._voiceBanner.classList.toggle("claude-focus", active);
        this._voiceBanner.textContent = active ? "Claude Focus" : "Voice Mode";
    }

    /**
     * Show or hide the reconnect banner above the chat. Pass `undefined` to
     * hide. While disconnected, also hides the in-progress stop button so the
     * user can't fire RPCs into a dead channel.
     */
    public setReconnectStatus(message: string | undefined): void {
        if (message === undefined) {
            this._reconnectBanner.style.display = "none";
            this._reconnectBanner.textContent = "";
        } else {
            this._reconnectBanner.textContent = message;
            this._reconnectBanner.style.display = "";
            // Any in-flight requestId is now orphaned — the server we were
            // talking to is gone. Reset so the stop button doesn't sit
            // dangling in the input bar pointing at nothing.
            if (this.activeRequestId) {
                this.activeRequestId = undefined;
                this.showStopButton(false);
            }
        }
    }

    public setDemoState(state: DemoUIState): void {
        const textEntry = this.chatInput?.textarea.getTextEntry();
        if (!textEntry) return;
        if (state === "paused") {
            textEntry.dataset.placeholder =
                "Ctrl+Right to continue • Esc to break demo";
        } else if (state === "running") {
            textEntry.dataset.placeholder = "Demo running… Esc to break";
        } else {
            delete textEntry.dataset.placeholder;
        }
    }

    /**
     * Show a transient busy state on the input box: set the placeholder to
     * `message` and disable typing.  Pass `undefined` to clear the busy
     * state and restore normal interaction.  Used while long-ish IPC
     * operations (e.g. switching conversation + replaying history) are in
     * flight so the user doesn't think the UI is unresponsive.
     *
     * NOTE: This low-level API does not snapshot prior state.  Prefer
     * {@link withBusy} for scoped use cases (it preserves any non-busy
     * placeholder set by, e.g., demo mode).
     */
    public setBusy(message: string | undefined): void {
        const textarea = this.chatInput?.textarea;
        const textEntry = textarea?.getTextEntry();
        if (!textarea || !textEntry) return;
        if (message) {
            textEntry.dataset.placeholder = message;
            textarea.enable(false);
        } else {
            delete textEntry.dataset.placeholder;
            textarea.enable(true);
        }
    }

    /**
     * Run `work` while the input is in a busy state showing `message`.
     * Snapshots the prior placeholder + enabled state on entry and
     * restores them on exit (even if `work` throws), so demo-mode or
     * other ambient placeholders are preserved across busy windows.
     * Supports nesting via LIFO snapshot stack.
     */
    public async withBusy<T>(
        message: string,
        work: () => Promise<T>,
    ): Promise<T> {
        const textarea = this.chatInput?.textarea;
        const textEntry = textarea?.getTextEntry();
        const snapshot =
            textarea && textEntry
                ? {
                      placeholder: textEntry.dataset.placeholder,
                      // contentEditable is the string "true"/"false"/"inherit".
                      enabled: textEntry.contentEditable !== "false",
                  }
                : undefined;
        this.setBusy(message);
        try {
            return await work();
        } finally {
            if (textarea && textEntry && snapshot) {
                if (snapshot.placeholder !== undefined) {
                    textEntry.dataset.placeholder = snapshot.placeholder;
                } else {
                    delete textEntry.dataset.placeholder;
                }
                textarea.enable(snapshot.enabled);
            } else {
                this.setBusy(undefined);
            }
        }
    }

    getMessageElm() {
        return this.topDiv;
    }
    getScrollContainer() {
        return this.messageDiv;
    }

    async showInputText(message: string) {
        return this.chatInput?.showInputText(message);
    }

    public setMetricsVisible(visible: boolean) {
        this.hideMetrics = !visible;
        for (const messageGroup of this.idToMessageGroup.values()) {
            messageGroup.setMetricsVisible(visible);
        }
        for (const messageGroup of this.pendingLocalGroups.values()) {
            messageGroup.setMetricsVisible(visible);
        }
        for (const messageGroup of this.clientMessageGroups.values()) {
            messageGroup.setMetricsVisible(visible);
        }
    }

    public set settingsView(value: SettingsView) {
        this._settingsView = value;
    }

    public get settingsView(): SettingsView | undefined {
        return this._settingsView;
    }

    public setInputMode(verticalLayout: boolean) {
        if (verticalLayout) {
            //this.topDiv.parentElement?.classList.add("write-only");
            this.topDiv.parentElement?.classList.remove("read-only");
        } else {
            //this.topDiv.parentElement?.classList.remove("write-only");
            this.topDiv.parentElement?.classList.remove("read-only");
        }
    }

    /**
     * Hosts a chat input control within the chat view.
     * @param input The chat input to set. This method can only be called once.
     */
    public setChatInput(input: ChatInput) {
        if (this.chatInput !== undefined) {
            throw new Error("Chat input already set");
        }

        // event handler for the text entry send event
        input.textarea.onSend = (messageHtml: string) => {
            // message from chat input are from innerHTML
            this.addUserMessage({
                type: "html",
                content: messageHtml,
            });
        };

        input.textarea.onChange = (
            _eta: ExpandableTextArea,
            isInput: boolean,
        ) => {
            if (this.partialCompletion) {
                if (isInput) {
                    this.partialCompletion.update(true);
                } else {
                    this.partialCompletion.hide();
                }
            }
        };

        input.textarea.onMouseWheel = (
            _eta: ExpandableTextArea,
            ev: WheelEvent,
        ) => {
            this.partialCompletion?.handleMouseWheel(ev);
        };

        input.textarea.onKeydown = (
            _eta: ExpandableTextArea,
            ev: KeyboardEvent,
        ) => {
            if (this.partialCompletion?.handleSpecialKeys(ev) === true) {
                return false;
            }

            // history
            if (!ev.altKey && !ev.ctrlKey) {
                if (ev.key == "ArrowUp" || ev.key == "ArrowDown") {
                    const currentContent: string =
                        this.chatInput?.textarea.getTextEntry().innerHTML ?? "";

                    if (
                        this.commandBackStack.length === 0 ||
                        this.commandBackStack[this.commandBackStackIndex] !==
                            currentContent
                    ) {
                        // Include previous-session entries (.history) — the
                        // up-arrow should walk every user bubble currently
                        // in the window, not just the ones from this run.
                        const messages: NodeListOf<Element> =
                            this.messageDiv.querySelectorAll(
                                ".chat-message-container-user:not(.chat-message-hidden) .chat-message-content",
                            );
                        this.commandBackStack = Array.from(messages).map(
                            (m: Element) =>
                                m.firstElementChild?.innerHTML.replace(
                                    'class="chat-input-image"',
                                    'class="chat-input-dropImage"',
                                ) ?? "",
                        );

                        this.commandBackStack.unshift(currentContent);
                        this.commandBackStackIndex = 0;
                    }

                    if (
                        ev.key == "ArrowUp" &&
                        this.commandBackStackIndex <
                            this.commandBackStack.length - 1
                    ) {
                        this.commandBackStackIndex++;
                    } else if (
                        ev.key == "ArrowDown" &&
                        this.commandBackStackIndex > 0
                    ) {
                        this.commandBackStackIndex--;
                    }

                    if (this.chatInput) {
                        const content =
                            this.commandBackStack[this.commandBackStackIndex];
                        this.chatInput.textarea.getTextEntry().innerHTML =
                            content;
                    }

                    this.chatInput?.textarea.moveCursorToEnd();

                    return false;
                }
            }

            return true;
        };

        this.chatInput = input;
        this.inputContainer = this.chatInput.getInputContainer();

        // Add the input div at the bottom so it's always visible
        this.topDiv.append(this.inputContainer);
    }
}
