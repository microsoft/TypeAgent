// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import registerDebug from "debug";
import { getHistoryContextForTranslation } from "./translateRequest.js";
import { ExecutableAction, getPropertyInfo } from "agent-cache";
import { getAppAgentName } from "./agentTranslators.js";
const debugCompletion = registerDebug("typeagent:request:completion");
const debugCompletionError = registerDebug(
    "typeagent:request:completion:error",
);
export async function requestCompletion(
    requestPrefix: string,
    completions: string[],
    context: CommandHandlerContext,
) {
    const constructionStore = context.agentCache.constructionStore;
    if (!constructionStore.isEnabled()) {
        return;
    }

    debugCompletion(`Request completion for prefix '${requestPrefix}'`);
    const config = context.session.getConfig();
    const activeSchemaNames = context.agents.getActiveSchemas();
    const results = constructionStore.match(requestPrefix, {
        partial: true,
        wildcard: config.cache.matchWildcard,
        rejectReferences: config.explainer.filter.reference.list,
        namespaceKeys: context.agentCache.getNamespaceKeys(activeSchemaNames),
        history: getHistoryContextForTranslation(context),
    });

    debugCompletion(`Request completion construction match: ${results.length}`);

    for (const result of results) {
        const { construction, partialPartCount } = result;
        if (partialPartCount === undefined) {
            throw new Error("Internal Error: Partial part count is undefined");
        }

        if (partialPartCount === construction.parts.length) {
            continue; // No more parts to complete
        }

        const nextPart = construction.parts[partialPartCount];
        const partCompletions = nextPart.getCompletion();
        if (partCompletions) {
            completions.push(...partCompletions);
        }

        const propertyNames = nextPart.getPropertyNames();
        if (propertyNames !== undefined) {
            // Detect multi-part properties
            const allPropertyNames = new Map<string, number>();
            for (const part of construction.parts) {
                const names = part.getPropertyNames();
                if (names === undefined) {
                    continue; // No property names for this part
                }
                for (const name of names) {
                    const count = allPropertyNames.get(name) ?? 0;
                    allPropertyNames.set(name, count + 1);
                }
            }

            const queryPropertyNames = propertyNames.filter(
                (name) => allPropertyNames.get(name) === 1,
            );
            if (queryPropertyNames.length === 0) {
                continue; // No single-part properties to complete
            }
            await getActionCompletion(
                queryPropertyNames,
                result.match.actions,
                context,
                completions,
            );
        }
    }
}

async function getActionCompletion(
    properties: string[],
    partialActions: ExecutableAction[],
    context: CommandHandlerContext,
    completions: string[],
) {
    for (const propertyName of properties) {
        const { action, parameterName } = getPropertyInfo(
            propertyName,
            partialActions,
        );
        if (
            parameterName === undefined ||
            action?.schemaName === undefined ||
            action?.actionName === undefined
        ) {
            // The part is for the fullActionName, or the action doesn't have a schema or action name yet.
            // Can't do completion for this part.
            continue;
        }

        const appAgentName = getAppAgentName(action.schemaName);
        const agent = context.agents.getAppAgent(appAgentName);
        const sessionContext = context.agents.getSessionContext(appAgentName);
        try {
            debugCompletion(
                `Getting action completion for ${action.schemaName}.${action.actionName} parameter ${parameterName}`,
            );
            const paramCompletion = await agent.getActionCompletion?.(
                action,
                `parameters.${parameterName}`,
                sessionContext,
            );

            if (paramCompletion !== undefined) {
                completions.push(...paramCompletion);
            }
        } catch (e: any) {
            // If the agent completion fails, just ignore it.
            debugCompletionError(
                `Error getting action completion for ${action.schemaName}.${action.actionName} parameter ${parameterName}: ${e.message}`,
            );
        }
    }
}
