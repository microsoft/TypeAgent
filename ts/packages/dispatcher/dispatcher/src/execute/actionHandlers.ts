// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ExecutableAction,
    FullAction,
    getFullActionName,
    PromptEntity,
} from "@typeagent/agent-cache";
import {
    type CommandHandlerContext,
    getCommandResult,
    ensureCommandResult,
    getRequestId,
} from "../context/commandHandlerContext.js";
import registerDebug from "debug";
import { getAppAgentName } from "../translation/agentTranslators.js";
import {
    ActionResult,
    ActionResultError,
    ActionContext,
    AppAgent,
    ParsedCommandParams,
    ParameterDefinitions,
    AppAction,
} from "@typeagent/agent-sdk";
import type { Span } from "@opentelemetry/api";
import {
    createActionResult,
    createActionResultNoDisplay,
    createActionResultFromError,
    serializeError,
} from "@typeagent/agent-sdk/helpers/action";
import {
    displayError,
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { IncrementalJsonValueCallBack } from "@typeagent/typechat-utils";
import { ProfileNames } from "../utils/profileNames.js";
import { UnknownAction } from "../context/dispatcher/schema/dispatcherActionSchema.js";
import {
    DispatcherName,
    isUnknownAction,
} from "../context/dispatcher/dispatcherUtils.js";
import { isPendingRequestAction } from "../translation/pendingRequest.js";
import {
    isSwitchEnabled,
    translatePendingRequestAction,
} from "../translation/translateRequest.js";
import { validateAction } from "@typeagent/action-schema";
import {
    PendingAction,
    resolveEntities,
    toPendingActions,
} from "./pendingActions.js";
import {
    recordActionFlowException,
    recordActionHandlerException,
    recordActionResultError,
    recordActionSetupFailure,
    wrapActionSpan,
} from "../otel/actionSpan.js";
import { otel } from "@typeagent/telemetry";
import { getActionContext } from "./actionContext.js";
import {
    AgentNotReadyError,
    getErrorDisplayContent,
} from "./agentNotReadyError.js";
import {
    addActionResultToMemory,
    addResultToMemory,
} from "../context/memory.js";
import { setActivityContext } from "./activityContext.js";
import { tryGetActionSchema } from "../translation/actionSchemaFileCache.js";
import { processFlow, type FlowDefinition } from "./flowInterpreter.js";
import { getSessionName } from "../context/session.js";
import {
    logActionCompleted,
    logActionStarted,
} from "../otel/structuredEvents.js";

const debugActions = registerDebug("typeagent:dispatcher:actions");
const debugActionsInfo = registerDebug("typeagent:dispatcher:actions:info");
const debugCommandExecError = registerDebug(
    "typeagent:dispatcher:command:exec:error",
);
export function getSchemaNamePrefix(
    schemaName: string,
    systemContext: CommandHandlerContext,
) {
    const config = systemContext.agents.getActionConfig(schemaName);
    return `[${config.emojiChar} ${schemaName}] `;
}

// Pre-flight readiness gate. Looks up the agent's cached ReadinessReport
// (populated when the agent's session context was initialized; refreshed
// after setup).
//
// Behavior:
//   - state "ready": returns undefined; the caller proceeds with the action
//     or command.
//   - state "setup-required" with `execution.setupOnFirstUse` enabled and
//     the agent implements `setup`: invokes setup and returns its
//     ActionResult so the caller can surface it (yes/no card included) in
//     place of the user's original request. The original action/command is
//     NOT auto-retried — the user re-runs it after setup completes.
//   - state "setup-required" otherwise: throws a friendly Error with a
//     `@config agent setup <name>` hint.
//   - state "unsupported": always throws.
//
// Agents that don't implement checkReadiness default to `ready` and never
// trip this check — see appAgentManager.getReadiness().
// Exported for unit tests.
export async function checkAgentReady(
    appAgentName: string,
    systemContext: CommandHandlerContext,
    actionContext: ActionContext<unknown>,
): Promise<ActionResult | undefined> {
    const report = systemContext.agents.getReadiness(appAgentName);
    if (report.state === "ready") {
        return undefined;
    }
    const reason = report.message ?? "Agent is not ready.";
    // `details` carries the actionable part (which file to edit, the YAML to
    // paste). It's markdown, so it travels as rich display content rather
    // than being folded into the plain-text Error message, which clients
    // render without formatting (collapsing the snippet's indentation).
    const details = report.details;
    if (report.state === "unsupported") {
        const message = `Agent '${appAgentName}' is not supported in this environment: ${reason}`;
        throw new AgentNotReadyError(
            message,
            details ? `${message}\n\n${details}` : undefined,
        );
    }
    // setup-required
    if (systemContext.session.getConfig().execution.setupOnFirstUse) {
        const setupResult = await systemContext.agents.runSetup(
            appAgentName,
            actionContext,
            systemContext,
        );
        if (setupResult !== undefined) {
            return setupResult;
        }
        // No setup hook — fall through to the friendly throw below.
    }
    // Different hint depending on whether the agent can be configured
    // from chat. Without a hook (manual config case), `@config agent
    // setup` would just bounce the user; point at `refresh` instead.
    const hasSetup = systemContext.agents.hasSetup(appAgentName);
    const command = hasSetup
        ? `@config agent setup ${appAgentName}`
        : `@config agent refresh ${appAgentName}`;
    const hint = hasSetup
        ? `Run \`${command}\` to configure it.`
        : `After fixing the underlying issue, run \`${command}\` to re-check.`;
    const headline = `Agent '${appAgentName}' needs configuration before it can be used: ${reason}`;
    // Agents commonly close their own `details` by telling the user to run
    // the very same command; appending the hint on top of that just says it
    // twice. Only add it when the details didn't already.
    const detailsDisplay =
        details === undefined
            ? undefined
            : details.includes(command)
              ? `${headline}\n\n${details}`
              : `${headline}\n\n${details}\n\n${hint}`;
    throw new AgentNotReadyError(`${headline} ${hint}`, detailsDisplay);
}

function getStreamingActionContext(
    appAgentName: string,
    actionIndex: number,
    systemContext: CommandHandlerContext,
    fullAction: FullAction,
) {
    const actionContext = systemContext.streamingActionContext;
    systemContext.streamingActionContext = undefined;

    if (
        actionContext === undefined ||
        actionContext.actionIndex !== actionIndex
    ) {
        actionContext?.closeActionContext();
        return undefined;
    }

    // If we are reusing the streaming action context, we need to update the action.
    systemContext.clientIO.setDisplayInfo(
        getRequestId(systemContext),
        appAgentName,
        actionIndex,
        fullAction,
    );
    return actionContext;
}

interface ActionSpanExecutionArgs {
    executableAction: ExecutableAction;
    context: ActionContext<CommandHandlerContext>;
    actionIndex: number;
    systemContext: CommandHandlerContext;
    appAgentName: string;
    appAgent: AppAgent;
    actionContext: ActionContext<unknown>;
}

interface ActionSpanExecutionOutcome {
    result: ActionResult;
    failureRecorded: boolean;
    setupReplacementResult: boolean;
}

function rethrowIfActionCancelled(
    error: unknown,
    systemContext: CommandHandlerContext,
): void {
    if (
        (error as { name?: unknown })?.name === "AbortError" ||
        systemContext.currentAbortSignal?.aborted
    ) {
        throw new DOMException("The operation was aborted.", "AbortError");
    }
}

function createConvertedActionErrorResult(error: unknown): ActionResult {
    const details = serializeError(error);
    const result = createActionResultFromError(details.message, details);
    const errorDisplay = getErrorDisplayContent(error);
    return errorDisplay === undefined
        ? result
        : { ...result, errorDisplayContent: errorDisplay };
}

async function executeFlowForActionSpan(
    span: Span,
    flowDef: FlowDefinition,
    args: ActionSpanExecutionArgs,
): Promise<ActionSpanExecutionOutcome> {
    const { executableAction, context, actionIndex, systemContext } = args;
    const flowParams = (executableAction.action.parameters ?? {}) as Record<
        string,
        unknown
    >;
    try {
        const result = await processFlow(
            flowDef,
            flowParams,
            context,
            actionIndex,
        );
        return {
            result,
            failureRecorded: false,
            setupReplacementResult: false,
        };
    } catch (error) {
        rethrowIfActionCancelled(error, systemContext);
        recordActionFlowException(span);
        return {
            result: createConvertedActionErrorResult(error),
            failureRecorded: true,
            setupReplacementResult: false,
        };
    }
}

async function executeHandlerForActionSpan(
    span: Span,
    args: ActionSpanExecutionArgs,
): Promise<ActionSpanExecutionOutcome> {
    const {
        executableAction,
        systemContext,
        appAgentName,
        appAgent,
        actionContext,
    } = args;
    if (appAgent.executeAction === undefined) {
        recordActionSetupFailure(span, "handler_missing");
        const error = new Error(
            `Agent '${appAgentName}' does not support executeAction.`,
        );
        return {
            result: createConvertedActionErrorResult(error),
            failureRecorded: true,
            setupReplacementResult: false,
        };
    }

    let setupResult: ActionResult | undefined;
    try {
        setupResult = await checkAgentReady(
            appAgentName,
            systemContext,
            actionContext,
        );
    } catch (error) {
        rethrowIfActionCancelled(error, systemContext);
        recordActionSetupFailure(span, "agent_not_ready");
        return {
            result: createConvertedActionErrorResult(error),
            failureRecorded: true,
            setupReplacementResult: false,
        };
    }
    if (setupResult !== undefined) {
        return {
            result: setupResult,
            failureRecorded: false,
            setupReplacementResult: true,
        };
    }

    const displayCountBefore = systemContext.displayCount;
    try {
        const handlerResult = await appAgent.executeAction(
            executableAction.action,
            actionContext,
        );
        const completedText = `Action ${getFullActionName(
            executableAction,
        )} completed.`;
        return {
            result:
                handlerResult ??
                (systemContext.displayCount !== displayCountBefore
                    ? createActionResultNoDisplay(completedText)
                    : createActionResult(completedText)),
            failureRecorded: false,
            setupReplacementResult: false,
        };
    } catch (error) {
        rethrowIfActionCancelled(error, systemContext);
        recordActionHandlerException(span);
        return {
            result: createConvertedActionErrorResult(error),
            failureRecorded: true,
            setupReplacementResult: false,
        };
    }
}

async function executeForActionSpan(
    span: Span,
    args: ActionSpanExecutionArgs,
): Promise<ActionSpanExecutionOutcome> {
    const { schemaName, actionName } = args.executableAction.action;
    const flowDef = args.systemContext.agents.getFlow(schemaName, actionName);
    return flowDef === undefined
        ? executeHandlerForActionSpan(span, args)
        : executeFlowForActionSpan(span, flowDef, args);
}

// REVIEW: don't export this
export async function executeAction(
    executableAction: ExecutableAction,
    context: ActionContext<CommandHandlerContext>,
    actionIndex: number,
): Promise<ActionResult> {
    const action = executableAction.action;
    const schemaName = action.schemaName;
    // For nested action calls (e.g., from TaskFlow scripts), agentContext may be
    // the agent's own context rather than CommandHandlerContext. In that case,
    // use _systemContext which exposes the CommandHandlerContext.
    const sessionCtx = context.sessionContext as any;
    const systemContext: CommandHandlerContext =
        sessionCtx._systemContext ?? sessionCtx.agentContext;

    const appAgentName = getAppAgentName(schemaName);
    const requestId = getRequestId(systemContext);
    const appAgent = systemContext.agents.getAppAgent(appAgentName);

    debugActionsInfo("executing action", {
        requestId: requestId.requestId,
        schema: schemaName,
        action: action.actionName,
        agent: appAgentName,
        index: actionIndex,
    });
    if (debugActions.enabled) {
        const parameters = Object.entries(action.parameters ?? {});
        debugActions("executing action details", {
            requestId: requestId.requestId,
            schema: schemaName,
            action: action.actionName,
            agent: appAgentName,
            index: actionIndex,
            parameterCount: parameters.length,
            parameters: parameters.slice(0, 20).map(([name, value]) => ({
                name,
                type:
                    value === null
                        ? "null"
                        : Array.isArray(value)
                          ? "array"
                          : typeof value,
            })),
        });
    }

    // Update the last action translator.
    systemContext.lastActionSchemaName = schemaName;

    // Reuse the same streaming action context if one is available.

    const { actionContext, closeActionContext } =
        getStreamingActionContext(
            appAgentName,
            actionIndex,
            systemContext,
            action,
        ) ??
        getActionContext(
            appAgentName,
            systemContext,
            requestId,
            actionIndex,
            action,
        );

    const prefix = getSchemaNamePrefix(action.schemaName, systemContext);
    displayStatus(
        `${prefix}Executing action ${getFullActionName(executableAction)}`,
        context,
    );
    actionContext.profiler = systemContext.commandProfiler?.measure(
        ProfileNames.executeAction,
        true,
        actionIndex,
    );

    // Action parameters, result payloads, and user text are never stamped.
    const actionSpanAttributes: {
        -readonly [K in keyof otel.TypeAgentSpanAttributes]: otel.TypeAgentSpanAttributes[K];
    } = {
        agentName: appAgentName,
        actionName: action.actionName,
    };
    const sessionDirPath = systemContext.session?.sessionDirPath;
    if (sessionDirPath !== undefined) {
        actionSpanAttributes.sessionId = getSessionName(sessionDirPath);
    }
    if (systemContext.activationId !== undefined) {
        actionSpanAttributes.activationId = systemContext.activationId;
    }
    if (systemContext.traceId !== undefined) {
        actionSpanAttributes.traceId = systemContext.traceId;
    }

    return wrapActionSpan(actionSpanAttributes, async (actionSpan) => {
        const eventData = {
            requestId: requestId.requestId,
            schemaName,
            actionName: action.actionName,
            appAgentName,
            actionIndex,
        };
        // Measure the action-execution phase at this call boundary (same
        // `Date.now()` convention as reasoning/translation) so success,
        // failure, and cancellation completions all carry a real duration.
        const actionStartedAt = Date.now();
        logActionStarted(systemContext.logger, eventData);
        try {
            const outcome = await executeForActionSpan(actionSpan, {
                executableAction,
                context,
                actionIndex,
                systemContext,
                appAgentName,
                appAgent,
                actionContext,
            });
            // If the agent ran to completion but a cancel arrived while it was executing,
            // discard the result and treat this as a cancellation.
            systemContext.currentAbortSignal?.throwIfAborted();
            actionContext.profiler?.stop();
            actionContext.profiler = undefined;

            if (
                !outcome.failureRecorded &&
                !outcome.setupReplacementResult &&
                outcome.result.error !== undefined
            ) {
                recordActionResultError(actionSpan);
            }
            emitActionResult(
                outcome.result,
                actionContext,
                systemContext,
                requestId,
                appAgentName,
                actionIndex,
                schemaName,
            );

            logActionCompleted(systemContext.logger, {
                ...eventData,
                success: outcome.result.error === undefined,
                elapsedMs: Date.now() - actionStartedAt,
            });
            closeActionContext();
            return outcome.result;
        } catch (error) {
            logActionCompleted(systemContext.logger, {
                ...eventData,
                success: false,
                cancelled:
                    (error as { name?: unknown })?.name === "AbortError" ||
                    systemContext.currentAbortSignal?.aborted === true,
                elapsedMs: Date.now() - actionStartedAt,
            });
            throw error;
        }
    });
}

// Post-execution processing for an ActionResult: error / displayContent /
// dynamicDisplayId / pendingChoice. Shared between the action and command
// pipelines so commands that opt in to returning ActionResult get the same
// rendering — including the in-chat yes/no card via createYesNoChoiceResult.
//
// `actionIndex` and `schemaName` are action-shaped concepts. For commands
// invoking this helper, callers pass `actionIndex: 0` and
// `schemaName: appAgentName` as placeholders. Choice routing keys on
// `choiceId`, not actionIndex; schemaName is only used as the source label
// on the choice card.
//
// Exported for @config agent setup, which needs to route a target agent's
// setup result (display + pendingChoice) under the TARGET agent's name —
// not the system agent that owns the @config command. Without this, the
// yes/no choice card's response is routed to the wrong agent's
// handleChoice, and the registered callback never fires.
// Build a JSON-safe snapshot of an ActionResult for the dev inspector.
// `displayContent` is already rendered as the message bubble, so we record
// only its shape (not the potentially large HTML) to keep the payload small.
// The round-trip guarantees the result can't carry anything that breaks the
// diagnostic transport.
function projectActionResultForDiagnostics(result: ActionResult): unknown {
    const { displayContent, ...rest } = result as ActionResult & {
        displayContent?: unknown;
    };
    const snapshot: Record<string, unknown> = { ...rest };
    if (displayContent !== undefined) {
        snapshot.displayContentType =
            typeof displayContent === "object" && displayContent !== null
                ? ((displayContent as { type?: unknown }).type ?? "object")
                : typeof displayContent;
    }
    try {
        return JSON.parse(JSON.stringify(snapshot));
    } catch {
        return {
            note: "result not serializable",
            error: "error" in result ? result.error : undefined,
        };
    }
}

function displayActionResultError(
    result: ActionResultError,
    actionContext: ActionContext<unknown>,
): void {
    if (result.errorDisplayContent !== undefined) {
        actionContext.actionIO.appendDisplay(
            result.errorDisplayContent,
            "block",
        );
    } else {
        displayError(result.error, actionContext);
    }
}

export function emitActionResult(
    result: ActionResult,
    actionContext: ActionContext<unknown>,
    systemContext: CommandHandlerContext,
    requestId: ReturnType<typeof getRequestId>,
    appAgentName: string,
    actionIndex: number,
    schemaName: string,
): void {
    // Dev inspector: ship a serialized snapshot of the whole result (success
    // or error - entities, historyText, tokenUsage, errorDetails) over the
    // diagnostic side-channel so a client can show it in a panel separate
    // from the action JSON. Emitted before the error early-return below so
    // failures are captured too. Best-effort: never let it break execution.
    try {
        systemContext.clientIO.appendDiagnosticData(requestId, {
            type: "actionResult",
            source: appAgentName,
            schemaName,
            actionIndex,
            result: projectActionResultForDiagnostics(result),
        });
    } catch {
        // Diagnostics are best-effort; ignore transport errors.
    }
    if (result.error !== undefined) {
        if (!("fallbackToReasoning" in result) || !result.fallbackToReasoning) {
            displayActionResultError(result, actionContext);
        }
        return;
    }
    // Accumulate any self-reported action token usage onto the command
    // result so the UI can show "Action Tokens". This is the single choke
    // point for both the action pipeline (executeAction) and command
    // pipeline (executeCommand), so all agent-reported usage lands here.
    // Use ensureCommandResult (not getCommandResult) so this is recorded
    // even when collectCommandResult is off — same as how metrics are
    // attached in endProcessCommand, which always returns context.commandResult.
    if (result.tokenUsage !== undefined) {
        const commandResult = ensureCommandResult(systemContext);
        const acc = commandResult.actionTokenUsage ?? {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        };
        acc.prompt_tokens += result.tokenUsage.prompt_tokens;
        acc.completion_tokens += result.tokenUsage.completion_tokens;
        acc.total_tokens += result.tokenUsage.total_tokens;
        if (result.tokenUsage.cached_tokens !== undefined) {
            acc.cached_tokens =
                (acc.cached_tokens ?? 0) + result.tokenUsage.cached_tokens;
        }
        if (result.tokenUsage.thinking_tokens !== undefined) {
            acc.thinking_tokens = [
                ...(acc.thinking_tokens ?? []),
                ...result.tokenUsage.thinking_tokens,
            ];
        }
        if (result.tokenUsage.thinking_tokens_estimated) {
            acc.thinking_tokens_estimated = true;
        }
        commandResult.actionTokenUsage = acc;
    }
    if (result.displayContent !== undefined) {
        actionContext.actionIO.appendDisplay(result.displayContent, "block");
    }
    if (result.dynamicDisplayId !== undefined) {
        systemContext.clientIO.setDynamicDisplay(
            requestId,
            schemaName,
            actionIndex,
            result.dynamicDisplayId,
            result.dynamicDisplayNextRefreshMs!,
        );
    }
    if (result.pendingChoice !== undefined) {
        const pc = result.pendingChoice;
        systemContext.pendingChoiceRoutes.set(pc.choiceId, {
            agentName: appAgentName,
            requestId,
            actionIndex,
        });
        if (pc.type === "form") {
            // Only include optionals when set - exactOptionalPropertyTypes
            // forbids assigning `undefined` to QuestionForm's optional props.
            systemContext.clientIO.requestForm(
                requestId,
                pc.choiceId,
                {
                    fields: pc.fields,
                    ...(pc.message !== undefined
                        ? { message: pc.message }
                        : {}),
                    ...(pc.paged !== undefined ? { paged: pc.paged } : {}),
                },
                schemaName,
            );
        } else {
            systemContext.clientIO.requestChoice(
                requestId,
                pc.choiceId,
                pc.type,
                pc.message,
                pc.type === "yesNo" ? [] : pc.choices,
                schemaName,
                pc.type === "pickRemember" ? pc.checkboxLabel : undefined,
            );
        }
    }
}

async function canExecute(
    actions: ExecutableAction[],
    context: ActionContext<CommandHandlerContext>,
): Promise<boolean> {
    const sessionCtx = context.sessionContext as any;
    const systemContext: CommandHandlerContext =
        sessionCtx._systemContext ?? sessionCtx.agentContext;
    const unknown: UnknownAction[] = [];
    const disabled = new Set<string>();
    for (const { action } of actions) {
        if (isUnknownAction(action)) {
            unknown.push(action);
        }
        if (
            action.schemaName &&
            !systemContext.agents.isActionActive(action.schemaName)
        ) {
            disabled.add(action.schemaName);
        }
    }

    if (unknown.length > 0) {
        const unknownRequests = unknown.map(
            (action) => action.parameters.request,
        );
        const lines = [
            `Unable to determine ${actions.length > 1 ? "one or more actions in" : "action for"} the request.`,
            ...unknownRequests.map((s) => `- ${s}`),
        ];
        addResultToMemory(systemContext, lines.join("\n"), DispatcherName);

        const config = systemContext.session.getConfig();
        if (!isSwitchEnabled(config)) {
            lines.push("");
            lines.push("Switching agents is disabled");
        } else {
            const entries = await Promise.all(
                unknownRequests.map((request) =>
                    systemContext.agents.semanticSearchActionSchema(
                        request,
                        1,
                        () => true, // don't filter
                    ),
                ),
            );
            const schemaNames = new Set(
                entries
                    .filter((e) => e !== undefined)
                    .map((e) => e![0].item.actionSchemaFile.schemaName)
                    .filter(
                        (schemaName) =>
                            !systemContext.agents.isSchemaActive(schemaName),
                    ),
            );

            if (schemaNames.size > 0) {
                lines.push("");
                lines.push(
                    `Possible agent${schemaNames.size > 1 ? "s" : ""} to handle the request${unknownRequests.length > 1 ? "s" : ""} are not active: ${Array.from(schemaNames).join(", ")}`,
                );
            }
        }

        displayError(lines, context);
        return false;
    }

    if (disabled.size > 0) {
        const message = `Not executed. Action disabled for ${Array.from(disabled.values()).join(", ")}`;
        addResultToMemory(systemContext, message, DispatcherName);
        displayWarn(message, context);
        return false;
    }

    return true;
}

export type ActionExecutionError = {
    error: string;
    failedAction: ExecutableAction;
    fallbackToReasoning?: boolean;
};

export async function executeActions(
    actions: ExecutableAction[],
    entities: PromptEntity[] | undefined,
    context: ActionContext<CommandHandlerContext>,
): Promise<ActionExecutionError | undefined> {
    const sessionCtx = context.sessionContext as any;
    const systemContext: CommandHandlerContext =
        sessionCtx._systemContext ?? sessionCtx.agentContext;
    const commandResult = getCommandResult(systemContext);
    if (commandResult !== undefined) {
        commandResult.actions = actions.map(({ action }) => action);
    }

    // Even if the action is not executed, resolve the entities for the commandResult.
    const actionQueue: PendingAction[] = await toPendingActions(
        context,
        actions,
        entities,
    );

    if (!(await canExecute(actions, context))) {
        return;
    }

    let actionIndex = 0;
    while (actionQueue.length !== 0) {
        systemContext.currentAbortSignal?.throwIfAborted();
        const pending = actionQueue.shift()!;
        const executableAction = pending.executableAction;

        const action = executableAction.action;

        if (isPendingRequestAction(action)) {
            const translationResult = await translatePendingRequestAction(
                action,
                context,
                actionIndex,
            );

            const requestAction = translationResult.requestAction;
            actionQueue.unshift(
                ...(await toPendingActions(
                    context,
                    requestAction.actions,
                    requestAction.history?.entities,
                )),
            );
            continue;
        }
        const appAgentName = getAppAgentName(action.schemaName);
        // resolve result entities.
        const resultEntityResolver = pending.resultEntityResolver;
        let resolvedEntities = pending.resolvedEntities;
        if (resultEntityResolver !== undefined) {
            const resultResolvedEntities = await resolveEntities(
                systemContext.agents,
                action,
                resultEntityResolver,
            );
            if (resultResolvedEntities !== undefined) {
                if (resolvedEntities === undefined) {
                    resolvedEntities = [];
                }
                resolvedEntities.push(...resultResolvedEntities);
            }
        }
        const result = await executeAction(
            executableAction,
            context,
            actionIndex,
        );

        // add the action result to memory whether it has error or not.
        if (
            systemContext.actionResultEntityStorage ||
            systemContext.actionResultKnowledgeExtraction
        ) {
            addActionResultToMemory(
                systemContext,
                executableAction,
                resolvedEntities,
                action.schemaName,
                result,
            );
        }

        if (result.error !== undefined) {
            // Stop executing further action on error.
            return { error: result.error, failedAction: executableAction };
        }

        const resultEntityId = executableAction.resultEntityId;
        if (resultEntityId !== undefined) {
            if (result.resultEntity === undefined) {
                throw new Error(
                    `Action ${getFullActionName(
                        executableAction,
                    )} did not return a result entity.`,
                );
            }
            if (resultEntityResolver === undefined) {
                throw new Error(
                    `Internal error: resultEntityResolver is undefined`,
                );
            }
            resultEntityResolver.setResultEntity(
                `\${result-${resultEntityId}}`,
                {
                    ...result.resultEntity,
                    sourceAppAgentName: appAgentName,
                },
                result.resultValue,
            );
        }

        if (result.activityContext !== undefined) {
            if (actionQueue.length > 0) {
                throw new Error(
                    `Cannot change activity context when there are pending actions.`,
                );
            }

            debugActionsInfo("result activity context", {
                agent: appAgentName,
                activity: result.activityContext?.activityName,
                clearing: result.activityContext === null,
                openLocalView: result.activityContext?.openLocalView,
                restricted: result.activityContext?.restricted,
            });
            const prevActivityContext = systemContext.activityContext;
            const openLocalView = setActivityContext(
                action.schemaName,
                result.activityContext,
                systemContext,
            );
            if (openLocalView !== undefined) {
                if (openLocalView) {
                    const port =
                        systemContext.agents.getLocalHostPort(appAgentName);
                    if (port !== undefined) {
                        await systemContext.clientIO.openLocalView(
                            getRequestId(systemContext),
                            port,
                        );
                    }
                } else if (prevActivityContext !== undefined) {
                    const port = systemContext.agents.getLocalHostPort(
                        prevActivityContext.appAgentName,
                    );
                    if (port !== undefined) {
                        await systemContext.clientIO.closeLocalView(
                            getRequestId(systemContext),
                            port,
                        );
                    }
                }
            }
            if (systemContext.activityContext !== undefined) {
                debugActionsInfo("activity started", {
                    schema: action.schemaName,
                    agent: systemContext.activityContext.appAgentName,
                    activity: systemContext.activityContext.activityName,
                });
            } else if (prevActivityContext !== undefined) {
                // Activity context cleared.
                debugActionsInfo("activity stopped", {
                    schema: action.schemaName,
                    agent: prevActivityContext.appAgentName,
                    activity: prevActivityContext.activityName,
                });
            }
        }

        if (result.additionalActions !== undefined) {
            try {
                const actions = getAdditionalExecutableActions(
                    result.additionalActions,
                    action.schemaName,
                    systemContext,
                );
                // REVIEW: assume that the agent will fill the entities already?  Also, current format doesn't support resultEntityIds.
                actionQueue.unshift(
                    ...(await toPendingActions(context, actions, undefined)),
                );
            } catch (e) {
                throw new Error(
                    `${action.schemaName}.${action.actionName} returned an invalid action: ${e}`,
                );
            }
        }
        actionIndex++;
    }
    return undefined;
}

function getAdditionalExecutableActions(
    actions: AppAction[],
    sourceSchemaName: string,
    context: CommandHandlerContext,
) {
    const appAgentName = getAppAgentName(sourceSchemaName);
    const executableActions: ExecutableAction[] = [];
    for (const newAction of actions) {
        const fullAction = (
            newAction.schemaName !== undefined
                ? newAction
                : {
                      ...newAction,
                      schemaName: sourceSchemaName,
                  }
        ) as FullAction;

        if (appAgentName !== DispatcherName) {
            // For non-dispatcher, action can only be triggered within the same agent,
            // with the exception of the reasoning action which is a meta-action that
            // any agent may request to hand off complex tasks to the reasoning loop.
            const actionAppAgentName = getAppAgentName(fullAction.schemaName);
            const isReasoningAction =
                actionAppAgentName === DispatcherName &&
                fullAction.actionName === "reasoningAction";
            if (actionAppAgentName !== appAgentName && !isReasoningAction) {
                throw new Error(
                    `Cannot invoke actions from other agent '${actionAppAgentName}'.`,
                );
            }
        }

        const actionInfo = tryGetActionSchema(fullAction, context.agents);
        if (actionInfo === undefined) {
            throw new Error(
                `Action not found ${fullAction.schemaName}.${fullAction.actionName}`,
            );
        }
        validateAction(actionInfo, fullAction);

        executableActions.push({ action: fullAction });
    }
    return executableActions;
}

export function startStreamPartialAction(
    schemaName: string,
    actionName: string,
    context: CommandHandlerContext,
    actionIndex: number,
): IncrementalJsonValueCallBack {
    const appAgentName = getAppAgentName(schemaName);
    const appAgent = context.agents.getAppAgent(appAgentName);
    if (appAgent.streamPartialAction === undefined) {
        // The config declared that there are streaming action, but the agent didn't implement it.
        throw new Error(
            `Agent '${appAgentName}' does not support streamPartialAction.`,
        );
    }

    const actionContextWithClose = getActionContext(
        appAgentName,
        context,
        getRequestId(context),
        actionIndex,
        {
            schemaName,
            actionName,
        },
    );

    context.streamingActionContext = actionContextWithClose;

    return (name: string, value: any, delta?: string) => {
        // Gap 2: Drop streaming chunks after cancellation to avoid
        // dispatching to agents once the request has been aborted.
        if (context.currentAbortSignal?.aborted) return;

        appAgent.streamPartialAction!(
            actionName,
            name,
            value,
            delta,
            actionContextWithClose.actionContext,
        );
    };
}

export async function executeCommand(
    commands: string[],
    params: ParsedCommandParams<ParameterDefinitions> | undefined,
    appAgentName: string,
    context: CommandHandlerContext,
    attachments?: string[],
): Promise<void> {
    const appAgent = context.agents.getAppAgent(appAgentName);
    if (appAgent.executeCommand === undefined) {
        throw new Error(
            `Agent '${appAgentName}' does not support executeCommand.`,
        );
    }

    // update the last action name
    const { actionContext, closeActionContext } = getActionContext(
        appAgentName,
        context,
        getRequestId(context),
        undefined,
        commands,
    );

    try {
        actionContext.profiler = context.commandProfiler?.measure(
            ProfileNames.executeCommand,
            true,
        );

        try {
            // Pre-flight readiness check — runs as late as possible, right
            // before invoking the command handler. The system agent (where
            // @config agent setup/refresh live) doesn't implement
            // checkReadiness, so it's always `ready` — no chicken-and-egg.
            // When `setupOnFirstUse` is on and setup runs, its ActionResult
            // is surfaced in place of the user's original command — the
            // caller is expected to re-run after setup completes.
            const setupResult = await checkAgentReady(
                appAgentName,
                context,
                actionContext,
            );
            if (setupResult !== undefined) {
                emitActionResult(
                    setupResult,
                    actionContext,
                    context,
                    getRequestId(context),
                    appAgentName,
                    0,
                    appAgentName,
                );
                return;
            }
            // Command handlers MAY return an ActionResult — when they do,
            // we run the same post-processing the action pipeline uses
            // (display content / pendingChoice / dynamicDisplayId). Returning
            // void / undefined keeps the legacy "use actionIO directly"
            // pattern. For commands actionIndex=0 and schemaName=appAgentName
            // are placeholders — see emitActionResult().
            const result = await appAgent.executeCommand(
                commands,
                params,
                actionContext,
                attachments,
            );
            if (result !== undefined) {
                emitActionResult(
                    result,
                    actionContext,
                    context,
                    getRequestId(context),
                    appAgentName,
                    0,
                    appAgentName,
                );
            }
            return;
        } catch (e: any) {
            if (
                e.name === "AbortError" ||
                context.currentAbortSignal?.aborted
            ) {
                throw new DOMException(
                    "The operation was aborted.",
                    "AbortError",
                );
            }
            const errorDisplay = getErrorDisplayContent(e);
            if (errorDisplay !== undefined) {
                actionContext.actionIO.appendDisplay(errorDisplay, "block");
            } else {
                displayError(`ERROR: ${e.message}`, actionContext);
            }
            debugCommandExecError("command execution exception", {
                requestId: getRequestId(context).requestId,
                agent: appAgentName,
                command: commands.join(" "),
                errorType: e?.name,
                error: e?.message,
                stack: e?.stack,
            });
        }
    } finally {
        actionContext.profiler?.stop();
        actionContext.profiler = undefined;
        closeActionContext();
    }
}
