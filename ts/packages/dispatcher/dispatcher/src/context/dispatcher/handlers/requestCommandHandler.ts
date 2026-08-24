// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import {
    RequestAction,
    printProcessRequestActionResult,
    FullAction,
    ProcessRequestActionResult,
    ExplanationOptions,
    equalNormalizedObject,
    toFullActions,
} from "@typeagent/agent-cache";
import type {
    ExplainedDetail,
    ExplainedMapping,
    ExplainedSegment,
} from "@typeagent/dispatcher-types";
import {
    loadGrammarRulesNoThrow,
    matchGrammar,
} from "@typeagent/action-grammar";

import {
    type CommandHandlerContext,
    ensureCommandResult,
    getRequestId,
} from "../../commandHandlerContext.js";
import { CachedImageWithDetails } from "@typeagent/typechat-utils";
import { Logger } from "@typeagent/telemetry";
import { executeActions } from "../../../execute/actionHandlers.js";
import {
    TypeAgentTranslator,
    TranslatedAction,
} from "../../../translation/agentTranslators.js";
import {
    isMultipleAction,
    isPendingRequest,
} from "../../../translation/multipleActionSchema.js";
import registerDebug from "debug";
import ExifReader from "exifreader";
import { ProfileNames } from "../../../utils/profileNames.js";
import {
    ActionContext,
    ParsedCommandParams,
    SessionContext,
    CompletionDirection,
    CompletionGroups,
} from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import {
    DispatcherClarifyName,
    DispatcherName,
    isUnknownAction,
} from "../dispatcherUtils.js";
import { executeReasoning as executeClaudeReasoning } from "../../../reasoning/claude.js";
import {
    executeCodingRequest,
    executeReasoning as executeCopilotReasoning,
} from "../../../reasoning/copilot.js";
import {
    classifyCodingRequest,
    clearCodingAffinity,
    establishCodingAffinity,
    isCodeAgentRequest,
    isCodingWorkingDirectorySelection,
    isGenericFallbackCandidate,
} from "../../../reasoning/codingRouting.js";
import {
    parseRecordingDirective,
    type CommandDisposition,
} from "@typeagent/dispatcher-types";
import { resolveActiveSchemaScope } from "../../../translation/activeSchemaScope.js";
import {
    getPowerShellCapabilityDisposition,
    getPowerShellCapabilityOutcome,
} from "../../../reasoning/powershellCapabilityOutcome.js";
import {
    logTranslationCompleted,
    logTranslationStarted,
} from "../../../otel/structuredEvents.js";
import { readTranslationRoutingFromError } from "../../../otel/translationSpan.js";
import { withChatModelTelemetryContext } from "@typeagent/aiclient";

type ReasoningFallbackContext = {
    failedSchema: string;
    failedAction: string;
    error: string;
};

function setDisposition(
    context: CommandHandlerContext,
    disposition: CommandDisposition,
): void {
    ensureCommandResult(context).disposition = disposition;
}

function getActionSchemas(
    actions: { action: { schemaName: string } }[],
): string[] {
    return [...new Set(actions.map(({ action }) => action.schemaName))];
}

function applyPowerShellCapabilityOutcome(
    context: CommandHandlerContext,
): boolean {
    if (
        context.currentOptions?.reasoningProfile !==
        "powershellCapabilityFallback"
    ) {
        return false;
    }

    const commandResult = ensureCommandResult(context);
    const outcome = getPowerShellCapabilityOutcome(commandResult.actions);
    if (!outcome) {
        commandResult.lastError =
            "PowerShell capability reasoning did not report a typed outcome.";
        setDisposition(context, {
            status: "failed",
            path: "reasoning",
            mayHaveSideEffects: false,
        });
        return true;
    }

    commandResult.capabilityOutcome = outcome;
    if (outcome.status === "failed") {
        commandResult.lastError = outcome.reason;
    }
    setDisposition(context, getPowerShellCapabilityDisposition(outcome));
    return true;
}

