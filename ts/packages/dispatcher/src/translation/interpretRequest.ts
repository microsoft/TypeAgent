// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai as ai } from "aiclient";
import { HistoryContext, RequestAction } from "agent-cache";
import {
    getActivityActiveSchemas,
    getActivityCacheSpec,
    getNonActivityActiveSchemas,
    matchRequest,
} from "./matchRequest.js";
import { translateRequest } from "./translateRequest.js";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { CachedImageWithDetails } from "common-utils";
import { unicodeChar } from "../command/command.js";
import { confirmTranslation } from "./confirmTranslation.js";
import {
    DispatcherEmoji,
    isUnknownAction,
} from "../context/dispatcher/dispatcherUtils.js";
import registerDebug from "debug";
import { ProfileNames } from "../utils/profileNames.js";
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
                "The following is a history of the conversation with the user that can be used for context to translate the current user request.",
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
    return {
        promptSections,
        entities,
        additionalInstructions,
        activityContext: context.activityContext,
    };
}

export type InterpretResult = {
    requestAction: RequestAction;
    elapsedMs: number;
    fromUser: boolean;
    fromCache: boolean;
    tokenUsage?: ai.CompletionUsageStats | undefined;
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
    const cannotUseCacheReason = getCannotUseCacheReason(
        context.sessionContext.agentContext,
        attachments,
        history,
    );
    const canUseCacheMatch = cannotUseCacheReason === undefined;
    const match = canUseCacheMatch
        ? await matchRequest(context, request, history, activeSchemaNames)
        : undefined;

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
): Promise<InterpretResult> {
    const systemContext = context.sessionContext.agentContext;
    const activeSchemaNames = systemContext.agents.getActiveSchemas();

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

    const translateResult = history?.activityContext
        ? await interpretRequestWithActivityContext(
              context,
              request,
              attachments,
              history,
              0,
              activeSchemaNames,
              usageCallback,
          )
        : await interpretRequestWithActiveSchemas(
              context,
              request,
              attachments,
              history,
              0,
              activeSchemaNames,
              usageCallback,
          );

    const { requestAction, replacedAction } = await confirmTranslation(
        translateResult.elapsedMs,
        translateResult.type === "match"
            ? unicodeChar.constructionSign
            : DispatcherEmoji,
        translateResult.requestAction,
        context,
    );

    if (!systemContext.batchMode) {
        systemContext.logger?.logEvent(translateResult.type, {
            elapsedMs: translateResult.elapsedMs,
            request,
            history,
            actions: translateResult.requestAction.actions,
            replacedAction,
            schemaNames: activeSchemaNames,
            developerMode: systemContext.developerMode,
            config: translateResult.config,
            metrics: systemContext.metricsManager?.getMeasures(
                systemContext.requestId!,
                ProfileNames.translate,
            ),
            allMatches: translateResult.allMatches,
            tokenUsage,
        });
    }

    return {
        elapsedMs: translateResult.elapsedMs,
        requestAction,
        fromUser: replacedAction !== undefined,
        fromCache: translateResult.type === "match",
        tokenUsage,
    };
}
