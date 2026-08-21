// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai as ai } from "@typeagent/aiclient";
import { HistoryContext, RequestAction } from "@typeagent/agent-cache";
import {
    getActivityActiveSchemas,
    getActivityCacheSpec,
    getMatchRequestBypassReason,
    getNonActivityActiveSchemas,
    matchRequest,
} from "./matchRequest.js";
import { translateRequest } from "./translateRequest.js";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { CachedImageWithDetails } from "@typeagent/typechat-utils";
import { unicodeChar } from "../command/command.js";
import { confirmTranslation } from "./confirmTranslation.js";
import {
    DispatcherEmoji,
    isUnknownAction,
} from "../context/dispatcher/dispatcherUtils.js";
import registerDebug from "debug";
import {
    attachTranslationRoutingToError,
    emitTranslationCacheBypass,
    emitTranslationMatchResult,
    readTranslationRoutingSummary,
    runInTranslationSpan,
    type TranslationRoutingSummary,
} from "../otel/translationSpan.js";
const debugInterpret = registerDebug("typeagent:interpret");
export function getHistoryContext(context: CommandHandlerContext) {
    const config = context.session.getConfig();
    return config.translation.history.enabled
        ? createHistoryContext(context)
        : undefined;
}

export function createHistoryContext(
    context: CommandHandlerContext,
): HistoryContext {
    const promptSections = context.chatHistory.getPromptSections();
    if (promptSections.length !== 0) {
        promptSections.unshift({
            content:
                "The following is the chat history of requests and action results with the user, used for context to translate the current user request." +
                "Do NOT translate actions from requests in the chat history unless the current user request refers to it.",
            role: "system",
        });
    }
    const translateConfig = context.session.getConfig().translation;
    const entities = context.chatHistory.getTopKEntities(
        translateConfig.history.limit,
    );
    const additionalInstructions = translateConfig.promptConfig
        .additionalInstructions
        ? context.chatHistory.getCurrentInstructions()
        : undefined;
    const actions = translateConfig.promptConfig.recentActions
        ? context.chatHistory.getRecentActions(
              translateConfig.promptConfig.recentActionsLimit,
          )
        : undefined;
    return {
        promptSections,
        entities,
        additionalInstructions,
        actions,
        activityContext: context.activityContext,
    };
}

export type InterpretResult = {
    requestAction: RequestAction;
    elapsedMs: number;
    fromUser: boolean;
    fromCache: "construction" | "grammar" | false;
    tokenUsage?: ai.CompletionUsageStats | undefined;
    // The matched construction/rule pattern text (cache hits only), surfaced
    // for the explained popover.
    ruleText?: string | undefined;
    // Bounded routing decisions taken during translation (fallback/retry/cache
    // lookup outcome), for the `translation:completed` structured event.
    routing?: TranslationRoutingSummary | undefined;
};

export function getCannotUseCacheReason(
    context: CommandHandlerContext,
    attachments?: CachedImageWithDetails[] | undefined,
    history?: HistoryContext,
) {
    if (attachments && attachments.length > 0) {
        return "has attachments";
    }
    if (history !== undefined) {
        if (history.additionalInstructions) {
            return "has additional instructions";
        }
        const cacheSpec = getActivityCacheSpec(
            context,
            history.activityContext,
        );
        if (cacheSpec === false) {
            return "has activity with cache disabled";
        }
    }
    return undefined;
}