async function runConfiguredReasoning(
    request: string,
    context: ActionContext<CommandHandlerContext>,
    options?: { fallbackContext?: ReasoningFallbackContext },
): Promise<void> {
    const systemContext = context.sessionContext.agentContext;
    const engine = systemContext.session.getConfig().execution.reasoning;
    const reasoningIcons: Record<string, string> = {
        claude: "🧠",
        copilot: "✨",
    };
    systemContext.reasoningSourceIcon = reasoningIcons[engine] ?? undefined;
    try {
        switch (engine) {
            case "copilot":
                await executeCopilotReasoning(request, context, {
                    engine: "copilot",
                });
                return;
            case "claude":
                await executeClaudeReasoning(request, context, {
                    engine: "claude",
                    ...(options?.fallbackContext
                        ? { fallbackContext: options.fallbackContext }
                        : {}),
                });
                return;
            case "none":
                throw new Error(
                    "Reasoning is disabled. Set reasoning engine to 'claude' or 'copilot'.",
                );
            default:
                throw new Error(`Unknown reasoning engine: ${engine}`);
        }
    } finally {
        systemContext.reasoningSourceIcon = undefined;
    }
}
import { getTranslatorForSchema } from "../../../translation/translateRequest.js";
import { getActivityNamespaceSuffix } from "../../../translation/matchRequest.js";
import {
    addRequestToMemory,
    addResultToMemory,
    addUserMessageToHistory,
} from "../../memory.js";
import { requestCompletion } from "../../../translation/requestCompletion.js";
import {
    getCannotUseCacheReason,
    getHistoryContext,
    interpretRequest,
    InterpretResult,
} from "../../../translation/interpretRequest.js";
import {
    displayStatus,
    displayError,
} from "@typeagent/agent-sdk/helpers/display";

const debugExplain = registerDebug("typeagent:explain");
const debugRequest = registerDebug("typeagent:request");

// True when every action in the request targets the built-in chat agent
// (`generateResponse` / `showImageFile`). These actions have their parameters
// generated during translation and make no LLM call when executed, so the
// translation token usage represents the chat agent's generation cost.
function isChatAgentOnlyRequest(requestAction: RequestAction): boolean {
    const actions = requestAction.actions;
    return (
        actions.length > 0 &&
        actions.every(({ action }) => action.schemaName === "chat")
    );
}

async function canTranslateWithoutContext(
    requestAction: RequestAction,
    usedTranslators: Map<string, TypeAgentTranslator>,
    logger?: Logger,
) {
    if (requestAction.history === undefined) {
        return;
    }

    // Do the retranslation check, which will also check the action.
    const oldActions: FullAction[] = toFullActions(requestAction.actions);
    const newActions: (FullAction | undefined)[] = [];
    const request = requestAction.request;
    try {
        const translations = new Map<string, TranslatedAction>();
        for (const [schemaName, translator] of usedTranslators) {
            const result = await translator.checkTranslate(request);
            if (!result.success) {
                throw new Error("Failed to translate without history context");
            }
            const newActions = result.data;
            const count = isMultipleAction(newActions)
                ? newActions.parameters.requests.length +
                  (newActions.parameters.pendingRequests?.length ?? 0)
                : 1;

            if (count !== oldActions.length) {
                throw new Error("Action count mismatch without context");
            }
            translations.set(schemaName, result.data);
        }

        let index = 0;
        for (const { action } of requestAction.actions) {
            const schemaName = action.schemaName;
            const newTranslatedActions = translations.get(schemaName)!;
            let newAction: TranslatedAction;
            if (isMultipleAction(newTranslatedActions)) {
                const entry = newTranslatedActions.parameters.requests[index];
                if (entry === undefined || isPendingRequest(entry)) {
                    throw new Error("Pending request in multiple action");
                }
                newAction = entry.action;
            } else {
                newAction = newTranslatedActions;
            }
            const newSchemaName = isUnknownAction(newAction)
                ? DispatcherName
                : usedTranslators
                      .get(schemaName)!
                      .getSchemaName(newAction.actionName);
            if (newSchemaName === undefined) {
                // Should not happen
                throw new Error(
                    `Internal Error: Unable to match schema name for action '${newAction.actionName}'`,
                );
            }
            newActions.push({
                schemaName: newSchemaName,
                ...newAction,
            });
        }

        debugExplain(
            `With context: ${JSON.stringify(oldActions)}\nWithout context: ${JSON.stringify(newActions)}`,
        );

        if (oldActions.length !== newActions.length) {
            throw new Error("Action count mismatch without context");
        }

        index = 0;
        for (const oldAction of oldActions) {
            const newAction = newActions[index];
            if (newAction === undefined) {
                throw new Error(`Action missing without context`);
            }

            if (newAction.actionName !== oldAction.actionName) {
                throw new Error(`Action Name mismatch without context`);
            }

            if (
                !equalNormalizedObject(
                    newAction.parameters,
                    oldAction.parameters,
                )
            ) {
                throw new Error(`Action parameters mismatch without context`);
            }
            index++;
        }
        logger?.logEvent("contextlessTranslation", {
            request,
            actions: oldActions,
            history: requestAction.history,
            newActions,
        });
    } catch (e: any) {
        logger?.logEvent(
            "contextlessTranslation",
            {
                requestAction,
                actions: oldActions,
                history: requestAction.history,
                newActions,
                error: e.message,
            },
            "error",
        );
        throw e;
    }
}

