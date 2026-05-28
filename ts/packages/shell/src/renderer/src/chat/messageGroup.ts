// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayContent, TypeAgentAction } from "@typeagent/agent-sdk";
import {
    CommandResult,
    IAgentMessage,
    NotifyExplainedData,
    RequestId,
    UserFeedbackEntry,
    UserMessageHiddenEntry,
} from "agent-dispatcher";
import { RequestMetrics } from "agent-dispatcher";

import { MessageContainer } from "../messageContainer";
import { ChatView } from "./chatView";
import { SettingsView } from "../settingsView";

/**
 * Persist the requestId on the agent message container as data
 * attributes so that when chat history is restored from saved HTML, we
 * can locate the rated request and rebuild a fresh widget with click
 * handlers (the saved HTML has only DOM, no JS state).
 */
function stampRequestIdOn(div: HTMLElement, requestId: RequestId) {
    if (requestId.requestId) {
        div.dataset.feedbackRequestId = requestId.requestId;
    }
    if (requestId.clientRequestId !== undefined) {
        div.dataset.feedbackClientRequestId = String(requestId.clientRequestId);
    }
}

const CANCELLED_MESSAGE = "⚠  Cancelled";
const CANCELLED_SOURCE = "shell";

export class MessageGroup {
    public metricsDiv?: {
        mainMetricsDiv: HTMLDivElement;
        markMetricsDiv: HTMLDivElement;
    };
    private readonly userMessage: MessageContainer;
    private statusMessage: MessageContainer | undefined;
    private readonly agentMessages: MessageContainer[] = [];
    private readonly start: number = performance.now();

    // The canonical RequestId for this group, populated when the server
    // assigns a UUID via setUserRequest (or when a remote/replayed
    // MessageGroup is constructed). Required for recordUserFeedback;
    // the feedback widget is attached only after this is set.
    private _requestId: RequestId | undefined;
    private _currentFeedback: UserFeedbackEntry | null = null;
    // LOAD-BEARING IDEMPOTENCE: `notifyCancelled` is invoked from two
    // independent paths — `requestCompleted({cancelled:true})` for local-origin
    // groups and `ChatView.onRequestCancelled` for remote-origin groups (and
    // both fire for locally-originated requests). This flag prevents
    // double-painting "⚠ Cancelled". Do not remove without rewiring both paths.
    private cancelledRendered = false;

    public get requestId(): RequestId | undefined {
        return this._requestId;
    }

    /**
     * Associate this group with a server-assigned RequestId. Idempotent —
     * later calls with the same id are no-ops. Also wires feedback for
     * any agent messages that already exist.
     *
     * Notifications use an empty server requestId and identify the group
     * by clientRequestId, so equality has to compare both fields (not
     * just `.requestId`).
     */
    public setRequestId(requestId: RequestId) {
        if (
            this._requestId !== undefined &&
            this._requestId.requestId === requestId.requestId &&
            this._requestId.clientRequestId === requestId.clientRequestId
        ) {
            return;
        }
        this._requestId = requestId;
        const controller = this.buildFeedbackController();
        if (controller !== undefined) {
            this.statusMessage?.attachFeedbackController(controller);
            this.statusMessage &&
                stampRequestIdOn(this.statusMessage.div, requestId);
            for (const agentMessage of this.agentMessages) {
                agentMessage?.attachFeedbackController(controller);
                agentMessage && stampRequestIdOn(agentMessage.div, requestId);
            }
            // User-message bubble gets a trash button only (no feedback
            // row) so the user can soft-delete their request alongside
            // its agent responses.
            this.userMessage.attachTrashButton(controller);
            stampRequestIdOn(this.userMessage.div, requestId);
        }
        if (this._currentFeedback !== null) {
            this.applyFeedback(this._currentFeedback);
        }
    }

