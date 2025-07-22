// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { HistoryContext, MatchResult } from "agent-cache";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { TranslationResult } from "./translateRequest.js";

import registerDebug from "debug";
import { unicodeChar } from "../command/command.js";
import { confirmTranslation } from "./confirmTranslation.js";
import { getAppAgentName } from "./agentTranslators.js";
import { canResolvePropertyEntity } from "../execute/pendingActions.js";

const debugConstValidation = registerDebug("typeagent:const:validation");

async function validateWildcardMatch(
    match: MatchResult,
    context: CommandHandlerContext,
) {
    const actions = match.match.actions;
    for (const { action } of actions) {
        const schemaName = action.schemaName;
        if (schemaName === undefined) {
            continue;
        }
        const appAgentName = getAppAgentName(schemaName);
        if (!context.agents.isActionActive(appAgentName)) {
            // Test mode? Assume validateWildcardMatch is true.
            continue;
        }
        const appAgent = context.agents.getAppAgent(appAgentName);
        const sessionContext = context.agents.getSessionContext(appAgentName);
        const validate = await appAgent.validateWildcardMatch?.(
            action,
            sessionContext,
        );
        if (validate === false) {
            return false;
        }
    }
    return true;
}

async function validateEntityWildcardMatch(
    match: MatchResult,
    context: CommandHandlerContext,
): Promise<boolean> {
    if (match.entityWildcardPropertyNames.length === 0) {
        // No entity wildcard, nothing to validate.
        return true;
    }
    const conversationMemory = context.conversationMemory;
    if (conversationMemory === undefined) {
        // Can't resolve entity without memory.
        return false;
    }

    const actions = match.match.actions;
    const agents = context.agents;

    for (const propertyName of match.entityWildcardPropertyNames) {
        const canResolve = await canResolvePropertyEntity(
            conversationMemory,
            propertyName,
            actions,
            agents,
        );
        if (!canResolve) {
            return false;
        }
    }
    return true;
}

/**
 * Assuming the match results are sorted by most likely to least likely by some heuristics, return the first
 * validated match.  Matches that doesn't have wildcard are assumed validated.
 *
 * @param matches
 * @param context
 * @returns the validate matched.
 */
async function getValidatedMatch(
    matches: MatchResult[],
    context: CommandHandlerContext,
) {
    for (const match of matches) {
        if (!(await validateEntityWildcardMatch(match, context))) {
            continue;
        }

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
        entityWildcard: config.cache.matchEntityWildcard,
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