async function interpretRequestWithActiveSchemas(
    context: ActionContext<CommandHandlerContext>,
    request: string,
    attachments: CachedImageWithDetails[] | undefined,
    history: HistoryContext | undefined,
    streamingActionIndex: number | undefined,
    activeSchemaNames: string[],
    usageCallback: (usage: ai.CompletionUsageStats) => void,
) {
    const systemContext = context.sessionContext.agentContext;
    const cannotUseCacheReason = getCannotUseCacheReason(
        systemContext,
        attachments,
        history,
    );
    const canUseCacheMatch = cannotUseCacheReason === undefined;
    const matchBypassReason = canUseCacheMatch
        ? getMatchRequestBypassReason(context, request)
        : undefined;
    const match =
        canUseCacheMatch && matchBypassReason === undefined
            ? await matchRequest(
                  context,
                  request,
                  history,
                  activeSchemaNames,
                  systemContext.currentAbortSignal,
              )
            : undefined;

    // Activity-context translation may perform more than one lookup. Emit
    // each result in order so the span reflects every cache/grammar decision.
    if (!canUseCacheMatch) {
        emitTranslationCacheBypass("request_constraints");
    } else if (matchBypassReason !== undefined) {
        emitTranslationCacheBypass(matchBypassReason);
    } else if (match === undefined) {
        emitTranslationMatchResult("miss");
    } else if (match.type === "grammar") {
        emitTranslationMatchResult("grammar_hit");
    } else if (match.type === "construction") {
        emitTranslationMatchResult("cache_hit");
    }

    return (
        match ??
        (await translateRequest(
            context,
            request,
            history,
            attachments,
            streamingActionIndex,
            activeSchemaNames,
            usageCallback,
            systemContext.currentOptions?.userContext,
        ))
    );
}

async function interpretRequestWithActivityContext(
    context: ActionContext<CommandHandlerContext>,
    request: string,
    attachments: CachedImageWithDetails[] | undefined,
    history: HistoryContext,
    streamingActionIndex: number | undefined,
    activeSchemaNames: string[],
    usageCallback: (usage: ai.CompletionUsageStats) => void,
) {
    // Translate the request with only the activity schemas
    const activityContext = history.activityContext!;
    const activitySchemas = getActivityActiveSchemas(
        activeSchemaNames,
        activityContext,
    );

    debugInterpret(`Activity schemas: ${activitySchemas.join(",")}`);
    const translationResult = await interpretRequestWithActiveSchemas(
        context,
        request,
        attachments,
        history,
        streamingActionIndex,
        activitySchemas,
        usageCallback,
    );

    if (activityContext.restricted) {
        // Don't try non-activity schemas if restricted
        return translationResult;
    }

    const activityActions = translationResult.requestAction.actions;
    const hasUnknownAction = activityActions.some((e) =>
        isUnknownAction(e.action),
    );
    if (!hasUnknownAction) {
        // No more unknown action to translate
        return translationResult;
    }

    // Translate the unknown requests with non-activity schemas
    const nonActivitySchemas = getNonActivityActiveSchemas(
        activeSchemaNames,
        activityContext,
    );
    debugInterpret(
        `Non-activity schemas: ${Array.from(nonActivitySchemas).join(",")}`,
    );
    // Activity context should not be used for non-activity schemas
    const historyWithNoActivity = {
        ...history!,
        activityContext: undefined, // Clear activity context for non-activity schemas
    };

    if (activityActions.length <= 1) {
        return interpretRequestWithActiveSchemas(
            context,
            request,
            attachments,
            historyWithNoActivity,
            streamingActionIndex,
            nonActivitySchemas,
            usageCallback,
        );
    }
    const executableAction = [];
    for (const action of activityActions) {
        if (!isUnknownAction(action.action)) {
            executableAction.push(action);
        } else {
            const newResult = await interpretRequestWithActiveSchemas(
                context,
                action.action.parameters.request,
                attachments,
                historyWithNoActivity,
                streamingActionIndex,
                nonActivitySchemas,
                usageCallback,
            );
            executableAction.push(...newResult.requestAction.actions);
            translationResult.elapsedMs += newResult.elapsedMs;
        }
    }
    translationResult.requestAction = RequestAction.create(
        request,
        executableAction,
        history,
    );
    return translationResult;
}