function getExplainerOptions(
    requestAction: RequestAction,
    context: CommandHandlerContext,
): ExplanationOptions | undefined {
    if (!context.session.explanation) {
        // Explanation is disabled
        return undefined;
    }

    if (
        !context.session.getConfig().explainer.filter.multiple &&
        requestAction.actions.length > 1
    ) {
        // filter multiple
        return undefined;
    }

    const usedTranslators = new Map<string, TypeAgentTranslator>();
    const actions = requestAction.actions;
    const activeSchemas = new Set(context.agents.getActiveSchemas());
    for (const { action } of actions) {
        if (isUnknownAction(action)) {
            // can't explain unknown actions
            return undefined;
        }

        const schemaName = action.schemaName;
        if (context.agents.getActionConfig(schemaName).cached === false) {
            // explanation disable at the translator level
            return undefined;
        }

        // TODO: This does not support activities.
        usedTranslators.set(
            schemaName,
            getTranslatorForSchema(context, schemaName, activeSchemas),
        );
    }
    const { list, value, translate } =
        context.session.getConfig().explainer.filter.reference;

    // NFA mode uses grammar rules for matching; construction-cache validation is not needed.
    const isNFAMode = context.agentCache.isUsingNFAGrammar();

    return {
        namespaceSuffix: getActivityNamespaceSuffix(
            context,
            requestAction.history?.activityContext,
        ),
        // In NFA mode, skip contextless translation check (not needed for grammar rules)
        checkExplainable:
            translate && !isNFAMode
                ? (requestAction: RequestAction) =>
                      canTranslateWithoutContext(
                          requestAction,
                          usedTranslators,
                          context.logger,
                      )
                : undefined,
        valueInRequest: isNFAMode ? false : value,
        noReferences: list,
    };
}

// Flatten action parameters into dotted-path rows for the explained popover,
// e.g. { artist: { name: "Adele" } } -> [{ name: "artist.name", value: "Adele" }].
function flattenExplainedParams(
    value: unknown,
    prefix: string,
    rows: ExplainedMapping[],
) {
    if (value !== null && typeof value === "object") {
        if (Array.isArray(value)) {
            value.forEach((v, i) =>
                flattenExplainedParams(v, `${prefix}[${i}]`, rows),
            );
            return;
        }
        for (const [key, v] of Object.entries(value)) {
            flattenExplainedParams(v, prefix ? `${prefix}.${key}` : key, rows);
        }
        return;
    }
    rows.push({ name: prefix, value: String(value) });
}

// Assemble the detail payload backing the roadrunner popover: the user phrase,
// the resolved action(s), the rule/generalized-form text, and the extracted
// parameter mapping.
function buildExplainedDetail(
    source: ExplainedDetail["source"],
    requestAction: RequestAction,
    rule: string | undefined,
    segments?: ExplainedSegment[] | undefined,
    generalizations?: ExplainedSegment[][] | undefined,
): ExplainedDetail {
    const actions = toFullActions(requestAction.actions);
    const multi = actions.length > 1;
    const mapping: ExplainedMapping[] = [];
    actions.forEach((action, i) => {
        if (action.parameters !== undefined) {
            flattenExplainedParams(
                action.parameters,
                multi ? `[${i}]` : "",
                mapping,
            );
        }
    });
    return {
        source,
        phrase: requestAction.request,
        action: actions
            .map((a) => `${a.schemaName}.${a.actionName}`)
            .join(", "),
        rule,
        mapping: mapping.length > 0 ? mapping : undefined,
        segments: segments && segments.length > 0 ? segments : undefined,
        generalizations:
            generalizations && generalizations.length > 0
                ? generalizations
                : undefined,
    };
}

// Break a V5 explanation's sub-phrases into { text, category } segments so the
// client can color each phrase word by its role and match it to the same-color
// marker in the generalized form. Best-effort and shape-tolerant.
function buildSegments(explanationData: unknown): ExplainedSegment[] {
    const data = explanationData as {
        subPhrases?: { text?: unknown; category?: unknown }[];
    };
    if (!Array.isArray(data?.subPhrases)) return [];
    const segments: ExplainedSegment[] = [];
    for (const sp of data.subPhrases) {
        if (typeof sp?.text === "string" && typeof sp?.category === "string") {
            segments.push({ text: sp.text, category: sp.category });
        }
    }
    return segments;
}

