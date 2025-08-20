// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai as ai } from "aiclient";
import { HistoryContext, RequestAction } from "agent-cache";
import { getActivityCacheSpec, matchRequest } from "./matchRequest.js";
import { translateRequest } from "./translateRequest.js";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { CachedImageWithDetails } from "common-utils";
import { unicodeChar } from "../command/command.js";
import { confirmTranslation } from "./confirmTranslation.js";
import { DispatcherEmoji } from "../context/dispatcher/dispatcherUtils.js";

export function getHistoryContext(context: CommandHandlerContext) {
    const config = context.session.getConfig();
    return config.translation.history.enabled
        ? createHistoryContext(context)
        : undefined;
}

function createHistoryContext(context: CommandHandlerContext): HistoryContext {
    const promptSections = context.chatHistory.getPromptSections();
    if (promptSections.length !== 0) {
        promptSections.unshift({
            content:
                "The following is a history of the conversation with the user that can be used to translate user requests",
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
    cannotUseCacheReason?: string | undefined;
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

export async function interpretRequest(
    context: ActionContext<CommandHandlerContext>,
    request: string,
    attachments?: CachedImageWithDetails[] | undefined,
): Promise<InterpretResult> {
    const systemContext = context.sessionContext.agentContext;
    const history = getHistoryContext(systemContext);

    const cannotUseCacheReason = getCannotUseCacheReason(
        systemContext,
        attachments,
        history,
    );
    const canUseCacheMatch = cannotUseCacheReason === undefined;

    const activeSchemaNames = systemContext.agents.getActiveSchemas();
    const match = canUseCacheMatch
        ? await matchRequest(context, request, history, activeSchemaNames)
        : undefined;

    const translateResult =
        match ??
        (await translateRequest(
            context,
            request,
            history,
            attachments,
            0,
            activeSchemaNames,
        ));

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
            metrics: translateResult.metrics,
        });
    }

    return {
        elapsedMs: translateResult.elapsedMs,
        requestAction,
        fromUser: replacedAction !== undefined,
        fromCache: translateResult.type === "match",
        tokenUsage: translateResult.tokenUsage,
        cannotUseCacheReason,
    };
}
