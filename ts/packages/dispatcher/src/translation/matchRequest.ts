// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { HistoryContext, MatchResult } from "agent-cache";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { ActionContext, ActivityContext } from "@typeagent/agent-sdk";
import { TranslationResult } from "./translateRequest.js";

import registerDebug from "debug";
import { getAppAgentName } from "./agentTranslators.js";
import { canResolvePropertyEntity } from "../execute/pendingActions.js";
import {
    DispatcherActivityName,
    DispatcherName,
} from "../context/dispatcher/dispatcherUtils.js";

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

export function getActivityActiveSchemas(
    activeSchemaNames: string[],
    activityContext: ActivityContext,
) {
    const activitySchemas = activeSchemaNames.filter(
        (schemaName) =>
            getAppAgentName(schemaName) === activityContext.appAgentName,
    );

    if (activitySchemas.length === 0) {
        throw new Error(
            `Activity context schema ${activityContext.appAgentName} not active`,
        );
    }
    // Dispatcher schema (for unknown) is always active
    activitySchemas.push(
        DispatcherName,
        DispatcherActivityName,
        "dispatcher.lookup",
    );

    return activitySchemas;
}

export function getNonActivityActiveSchemas(
    activeSchemaNames: string[],
    activityContext: ActivityContext,
): string[] {
    return activeSchemaNames.filter(
        (schemaName) =>
            getAppAgentName(schemaName) !== activityContext.appAgentName,
    );
}
export function getActivityCacheSpec(
    context: CommandHandlerContext,
    activityContext?: ActivityContext,
) {
    if (activityContext === undefined) {
        return "shared"; // shared cache when no activity is active.
    }

    const { appAgentName, activityName } = activityContext;
    const actionConfig = context.agents.getActionConfig(appAgentName);
    return actionConfig.cachedActivities?.[activityName] ?? false;
}

export function getActivityNamespaceSuffix(
    context: CommandHandlerContext,
    activityContext?: ActivityContext,
): string | undefined {
    const cacheSpec = getActivityCacheSpec(context, activityContext);
    if (cacheSpec === false) {
        throw new Error(
            "Cannot match request during activity with cache disabled",
        );
    }
    return cacheSpec !== "shared" ? activityContext!.activityName : undefined;
}

export async function matchRequest(
    context: ActionContext<CommandHandlerContext>,
    request: string,
    history?: HistoryContext,
    activeSchemas?: string[],
): Promise<TranslationResult | undefined> {
    const systemContext = context.sessionContext.agentContext;
    const constructionStore = systemContext.agentCache.constructionStore;
    if (!constructionStore.isEnabled()) {
        return undefined;
    }
    const startTime = performance.now();
    const config = systemContext.session.getConfig();
    const activityContext = history?.activityContext;
    const activeSchemaNames = activityContext
        ? getActivityActiveSchemas(
              activeSchemas ?? systemContext.agents.getActiveSchemas(),
              activityContext,
          )
        : (activeSchemas ?? systemContext.agents.getActiveSchemas());

    const namespaceSuffix = getActivityNamespaceSuffix(
        systemContext,
        activityContext,
    );
    const matchConfig = {
        wildcard: config.cache.matchWildcard,
        entityWildcard: config.cache.matchEntityWildcard,
        rejectReferences: config.explainer.filter.reference.list,
    };
    const matches = constructionStore.match(request, {
        ...matchConfig,
        namespaceKeys: systemContext.agentCache.getNamespaceKeys(
            activeSchemaNames,
            namespaceSuffix,
        ),
        history,
    });

    const elapsedMs = performance.now() - startTime;

    const match = await getValidatedMatch(matches, systemContext);
    if (match === undefined) {
        return undefined;
    }

    return {
        type: "match",
        requestAction: match.match,
        elapsedMs,
        config: {
            ...matchConfig,
            explainerName: systemContext.agentCache.explainerName,
        },
        allMatches: matches.map((m) => {
            const { construction: _, match, ...rest } = m;
            return { action: match.actions, ...rest };
        }),
    };
}