// Recover the grammar rule that matched a grammar cache hit. The live matcher
// (NFA/DFA) doesn't report which rule matched, so look up the persisted rules
// for the matched action: when there's one it is the answer; when there are
// several, re-run the request against each to disambiguate. Falls back to the
// compiled grammar's source-map side-car for statically shipped rules (which
// aren't in the persisted store), which also yields colored phrase segments.
function findMatchedGrammarRule(
    context: CommandHandlerContext,
    requestAction: RequestAction,
): { rule?: string; segments?: ExplainedSegment[] } {
    const primary = toFullActions(requestAction.actions)[0];
    if (primary === undefined) return {};

    const store = context.persistedGrammarStore;
    const candidates =
        store
            ?.getRulesForSchema(primary.schemaName)
            .filter((rule) => rule.actionName === primary.actionName) ?? [];
    if (candidates.length === 1) {
        return { rule: candidates[0].grammarText };
    }
    if (candidates.length > 1) {
        const request = requestAction.request;
        for (const rule of candidates) {
            const errors: string[] = [];
            const grammar = loadGrammarRulesNoThrow(
                primary.schemaName,
                rule.grammarText,
                errors,
            );
            if (
                grammar !== undefined &&
                matchGrammar(grammar, request).length > 0
            ) {
                return { rule: rule.grammarText };
            }
        }
        // Couldn't pinpoint one (e.g. cross-rule references) — show the first.
        return { rule: candidates[0].grammarText };
    }

    // No dynamically-learned rule: recover a statically shipped rule via the
    // compiled grammar's source-map side-car.
    const matched = context.agents.findMatchedGrammarRule(
        primary.schemaName,
        requestAction.request,
        primary.actionName,
    );
    return matched ? { rule: matched.text, segments: matched.segments } : {};
}

// Derive example same-meaning rephrasings from a V5 explanation, each broken
// into per-category segments (so the client can color them like the phrase):
// substitute each non-property sub-phrase's synonyms, and add the explainer's
// polite prefix/suffix variants. Best-effort and shape-tolerant.
function buildGeneralizations(
    phrase: string,
    baseSegments: ExplainedSegment[],
    explanationData: unknown,
): ExplainedSegment[][] {
    const data = explanationData as {
        subPhrases?: { synonyms?: unknown }[];
        politePrefixes?: unknown[];
        politeSuffixes?: unknown[];
    };
    const variants: ExplainedSegment[][] = [];
    baseSegments.forEach((segment, i) => {
        const synonyms = Array.isArray(data?.subPhrases?.[i]?.synonyms)
            ? (data.subPhrases[i].synonyms as unknown[])
            : [];
        for (const synonym of synonyms) {
            if (typeof synonym !== "string" || synonym === segment.text) {
                continue;
            }
            variants.push(
                baseSegments.map((s, j) =>
                    j === i ? { text: synonym, category: s.category } : s,
                ),
            );
        }
    });
    for (const prefix of data?.politePrefixes ?? []) {
        if (typeof prefix === "string" && prefix.trim()) {
            variants.push([
                { text: prefix.trim(), category: "politeness" },
                ...baseSegments,
            ]);
        }
    }
    for (const suffix of data?.politeSuffixes ?? []) {
        if (typeof suffix === "string" && suffix.trim()) {
            variants.push([
                ...baseSegments,
                { text: suffix.trim(), category: "politeness" },
            ]);
        }
    }
    // Dedupe (case-insensitive by joined text) and drop the original.
    const seen = new Set<string>([phrase.toLowerCase()]);
    const result: ExplainedSegment[][] = [];
    for (const variant of variants) {
        const key = variant
            .map((s) => s.text)
            .join(" ")
            .toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(variant);
        if (result.length >= 24) break; // cap persisted list size
    }
    return result;
}

