// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionParamArray,
    ActionParamObject,
    ActionParamType,
    ActionResolvedParamType,
    resolveTypeReference,
    resolveUnionType,
} from "action-schema";
import {
    ExecutableAction,
    FullAction,
    normalizeParamString,
    PromptEntity,
} from "agent-cache";
import { getAppAgentName } from "../internal.js";
import {
    ActionContext,
    Entity,
    ResolveEntityResult,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { DispatcherClarifyName } from "../context/dispatcher/dispatcherUtils.js";
import { AppAgentManager } from "../context/appAgentManager.js";
import registerDebug from "debug";
import { filterEntitySelection } from "../translation/entityResolution.js";
import { displayStatus } from "@typeagent/agent-sdk/helpers/display";
import { ConversationMemory } from "conversation-memory";
import { SearchSelectExpr } from "knowpro";
import { conversation as kp } from "knowledge-processor";

const debugEntities = registerDebug("typeagent:dispatcher:actions:entities");

const debugAgentEntities = registerDebug(
    "typeagent:dispatcher:actions:agent:entities",
);

const debugMemoryEntities = registerDebug(
    "typeagent:dispatcher:actions:memory:entities",
);

const debugMemoryEntitiesError = registerDebug(
    "typeagent:dispatcher:actions:memory:entities:error",
);
type EntityValue = PromptEntity | undefined;
type EntityField = EntityValue | EntityObject | EntityField[];
interface EntityObject {
    [key: string]: EntityField;
}

async function getParameterObjectEntities(
    action: FullAction,
    obj: Record<string, any>,
    objType: ActionParamObject,
    entityResolver: EntityResolver,
    existing?: EntityObject,
) {
    let hasEntity = false;
    const entities: EntityObject = {};
    for (const [k, v] of Object.entries(obj)) {
        const fieldType = objType.fields[k]?.type;
        const actualType = resolveTypeReference(fieldType);
        if (actualType === undefined) {
            throw new Error(
                `Parameter type mismatch: ${action.schemaName}.${action.actionName}: schema does not have field ${k}`,
            );
        }
        const entity = await getParameterEntities(
            action,
            obj,
            k,
            v,
            fieldType,
            actualType,
            entityResolver,
            existing?.[k],
        );
        if (entity !== undefined) {
            hasEntity = true;
            (entities as any)[k] = entity;
        }
    }
    return hasEntity ? entities : undefined;
}

async function getParameterArrayEntities(
    action: FullAction,
    value: unknown[],
    actualType: ActionParamArray,
    entityResolver: EntityResolver,
    existing?: EntityField[] | undefined,
) {
    const elementFieldType = actualType.elementType;
    const elementActualType = resolveTypeReference(actualType.elementType);
    if (elementActualType === undefined) {
        throw new Error("Unresolved reference");
    }
    const result = await Promise.all(
        value.map((v, i) =>
            getParameterEntities(
                action,
                value,
                i,
                v,
                elementFieldType,
                elementActualType,
                entityResolver,
                existing?.[i],
            ),
        ),
    );
    if (result.every((r) => r === undefined)) {
        // Don't return empty array if no entities are found.
        return undefined;
    }
    return result;
}

function resolvePromptEntity(
    appAgentName: string,
    promptNameEntityMap: Map<string, PromptEntity | PromptEntity[]> | undefined,
    value: string,
) {
    // LLM like to correct/change casing.  Normalize entity name for look up.
    const foundEntity = promptNameEntityMap?.get(normalizeParamString(value));
    if (foundEntity === undefined) {
        return undefined;
    }
    if (!Array.isArray(foundEntity)) {
        return foundEntity.sourceAppAgentName === appAgentName
            ? foundEntity
            : undefined;
    }
    const matched = foundEntity.filter(
        (e) => e.sourceAppAgentName === appAgentName,
    );
    // TODO: If there are multiple match, ignore for now.
    return matched.length === 1 ? matched[0] : undefined;
}

interface EntityResolver {
    resolve: (
        action: FullAction,
        obj: Record<string, any>,
        key: string | number,
        value: any,
        fieldType: ActionParamType,
        existing?: EntityValue,
    ) => Promise<PromptEntity | undefined>;
    setResultEntity: (name: string, entity: PromptEntity) => void;
}

function createResultEntityResolver(): EntityResolver {
    const resultEntityMap = new Map<string, PromptEntity>();
    return {
        resolve: async (
            action: FullAction,
            obj: Record<string, any>,
            key: string | number,
            value: any,
        ): Promise<PromptEntity | undefined> => {
            if (value.startsWith("${result-")) {
                const resultEntity = resultEntityMap?.get(value);
                if (resultEntity !== undefined) {
                    // fix up the action to the actual entity name
                    obj[key] = resultEntity.name;
                    const appAgentName = getAppAgentName(action.schemaName);
                    return resultEntity.sourceAppAgentName === appAgentName
                        ? resultEntity
                        : undefined;
                }
                throw new Error(`Result entity reference not found: ${value}`);
            }
        },
        setResultEntity: (name: string, entity: PromptEntity) => {
            resultEntityMap.set(name, entity);
        },
    };
}

type ClarifyResolvedEntity = {
    type: string;
    name: string;
    result: ResolveEntityResult;
};

interface ParameterEntityResolver extends EntityResolver {
    readonly clarifyResolvedEntities: ClarifyResolvedEntity[];
}

type ParameterEntityResolverOptions = {
    resolve: boolean;
    clarify: boolean;
    filter: boolean;
};

function toPromptEntityMap(entities: PromptEntity[] | undefined) {
    return entities
        ? new Map<string, PromptEntity>(
              entities.map((entity, i) => [`\${entity-${i}}`, entity] as const),
          )
        : undefined;
}

function toPromptEntityNameMap(entities: PromptEntity[] | undefined) {
    if (entities === undefined) {
        return undefined;
    }
    const map = new Map<string, PromptEntity | PromptEntity[]>();
    for (const entity of entities) {
        // LLM like to correct/change casing.  Normalize entity name for look up.
        const name = normalizeParamString(entity.name);
        const existing = map.get(name);
        if (existing === undefined) {
            map.set(name, entity);
            continue;
        }
        if (Array.isArray(existing)) {
            existing.push(entity);
        } else {
            map.set(name, [existing, entity]);
        }
    }
    return map;
}

function isEntityType(
    agents: AppAgentManager,
    schemaName: string,
    type: string,
) {
    const actionSchemaFile = agents.getActionSchemaFileForConfig(
        agents.getActionConfig(schemaName),
    );

    return actionSchemaFile.parsedActionSchema.entitySchemas?.has(type);
}

async function resolveEntityWithMemory(
    conversationMemory: ConversationMemory,
    appAgentName: string,
    type: string,
    name: string,
): Promise<ResolveEntityResult | undefined> {
    const searchSelectExpr: SearchSelectExpr = {
        searchTermGroup: {
            booleanOp: "and",
            terms: [
                {
                    term: { text: name },
                },
            ],
        },
        when: {
            knowledgeType: "entity",
            scopeDefiningTerms: {
                booleanOp: "and",
                terms: [
                    {
                        propertyName: {
                            term: { text: "typeagent.appAgentName" },
                            relatedTerms: [], // REVIEW: for now empty relatedTerms disable fuzzy match
                        },
                        propertyValue: {
                            term: { text: appAgentName },
                            relatedTerms: [], // REVIEW: for now empty relatedTerms disable fuzzy match
                        },
                    },
                    {
                        propertyName: "type",
                        propertyValue: {
                            term: { text: type },
                            relatedTerms: [], // REVIEW: for now empty relatedTerms disable fuzzy match
                        },
                    },
                ],
            },
        },
    };

    const result = await conversationMemory.searchKnowledge(searchSelectExpr);
    const entityResult = result?.get("entity");
    if (entityResult === undefined) {
        debugMemoryEntities("No entity found in memory");
        return undefined;
    }

    const entities: PromptEntity[] = [];
    for (const match of entityResult.semanticRefMatches) {
        const semanticRef = conversationMemory.conversation.semanticRefs?.get(
            match.semanticRefOrdinal,
        );
        if (semanticRef === undefined) {
            throw new Error(
                `Semantic ref not found for ordinal: ${match.semanticRefOrdinal}`,
            );
        }
        if (semanticRef.knowledgeType !== "entity") {
            // We asked for entity only, so this shouldn't happen
            throw new Error(
                `Unexpected semantic ref type: ${semanticRef} for entity search`,
            );
        }
        const concreteEntity = semanticRef.knowledge as kp.ConcreteEntity;
        if (concreteEntity.type.includes(type) === false) {
            // Entity type mismatch, skip this entity.
            // REVIEW: should we error?
            debugMemoryEntitiesError(
                `concreteEntity type missing expected type ${type}: ${JSON.stringify(concreteEntity)}`,
            );
            continue;
        }
        const entityAppAgentName = concreteEntity.facets?.find(
            (f) => f.name === "typeagent.appAgentName",
        )?.value as string;
        if (
            entityAppAgentName === undefined ||
            entityAppAgentName !== appAgentName
        ) {
            // Our search specify app agent name to match, so we should expect the result to match.
            throw new Error(
                `Entity app agent name ${appAgentName} expected. Actual ${entityAppAgentName}`,
            );
        }
        const uniqueId = concreteEntity.facets?.find(
            (f) => f.name === "typeagent.uniqueId",
        )?.value as string;
        if (uniqueId === undefined) {
            debugMemoryEntitiesError(
                `Missing uniqueId: ${JSON.stringify(concreteEntity)}`,
            );
        }
        const entity: PromptEntity = {
            name: concreteEntity.name,
            type: concreteEntity.type,
            sourceAppAgentName: appAgentName,
            uniqueId,
        };
        entities.push(entity);
    }
    if (entities.length === 0) {
        debugMemoryEntities("No entity found in memory");
        return undefined;
    }
    const exact = entities.filter((e) => e.name === name);
    if (exact.length > 0) {
        debugMemoryEntities(
            `Exact entities found in memory: ${JSON.stringify(exact)}`,
        );
        return {
            entities: exact,
            match: "exact",
        };
    }

    debugMemoryEntities(
        `Fuzzy entities found in memory: ${JSON.stringify(entities)}`,
    );
    return {
        entities,
        match: "fuzzy",
    };
}

async function resolveEntityWithAgent(
    agents: AppAgentManager,
    appAgentName: string,
    type: string,
    value: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<ResolveEntityResult | undefined> {
    if (!agents.isActionActive(appAgentName)) {
        // Don't resolve entities with agent if action is not active.
        return undefined;
    }
    const agent = agents.getAppAgent(appAgentName);
    if (agent.resolveEntity === undefined) {
        throw new Error(
            `Agent ${appAgentName} declares entity types but does not implement resolveEntity`,
        );
    }
    debugAgentEntities(
        `Resolving ${type} entity with agent ${appAgentName}: ${value}`,
    );
    displayStatus(`Resolving ${type}: ${value}`, context);
    const result = await agent.resolveEntity(
        type,
        value,
        agents.getSessionContext(appAgentName),
    );
    if (result === undefined || result.entities.length === 0) {
        // REVIEW: not need the error, let the agent deal with it for now during action execution.
        return undefined;
    }

    for (const entity of result.entities) {
        if (!entity.type.includes(type)) {
            throw new Error(
                `Entity type mismatch: expected '${type}' but got '${entity.type.join(",")}`,
            );
        }
    }

    debugAgentEntities(
        `Resolved ${type} entity for '${value}': ${JSON.stringify(
            result,
            undefined,
            2,
        )}`,
    );
    return result;
}

async function processResolvedEntityResult(
    appAgentName: string,
    action: FullAction,
    type: string,
    value: string,
    result: ResolveEntityResult,
    clarifyEntities: ClarifyResolvedEntity[],
    options?: ParameterEntityResolverOptions,
) {
    if (
        options?.filter &&
        result.match === "fuzzy" &&
        result.entities.length > 1
    ) {
        // An extra pass to use LLM to narrow down the selection for fuzzy match.
        await filterEntitySelection(action, type, value, result);
    }
    if (options?.clarify && result.entities.length > 1) {
        clarifyEntities.push({
            type: type,
            name: value,
            result,
        });
        return;
    }
    if (result.match === "exact") {
        return {
            sourceAppAgentName: appAgentName,
            ...result.entities[0],
        };
    } else {
        // TODO: we should have a heuristic to determine if we should
        // clarify the fuzzy match or not.
        return {
            sourceAppAgentName: appAgentName,
            ...result.entities[0],
        };
    }
}

function createParameterEntityResolver(
    context: ActionContext<CommandHandlerContext>,
    entities: PromptEntity[] | undefined,
    options?: ParameterEntityResolverOptions,
): ParameterEntityResolver {
    const agentContext = context.sessionContext.agentContext;
    const agents = agentContext.agents;
    const conversationMemory = agentContext.conversationMemory;
    const resultEntityMap = new Set<string>();
    const clarifyEntities: ClarifyResolvedEntity[] = [];
    const promptEntityMap = toPromptEntityMap(entities);
    const promptNameEntityMap = toPromptEntityNameMap(entities);

    return {
        get clarifyResolvedEntities() {
            return clarifyEntities;
        },
        resolve: async (
            action: FullAction,
            obj: Record<string, any>,
            key: string | number,
            value: any,
            fieldType: ActionParamType,
            existing?: EntityValue,
        ): Promise<PromptEntity | undefined> => {
            const appAgentName = getAppAgentName(action.schemaName);

            // validate result entity
            if (value.startsWith("${result-")) {
                if (!resultEntityMap.has(value)) {
                    throw new Error(
                        `Result entity reference not found: ${value}`,
                    );
                }
                return;
            }

            // Don't resolve other entities if we already have one.
            if (existing !== undefined) {
                return existing;
            }

            if (value.startsWith("${entity-")) {
                const entity = promptEntityMap?.get(value);
                if (entity !== undefined) {
                    // fix up the action to the actual entity name
                    obj[key] = entity.name;
                    // Don't allow entity to be used in different app agent name.
                    return entity.sourceAppAgentName === appAgentName
                        ? entity
                        : undefined;
                }
                throw new Error(`Entity reference not found: ${value}`);
            }

            const entity = resolvePromptEntity(
                appAgentName,
                promptNameEntityMap,
                value,
            );
            if (entity !== undefined) {
                return entity;
            }

            if (
                options?.resolve &&
                fieldType.type === "type-reference" &&
                isEntityType(agents, action.schemaName, fieldType.name)
            ) {
                let resolveEntityResult: ResolveEntityResult | undefined;
                if (conversationMemory) {
                    resolveEntityResult = await resolveEntityWithMemory(
                        conversationMemory,
                        appAgentName,
                        fieldType.name,
                        value,
                    );
                }

                if (resolveEntityResult === undefined) {
                    resolveEntityResult = await resolveEntityWithAgent(
                        agents,
                        appAgentName,
                        fieldType.name,
                        value,
                        context,
                    );
                }

                if (resolveEntityResult !== undefined) {
                    return processResolvedEntityResult(
                        appAgentName,
                        action,
                        fieldType.name,
                        value,
                        resolveEntityResult,
                        clarifyEntities,
                        options,
                    );
                }
            }

            return undefined;
        },
        setResultEntity: (name: string, entity: PromptEntity) => {
            resultEntityMap.add(name);
        },
    };
}

async function getParameterEntities(
    action: FullAction,
    obj: any,
    key: string | number,
    value: unknown,
    originalFieldType: ActionParamType,
    originalActualType: ActionResolvedParamType,
    entityResolver: EntityResolver,
    existing?: EntityField,
): Promise<EntityField | undefined> {
    const resolvedType = resolveUnionType(
        originalFieldType,
        originalActualType,
        value,
    );
    if (resolvedType === undefined) {
        throw new Error(
            `Action parameter type mismatch ${key}: value doesn't match any of the union type`,
        );
    }
    const { fieldType, actualType } = resolvedType;
    switch (typeof value) {
        case "undefined":
            return;
        case "string":
            return entityResolver.resolve(
                action,
                obj,
                key,
                value,
                fieldType,
                existing as EntityValue | undefined,
            );
        case "function":
            throw new Error("Function is not supported as an action value");

        case "object":
            if (value === null) {
                throw new Error(
                    `Action parameter value cannot be null: ${key}`,
                );
            }
            if (Array.isArray(value)) {
                if (actualType.type !== "array") {
                    throw new Error(
                        `Action parameter type mismatch: ${key}. Expected 'array' but got '${actualType.type}'`,
                    );
                }
                return getParameterArrayEntities(
                    action,
                    value,
                    actualType,
                    entityResolver,
                    existing as EntityField[] | undefined,
                );
            }
            if (actualType.type !== "object") {
                throw new Error(
                    `Action parameter type mismatch: ${key}.  Expected 'object' but got '${actualType.type}'`,
                );
            }
            return getParameterObjectEntities(
                action,
                value,
                actualType,
                entityResolver,
                existing as EntityObject | undefined,
            );
    }
}

export async function resolveEntities(
    agents: AppAgentManager,
    action: TypeAgentAction<FullAction>,
    entityResolver: EntityResolver,
) {
    const parameters = action.parameters;
    if (parameters === undefined) {
        return;
    }

    const config = agents.getActionConfig(action.schemaName);
    const actionSchemaFile = agents.getActionSchemaFileForConfig(config);

    const schema = actionSchemaFile.parsedActionSchema.actionSchemas.get(
        action.actionName,
    );

    if (schema === undefined) {
        throw new Error(
            `Action schema not found for ${action.schemaName}.${action.actionName}`,
        );
    }

    const parameterType = schema.type.fields.parameters?.type;
    if (parameterType?.type !== "object") {
        throw new Error(
            `Action schema parameter type mismatch: ${action.schemaName}.${action.actionName}`,
        );
    }

    let resolvedEntities: Entity[] | undefined;
    const trackedEntityResolver: EntityResolver = {
        resolve: async (...args) => {
            const result = await entityResolver.resolve(...args);
            if (result !== undefined) {
                if (resolvedEntities === undefined) {
                    resolvedEntities = [];
                }
                resolvedEntities.push(result);
            }
            return result;
        },
        setResultEntity: entityResolver.setResultEntity.bind(entityResolver),
    };

    const entities = await getParameterObjectEntities(
        action,
        parameters,
        parameterType,
        trackedEntityResolver,
        action.entities as EntityObject | undefined,
    );
    if (entities !== undefined) {
        debugEntities(
            `Resolved action entities: ${JSON.stringify(
                entities,
                undefined,
                2,
            )}`,
        );
        action.entities = entities as any;
    }
    return resolvedEntities;
}

export type PendingAction = {
    executableAction: ExecutableAction;
    resolvedEntities?: Entity[] | undefined;
    resultEntityResolver?: EntityResolver | undefined;
};

// Action generated internally by the dispatcher.
export type ClarifyEntityAction = {
    actionName: "clarifyEntities";
    parameters: ClarifyResolvedEntity;
};

export async function toPendingActions(
    context: ActionContext<CommandHandlerContext>,
    actions: ExecutableAction[],
    entities: PromptEntity[] | undefined,
): Promise<PendingAction[]> {
    let resultEntityResolver: EntityResolver | undefined;
    const systemContext = context.sessionContext.agentContext;
    const agents = systemContext.agents;
    const entityResolver = createParameterEntityResolver(
        context,
        entities,
        systemContext.session.getConfig().translation.entity,
    );
    const pendingActions: PendingAction[] = [];

    for (const executableAction of actions) {
        const resolvedEntities = await resolveEntities(
            agents,
            executableAction.action,
            entityResolver,
        );

        if (entityResolver.clarifyResolvedEntities.length > 0) {
            const clarifyEntityAction: TypeAgentAction<ClarifyEntityAction> = {
                schemaName: DispatcherClarifyName,
                actionName: "clarifyEntities",
                // REVIEW: Only clarify one parameter at a time?
                parameters: entityResolver.clarifyResolvedEntities[0],
            };
            return [
                {
                    executableAction: {
                        action: clarifyEntityAction as any,
                    },
                },
            ];
        }

        const resultEntityId = executableAction.resultEntityId;
        if (resultEntityId !== undefined) {
            if (resultEntityResolver === undefined) {
                resultEntityResolver = createResultEntityResolver();
            }
            const name = `\${result-${resultEntityId}}`;
            entityResolver.setResultEntity(name, {
                name,
                type: [],
                sourceAppAgentName: "",
            });
        }
        const pending: PendingAction = {
            executableAction,
            resolvedEntities,
            resultEntityResolver,
        };
        pendingActions.push(pending);
    }

    return pendingActions;
}
