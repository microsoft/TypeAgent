// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import registerDebug from "debug";
import { ExecutableAction, getPropertyInfo, MatchOptions } from "agent-cache";
import {
    CompletionDirection,
    CompletionGroup,
    CompletionGroups,
    SeparatorMode,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import type { CompiledSpacingMode } from "action-grammar";
import { candidateSeparatorMode, requiresSeparator } from "action-grammar";
import { DeepPartialUndefined } from "@typeagent/common-utils";
import {
    ActionParamType,
    ActionResolvedParamType,
    CompletionEmojis,
    getPropertyType,
    resolveTypeReference,
} from "@typeagent/action-schema";
import { getAppAgentName } from "./agentTranslators.js";
import { resolveEntityTypeName } from "../execute/pendingActions.js";
import {
    getActivityActiveSchemas,
    getActivityCacheSpec,
    getActivityNamespaceSuffix,
    getNonActivityActiveSchemas,
} from "./matchRequest.js";
import { getHistoryContext } from "./interpretRequest.js";
import {
    getActionSchema,
    tryGetActionSchemaParameterType,
} from "./actionSchemaUtils.js";
import { getParamPatternValue } from "./actionSchemaFileCache.js";

const debugCompletion = registerDebug("typeagent:request:completion");
const debugCompletionError = registerDebug(
    "typeagent:request:completion:error",
);

function getCompletionNamespaceKeys(context: CommandHandlerContext): string[] {
    const cache = context.agentCache;
    const activeSchemaNames = context.agents.getActiveSchemas();
    const activityContext = context.activityContext;
    if (activityContext === undefined) {
        return cache.getNamespaceKeys(activeSchemaNames, undefined);
    }

    const cacheSpec = getActivityCacheSpec(context, activityContext);
    if (cacheSpec === false) {
        // activity cache is disable, only return non-activity completions.
        return cache.getNamespaceKeys(
            getNonActivityActiveSchemas(activeSchemaNames, activityContext),
            undefined,
        );
    }
    const namespaceSuffix = getActivityNamespaceSuffix(
        context,
        activityContext,
    );

    if (namespaceSuffix === undefined) {
        return cache.getNamespaceKeys(activeSchemaNames, undefined);
    }
    return cache
        .getNamespaceKeys(
            getActivityActiveSchemas(activeSchemaNames, activityContext),
            namespaceSuffix,
        )
        .concat(
            cache.getNamespaceKeys(
                getNonActivityActiveSchemas(activeSchemaNames, activityContext),
                undefined,
            ),
        );
}

export async function requestCompletion(
    input: string,
    context: CommandHandlerContext,
    direction?: CompletionDirection, // defaults to forward-like behavior when omitted
): Promise<CompletionGroups> {
    debugCompletion(`Request completion for input: '${input}'`);
    const namespaceKeys = getCompletionNamespaceKeys(context);
    debugCompletion(`Request completion namespace keys`, namespaceKeys);

    const config = context.session.getConfig();
    const options: MatchOptions = {
        wildcard: config.cache.matchWildcard,
        rejectReferences: config.explainer.filter.reference.list,
        namespaceKeys,
        history: getHistoryContext(context),
    };
    const results = context.agentCache.completion(input, options, direction);

    if (results === undefined) {
        return { groups: [] };
    }

    const matchedPrefixLength = results.matchedPrefixLength;
    const closedSet = results.closedSet;
    const directionSensitive = results.directionSensitive;
    const afterWildcard = results.afterWildcard;
    // Groups already carry per-group separatorMode from the cache layer.
    const completions: CompletionGroup[] = [...results.groups];

    if (results.properties === undefined) {
        return {
            groups: completions,
            matchedPrefixLength,
            closedSet,
            directionSensitive,
            afterWildcard,
        };
    }

    const propertyCompletions = new Map<string, CompletionGroup>();
    for (const completionProperty of results.properties) {
        // TODO: assuming the partial action doesn't change the possible values.
        const propertyNames = completionProperty.names.filter(
            (name) => !propertyCompletions.has(name),
        );
        if (propertyNames.length > 0) {
            await collectActionCompletions(
                propertyNames,
                completionProperty.actions,
                context,
                propertyCompletions,
                completionProperty.spacingMode,
                input,
                matchedPrefixLength ?? 0,
            );
        }
    }

    completions.push(...propertyCompletions.values());
    return {
        groups: completions,
        matchedPrefixLength,
        closedSet,
        directionSensitive,
        afterWildcard,
    };
}

// Compute the SeparatorMode for a completion string given the
// spacing mode, the input text, and the matched prefix length.
function completionSeparatorMode(
    completion: string,
    spacingMode: CompiledSpacingMode,
    input: string,
    prefixLength: number,
): SeparatorMode {
    if (prefixLength <= 0 || completion.length === 0) {
        return spacingMode === "none" ? "none" : "optionalSpace";
    }
    const needsSep =
        spacingMode !== "none" &&
        requiresSeparator(input[prefixLength - 1], completion[0], spacingMode);
    return candidateSeparatorMode(needsSep, spacingMode);
}

async function collectActionCompletions(
    properties: string[],
    partialActions: ExecutableAction[],
    context: CommandHandlerContext,
    propertyCompletions: Map<string, CompletionGroup>,
    spacingMode: CompiledSpacingMode,
    input: string,
    matchedPrefixLength: number,
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
            // Partition completions by their computed separator mode,
            // creating one CompletionGroup per (property, mode) pair.
            const byMode = new Map<SeparatorMode, string[]>();
            for (const c of paramCompletion.completions) {
                const mode = completionSeparatorMode(
                    c,
                    spacingMode,
                    input,
                    matchedPrefixLength,
                );
                let bucket = byMode.get(mode);
                if (bucket === undefined) {
                    bucket = [];
                    byMode.set(mode, bucket);
                }
                bucket.push(c);
            }

            for (const [mode, completions] of byMode) {
                // Use a composite key so multiple modes from the same
                // property don't overwrite each other.
                const key =
                    byMode.size === 1
                        ? propertyName
                        : `${propertyName}:${mode}`;
                propertyCompletions.set(key, {
                    name: `property ${propertyName}`,
                    completions,
                    emojiChar: paramCompletion.emojiChar,
                    separatorMode: mode,
                    needQuotes: false, // Request completions are partial, no quotes needed
                    sorted: true, // REVIEW: assume property completions are already in desired order by the agent.
                    kind: "entity",
                });
            }
        }
    }
}