async function requestExplain(
    context: CommandHandlerContext,
    attachments: CachedImageWithDetails[] | undefined,
    translationResult: InterpretResult,
) {
    // Make sure the current requestId is captured
    const requestId = getRequestId(context);

    const { fromCache, fromUser, requestAction } = translationResult;

    const notifyExplained = (error?: string, detail?: ExplainedDetail) => {
        context.clientIO.notify(
            requestId,
            "explained",
            {
                time: new Date().toLocaleTimeString(),
                fromCache,
                fromUser,
                error,
                detail,
            },
            DispatcherName,
            undefined,
            // Persist so the roadrunner icon + popover survive conversation
            // rehydration (replayed from the DisplayLog on rejoin/reload).
            { persist: true },
        );
    };

    const notifyExplainedResult = (result: ProcessRequestActionResult) => {
        const explanationResult = result.explanationResult.explanation;
        const error = explanationResult.success
            ? undefined
            : explanationResult?.message;
        // The generalized form the model produced: the newly generated grammar
        // rule (NFA mode) or the construction string (construction mode).
        const rule =
            result.grammarResult?.generatedRule ??
            (explanationResult.success
                ? explanationResult.construction?.toString()
                : undefined);
        const segments = explanationResult.success
            ? buildSegments(explanationResult.data)
            : undefined;
        const generalizations = explanationResult.success
            ? buildGeneralizations(
                  requestAction.request,
                  segments ?? [],
                  explanationResult.data,
              )
            : undefined;
        notifyExplained(
            error,
            buildExplainedDetail(
                "model",
                requestAction,
                rule,
                segments,
                generalizations,
            ),
        );

        // Notify about grammar result (success or rejection)
        if (result.grammarResult) {
            context.clientIO.notify(
                requestId,
                "grammarRule",
                {
                    success: result.grammarResult.success,
                    message: result.grammarResult.message,
                    rule: result.grammarResult.generatedRule,
                    time: new Date().toLocaleTimeString(),
                },
                DispatcherName,
            );
        }
    };

    const cannotUseCacheReason = getCannotUseCacheReason(
        context,
        attachments,
        requestAction.history,
    );
    if (cannotUseCacheReason !== undefined) {
        notifyExplained(`cannot not use cache (${cannotUseCacheReason})`);
    }
    if (fromCache && !fromUser) {
        // If it is from cache, and not from the user, explanation is not necessary.
        // Recover the matched rule: the matched construction for construction
        // hits, or (grammar mode) the grammar rule + colored phrase segments
        // re-matched on demand.
        let rule: string | undefined;
        let segments: ExplainedSegment[] | undefined;
        if (fromCache === "grammar") {
            ({ rule, segments } = findMatchedGrammarRule(
                context,
                requestAction,
            ));
        } else {
            rule = translationResult.ruleText;
        }
        notifyExplained(
            undefined,
            buildExplainedDetail(fromCache, requestAction, rule, segments),
        );
        return;
    }

    const options = getExplainerOptions(requestAction, context);
    if (options === undefined) {
        return;
    }

    const processRequestActionP = withChatModelTelemetryContext(
        {
            phase: context.explanationAsynchronousMode
                ? "explanation"
                : "translation",
            purpose: "cache-generation",
            scope: context.explanationAsynchronousMode
                ? "background"
                : "foreground",
        },
        () =>
            context.agentCache.processRequestAction(
                requestAction,
                true,
                options,
            ),
    );

    if (context.explanationAsynchronousMode) {
        processRequestActionP
            .then(notifyExplainedResult)
            .catch((e) => notifyExplained(e.message));
    } else {
        console.log(
            chalk.grey(`Generating explanation for '${requestAction}'`),
        );
        const processRequestActionResult = await processRequestActionP;
        notifyExplainedResult(processRequestActionResult);

        // Print result details (includes grammar result if using NFA)
        printProcessRequestActionResult(processRequestActionResult);
    }
}

