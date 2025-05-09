// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ExecutableAction,
    FullAction,
    getFullActionName,
    normalizeParamString,
} from "agent-cache";
import {
    CommandHandlerContext,
    getCommandResult,
} from "../context/commandHandlerContext.js";
import registerDebug from "debug";
import { getAppAgentName } from "../translation/agentTranslators.js";
import {
    ActionIO,
    AppAgentEvent,
    SessionContext,
    ActionResult,
    DisplayContent,
    ActionContext,
    DisplayAppendMode,
    ParsedCommandParams,
    ParameterDefinitions,
    Entity,
    AppAgentManifest,
    AppAgent,
    TypeAgentAction,
    AppAction,
} from "@typeagent/agent-sdk";
import {
    createActionResult,
    actionResultToString,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import {
    displayError,
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { MatchResult, PromptEntity } from "agent-cache";
import { getStorage } from "./storageImpl.js";
import { IncrementalJsonValueCallBack } from "common-utils";
import { ProfileNames } from "../utils/profileNames.js";
import { conversation } from "knowledge-processor";
import { makeClientIOMessage } from "../context/interactiveIO.js";
import { UnknownAction } from "../context/dispatcher/schema/dispatcherActionSchema.js";
import {
    DispatcherActivityName,
    DispatcherName,
    isUnknownAction,
} from "../context/dispatcher/dispatcherUtils.js";
import { isPendingRequestAction } from "../translation/pendingRequest.js";
import {
    isSwitchEnabled,
    translatePendingRequestAction,
} from "../translation/translateRequest.js";
import { getActionSchema } from "../internal.js";
import { validateAction } from "action-schema";
import { IndexManager } from "../context/indexManager.js";
import { IndexData } from "image-memory";

const debugActions = registerDebug("typeagent:dispatcher:actions");

export function getSchemaNamePrefix(
    schemaName: string,
    systemContext: CommandHandlerContext,
) {
    const config = systemContext.agents.getActionConfig(schemaName);
    return `[${config.emojiChar} ${schemaName}] `;
}

export type ActionContextWithClose = {
    actionContext: ActionContext<unknown>;
    actionIndex: number | undefined;
    closeActionContext: () => void;
};

function getActionContext(
    appAgentName: string,
    systemContext: CommandHandlerContext,
    requestId: string,
    actionIndex?: number,
    action?: TypeAgentAction | string[],
): ActionContextWithClose {
    let context = systemContext;
    const sessionContext = context.agents.getSessionContext(appAgentName);
    context.clientIO.setDisplayInfo(
        appAgentName,
        requestId,
        actionIndex,
        action,
    );
    const actionIO: ActionIO = {
        setDisplay(content: DisplayContent): void {
            context.clientIO.setDisplay(
                makeClientIOMessage(
                    context,
                    content,
                    requestId,
                    appAgentName,
                    actionIndex,
                ),
            );
        },
        appendDisplay(
            content: DisplayContent,
            mode: DisplayAppendMode = "inline",
        ): void {
            context.clientIO.appendDisplay(
                makeClientIOMessage(
                    context,
                    content,
                    requestId,
                    appAgentName,
                    actionIndex,
                ),
                mode,
            );
        },
        takeAction(action: string, data: unknown): void {
            context.clientIO.takeAction(action, data);
        },
        appendDiagnosticData(data): void {
            context.clientIO.appendDiagnosticData(requestId, data);
        },
    };
    const actionContext: ActionContext<unknown> = {
        streamingContext: undefined,
        get sessionContext() {
            return sessionContext;
        },
        get actionIO() {
            return actionIO;
        },
    };
    return {
        actionContext,
        actionIndex,
        closeActionContext: () => {
            closeContextObject(actionIO);
            closeContextObject(actionContext);
            // This will cause undefined except if context is access for the rare case
            // the implementation function are saved.
            (context as any) = undefined;
        },
    };
}

function closeContextObject(o: any) {
    const descriptors = Object.getOwnPropertyDescriptors(o);
    for (const [name] of Object.entries(descriptors)) {
        // TODO: Note this doesn't prevent the function continue to be call if is saved.
        Object.defineProperty(o, name, {
            get: () => {
                throw new Error("Context is closed.");
            },
        });
    }
}

export function createSessionContext<T = unknown>(
    name: string,
    agentContext: T,
    context: CommandHandlerContext,
    allowDynamicAgent: boolean,
): SessionContext<T> {
    const sessionDirPath = context.session.getSessionDirPath();
    const storage = sessionDirPath
        ? getStorage(name, sessionDirPath)
        : undefined;
    const instanceStorage = context.persistDir
        ? getStorage(name, context.persistDir)
        : undefined;
    const dynamicAgentNames = new Set<string>();
    const addDynamicAgent = allowDynamicAgent
        ? (agentName: string, manifest: AppAgentManifest, appAgent: AppAgent) =>
              // acquire the lock to prevent change the state while we are processing a command or removing dynamic agent.
              // WARNING: deadlock if this is call because we are processing a request
              context.commandLock(async () => {
                  await context.agents.addDynamicAgent(
                      agentName,
                      manifest,
                      appAgent,
                  );
                  dynamicAgentNames.add(agentName);
                  // Update the enable state to reflect the new agent
                  context.agents.setState(context, context.session.getConfig());
              })
        : () => {
              throw new Error("Permission denied: cannot add dynamic agent");
          };

    const removeDynamicAgent = allowDynamicAgent
        ? (agentName: string) =>
              // acquire the lock to prevent change the state while we are processing a command or adding dynamic agent.
              // WARNING: deadlock if this is called while we are processing a request
              context.commandLock(async () => {
                  if (!dynamicAgentNames.delete(agentName)) {
                      throw new Error(
                          `Permission denied: dynamic agent '${agentName}' not added by this agent`,
                      );
                  }
                  dynamicAgentNames.delete(agentName);
                  return context.agents.removeAgent(agentName);
              })
        : () => {
              throw new Error("Permission denied: cannot remove dynamic agent");
          };
    const sessionContext: SessionContext<T> = {
        get agentContext() {
            return agentContext;
        },
        get sessionStorage() {
            return storage;
        },
        get instanceStorage() {
            return instanceStorage;
        },
        notify(event: AppAgentEvent, message: string) {
            context.clientIO.notify(event, undefined, message, name);
        },
        async toggleTransientAgent(subAgentName: string, enable: boolean) {
            if (!subAgentName.startsWith(`${name}.`)) {
                throw new Error(`Invalid sub agent name: ${subAgentName}`);
            }
            const state = context.agents.getTransientState(subAgentName);
            if (state === undefined) {
                throw new Error(
                    `Transient sub agent not found: ${subAgentName}`,
                );
            }

            if (state === enable) {
                return;
            }

            // acquire the lock to prevent change the state while we are processing a command.
            // WARNING: deadlock if this is call because we are processing a request
            return context.commandLock(async () => {
                context.agents.toggleTransient(subAgentName, enable);
                // Because of the embedded switcher, we need to clear the cache.
                context.translatorCache.clear();
                if (enable) {
                    // REVIEW: is switch current translator the right behavior?
                    context.lastActionSchemaName = subAgentName;
                } else if (context.lastActionSchemaName === subAgentName) {
                    context.lastActionSchemaName = name;
                }
            });
        },
        addDynamicAgent,
        removeDynamicAgent,
        indexes(type: string): Promise<any[]> {
            return new Promise<IndexData[]>((resolve, reject) => {
                const iidx: IndexData[] =
                    IndexManager.getInstance().indexes.filter((value) => {
                        return type === "all" || value.source === type;
                    });

                resolve(iidx);
            });
        },
    };

    (sessionContext as any).conversationManager = context.conversationManager;
    return sessionContext;
}

function getStreamingActionContext(
    appAgentName: string,
    actionIndex: number,
    systemContext: CommandHandlerContext,
    fullAction: FullAction,
) {
    const actionContext = systemContext.streamingActionContext;
    systemContext.streamingActionContext = undefined;

    if (
        actionContext === undefined ||
        actionContext.actionIndex !== actionIndex
    ) {
        actionContext?.closeActionContext();
        return undefined;
    }
    // If we are reusing the streaming action context, we need to update the action.
    systemContext.clientIO.setDisplayInfo(
        appAgentName,
        systemContext.requestId,
        actionIndex,
        fullAction,
    );
    return actionContext;
}

async function executeAction(
    executableAction: ExecutableAction,
    context: ActionContext<CommandHandlerContext>,
    actionIndex: number,
): Promise<ActionResult> {
    const action = executableAction.action;
    if (debugActions.enabled) {
        debugActions(
            `Executing action: ${JSON.stringify(action, undefined, 2)}`,
        );
    }

    const schemaName = action.schemaName;
    const systemContext = context.sessionContext.agentContext;
    const appAgentName = getAppAgentName(schemaName);
    const appAgent = systemContext.agents.getAppAgent(appAgentName);

    // Update the last action translator.
    systemContext.lastActionSchemaName = schemaName;

    if (appAgent.executeAction === undefined) {
        throw new Error(
            `Agent '${appAgentName}' does not support executeAction.`,
        );
    }

    // Reuse the same streaming action context if one is available.

    const { actionContext, closeActionContext } =
        getStreamingActionContext(
            appAgentName,
            actionIndex,
            systemContext,
            action,
        ) ??
        getActionContext(
            appAgentName,
            systemContext,
            systemContext.requestId!,
            actionIndex,
            action,
        );

    const prefix = getSchemaNamePrefix(action.schemaName, systemContext);
    displayStatus(
        `${prefix}Executing action ${getFullActionName(executableAction)}`,
        context,
    );
    actionContext.profiler = systemContext.commandProfiler?.measure(
        ProfileNames.executeAction,
        true,
        actionIndex,
    );
    let returnedResult: ActionResult | undefined;
    try {
        returnedResult = await appAgent.executeAction(action, actionContext);
    } catch (e: any) {
        returnedResult = createActionResultFromError(e.message);
    }
    actionContext.profiler?.stop();
    actionContext.profiler = undefined;

    let result: ActionResult;
    if (returnedResult === undefined) {
        result = createActionResult(
            `Action ${getFullActionName(executableAction)} completed.`,
        );
    } else {
        if (
            returnedResult.error === undefined &&
            returnedResult.literalText &&
            systemContext.conversationManager
        ) {
            addToConversationMemory(
                systemContext,
                returnedResult.literalText,
                returnedResult.entities,
            );
        }
        result = returnedResult;
    }
    if (debugActions.enabled) {
        debugActions(actionResultToString(result));
    }

    if (result.error !== undefined) {
        displayError(result.error, actionContext);
        systemContext.chatHistory.addAssistantEntry(
            `Action ${getFullActionName(executableAction)} failed: ${result.error}`,
            systemContext.requestId,
            appAgentName,
        );
    } else {
        if (result.displayContent !== undefined) {
            actionContext.actionIO.setDisplay(result.displayContent);
        }
        if (result.dynamicDisplayId !== undefined) {
            systemContext.clientIO.setDynamicDisplay(
                schemaName,
                systemContext.requestId,
                actionIndex,
                result.dynamicDisplayId,
                result.dynamicDisplayNextRefreshMs!,
            );
        }
        const combinedEntities = [...result.entities];
        if (result.resultEntity) {
            combinedEntities.push(result.resultEntity);
        }
        systemContext.chatHistory.addAssistantEntry(
            result.literalText
                ? result.literalText
                : `Action ${getFullActionName(executableAction)} completed.`,
            systemContext.requestId,
            appAgentName,
            combinedEntities,
            result.additionalInstructions,
        );
    }

    closeActionContext();
    return result;
}

async function canExecute(
    actions: ExecutableAction[],
    context: ActionContext<CommandHandlerContext>,
): Promise<boolean> {
    const systemContext = context.sessionContext.agentContext;
    const unknown: UnknownAction[] = [];
    const disabled = new Set<string>();
    for (const { action } of actions) {
        if (isUnknownAction(action)) {
            unknown.push(action);
        }
        if (
            action.schemaName &&
            !systemContext.agents.isActionActive(action.schemaName)
        ) {
            disabled.add(action.schemaName);
        }
    }

    if (unknown.length > 0) {
        const unknownRequests = unknown.map(
            (action) => action.parameters.request,
        );
        const lines = [
            `Unable to determine ${actions.length > 1 ? "one or more actions in" : "action for"} the request.`,
            ...unknownRequests.map((s) => `- ${s}`),
        ];
        systemContext.chatHistory.addAssistantEntry(
            lines.join("\n"),
            systemContext.requestId,
            DispatcherName,
        );

        const config = systemContext.session.getConfig();
        if (!isSwitchEnabled(config)) {
            lines.push("");
            lines.push("Switching agents is disabled");
        } else {
            const entries = await Promise.all(
                unknownRequests.map((request) =>
                    systemContext.agents.semanticSearchActionSchema(
                        request,
                        1,
                        () => true, // don't filter
                    ),
                ),
            );
            const schemaNames = new Set(
                entries
                    .filter((e) => e !== undefined)
                    .map((e) => e![0].item.actionSchemaFile.schemaName)
                    .filter(
                        (schemaName) =>
                            !systemContext.agents.isSchemaActive(schemaName),
                    ),
            );

            if (schemaNames.size > 0) {
                lines.push("");
                lines.push(
                    `Possible agent${schemaNames.size > 1 ? "s" : ""} to handle the request${unknownRequests.length > 1 ? "s" : ""} are not active: ${Array.from(schemaNames).join(", ")}`,
                );
            }
        }

        displayError(lines, context);
        return false;
    }

    if (disabled.size > 0) {
        const message = `Not executed. Action disabled for ${Array.from(disabled.values()).join(", ")}`;
        systemContext.chatHistory.addAssistantEntry(
            message,
            systemContext.requestId,
            DispatcherName,
        );

        displayWarn(message, context);
        return false;
    }

    return true;
}

type EntityValue = PromptEntity | undefined;
type EntityField = EntityValue | EntityObject | EntityField[];
interface EntityObject {
    [key: string]: EntityValue | EntityField;
}

function getParameterObjectEntities(
    appAgentName: string,
    obj: Record<string, any>,
    resultEntityMap: Map<string, PromptEntity>,
    promptEntityMap: Map<string, PromptEntity> | undefined,
    promptNameEntityMap: Map<string, PromptEntity | PromptEntity[]> | undefined,
) {
    let hasEntity = false;
    const entities: EntityObject | EntityField[] = Array.isArray(obj) ? [] : {};
    for (const [k, v] of Object.entries(obj)) {
        const entity = getParameterEntities(
            appAgentName,
            obj,
            k,
            v,
            resultEntityMap,
            promptEntityMap,
            promptNameEntityMap,
        );
        if (entity !== undefined) {
            hasEntity = true;
            (entities as any)[k] = entity;
        }
    }
    return hasEntity ? entities : undefined;
}

function resolveParameterEntity(
    obj: Record<string, any>,
    key: string,
    value: any,
    resultEntityMap: Map<string, PromptEntity>,
    promptEntityMap: Map<string, PromptEntity> | undefined,
    promptNameEntityMap: Map<string, PromptEntity | PromptEntity[]> | undefined,
) {
    const resultEntity = resultEntityMap.get(value);
    if (resultEntity !== undefined) {
        return resultEntity;
    }
    const entity = promptEntityMap?.get(value);
    if (entity !== undefined) {
        // fix up the action to the actual entity name
        obj[key] = entity.name;
        return entity;
    }

    // LLM like to correct/change casing.  Normalize entity name for look up.
    return promptNameEntityMap?.get(normalizeParamString(value));
}

function getParameterEntities(
    appAgentName: string,
    obj: any,
    key: string,
    value: any,
    resultEntityMap: Map<string, PromptEntity>,
    promptEntityMap: Map<string, PromptEntity> | undefined,
    promptNameEntityMap: Map<string, PromptEntity | PromptEntity[]> | undefined,
): EntityField | undefined {
    switch (typeof value) {
        case "undefined":
            return;
        case "string":
            const entity = resolveParameterEntity(
                obj,
                key,
                value,
                resultEntityMap,
                promptEntityMap,
                promptNameEntityMap,
            );

            if (entity === undefined) {
                return undefined;
            }
            if (!Array.isArray(entity)) {
                return entity.sourceAppAgentName === appAgentName
                    ? entity
                    : undefined;
            }
            const matched = entity.filter(
                (e) => e.sourceAppAgentName === appAgentName,
            );
            // TODO: If there are multiple match, ignore for now.
            return matched.length === 1 ? matched[0] : undefined;
        case "function":
            throw new Error("Function is not supported as an action value");
        case "object":
            return value
                ? getParameterObjectEntities(
                      appAgentName,
                      value,
                      resultEntityMap,
                      promptEntityMap,
                      promptNameEntityMap,
                  )
                : undefined;
    }
}

type PendingAction = {
    executableAction: ExecutableAction;
    promptEntityMap: Map<string, PromptEntity> | undefined;
    promptNameEntityMap: Map<string, PromptEntity | PromptEntity[]> | undefined;
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

function resolveEntities(
    action: TypeAgentAction<FullAction>,
    resultEntityMap: Map<string, PromptEntity>,
    promptEntityMap: Map<string, PromptEntity> | undefined,
    promptNameEntityMap: Map<string, PromptEntity | PromptEntity[]> | undefined,
    duplicateAction: boolean,
) {
    if (action.parameters === undefined) {
        return action;
    }
    const result = duplicateAction ? { ...action } : action;
    const entities = getParameterObjectEntities(
        getAppAgentName(action.schemaName),
        action.parameters!,
        resultEntityMap,
        promptEntityMap,
        promptNameEntityMap,
    );
    if (entities !== undefined) {
        result.entities = entities as any;
    }
    return result;
}

function toPendingActions(
    actions: ExecutableAction[],
    entities: PromptEntity[] | undefined,
): PendingAction[] {
    const promptEntityMap = toPromptEntityMap(entities);
    const promptNameEntityMap = toPromptEntityNameMap(entities);
    return Array.from(actions).map((executableAction) => ({
        executableAction,
        promptEntityMap,
        promptNameEntityMap,
    }));
}

export async function executeActions(
    actions: ExecutableAction[],
    entities: PromptEntity[] | undefined,
    context: ActionContext<CommandHandlerContext>,
) {
    const systemContext = context.sessionContext.agentContext;
    const commandResult = getCommandResult(systemContext);
    if (commandResult !== undefined) {
        const promptEntityMap = toPromptEntityMap(entities);
        const promptNameEntityMap = toPromptEntityNameMap(entities);
        commandResult.actions = actions.map(({ action }) =>
            resolveEntities(
                action,
                new Map(),
                promptEntityMap,
                promptNameEntityMap,
                true,
            ),
        );
    }

    if (!(await canExecute(actions, context))) {
        return;
    }
    debugActions(`Executing actions: ${JSON.stringify(actions, undefined, 2)}`);
    let actionIndex = 0;
    const resultEntityMap = new Map<string, PromptEntity>();
    const actionQueue: PendingAction[] = toPendingActions(actions, entities);

    while (actionQueue.length !== 0) {
        const { executableAction, promptEntityMap, promptNameEntityMap } =
            actionQueue.shift()!;
        const action = executableAction.action;
        if (isPendingRequestAction(action)) {
            const translationResult = await translatePendingRequestAction(
                action,
                context,
                actionIndex,
            );
            if (!translationResult) {
                throw new Error("Pending action translation error.");
            }

            const requestAction = translationResult.requestAction;
            actionQueue.unshift(
                ...toPendingActions(
                    requestAction.actions,
                    requestAction.history?.entities,
                ),
            );
            continue;
        }
        const appAgentName = getAppAgentName(action.schemaName);
        resolveEntities(
            action,
            resultEntityMap,
            promptEntityMap,
            promptNameEntityMap,
            false,
        );
        const result = await executeAction(
            executableAction,
            context,
            actionIndex,
        );
        if (result.error === undefined) {
            if (result.resultEntity && executableAction.resultEntityId) {
                resultEntityMap.set(executableAction.resultEntityId, {
                    ...result.resultEntity,
                    sourceAppAgentName: appAgentName,
                });
            }

            if (result.additionalActions !== undefined) {
                try {
                    const actions = getAdditionalExecutableActions(
                        result.additionalActions,
                        action.schemaName,
                        systemContext,
                    );
                    // REVIEW: assume that the agent will fill the entities already?  Also, current format doesn't support resultEntityIds.
                    actionQueue.unshift(
                        ...toPendingActions(actions, undefined),
                    );
                } catch (e) {
                    throw new Error(
                        `${action.schemaName}.${action.actionName} returned an invalid action: ${e}`,
                    );
                }
            }

            if (result.activityContext !== undefined) {
                if (actionQueue.length > 0) {
                    throw new Error(
                        `Cannot start an activity when there are pending actions.`,
                    );
                }
                // TODO: validation
                systemContext.activityContext = {
                    appAgentName: getAppAgentName(
                        executableAction.action.schemaName,
                    ),
                    ...result.activityContext,
                };
                systemContext.agents.toggleTransient(
                    DispatcherActivityName,
                    true,
                );
            }
        }
        actionIndex++;
    }
}

function getAdditionalExecutableActions(
    actions: AppAction[],
    sourceSchemaName: string,
    context: CommandHandlerContext,
) {
    const appAgentName = getAppAgentName(sourceSchemaName);
    const executableActions: ExecutableAction[] = [];
    for (const newAction of actions) {
        const fullAction = (
            newAction.schemaName !== undefined
                ? newAction
                : {
                      ...newAction,
                      schemaName: sourceSchemaName,
                  }
        ) as FullAction;

        if (appAgentName !== DispatcherName) {
            // For non-dispatcher, action can only be trigger within the same agent.
            const actionAppAgentName = getAppAgentName(fullAction.schemaName);
            if (actionAppAgentName !== appAgentName) {
                throw new Error(
                    `Cannot invoke actions from other agent '${actionAppAgentName}'.`,
                );
            }
        }

        const actionInfo = getActionSchema(fullAction, context.agents);
        if (actionInfo === undefined) {
            throw new Error(
                `Action not found ${fullAction.schemaName}.${fullAction.actionName}`,
            );
        }
        validateAction(actionInfo, fullAction);

        executableActions.push({ action: fullAction });
    }
    return executableActions;
}

export async function validateWildcardMatch(
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
            // Assume validateWildcardMatch is true.
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

export function startStreamPartialAction(
    schemaName: string,
    actionName: string,
    context: CommandHandlerContext,
    actionIndex: number,
): IncrementalJsonValueCallBack {
    const appAgentName = getAppAgentName(schemaName);
    const appAgent = context.agents.getAppAgent(appAgentName);
    if (appAgent.streamPartialAction === undefined) {
        // The config declared that there are streaming action, but the agent didn't implement it.
        throw new Error(
            `Agent '${appAgentName}' does not support streamPartialAction.`,
        );
    }

    const actionContextWithClose = getActionContext(
        appAgentName,
        context,
        context.requestId!,
        actionIndex,
        {
            schemaName,
            actionName,
        },
    );

    context.streamingActionContext = actionContextWithClose;

    return (name: string, value: any, delta?: string) => {
        appAgent.streamPartialAction!(
            actionName,
            name,
            value,
            delta,
            actionContextWithClose.actionContext,
        );
    };
}

export async function executeCommand(
    commands: string[],
    params: ParsedCommandParams<ParameterDefinitions> | undefined,
    appAgentName: string,
    context: CommandHandlerContext,
    attachments?: string[],
): Promise<void> {
    const appAgent = context.agents.getAppAgent(appAgentName);
    if (appAgent.executeCommand === undefined) {
        throw new Error(
            `Agent '${appAgentName}' does not support executeCommand.`,
        );
    }

    // update the last action name
    const { actionContext, closeActionContext } = getActionContext(
        appAgentName,
        context,
        context.requestId!,
        undefined,
        commands,
    );

    try {
        actionContext.profiler = context.commandProfiler?.measure(
            ProfileNames.executeCommand,
            true,
        );

        return await appAgent.executeCommand(
            commands,
            params,
            actionContext,
            attachments,
        );
    } finally {
        actionContext.profiler?.stop();
        actionContext.profiler = undefined;
        closeActionContext();
    }
}

function addToConversationMemory(
    systemContext: CommandHandlerContext,
    message: string,
    entities: Entity[],
) {
    if (systemContext.conversationManager) {
        const newEntities = entities.filter(
            (e) => !conversation.isMemorizedEntity(e.type),
        );
        if (newEntities.length > 0) {
            systemContext.conversationManager.queueAddMessage(
                {
                    text: message,
                    knowledge: newEntities,
                    timestamp: new Date(),
                },
                false,
            );
        }
    }
}
