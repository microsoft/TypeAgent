// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import registerDebug from "debug";
import { getHistoryContextForTranslation } from "./translateRequest.js";
import { ExecutableAction, getPropertyInfo } from "agent-cache";
import { CompletionGroup, TypeAgentAction } from "@typeagent/agent-sdk";
import { DeepPartialUndefined } from "common-utils";
import {
    ActionParamType,
    ActionResolvedParamType,
    getPropertyType,
    resolveTypeReference,
} from "action-schema";
import { getAppAgentName } from "./agentTranslators.js";
import {
    getActionParametersType,
    resolveEntityTypeName,
} from "../execute/pendingActions.js";
import { WildcardMode } from "agent-cache";

const debugCompletion = registerDebug("typeagent:request:completion");
const debugCompletionError = registerDebug(
    "typeagent:request:completion:error",
);
export async function requestCompletion(
    requestPrefix: string | undefined,
    context: CommandHandlerContext,
): Promise<CompletionGroup[]> {
    const constructionStore = context.agentCache.constructionStore;
    if (!constructionStore.isEnabled()) {
        return [];
    }

    debugCompletion(`Request completion for prefix '${requestPrefix}'`);
    const config = context.session.getConfig();
    const activeSchemaNames = context.agents.getActiveSchemas();
    const namespaceKeys =
        context.agentCache.getNamespaceKeys(activeSchemaNames);
    if (!requestPrefix) {
        const completions = constructionStore.getPrefix(namespaceKeys);

        return completions.length > 0
            ? [
                  {
                      name: "Request Completions",
                      completions,
                      needQuotes: false, // Request completions are partial, no quotes needed
                  },
              ]
            : [];
    }
    const results = constructionStore.match(requestPrefix, {
        partial: true,
        wildcard: config.cache.matchWildcard,
        rejectReferences: config.explainer.filter.reference.list,
        namespaceKeys,
        history: getHistoryContextForTranslation(context),
    });

    debugCompletion(`Request completion construction match: ${results.length}`);

    const propertyCompletions = new Map<string, CompletionGroup>();
    const requestText: string[] = [];
    for (const result of results) {
        const { construction, partialPartCount } = result;
        if (partialPartCount === undefined) {
            throw new Error("Internal Error: Partial part count is undefined");
        }

        if (partialPartCount === construction.parts.length) {
            continue; // No more parts to complete
        }

        const nextPart = construction.parts[partialPartCount];
        // Only include part completion if it is not a checked or entity wildcard.
        if (nextPart.wildcardMode <= WildcardMode.Enabled) {
            const partCompletions = nextPart.getCompletion();
            if (partCompletions) {
                requestText.push(...partCompletions);
            }
        }

        // TODO: assuming the partial action doesn't change the possible values.
        const propertyNames = nextPart
            .getPropertyNames()
            ?.filter((name) => !propertyCompletions.has(name));
        if (propertyNames !== undefined && propertyNames.length > 0) {
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
            await collectActionCompletions(
                queryPropertyNames,
                result.match.actions,
                context,
                propertyCompletions,
            );
        }
    }
    const completions: CompletionGroup[] = [];
    if (requestText.length > 0) {
        completions.push({
            name: "Request Completions",
            completions: requestText,
            needQuotes: false, // Request completions are partial, no quotes needed
        });
    }

    completions.push(...propertyCompletions.values());
    return completions;
}

async function collectActionCompletions(
    properties: string[],
    partialActions: ExecutableAction[],
    context: CommandHandlerContext,
    propertyCompletions: Map<string, CompletionGroup>,
) {
    for (const propertyName of properties) {
        const { action, parameterName } = getPropertyInfo(
            propertyName,
            partialActions,
        );

        if (parameterName === undefined) {
            // The part is for the fullActionName, can't do completion for this part.
            continue;
        }

        const paramCompletion = await getActionParamCompletion(
            context,
            action,
            parameterName,
        );

        if (paramCompletion !== undefined) {
            propertyCompletions.set(propertyName, {
                name: `property ${propertyName}`,
                completions: paramCompletion,
                needQuotes: false, // Request completions are partial, no quotes needed
            });
        }
    }
}

export async function getActionParamCompletion(
    systemContext: CommandHandlerContext,
    partialAction: DeepPartialUndefined<TypeAgentAction>,
    parameterName: string,
): Promise<string[] | undefined> {
    const { schemaName, actionName } = partialAction;
    if (schemaName === undefined || actionName === undefined) {
        return undefined;
    }

    debugCompletion(
        `Getting action completion for ${schemaName}.${actionName} parameter ${parameterName}`,
    );

    // Having action schema means it is a FullAction
    const action = partialAction as TypeAgentAction;
    let actionCompletion: string[] | undefined;
    let fieldType: ActionParamType | undefined;
    let resolvedFieldType: ActionResolvedParamType | undefined;
    let literalCompletion: string[] | undefined;

    const agents = systemContext.agents;
    const actionSchemaFile = agents.tryGetActionSchemaFile(schemaName);
    if (actionSchemaFile !== undefined) {
        const actionParametersType = getActionParametersType(
            actionName,
            actionSchemaFile,
        );
        fieldType = getPropertyType(actionParametersType, parameterName);
        resolvedFieldType = resolveTypeReference(fieldType);
        switch (resolvedFieldType?.type) {
            case "string-union":
                literalCompletion = [...resolvedFieldType.typeEnum];
                break;
            case "type-union":
                const literals = [];
                for (const type of resolvedFieldType.types) {
                    if (type.type === "string-union") {
                        literals.push(...type.typeEnum);
                    }
                }
                literalCompletion = literals.length > 0 ? literals : undefined;
                break;
        }
    }

    const appAgentName = getAppAgentName(schemaName);
    const appAgent = agents.getAppAgent(appAgentName);
    if (appAgent.getActionCompletion !== undefined) {
        const entitySchemas =
            actionSchemaFile?.parsedActionSchema.entitySchemas;
        const entityTypeName =
            fieldType && resolvedFieldType && entitySchemas
                ? resolveEntityTypeName(
                      fieldType,
                      resolvedFieldType,
                      entitySchemas,
                  )
                : undefined;
        const sessionContext = agents.getSessionContext(appAgentName);
        try {
            actionCompletion = await appAgent.getActionCompletion(
                sessionContext,
                action,
                `parameters.${parameterName}`,
                entityTypeName,
            );
        } catch (e: any) {
            // If the agent completion fails, just ignore it.
            debugCompletionError(
                `Error getting action completion for ${action.schemaName}.${action.actionName} parameter ${parameterName}: ${e.message}`,
            );
        }
    }

    return literalCompletion
        ? actionCompletion
            ? literalCompletion.concat(actionCompletion)
            : literalCompletion
        : actionCompletion;
}
