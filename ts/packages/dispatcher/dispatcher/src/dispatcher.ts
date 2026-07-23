// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DisplayType,
    DynamicDisplay,
    QuestionFormResponse,
    TemplateSchema,
} from "@typeagent/agent-sdk";
import type { CommandResult } from "@typeagent/dispatcher-types";
import {
    ConnectionId,
    Dispatcher,
    RequestId,
} from "@typeagent/dispatcher-types";
import type {
    DisplayLogEntry,
    PendingInteractionResponse,
    QueuedRequest,
    CancelResult,
} from "@typeagent/dispatcher-types";
import {
    QueueFullError,
    ServerStoppingError,
} from "@typeagent/dispatcher-types";
import { getDispatcherStatus, processCommand } from "./command/command.js";
import { getCommandCompletion } from "./command/completion.js";
import { getActionContext } from "./execute/actionContext.js";
import { emitActionResult } from "./execute/actionHandlers.js";
import {
    closeCommandHandlerContext,
    CommandHandlerContext,
    DispatcherOptions,
    initializeCommandHandlerContext,
} from "./context/commandHandlerContext.js";
import { randomUUID } from "node:crypto";
import { getAgentSchemas } from "./context/system/describe/agentSchemaInfo.js";

async function getDynamicDisplay(
    context: CommandHandlerContext,
    appAgentName: string,
    type: DisplayType,
    displayId: string,
): Promise<DynamicDisplay> {
    const appAgent = context.agents.getAppAgent(appAgentName);
    if (appAgent.getDynamicDisplay === undefined) {
        throw new Error(`Dynamic display not supported by '${appAgentName}'`);
    }
    const sessionContext = context.agents.getSessionContext(appAgentName);
    return appAgent.getDynamicDisplay(type, displayId, sessionContext);
}

function getTemplateSchema(
    context: CommandHandlerContext,
    templateAgentName: string,
    templateName: string,
    data: unknown,
): Promise<TemplateSchema> {
    const appAgent = context.agents.getAppAgent(templateAgentName);
    if (appAgent.getTemplateSchema === undefined) {
        throw new Error(
            `Template schema not supported by '${templateAgentName}'`,
        );
    }
    const sessionContext = context.agents.getSessionContext(templateAgentName);
    return appAgent.getTemplateSchema(templateName, data, sessionContext);
}

async function getTemplateCompletion(
    templateAgentName: string,
    templateName: string,
    data: unknown,
    propertyName: string,
    context: CommandHandlerContext,
) {
    const appAgent = context.agents.getAppAgent(templateAgentName);
    if (appAgent.getTemplateCompletion === undefined) {
        throw new Error(
            `Template schema not supported by '${templateAgentName}'`,
        );
    }
    const sessionContext = context.agents.getSessionContext(templateAgentName);
    return appAgent.getTemplateCompletion(
        templateName,
        data,
        propertyName,
        sessionContext,
    );
}

async function checkCache(
    request: string,
    context: CommandHandlerContext,
    requestId: RequestId,
): Promise<CommandResult | undefined> {
    const agentCache = context.agentCache;

    // Check if cache is enabled
    if (!agentCache.isEnabled()) {
        return {
            lastError: "Cache is not enabled",
        };
    }

    // Get active schema names from enabled agents
    const activeSchemaNames = context.agents.getActiveSchemas();

    if (activeSchemaNames.length === 0) {
        return {
            lastError: "No active agents",
        };
    }

    // Attempt to match the request against the cache
    const matches = agentCache.match(request, {
        wildcard: context.session.getConfig().cache.matchWildcard,
        entityWildcard: context.session.getConfig().cache.matchEntityWildcard,
        rejectReferences:
            context.session.getConfig().explainer.filter.reference.list,
        namespaceKeys: agentCache.getNamespaceKeys(
            activeSchemaNames,
            undefined,
        ),
    });

    if (matches.length === 0) {
        return {
            lastError: "No cache match found",
        };
    }

    // Cache hit - execute the command normally to get the full result
    // This will execute the cached actions and return proper results through ClientIO
    return await processCommand(request, context, requestId);
}

/**
 * Resolve the surrounding context for a feedback report by replaying
 * the displayLog. Returns the user prompt, agent response messages,
 * and any action JSON that was recorded for the rated request — the
 * same data the user saw on screen at the time. Used to attach
 * actionable context to telemetry when the user opts in.
 */
