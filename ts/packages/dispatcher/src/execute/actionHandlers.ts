// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Action, Actions, FullAction } from "agent-cache";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
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
    AppAction,
} from "@typeagent/agent-sdk";
import {
    createActionResult,
    actionResultToString,
} from "@typeagent/agent-sdk/helpers/action";
import {
    displayError,
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { MatchResult } from "agent-cache";
import { getStorage } from "./storageImpl.js";
import { IncrementalJsonValueCallBack } from "common-utils";
import { ProfileNames } from "../utils/profileNames.js";
import { conversation } from "knowledge-processor";
import { makeClientIOMessage } from "../context/interactiveIO.js";
import { UnknownAction } from "../context/dispatcher/schema/dispatcherActionSchema.js";
import { isUnknownAction } from "../context/dispatcher/dispatcherUtils.js";

const debugActions = registerDebug("typeagent:dispatcher:actions");

export function getSchemaNamePrefix(
    translatorName: string,
    systemContext: CommandHandlerContext,
) {
    const config = systemContext.agents.getActionConfig(translatorName);
    return `[${config.emojiChar} ${translatorName}] `;
}

function getActionContext(
    appAgentName: string,
    systemContext: CommandHandlerContext,
    requestId: string,
    actionIndex?: number,
    action?: AppAction | string[],
) {
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
    for (const [name, desc] of Object.entries(descriptors)) {
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
    const instanceStorage = context.instanceDir
        ? getStorage(name, context.instanceDir)
        : undefined;
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
                  // Update the enable state to reflect the new agent
                  context.agents.setState(context, context.session.getConfig());
              })
        : () => {
              throw new Error("Permission denied: cannot add dynamic agent");
          };

    // TODO: only allow remove agent added by this agent.
    const removeDynamicAgent = allowDynamicAgent
        ? (agentName: string) =>
              // acquire the lock to prevent change the state while we are processing a command or adding dynamic agent.
              // WARNING: deadlock if this is call because we are processing a request
              context.commandLock(async () =>
                  context.agents.removeDynamicAgent(agentName),
              )
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

    if (actionIndex !== 0 || actionContext === undefined) {
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
    action: Action,
    context: ActionContext<CommandHandlerContext>,
    actionIndex: number,
    entityMap?: Map<string, Entity>,
): Promise<ActionResult | undefined> {
    const translatorName = action.translatorName;

    if (translatorName === undefined) {
        throw new Error(`Cannot execute action without translator name.`);
    }

    const systemContext = context.sessionContext.agentContext;
    const appAgentName = getAppAgentName(translatorName);
    const appAgent = systemContext.agents.getAppAgent(appAgentName);

    // Update the last action translator.
    systemContext.lastActionSchemaName = translatorName;

    if (appAgent.executeAction === undefined) {
        throw new Error(
            `Agent ${appAgentName} does not support executeAction.`,
        );
    }

    // Reuse the same streaming action context if one is available.
    const fullAction = action.toFullAction();
    const { actionContext, closeActionContext } =
        getStreamingActionContext(
            appAgentName,
            actionIndex,
            systemContext,
            fullAction,
        ) ??
        getActionContext(
            appAgentName,
            systemContext,
            systemContext.requestId!,
            actionIndex,
            fullAction,
        );

    actionContext.profiler = systemContext.commandProfiler?.measure(
        ProfileNames.executeAction,
        true,
        actionIndex,
    );
    let returnedResult: ActionResult | undefined;
    try {
        const prefix = getSchemaNamePrefix(
            action.translatorName,
            systemContext,
        );
        displayStatus(
            `${prefix}Executing action ${action.fullActionName}`,
            context,
        );
        returnedResult = await appAgent.executeAction(
            action,
            actionContext,
            entityMap,
        );
    } finally {
        actionContext.profiler?.stop();
        actionContext.profiler = undefined;
    }

    let result: ActionResult;
    if (returnedResult === undefined) {
        result = createActionResult(
            `Action ${action.fullActionName} completed.`,
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
        systemContext.chatHistory.addEntry(
            `Action ${action.fullActionName} failed: ${result.error}`,
            [],
            "assistant",
            systemContext.requestId,
        );
    } else {
        if (result.displayContent !== undefined) {
            actionContext.actionIO.setDisplay(result.displayContent);
        }
        if (result.dynamicDisplayId !== undefined) {
            systemContext.clientIO.setDynamicDisplay(
                translatorName,
                systemContext.requestId,
                actionIndex,
                result.dynamicDisplayId,
                result.dynamicDisplayNextRefreshMs!,
            );
        }
        systemContext.chatHistory.addEntry(
            result.literalText
                ? result.literalText
                : `Action ${action.fullActionName} completed.`,
            result.entities,
            "assistant",
            systemContext.requestId,
            undefined,
            result.additionalInstructions,
        );
    }

    closeActionContext();
    return result;
}

async function canExecute(
    actions: Actions,
    context: ActionContext<CommandHandlerContext>,
): Promise<boolean> {
    const systemContext = context.sessionContext.agentContext;
    const unknown: UnknownAction[] = [];
    const disabled = new Set<string>();
    for (const action of actions) {
        if (isUnknownAction(action)) {
            unknown.push(action);
        }
        if (
            action.translatorName &&
            !systemContext.agents.isActionActive(action.translatorName)
        ) {
            disabled.add(action.translatorName);
        }
    }

    if (unknown.length > 0) {
        const unknownRequests = unknown.map(
            (action) => action.parameters.request,
        );
        const lines = [
            `Unable to determine ${actions.action === undefined ? "one or more actions in" : "action for"} the request.`,
            ...unknownRequests.map((s) => `- ${s}`),
        ];
        systemContext.chatHistory.addEntry(
            lines.join("\n"),
            [],
            "assistant",
            systemContext.requestId,
        );

        const config = systemContext.session.getConfig();
        if (
            !config.translation.switch.search &&
            !config.translation.switch.embedding &&
            !config.translation.switch.inline
        ) {
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
        systemContext.chatHistory.addEntry(
            message,
            [],
            "assistant",
            systemContext.requestId,
        );

        displayWarn(message, context);
        return false;
    }

    return true;
}

export async function executeActions(
    actions: Actions,
    context: ActionContext<CommandHandlerContext>,
) {
    const systemContext = context.sessionContext.agentContext;
    if (systemContext.commandResult === undefined) {
        systemContext.commandResult = { actions: actions.toFullActions() };
    } else {
        systemContext.commandResult.actions = actions.toFullActions();
    }

    if (!(await canExecute(actions, context))) {
        return;
    }
    debugActions(`Executing actions: ${JSON.stringify(actions, undefined, 2)}`);
    let actionIndex = 0;
    const entityMap = new Map<string, Entity>();
    for (const action of actions) {
        const result = await executeAction(
            action,
            context,
            actionIndex,
            entityMap,
        );
        if (result && result.error === undefined) {
            if (result.resultEntity && action.resultEntityId) {
                entityMap.set(action.resultEntityId, result.resultEntity);
            }
        }
        actionIndex++;
    }
}

export async function validateWildcardMatch(
    match: MatchResult,
    context: CommandHandlerContext,
) {
    const actions = match.match.actions;
    for (const action of actions) {
        const translatorName = action.translatorName;
        if (translatorName === undefined) {
            continue;
        }
        const appAgentName = getAppAgentName(translatorName);
        const appAgent = context.agents.getAppAgent(appAgentName);
        const sessionContext = context.agents.getSessionContext(appAgentName);
        if (
            (await appAgent.validateWildcardMatch?.(action, sessionContext)) ===
            false
        ) {
            return false;
        }
    }
    return true;
}

export function startStreamPartialAction(
    translatorName: string,
    actionName: string,
    context: CommandHandlerContext,
): IncrementalJsonValueCallBack {
    const appAgentName = getAppAgentName(translatorName);
    const appAgent = context.agents.getAppAgent(appAgentName);
    if (appAgent.streamPartialAction === undefined) {
        // The config declared that there are streaming action, but the agent didn't implement it.
        throw new Error(
            `Agent ${appAgentName} does not support streamPartialAction.`,
        );
    }

    const actionContextWithClose = getActionContext(
        appAgentName,
        context,
        context.requestId!,
        0,
        {
            translatorName,
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
            `Agent ${appAgentName} does not support executeCommand.`,
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
