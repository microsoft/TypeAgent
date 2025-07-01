// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { HistoryContext, MatchResult } from "agent-cache";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { validateWildcardMatch } from "../execute/actionHandlers.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { TranslationResult } from "./translateRequest.js";

import registerDebug from "debug";
import { unicodeChar } from "../command/command.js";
import { confirmTranslation } from "./confirmTranslation.js";
const debugConstValidation = registerDebug("typeagent:const:validation");

async function getValidatedMatch(
    matches: MatchResult[],
    context: CommandHandlerContext,
) {
    for (const match of matches) {
        if (match.wildcardCharCount === 0) {
            return match;
        }
        if (await validateWildcardMatch(match, context)) {
            debugConstValidation(
                `Wildcard match accepted: ${match.match.actions}`,
            );
            return match;
        }
        debugConstValidation(`Wildcard match rejected: ${match.match.actions}`);
    }
    return undefined;
}

export async function matchRequest(
    request: string,
    context: ActionContext<CommandHandlerContext>,
    history?: HistoryContext,
): Promise<TranslationResult | undefined> {
    const systemContext = context.sessionContext.agentContext;
    const constructionStore = systemContext.agentCache.constructionStore;
    if (!constructionStore.isEnabled()) {
        return undefined;
    }
    const startTime = performance.now();
    const config = systemContext.session.getConfig();
    const activeSchemaNames = systemContext.agents.getActiveSchemas();
    const matches = constructionStore.match(request, {
        wildcard: config.cache.matchWildcard,
        rejectReferences: config.explainer.filter.reference.list,
        namespaceKeys:
            systemContext.agentCache.getNamespaceKeys(activeSchemaNames),
        history,
    });

    const elapsedMs = performance.now() - startTime;

    const match = await getValidatedMatch(matches, systemContext);
    if (match === undefined) {
        return undefined;
    }
    const { requestAction, replacedAction } = await confirmTranslation(
        elapsedMs,
        unicodeChar.constructionSign,
        match.match,
        context,
    );

    if (!systemContext.batchMode) {
        systemContext.logger?.logEvent("match", {
            elapsedMs,
            request,
            actions: requestAction.actions,
            replacedAction,
            developerMode: systemContext.developerMode,
            translators: activeSchemaNames,
            explainerName: systemContext.agentCache.explainerName,
            matchWildcard: config.cache.matchWildcard,
            allMatches: matches.map((m) => {
                const { construction: _, match, ...rest } = m;
                return { action: match.actions, ...rest };
            }),
            history,
        });
    }
    return {
        requestAction,
        elapsedMs,
        fromUser: replacedAction !== undefined,
        fromCache: true,
    };
}