export async function getActionParamCompletion(
    systemContext: CommandHandlerContext,
    partialAction: DeepPartialUndefined<TypeAgentAction>,
    parameterName: string,
): Promise<
    { completions: string[]; emojiChar: string | undefined } | undefined
> {
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
    let entityCompletionEmojis: CompletionEmojis | undefined;
    let paramCompletionEmojis: CompletionEmojis | undefined;
    if (actionSchemaFile !== undefined) {
        const actionSchema = getActionSchema(actionSchemaFile, actionName);
        const actionParametersType = tryGetActionSchemaParameterType(
            actionSchemaFile,
            actionName,
            actionSchema,
        );
        if (actionParametersType !== undefined) {
            fieldType = getPropertyType(actionParametersType, parameterName);
            resolvedFieldType = resolveTypeReference(fieldType);
        }
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

        paramCompletionEmojis = actionSchema.paramCompletionEmojis;
        entityCompletionEmojis = actionSchema.entityCompletionEmojis;
    }

    let entityEmojiChar: string | undefined;
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

        if (entityTypeName) {
            entityEmojiChar = getParamPatternValue(
                entityCompletionEmojis,
                entityTypeName,
            );
        }
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

    const completions = literalCompletion
        ? actionCompletion
            ? literalCompletion.concat(actionCompletion)
            : literalCompletion
        : actionCompletion;

    return completions === undefined || completions.length === 0
        ? undefined
        : {
              completions,
              emojiChar:
                  entityEmojiChar ??
                  getParamPatternValue(paramCompletionEmojis, parameterName),
          };
}
