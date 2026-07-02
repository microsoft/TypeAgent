// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createExecutableAction,
    HistoryContext,
    MatchResult,
    ParamObjectType,
    RequestAction,
} from "agent-cache";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { ActionContext, ActivityContext } from "@typeagent/agent-sdk";
import { TranslationResult } from "./translateRequest.js";

import registerDebug from "debug";
import { getAppAgentName } from "./agentTranslators.js";
import { canResolvePropertyEntity } from "../execute/pendingActions.js";
import {
    DispatcherActivityName,
    DispatcherClarifyName,
    DispatcherName,
} from "../context/dispatcher/dispatcherUtils.js";
import {
    isCollision,
    resolveGrammarCollision,
    resolveGrammarRegistryFirst,
} from "./matchCollision.js";

const debugConstValidation = registerDebug("typeagent:const:validation");

async function validateWildcardMatch(
    match: MatchResult,
    context: CommandHandlerContext,
    signal?: AbortSignal,
) {
    const actions = match.match.actions;
    for (const { action } of actions) {
        // Check abort signal before processing each action
        signal?.throwIfAborted();
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
        console.log(
            `[Wildcard Validation] ${schemaName}.${action.actionName} - Result: ${validate === false ? "REJECTED" : "ACCEPTED"}`,
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
    signal?: AbortSignal,
): Promise<boolean> {
    if (match.entityWildcardPropertyNames.length === 0) {
        // No entity wildcard, nothing to validate.
        return true;
    }

    // Check abort signal before starting validation loop
    signal?.throwIfAborted();

    debugConstValidation(
        `Validating entity wildcards: [${match.entityWildcardPropertyNames.join(", ")}] ` +
            `for actions: [${match.match.actions.map((a) => `${a.action.schemaName}.${a.action.actionName}`).join(", ")}]`,
    );
    const conversationMemory = context.conversationMemory;
    if (conversationMemory === undefined) {
        // Can't resolve entity without memory.
        debugConstValidation(
            `Entity wildcard validation skipped: no conversation memory`,
        );
        return false;
    }

    const actions = match.match.actions;
    const agents = context.agents;

    for (const propertyName of match.entityWildcardPropertyNames) {
        // Check abort signal before each property validation
        signal?.throwIfAborted();

        const canResolve = await canResolvePropertyEntity(
            conversationMemory,
            propertyName,
            actions,
            agents,
        );
        if (!canResolve) {
            debugConstValidation(
                `Entity wildcard '${propertyName}' could not be resolved`,
            );
            return false;
        }
    }
    return true;
}

/**
 * Walks the heuristically-sorted match results and returns ALL matches that
 * pass entity-wildcard and wildcard validation, preserving original order.
 *
 * Today's caller takes [0] (matching prior `getValidatedMatch` behavior); the
 * collision resolver looks at the full list when collision detection is
 * enabled in session config.
 *
 * @param matches
 * @param context
 * @param signal Optional AbortSignal to allow cancellation during validation
 * @returns the validated matches.
 */
async function getValidatedMatches(
    matches: MatchResult[],
    context: CommandHandlerContext,
    signal?: AbortSignal,
): Promise<MatchResult[]> {
    const accepted: MatchResult[] = [];
    for (const match of matches) {
        // Check abort signal before processing each match
        signal?.throwIfAborted();

        if (!(await validateEntityWildcardMatch(match, context, signal))) {
            continue;
        }

        if (match.wildcardCharCount === 0) {
            accepted.push(match);
            continue;
        }
        if (await validateWildcardMatch(match, context, signal)) {
            debugConstValidation(
                `Wildcard match accepted: ${match.match.actions}`,
            );
            console.log(
                `[Cache Validation Success] Wildcard match validated and accepted`,
            );
            accepted.push(match);
            continue;
        }
        debugConstValidation(`Wildcard match rejected: ${match.match.actions}`);
        console.log(
            `[Cache Validation Rejected] Wildcard validation failed for match. Trying next match...`,
        );
    }
    return accepted;
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
    activitySchemas.push(DispatcherName, DispatcherActivityName);

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

// Prefixes that must always reach Claude reasoning — never matched by grammar.
const REASONING_PREFIXES = ["learn:", "dev:", "remember how to ", "record "];

export async function matchRequest(
    context: ActionContext<CommandHandlerContext>,
    request: string,
    history?: HistoryContext,
    activeSchemas?: string[],
    signal?: AbortSignal,
): Promise<TranslationResult | undefined> {
    // Bypass grammar cache for recording/reasoning-directed requests.
    const lower = request.trimStart().toLowerCase();
    if (REASONING_PREFIXES.some((p) => lower.startsWith(p))) {
        return undefined;
    }

    // Check abort signal before expensive grammar matching
    signal?.throwIfAborted();

    const systemContext = context.sessionContext.agentContext;
    const agentCache = systemContext.agentCache;
    if (!agentCache.isEnabled()) {
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
    const matches = agentCache.match(request, {
        ...matchConfig,
        namespaceKeys: systemContext.agentCache.getNamespaceKeys(
            activeSchemaNames,
            namespaceSuffix,
        ),
        history,
    });

    const elapsedMs = performance.now() - startTime;

    const validated = await getValidatedMatches(matches, systemContext, signal);
    if (validated.length === 0) {
        if (matches.length > 0) {
            console.log(
                `[Cache Validation Failed] "${request}" - ${matches.length} match(es) found but validation rejected all. Falling back to LLM translation.`,
            );
        }
        return undefined;
    }

    // Collision detection — opt-in via session config. With detect=false this
    // is a no-op and we use validated[0], identical to legacy behavior.
    const collisionCfg = config.collision.grammarMatch;
    let chosen = validated[0];

    // Registry-first detection runs independently of grammarMatch.detect: a
    // single confident cache match can still be registry-known-ambiguous.
    let decision = resolveGrammarRegistryFirst(
        validated,
        systemContext,
        request,
    );
    if (
        decision === undefined &&
        collisionCfg.detect &&
        isCollision(validated, collisionCfg.classifier)
    ) {
        decision = resolveGrammarCollision(validated, systemContext, request);
    }
    if (decision !== undefined) {
        if (decision.kind === "fallthrough") {
            // A pending one-shot pick names a registry sibling the grammar
            // didn't match. Bail out of grammar matching so the request falls
            // through to LLM translation, which pins the schema to the pick.
            return undefined;
        }
        if (decision.kind === "match") {
            chosen = decision.match;
        } else {
            // user-clarify — synthesize a translation result whose action is the
            // ClarifyMultipleAgentMatches dispatcher action. Downstream execution
            // routes it to the dispatcher agent's clarify handler.
            const clarifyAction = createExecutableAction(
                DispatcherClarifyName,
                decision.clarify.actionName,
                decision.clarify.parameters as unknown as ParamObjectType,
            );
            const clarifyRequestAction = new RequestAction(request, [
                clarifyAction,
            ]);
            return {
                type: "grammar",
                requestAction: clarifyRequestAction,
                elapsedMs,
                config: {
                    ...matchConfig,
                    explainerName: systemContext.agentCache.explainerName,
                },
                allMatches: matches.map((m) => {
                    const { match, ...rest } = m;
                    return { action: match.actions, ...rest };
                }),
            };
        }
    }

    return {
        type: chosen.type,
        requestAction: chosen.match,
        elapsedMs,
        config: {
            ...matchConfig,
            explainerName: systemContext.agentCache.explainerName,
        },
        // For logging
        allMatches: matches.map((m) => {
            const { match, ...rest } = m;
            return { action: match.actions, ...rest };
        }),
    };
}