export async function interpretRequest(
    context: ActionContext<CommandHandlerContext>,
    request: string,
    attachments: CachedImageWithDetails[] | undefined,
    history: HistoryContext | undefined,
    activeSchemaNames?: string[],
): Promise<InterpretResult> {
    const systemContext = context.sessionContext.agentContext;
    const requestActiveSchemaNames =
        activeSchemaNames ?? systemContext.agents.getActiveSchemas();

    // Developer-mode capture: start a fresh prompt buffer for this request.
    systemContext.devTrace.beginTranslation();

    const tokenUsage: ai.CompletionUsageStats = {
        completion_tokens: 0,
        prompt_tokens: 0,
        total_tokens: 0,
    };

    const usageCallback = (usage: ai.CompletionUsageStats) => {
        tokenUsage.completion_tokens += usage.completion_tokens;
        tokenUsage.prompt_tokens += usage.prompt_tokens;
        tokenUsage.total_tokens += usage.total_tokens;
    };

    // Capture the span's routing decisions inside its async context (the
    // summary is unreadable once `runInTranslationSpan` tears the context
    // down). The `finally` records it on success and failure alike.
    let routing: TranslationRoutingSummary | undefined;
    let translateResult;
    try {
        translateResult = await runInTranslationSpan(context, async () => {
            try {
                return history?.activityContext
                    ? await interpretRequestWithActivityContext(
                          context,
                          request,
                          attachments,
                          history,
                          0,
                          requestActiveSchemaNames,
                          usageCallback,
                      )
                    : await interpretRequestWithActiveSchemas(
                          context,
                          request,
                          attachments,
                          history,
                          0,
                          requestActiveSchemaNames,
                          usageCallback,
                      );
            } finally {
                routing = readTranslationRoutingSummary();
            }
        });
    } catch (error) {
        // Surface the routing decisions the request made before it failed or
        // was cancelled so the completion boundary can log a truthful reason.
        attachTranslationRoutingToError(error, routing);
        throw error;
    }

    const { requestAction, replacedAction } = await confirmTranslation(
        translateResult.elapsedMs,
        translateResult.type !== "translate"
            ? unicodeChar.constructionSign
            : DispatcherEmoji,
        translateResult.requestAction,
        context,
    ).catch((error) => {
        // confirmTranslation (and the wrap-up work below) runs after the
        // translation span's async context has been torn down, so
        // `readTranslationRoutingSummary` can no longer see the span state.
        // Re-attach the summary captured inside the span so a cancellation or
        // validation failure here still carries a truthful routing rationale
        // to the completion boundary.
        attachTranslationRoutingToError(error, routing);
        throw error;
    });

    try {
        // Developer-mode capture: persist the history + complete translation
        // prompt(s) for this request so it can be inspected/reconstructed
        // later. No-op unless developer mode is on and the session is
        // persisted.
        await systemContext.devTrace.writeTranslationCapture({
            request,
            developerMode: systemContext.developerMode === true,
            translationType: translateResult.type,
            elapsedMs: translateResult.elapsedMs,
            schemaNames: [...requestActiveSchemaNames],
            config: translateResult.config,
            history,
            attachmentCount: attachments?.length ?? 0,
            actions: translateResult.requestAction.actions,
            replacedAction,
            allMatches: translateResult.allMatches,
            tokenUsage,
        });

        // Record this completed user turn into the contextSelector signal
        // *after* resolution, so it never contributes to its own context
        // vector (history-only, §10). Runs once per user turn at this ungated
        // ingress.
        systemContext.conversationSignal.recordRequest(request);
    } catch (error) {
        attachTranslationRoutingToError(error, routing);
        throw error;
    }

    return {
        elapsedMs: translateResult.elapsedMs,
        requestAction,
        fromUser: replacedAction !== undefined,
        fromCache:
            translateResult.type === "translate" ? false : translateResult.type,
        tokenUsage,
        ruleText: translateResult.ruleText,
        routing,
    };
}