export class RequestCommandHandler implements CommandHandler {
    public readonly description = "Translate and explain a request";
    public readonly parameters = {
        args: {
            request: {
                description: "Request to translate",
                implicitQuotes: true,
                optional: true, // can be optional since the user can supply images and no text // TODO: revisit
                skipKnowledgeExtraction: true,
            },
        },
    } as const;
    // code-complexity-allow: helper logic inlined from removed stand-alone helpers; request dispatch is inherently branchy
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
        attachments?: string[],
    ) {
        const systemContext = context.sessionContext.agentContext;
        const profiler = systemContext.commandProfiler?.measure(
            ProfileNames.request,
        );
        try {
            // Don't handle the request if it contains the separator
            const request =
                params.args.request === undefined ? "" : params.args.request;
            if (request.includes(RequestAction.Separator)) {
                throw new Error(
                    `Invalid translation request with translation separator '${RequestAction.Separator}'.  Use @explain if you want to explain a translation.`,
                );
            }

            // store attachments for later reuse
            const cachedAttachments: CachedImageWithDetails[] = [];
            if (
                attachments &&
                systemContext.session.sessionDirPath !== undefined
            ) {
                for (let i = 0; i < attachments?.length; i++) {
                    const [attachmentName, tags]: [string, ExifReader.Tags] =
                        await systemContext.session.storeUserSuppliedFile(
                            attachments![i],
                        );

                    cachedAttachments.push(
                        new CachedImageWithDetails(
                            tags,
                            attachmentName,
                            attachments![i],
                        ),
                    );
                }
            }

            // Make sure we clear any left over streaming context
            systemContext.streamingActionContext?.closeActionContext();
            systemContext.streamingActionContext = undefined;

            // Translate to action

            // Recording directives bypass translation and go straight to the
            // configured reasoning engine.
            const recordingDirective = parseRecordingDirective(request);
            const forceReasoningEnv =
                process.env.CLAUDE_FORCE_REASONING === "1";
            if (
                !systemContext.noReasoning &&
                (forceReasoningEnv || recordingDirective !== undefined)
            ) {
                try {
                    await runConfiguredReasoning(request, context);
                    setDisposition(systemContext, {
                        status: "handled",
                        path: "reasoning",
                    });
                } catch (error) {
                    setDisposition(systemContext, {
                        status: "failed",
                        path: "reasoning",
                        mayHaveSideEffects: true,
                    });
                    throw error;
                }
                return;
            }

            const activeSchemaScope = resolveActiveSchemaScope(
                systemContext.agents.getActiveSchemas(),
                systemContext.currentOptions?.activeSchemas,
                systemContext.currentOptions?.activeSchemaFamilies,
            );
            if (activeSchemaScope.unavailable.length > 0) {
                setDisposition(systemContext, {
                    status: "notHandled",
                    reason: "noActiveSchema",
                });
                return;
            }

            // Get the history context before adding the request to memory
            const history = getHistoryContext(systemContext);
            context.actionIO.appendDiagnosticData({
                type: "translationContext",
                entities: history?.entities ?? [],
                activityContext: history?.activityContext,
            });
            if (
                systemContext.session.getConfig().execution.recordUserMessages
            ) {
                addUserMessageToHistory(
                    systemContext,
                    request,
                    cachedAttachments,
                );
            }
            if (systemContext.userRequestKnowledgeExtraction === true) {
                addRequestToMemory(systemContext, request);
            }
            let interpretResult: InterpretResult;
            const requestId = getRequestId(systemContext).requestId;
            logTranslationStarted(systemContext.logger, {
                requestId,
                schemaNames: activeSchemaScope.schemaNames,
            });
            // Measure the translation phase at this call boundary with a
            // monotonic-ish wall clock (consistent with the reasoning span's
            // `Date.now()` convention) so the duration is a real fact on the
            // event, not something the exporter has to reconstruct from span
            // timestamps. Covers the success, failure, and cancellation paths.
            const translationStartedAt = Date.now();
            try {
                interpretResult = await interpretRequest(
                    context,
                    request,
                    cachedAttachments,
                    history,
                    activeSchemaScope.schemaNames,
                );
            } catch (e: any) {
                setDisposition(systemContext, {
                    status: "failed",
                    path: "command",
                    mayHaveSideEffects: false,
                });
                if (systemContext.userRequestKnowledgeExtraction === true) {
                    addResultToMemory(
                        systemContext,
                        `Error translating request '${request}': ${e.message}`,
                        DispatcherName,
                    );
                }
                logTranslationCompleted(systemContext.logger, {
                    requestId,
                    // `strategy` is only a placeholder on the failure path (the
                    // terminal route is unknown). The routing summary carried on
                    // the error is the source of truth: `logTranslationCompleted`
                    // derives `routingReason` from the routes actually observed
                    // and omits it when none reached a terminal decision, so a
                    // cache-stage failure is never mislabelled `llm_translation`.
                    strategy: "translate",
                    success: false,
                    // Only what is known from outside the error; a cancellation
                    // carried by the thrown value is recognized from `error`.
                    cancelled:
                        systemContext.currentAbortSignal?.aborted === true,
                    elapsedMs: Date.now() - translationStartedAt,
                    routing: readTranslationRoutingFromError(e),
                    error: e,
                    actions: [],
                });
                debugRequest(`Request translation failed: ${e.message}`);
                throw e;
            }

            const { requestAction, tokenUsage } = interpretResult;
            logTranslationCompleted(systemContext.logger, {
                requestId,
                strategy: interpretResult.fromUser
                    ? "user"
                    : interpretResult.fromCache || "translate",
                success: true,
                elapsedMs: Date.now() - translationStartedAt,
                routing: interpretResult.routing,
                actions: requestAction.actions,
            });

            if (tokenUsage) {
                ensureCommandResult(systemContext).tokenUsage = tokenUsage;

                // The chat agent produces its output (the answer text for
                // `generateResponse`, the file list for `showImageFile`) as
                // action parameters during translation; it makes no LLM call
                // at action-execution time, so it cannot self-report
                // `ActionResult.tokenUsage` the way other agents do. When a
                // request resolves solely to chat-agent actions, the
                // translation usage *is* the agent's generation cost, so mirror
                // it into `actionTokenUsage` ("Action Tokens" on the agent
                // bubble) in addition to the user bubble's "Translation
                // Tokens". The chat agent reports no usage of its own, so this
                // is not double-counted by the executeActions accumulation.
                if (isChatAgentOnlyRequest(requestAction)) {
                    ensureCommandResult(systemContext).actionTokenUsage = {
                        ...tokenUsage,
                    };
                }
            }

            const genericFallback = isGenericFallbackCandidate(requestAction);
            if (genericFallback) {
                const codingDecision = classifyCodingRequest(
                    request,
                    systemContext.codingAffinity !== undefined,
                    attachments?.length ?? 0,
                );
                if (codingDecision === "coding") {
                    if (establishCodingAffinity(systemContext) === undefined) {
                        displayError(
                            "Coding requires a valid server-side working directory. " +
                                "Configure TYPEAGENT_CODE_DEFAULT_WORKING_DIRECTORY or " +
                                "TYPEAGENT_CODE_ALLOWED_ROOTS on agent-server, or submit an authorized workingDirectory.",
                            context,
                        );
                        setDisposition(systemContext, {
                            status: "failed",
                            path: "reasoning",
                            mayHaveSideEffects: false,
                            schemas: ["code.swe"],
                        });
                        return;
                    }
                    if (isCodingWorkingDirectorySelection(request)) {
                        displayStatus(
                            `Coding working directory: ${systemContext.codingAffinity!.workingDirectory}`,
                            context,
                        );
                        setDisposition(systemContext, {
                            status: "handled",
                            path: "reasoning",
                            schemas: ["code.swe"],
                        });
                        return;
                    }
                    delete ensureCommandResult(systemContext).actionTokenUsage;
                    try {
                        await executeCodingRequest(
                            request,
                            context,
                            attachments,
                        );
                        setDisposition(systemContext, {
                            status: "handled",
                            path: "reasoning",
                            schemas: ["code.swe"],
                        });
                    } catch (error) {
                        setDisposition(systemContext, {
                            status: "failed",
                            path: "reasoning",
                            mayHaveSideEffects: true,
                            schemas: ["code.swe"],
                        });
                        throw error;
                    }
                    return;
                }
                if (systemContext.codingAffinity !== undefined) {
                    clearCodingAffinity(systemContext);
                }
            } else if (
                systemContext.codingAffinity !== undefined &&
                !isCodeAgentRequest(requestAction)
            ) {
                clearCodingAffinity(systemContext);
            }

            // If translation produced unknown or clarification actions,
            // fall back to reasoning which can handle ambiguity directly.
            // If reasoning is unavailable (no API key, model error, etc.),
            // fall through to executeActions which shows the original error.
            //
            // Exception: a cross-agent collision clarify
            // (`clarifyMultipleAgentMatches`) under the two-tier
            // `preference-clarify` feature is meant to render its own
            // interactive pick + "remember" card via executeActions, so it
            // must NOT be diverted to reasoning.
            const interactiveCollisionClarify =
                systemContext.session.getConfig().collision.preference
                    .enabled &&
                systemContext.session.getConfig().collision.preference
                    .remember !== "never";
            const needsReasoning = requestAction.actions.some(
                ({ action }) =>
                    isUnknownAction(action) ||
                    (action.schemaName === DispatcherClarifyName &&
                        !(
                            interactiveCollisionClarify &&
                            action.actionName === "clarifyMultipleAgentMatches"
                        )),
            );
            const hasUnknownAction = requestAction.actions.some(({ action }) =>
                isUnknownAction(action),
            );
            const hasClarificationAction = requestAction.actions.some(
                ({ action }) => action.schemaName === DispatcherClarifyName,
            );
            if (
                needsReasoning &&
                systemContext.noReasoning &&
                (systemContext.currentOptions?.activeSchemas !== undefined ||
                    systemContext.currentOptions?.activeSchemaFamilies !==
                        undefined)
            ) {
                const commandResult = ensureCommandResult(systemContext);
                commandResult.actions = requestAction.actions.map(
                    ({ action }) => action,
                );
                setDisposition(systemContext, {
                    status: "notHandled",
                    reason: hasUnknownAction ? "unknown" : "clarification",
                });
                return;
            }
            let reasoningHandled = false;
            if (needsReasoning && !systemContext.noReasoning) {
                try {
                    await runConfiguredReasoning(request, context);
                    reasoningHandled = true;
                    if (!applyPowerShellCapabilityOutcome(systemContext)) {
                        setDisposition(systemContext, {
                            status: "handled",
                            path: "reasoning",
                        });
                    }
                } catch (e: any) {
                    debugRequest(
                        `Reasoning fallback failed, using default handler: ${e.message}`,
                    );
                }
            }
            if (!reasoningHandled) {
                const execResult = await executeActions(
                    requestAction.actions,
                    requestAction.history?.entities,
                    context,
                );
                const actionSchemas = getActionSchemas(requestAction.actions);

                // Error-triggered reasoning: if an action failed and at least one
                // schema in the request opts in via errorReasoning: true, give Claude
                // a second chance using the same reasoning loop as UnknownAction.
                if (
                    !systemContext.noReasoning &&
                    execResult !== undefined &&
                    execResult.fallbackToReasoning
                ) {
                    const needsErrorReasoning = requestAction.actions.some(
                        ({ action }) => {
                            try {
                                return (
                                    systemContext.agents.getActionConfig(
                                        action.schemaName,
                                    ).errorReasoning === true
                                );
                            } catch {
                                return false;
                            }
                        },
                    );
                    let errorReasoningResolved = false;
                    if (needsErrorReasoning) {
                        const { error, failedAction } = execResult;
                        const augmentedRequest =
                            `[Context: A direct action dispatch failed.\n` +
                            `Action: ${JSON.stringify(failedAction.action, undefined, 2)}\n` +
                            `Error: "${error}"\n` +
                            `Please handle the following request using the available tools.]\n\n` +
                            request;
                        try {
                            displayStatus(
                                "Action failed — retrying with reasoning...",
                                context,
                            );
                            await runConfiguredReasoning(
                                augmentedRequest,
                                context,
                                {
                                    fallbackContext: {
                                        failedSchema:
                                            failedAction.action.schemaName,
                                        failedAction:
                                            failedAction.action.actionName,
                                        error,
                                    },
                                },
                            );
                            errorReasoningResolved = true;
                            setDisposition(systemContext, {
                                status: "handled",
                                path: "reasoning",
                                schemas: actionSchemas,
                            });
                        } catch (e: any) {
                            debugRequest(
                                `Error-triggered reasoning failed, keeping original error: ${e.message}`,
                            );
                        }
                    }
                    // If error-triggered reasoning did not run (schema opted out)
                    // or failed to resolve the failure, surface the original
                    // action error instead of silently reporting success.
                    if (!errorReasoningResolved) {
                        setDisposition(systemContext, {
                            status: "failed",
                            path: "action",
                            mayHaveSideEffects: true,
                            schemas: actionSchemas,
                        });
                        displayError(execResult.error, context);
                    }
                } else if (execResult !== undefined) {
                    setDisposition(systemContext, {
                        status: "failed",
                        path: "action",
                        mayHaveSideEffects: true,
                        schemas: actionSchemas,
                    });
                } else if (hasUnknownAction) {
                    setDisposition(systemContext, {
                        status: "notHandled",
                        reason: "unknown",
                    });
                } else if (
                    hasClarificationAction &&
                    systemContext.noReasoning
                ) {
                    setDisposition(systemContext, {
                        status: "notHandled",
                        reason: "clarification",
                    });
                } else {
                    setDisposition(systemContext, {
                        status: "handled",
                        path: "action",
                        schemas: actionSchemas,
                    });
                }
            }

            await requestExplain(
                systemContext,
                cachedAttachments,
                interpretResult,
            );
        } finally {
            profiler?.stop();
        }
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
        names: string[],
        direction?: CompletionDirection,
    ): Promise<CompletionGroups> {
        const result: CompletionGroups = { groups: [] };
        for (const name of names) {
            if (name === "request") {
                const input = params.args.request ?? "";
                const requestResult = await requestCompletion(
                    input,
                    context.agentContext,
                    direction,
                );
                result.groups.push(...requestResult.groups);
                result.matchedPrefixLength = requestResult.matchedPrefixLength;
                result.closedSet = requestResult.closedSet;
                result.directionSensitive = requestResult.directionSensitive;
                result.afterWildcard = requestResult.afterWildcard;
            }
        }
        return result;
    }
}