function gatherFeedbackContext(
    context: CommandHandlerContext,
    requestId: RequestId,
):
    | {
          prompt?: string;
          responses: unknown[];
          actions: unknown[];
      }
    | undefined {
    const match = requestId.requestId;
    if (!match) return undefined;
    let prompt: string | undefined;
    const responses: unknown[] = [];
    const actions: unknown[] = [];
    for (const e of context.displayLog.getEntries()) {
        switch (e.type) {
            case "user-request":
                if (e.requestId.requestId === match) {
                    prompt = e.command;
                }
                break;
            case "set-display":
            case "append-display":
                if (e.message.requestId.requestId === match) {
                    responses.push(e.message.message);
                }
                break;
            case "set-display-info":
                if (e.requestId.requestId === match && e.action !== undefined) {
                    actions.push(e.action);
                }
                break;
            default:
                break;
        }
    }
    if (
        prompt === undefined &&
        responses.length === 0 &&
        actions.length === 0
    ) {
        return undefined;
    }
    const result: ReturnType<typeof gatherFeedbackContext> = {
        responses,
        actions,
    };
    if (prompt !== undefined) {
        result!.prompt = prompt;
    }
    return result;
}

export function createDispatcherFromContext(
    context: CommandHandlerContext,
    connectionId?: ConnectionId,
    closeFn?: () => Promise<void>,
): Dispatcher {
    const submitInput = (
        command: string,
        clientRequestId: unknown,
        attachments: string[] | undefined,
        options: any,
        requestId?: string,
    ) => {
        const input: any = {
            text: command,
            originatorConnectionId: connectionId ?? "",
        };
        if (clientRequestId !== undefined)
            input.clientRequestId = clientRequestId;
        if (attachments != null) input.attachments = attachments;
        if (options != null) input.options = options;
        if (requestId !== undefined) input.requestId = requestId;
        return input;
    };

    const wireCopy = (entry: any): QueuedRequest => {
        const out: QueuedRequest = {
            requestId: entry.requestId,
            originatorConnectionId: entry.originatorConnectionId,
            text: entry.text,
            submittedAt: entry.submittedAt,
            state: entry.state,
        };
        if (entry.clientRequestId !== undefined)
            out.clientRequestId = entry.clientRequestId;
        out.attachmentCount = entry.attachmentCount ?? 0;
        if (entry.options !== undefined) out.options = entry.options;
        if (entry.startedAt !== undefined) out.startedAt = entry.startedAt;
        if (entry.finishedAt !== undefined) out.finishedAt = entry.finishedAt;
        if (entry.error !== undefined) out.error = entry.error;
        return out;
    };

    const dispatcher: Dispatcher = {
        get connectionId() {
            return connectionId;
        },
        async submitCommand(
            command,
            attachments,
            options,
            clientRequestId,
            requestId,
        ) {
            let entry;
            try {
                entry = context.requestQueue.submit(
                    submitInput(
                        command,
                        clientRequestId,
                        attachments,
                        options,
                        requestId,
                    ),
                );
            } catch (e) {
                if (e instanceof QueueFullError) {
                    return {
                        ok: false,
                        error: "queue_full",
                        maxDepth: e.maxDepth,
                    };
                }
                if (e instanceof ServerStoppingError) {
                    return { ok: false, error: "server_stopping" };
                }
                throw e;
            }
            // Defensive: keep an absorbing handler so a caller that ignores
            // `completion` doesn't surface as unhandledRejection on drain
            // failure or shutdown abandon. Callers that DO await `completion`
            // see rejections normally via their own handler.
            void entry.completion.catch(() => {});
            return {
                ok: true,
                entry: { ...wireCopy(entry), completion: entry.completion },
            };
        },
        async getQueueSnapshot() {
            return context.requestQueue.getSnapshot();
        },
        async getDeveloperMode() {
            return context.developerMode === true;
        },
        async interrupt(command, attachments, options, clientRequestId) {
            let entry;
            try {
                entry = context.requestQueue.interrupt(
                    submitInput(command, clientRequestId, attachments, options),
                );
            } catch (e) {
                if (e instanceof QueueFullError) {
                    return {
                        ok: false,
                        error: "queue_full",
                        maxDepth: e.maxDepth,
                    };
                }
                if (e instanceof ServerStoppingError) {
                    return { ok: false, error: "server_stopping" };
                }
                throw e;
            }
            void entry.completion.catch(() => {});
            // Cancel any previously-running entry, using the snapshot taken
            // *after* the unshift so we don't cancel the interrupting entry.
            const snap = context.requestQueue.getSnapshot();
            if (
                snap.running !== null &&
                snap.running.requestId !== entry.requestId
            ) {
                context.requestQueue.cancelRunning(
                    snap.running.requestId,
                    "user",
                );
                const controller = context.activeRequests.get(
                    snap.running.requestId,
                );
                controller?.abort();
            }
            return {
                ok: true,
                entry: { ...wireCopy(entry), completion: entry.completion },
            };
        },
        getCommandCompletion(prefix, direction) {
            return getCommandCompletion(prefix, direction, context);
        },
        checkCache(request) {
            return checkCache(request, context, {
                connectionId,
                requestId: randomUUID(),
            });
        },

        getDynamicDisplay(appAgentName, type, id) {
            return getDynamicDisplay(context, appAgentName, type, id);
        },
        getTemplateSchema(templateAgentName, templateName, data) {
            return getTemplateSchema(
                context,
                templateAgentName,
                templateName,
                data,
            );
        },
        getTemplateCompletion(
            templateAgentName,
            templateName,
            data,
            propertyName,
        ) {
            return getTemplateCompletion(
                templateAgentName,
                templateName,
                data,
                propertyName,
                context,
            );
        },
        async getDisplayHistory(afterSeq?: number): Promise<DisplayLogEntry[]> {
            return context.displayLog.getEntries(afterSeq);
        },
        async close() {
            await closeFn?.();
            const descriptors = Object.getOwnPropertyDescriptors(this);
            for (const [name] of Object.entries(descriptors)) {
                // TODO: Note this doesn't prevent the function continue to be call if is saved.
                Object.defineProperty(this, name, {
                    get: () => {
                        throw new Error("Dispatcher is closed.");
                    },
                });
            }
        },
        async getStatus() {
            return getDispatcherStatus(context);
        },
        async getAgentSchemas(agentName?: string) {
            return getAgentSchemas(context, agentName);
        },
        async cancelCommand(requestId: string): Promise<CancelResult> {
            const kind = context.requestQueue.classifyCancel(requestId, "user");
            if (kind === "queued") {
                return { kind: "cancelled_queued", requestId };
            }
            if (kind === "running") {
                context.requestQueue.cancelRunning(requestId, "user");
                const controller = context.activeRequests.get(requestId);
                controller?.abort();
                return { kind: "cancelled_running", requestId };
            }
            return { kind: "not_found", requestId };
        },
        async promoteCommand(requestId: string): Promise<boolean> {
            return context.requestQueue.promote(requestId);
        },
        cancelCommandByClientId(clientRequestId: unknown) {
            const controller =
                context.activeRequestsByClientId.get(clientRequestId);
            if (controller) {
                controller.abort();
                return;
            }
            // Entry may still be sitting in the queue (no AbortController yet).
            // Walk the snapshot to find a matching clientRequestId and cancel
            // it via the queue. Check the running head too — it's normally
            // already in activeRequestsByClientId, but cover the race anyway.
            const snap = context.requestQueue.getSnapshot();
            const running = snap.running;
            if (running && running.clientRequestId === clientRequestId) {
                context.requestQueue.cancelRunning(running.requestId, "user");
                return;
            }
            for (const entry of snap.queued) {
                if (entry.clientRequestId === clientRequestId) {
                    context.requestQueue.cancelQueued(entry.requestId, "user");
                    return;
                }
            }
        },
        async recordUserHide(
            requestId: RequestId,
            hidden: boolean,
            target?: "user" | "agent",
            permanent?: boolean,
        ): Promise<void> {
            const entry = context.displayLog.logUserHide(
                requestId,
                hidden,
                target,
                permanent,
            );
            context.displayLog.saveQueued();
            try {
                context.clientIO.onUserHide?.(entry);
            } catch {
                // best-effort
            }
        },
        async restoreAllHidden(): Promise<number> {
            const hides = context.displayLog.getCurrentHides();
            let count = 0;
            for (const h of hides) {
                if (h.permanent === true) continue;
                if (h.hidden !== true) continue;
                const entry = context.displayLog.logUserHide(
                    h.requestId,
                    false,
                    h.target,
                );
                try {
                    context.clientIO.onUserHide?.(entry);
                } catch {
                    // best-effort
                }
                count++;
            }
            context.displayLog.saveQueued();
            return count;
        },
        async flushHidden(): Promise<number> {
            const hides = context.displayLog.getCurrentHides();
            let count = 0;
            for (const h of hides) {
                if (h.permanent === true) continue;
                if (h.hidden !== true) continue;
                const entry = context.displayLog.logUserHide(
                    h.requestId,
                    true,
                    h.target,
                    true,
                );
                try {
                    context.clientIO.onUserHide?.(entry);
                } catch {
                    // best-effort
                }
                count++;
            }
            context.displayLog.saveQueued();
            return count;
        },
        async recordUserFeedback(
            requestId: RequestId,
            rating,
            category,
            comment,
            includeContext,
        ): Promise<void> {
            const entry = context.displayLog.logUserFeedback(
                requestId,
                rating,
                category,
                comment,
            );
            context.displayLog.saveQueued();

            // Telemetry. The includeContext flag is the user's opt-in to
            // ship the surrounding prompt/response/action JSON with the
            // event; resolve those from the displayLog (so we capture
            // the state as the user saw it, not the live state).
            try {
                const payload: Record<string, unknown> = {
                    requestId: requestId.requestId,
                    rating,
                    category,
                    comment,
                    includeContext: includeContext === true,
                };
                if (includeContext === true) {
                    const ctx = gatherFeedbackContext(context, requestId);
                    if (ctx) {
                        payload.context = ctx;
                    }
                }
                context.logger?.logEvent("userFeedback", payload);
            } catch {
                // best-effort
            }

            // Fan out to all connected clients (including the originator)
            // so multi-window setups stay in sync. Optional on ClientIO —
            // CLI/test sinks may not implement it.
            try {
                context.clientIO.onUserFeedback?.(entry);
            } catch {
                // best-effort
            }
        },
        async respondToChoice(
            choiceId: string,
            response:
                | boolean
                | number[]
                | { selected: number; remember: boolean }
                | QuestionFormResponse,
        ) {
            return context.commandLock(async () => {
                const pending = context.pendingChoiceRoutes.get(choiceId);
                if (!pending) {
                    throw new Error("Choice not found or expired");
                }
                context.pendingChoiceRoutes.delete(choiceId);

                // Use original requestId so display appends to same message group
                context.currentRequestId = pending.requestId;
                context.commandResult = undefined;
                try {
                    const appAgent = context.agents.getAppAgent(
                        pending.agentName,
                    );
                    if (!appAgent.handleChoice) {
                        throw new Error(
                            `Agent '${pending.agentName}' does not support choices`,
                        );
                    }
                    const { actionContext, closeActionContext } =
                        getActionContext(
                            pending.agentName,
                            context,
                            pending.requestId,
                            pending.actionIndex,
                        );
                    try {
                        const result = await appAgent.handleChoice(
                            choiceId,
                            response,
                            actionContext,
                        );
                        if (result) {
                            // Run the same post-processing as the action
                            // pipeline so a choice callback that returns a new
                            // ActionResult renders fully — including a chained
                            // `pendingChoice` (yes/no card). Without this, a
                            // follow-up choice's message would show but its
                            // interactive card would never appear.
                            emitActionResult(
                                result,
                                actionContext,
                                context,
                                pending.requestId,
                                pending.agentName,
                                pending.actionIndex ?? 0,
                                pending.agentName,
                            );
                        }
                    } finally {
                        closeActionContext();
                        // Choice callbacks are how setup hooks defer their
                        // actual work — setup() returns the yes/no card
                        // immediately, then the install/build/whatever runs
                        // later when the user clicks. runSetup's own readiness
                        // refresh fires when setup() returns (before the
                        // click), so the cache reflects the pre-work state.
                        // Refresh again here, after the deferred work, so a
                        // successful install / build is picked up without the
                        // user having to manually run @config agent refresh.
                        // Wrapped to avoid masking handleChoice's own errors.
                        try {
                            await context.agents.refreshReadiness(
                                pending.agentName,
                            );
                        } catch {
                            // Non-fatal — the agent will reconcile on the
                            // next explicit refresh or setupOnFirstUse pass.
                        }
                    }
                } finally {
                    const result = context.commandResult;
                    context.commandResult = undefined;
                    context.currentRequestId = undefined;
                    return result;
                }
            });
        },
        async respondToInteraction(
            _response: PendingInteractionResponse,
        ): Promise<void> {
            // Base dispatcher does not manage pending interactions.
            // The server's SharedDispatcher overrides this method on the
            // per-connection dispatcher instance.
            throw new Error(
                "respondToInteraction is not supported on this dispatcher instance",
            );
        },
        cancelInteraction(_interactionId: string): void {
            // Base dispatcher does not manage pending interactions.
            // The server's SharedDispatcher overrides this method on the
            // per-connection dispatcher instance.
            throw new Error(
                "cancelInteraction is not supported on this dispatcher instance",
            );
        },
    };
    return dispatcher;
}

/**
 * Create a instance of the dispatcher.
 *
 * @param hostName A name use to identify the application that hosts the dispatcher for logging purposes.
 * @param options A set of options to initialize the dispatcher.  See `DispatcherOptions` for more details.
 * @returns a new dispatcher instance.
 */
export async function createDispatcher(
    hostName: string,
    options?: DispatcherOptions,
): Promise<Dispatcher> {
    const context = await initializeCommandHandlerContext(hostName, options);
    return createDispatcherFromContext(context, undefined, async () =>
        closeCommandHandlerContext(context),
    );
}