    private buildFeedbackController() {
        const reqId = this._requestId;
        if (reqId === undefined) return undefined;
        return {
            getCurrentFeedback: () => this._currentFeedback,
            submit: async (
                rating: UserFeedbackEntry["rating"],
                category?: UserFeedbackEntry["category"],
                comment?: string,
                includeContext?: boolean,
            ) => {
                const dispatcher = this.chatView.dispatcher;
                if (dispatcher === undefined) return;
                try {
                    await dispatcher.recordUserFeedback(
                        reqId,
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
                const dispatcher = this.chatView.dispatcher;
                if (dispatcher === undefined) return;
                try {
                    await dispatcher.recordUserHide(reqId, hidden, target);
                } catch (e) {
                    console.error("recordUserHide failed", e);
                }
            },
        };
    }
    constructor(
        private readonly chatView: ChatView,
        private readonly settingsView: SettingsView,
        request: DisplayContent,
        container: HTMLDivElement,
        requestPromise: Promise<CommandResult | undefined> | undefined,
        public agents: Map<string, string>,
        private hideMetrics: boolean,
    ) {
        this.userMessage = new MessageContainer(
            chatView,
            settingsView,
            "user",
            chatView.userGivenName,
            agents,
            container,
            hideMetrics,
            this.start,
        );

        this.userMessage.setMessage(request, chatView.userGivenName);

        if (container.firstChild) {
            container.firstChild.before(this.userMessage.div);

            this.userMessage.div.scrollIntoView(false);
        } else {
            container.append(this.userMessage.div);
        }

        this.chatView.tts?.stop();

        if (requestPromise) {
            requestPromise
                .then((result) => this.requestCompleted(result))
                .catch((error) => this.requestException(error));
        }
    }

    public setMetricsVisible(visible: boolean) {
        this.hideMetrics = !visible;
        this.userMessage.setMetricsVisible(visible);
        this.statusMessage?.setMetricsVisible(visible);
        for (const agentMessage of this.agentMessages) {
            agentMessage.setMetricsVisible(visible);
        }
    }

    public setDisplayInfo(
        source: string,
        actionIndex?: number,
        action?: TypeAgentAction | string[],
    ) {
        const agentMessage = this.ensureAgentMessage({
            message: "",
            source,
            actionIndex,
        });
        agentMessage.setDisplayInfo(source, action);
    }

    public setActionData(_requestId: RequestId, data: any) {
        const agentMessage = this.ensureAgentMessage({
            message: "",
            source: "",
            actionIndex: undefined,
        });

        agentMessage.updateActionData(data);
    }

    public appendDiagnosticData(_requestId: RequestId, data: any) {
        const agentMessage = this.ensureAgentMessage({
            message: "",
            source: "",
            actionIndex: undefined,
        });

        agentMessage.appendDiagnosticData(data);
    }

    private requestCompleted(result: CommandResult | undefined) {
        this.updateMetrics(result?.metrics);
        if (result?.cancelled) {
            this.notifyCancelled();
        } else if (
            this.statusMessage === undefined &&
            this.agentMessages.length === 0
        ) {
            this.addStatusMessage(
                { message: "Command completed", source: "shell" },
                false,
            );
        } else {
            // statusMessage may be undefined when the dispatcher rendered
            // straight into agent bubbles (the consolidated path). The
            // per-container complete() calls below handle both shapes.
            this.chatView.updateScroll();
        }
        // Complete every bubble we created. complete() flushes pending TTS,
        // removes any trailing temporary content, and reconciles divState
        // (hide if empty / show if not). Without this, the consolidated
        // agent-bubble path leaves TTS un-flushed (audio truncated) and any
        // mid-stream "temporary" appendMode payload stays orphaned in the
        // DOM. Pre-existing behavior surfaced by Rob during PR #2291 review.
        this.statusMessage?.complete();
        for (const agentMessage of this.agentMessages) {
            agentMessage?.complete();
        }
        this.chatView.onRequestComplete?.();
    }

    private requestException(error: any) {
        console.error(error);
        this.addStatusMessage(
            { message: `Processing Error: ${error}`, source: "shell" },
            false,
        );
        // Same lifecycle reasoning as requestCompleted — flush TTS /
        // temporary content / divState on every bubble we created so an
        // exception mid-stream doesn't leave audio playing or temporary
        // payload visible.
        this.statusMessage?.complete();
        for (const agentMessage of this.agentMessages) {
            agentMessage?.complete();
        }
        this.chatView.onRequestComplete?.();
    }

    private ensureStatusMessage(source: string) {
        if (this.statusMessage === undefined) {
            this.statusMessage = new MessageContainer(
                this.chatView,
                this.settingsView,
                "agent",
                source,
                this.agents,
                this.userMessage.div,
                this.hideMetrics,
                this.start,
                true,
            );
            const controller = this.buildFeedbackController();
            if (controller && this._requestId) {
                this.statusMessage.attachFeedbackController(controller);
                stampRequestIdOn(this.statusMessage.div, this._requestId);
                if (this._currentFeedback !== null) {
                    this.statusMessage.setFeedbackState(this._currentFeedback);
                }
            }
        }

        return this.statusMessage;
    }

    public addStatusMessage(
        msg: Omit<IAgentMessage, "requestId">,
        temporary: boolean,
    ) {
        let message = msg.message;
        const statusMessage = this.ensureStatusMessage(msg.source);
        statusMessage.setMessage(
            message,
            msg.source,
            temporary ? "temporary" : "block",
        );

        this.updateMetrics(msg.metrics);
        this.chatView.updateScroll();
    }

    public updateMetrics(metrics?: RequestMetrics) {
        if (metrics) {
            if (metrics.parse !== undefined) {
                this.userMessage.updateMainMetrics(
                    "Translation",
                    metrics.parse,
                );
            }

            this.statusMessage?.updateMainMetrics(
                "Action",
                metrics.command,
                this.agentMessages.length === 0 ? metrics.duration : undefined,
            );

            for (let i = 0; i < this.agentMessages.length; i++) {
                const agentMessage = this.agentMessages[i];
                const info = metrics.actions[i];
                agentMessage.updateMainMetrics(
                    "Action",
                    info,
                    i === this.agentMessages.length - 1
                        ? metrics.duration
                        : undefined,
                );
            }
        }
    }

    public ensureAgentMessage(
        msg: Omit<IAgentMessage, "requestId">,
        notification = false,
    ) {
        const statusMessage = this.ensureStatusMessage(msg.source);

        const index = msg.actionIndex;
        if (index === undefined) {
            return statusMessage;
        }
        const agentMessage = this.agentMessages[index];
        if (agentMessage === undefined) {
            statusMessage.setFirstResponseMetricsVisibility(false);
            let beforeElem = statusMessage;
            for (let i = 0; i < index + 1; i++) {
                if (this.agentMessages[i] === undefined) {
                    const newAgentMessage = new MessageContainer(
                        this.chatView,
                        this.settingsView,
                        "agent",
                        msg.source,
                        this.agents,
                        beforeElem.div,
                        this.hideMetrics,
                        this.start,
                        i === 0,
                    );
                    if (notification) {
                        newAgentMessage.div.classList.add("notification");
                    }
                    const controller = this.buildFeedbackController();
                    if (controller && this._requestId) {
                        newAgentMessage.attachFeedbackController(controller);
                        stampRequestIdOn(newAgentMessage.div, this._requestId);
                        if (this._currentFeedback !== null) {
                            newAgentMessage.setFeedbackState(
                                this._currentFeedback,
                            );
                        }
                    }
                    this.agentMessages[i] = newAgentMessage;
                }
                beforeElem = this.agentMessages[i];
            }
            this.chatView.updateScroll();
        }

        this.updateMetrics(msg.metrics);
        return this.agentMessages[index];
    }

    /**
     * Hide (or restore) the side of this group identified by
     * `entry.target` — "user" affects only the user bubble, "agent"
     * affects the status + every agent response, undefined (legacy
     * entries) affects everything. The bubbles stay in DOM so
     * `@shell trash restore` brings them back in place.
     */
    public applyHide(entry: UserMessageHiddenEntry) {
        const hide = entry.hidden;
        const apply = (mc: MessageContainer | undefined) => {
            if (!mc) return;
            mc.div.classList.toggle("chat-message-trashed", hide);
        };
        if (entry.target === undefined || entry.target === "user") {
            apply(this.userMessage);
        }
        if (entry.target === undefined || entry.target === "agent") {
            apply(this.statusMessage);
            for (const agentMessage of this.agentMessages) {
                apply(agentMessage);
            }
        }
    }

    /**
     * Apply a feedback rating to every agent message bubble in this group.
     * Feedback is per-request, so all bubbles for the request reflect the
     * same rating regardless of which one was clicked.
     */
    public applyFeedback(entry: UserFeedbackEntry) {
        this._currentFeedback = entry.rating === null ? null : entry;
        this.statusMessage?.setFeedbackState(this._currentFeedback);
        for (const agentMessage of this.agentMessages) {
            agentMessage?.setFeedbackState(this._currentFeedback);
        }
    }

    public getLastAgentMessage(): MessageContainer | undefined {
        for (let i = this.agentMessages.length - 1; i >= 0; i--) {
            if (this.agentMessages[i] !== undefined) {
                return this.agentMessages[i];
            }
        }
        return undefined;
    }

    public updateUserMessage(message: string) {
        this.userMessage.setMessage(message, this.chatView.userGivenName);
    }

    /**
     * Reflect the server-side queue state onto the user bubble's chip.
     * Pass `null` on cancellation/completion to clear it. `onCancel` is wired
     * to the inline X button shown for queued entries.
     */
    public setQueueStatus(
        status: "queued" | "running" | null,
        onCancel?: () => void,
    ) {
        this.userMessage.setQueueStatus(status, onCancel);
    }

    /**
     * Render the "⚠ Cancelled" affordance for this group. Idempotent: safe to
     * call from both the local `requestCompleted({cancelled:true})` path and the
     * remote `requestCancelled` broadcast (which is the only signal for groups
     * that didn't originate locally, since they have no completion promise).
     */
    public notifyCancelled() {
        if (this.cancelledRendered) return;
        this.cancelledRendered = true;
        const lastAgentMessage = this.getLastAgentMessage();
        if (lastAgentMessage !== undefined) {
            lastAgentMessage.setMessage(
                CANCELLED_MESSAGE,
                CANCELLED_SOURCE,
                "block",
            );
            this.chatView.updateScroll();
        } else {
            this.addStatusMessage(
                { message: CANCELLED_MESSAGE, source: CANCELLED_SOURCE },
                false,
            );
        }
    }

    public notifyExplained(data: NotifyExplainedData) {
        this.userMessage.notifyExplained(data);
    }

    public updateGrammarResult(success: boolean, message?: string) {
        this.userMessage.updateGrammarResult(success, message);
    }

    public hideUserMessage() {
        this.userMessage.hide();
    }

    // Removes all DOM nodes owned by this group from their parents. Used by
    // ephemeral notification groups (e.g. OS-notification dismiss) so the
    // chat bubble disappears when the underlying notification is cleared.
    public dispose() {
        const removeFromParent = (el: HTMLElement | undefined) => {
            if (el && el.parentNode) {
                el.parentNode.removeChild(el);
            }
        };
        removeFromParent(this.userMessage.div);
        removeFromParent(this.statusMessage?.div);
        for (const agentMessage of this.agentMessages) {
            removeFromParent(agentMessage?.div);
        }
        removeFromParent(this.metricsDiv?.mainMetricsDiv);
        removeFromParent(this.metricsDiv?.markMetricsDiv);
    }
}
