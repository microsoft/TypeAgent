// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExecutableAction, FullAction, getFullActionName } from "agent-cache";
import {
    CommandHandlerContext,
    getCommandResult,
} from "../context/commandHandlerContext.js";
import registerDebug from "debug";
import { getAppAgentName } from "../translation/agentTranslators.js";
import {
    ActionResult,
    ActionContext,
    ParsedCommandParams,
    ParameterDefinitions,
    Entity,
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
import { IncrementalJsonValueCallBack } from "common-utils";
import { ProfileNames } from "../utils/profileNames.js";
import { conversation } from "knowledge-processor";
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
import {
    PendingAction,
    resolveEntities,
    toPendingActions,
} from "./pendingActions.js";
import { getActionContext } from "./actionContext.js";

const debugActions = registerDebug("typeagent:dispatcher:actions");

export function getSchemaNamePrefix(
    schemaName: string,
    systemContext: CommandHandlerContext,
) {
    const config = systemContext.agents.getActionConfig(schemaName);
    return `[${config.emojiChar} ${schemaName}] `;
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

export async function executeActions(
    actions: ExecutableAction[],
    entities: PromptEntity[] | undefined,
    context: ActionContext<CommandHandlerContext>,
) {
    const systemContext = context.sessionContext.agentContext;
    const commandResult = getCommandResult(systemContext);
    if (commandResult !== undefined) {
        commandResult.actions = actions.map(({ action }) => action);
    }

    // Even if the action is not executed, resolve the entities for the commandResult.
    const actionQueue: PendingAction[] = await toPendingActions(
        systemContext,
        actions,
        entities,
    );

    if (!(await canExecute(actions, context))) {
        return;
    }
    debugActions(`Executing actions: ${JSON.stringify(actions, undefined, 2)}`);
    let actionIndex = 0;

    while (actionQueue.length !== 0) {
        const { executableAction, resultEntityResolver } = actionQueue.shift()!;
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
                ...(await toPendingActions(
                    systemContext,
                    requestAction.actions,
                    requestAction.history?.entities,
                )),
            );
            continue;
        }
        const appAgentName = getAppAgentName(action.schemaName);
        // resolve result entities.
        if (resultEntityResolver !== undefined) {
            await resolveEntities(
                systemContext.agents,
                action,
                resultEntityResolver,
            );
        }
        const result = await executeAction(
            executableAction,
            context,
            actionIndex,
        );
        if (result.error !== undefined) {
            return;
        }
        const resultEntityId = executableAction.resultEntityId;
        if (resultEntityId !== undefined) {
            if (result.resultEntity === undefined) {
                throw new Error(
                    `Action ${getFullActionName(
                        executableAction,
                    )} did not return a result entity.`,
                );
            }
            if (resultEntityResolver === undefined) {
                throw new Error(
                    `Internal error: resultEntityResolver is undefined`,
                );
            }
            resultEntityResolver.setResultEntity(
                `\${result-${resultEntityId}}`,
                {
                    ...result.resultEntity,
                    sourceAppAgentName: appAgentName,
                },
            );
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
                    ...(await toPendingActions(
                        systemContext,
                        actions,
                        undefined,
                    )),
                );
            } catch (e) {
                throw new Error(
                    `${action.schemaName}.${action.actionName} returned an invalid action: ${e}`,
                );
            }
        }

        if (result.activityContext !== undefined) {
            if (result.activityContext === null) {
                debugActions(
                    `Clear activity: ${JSON.stringify(systemContext.activityContext, undefined, 2)}`,
                );
                clearActivityContext(systemContext);
            } else {
                if (actionQueue.length > 0) {
                    throw new Error(
                        `Cannot start an activity when there are pending actions.`,
                    );
                }

                // TODO: validation
                const {
                    activityName,
                    description,
                    state,
                    openLocalView,
                    activityEndAction,
                } = result.activityContext;

                if (activityEndAction !== undefined) {
                    if (activityEndAction.schemaName === undefined) {
                        activityEndAction.schemaName = action.schemaName;
                    } else {
                        if (
                            getAppAgentName(activityEndAction.schemaName) !==
                            appAgentName
                        ) {
                            throw new Error(
                                `Activity end action schema name '${activityEndAction.schemaName}' does not match the activity app agent name '${appAgentName}'.`,
                            );
                        }
                    }
                }

                const prevOpenLocalView =
                    systemContext.activityContext?.openLocalView;
                systemContext.activityContext = {
                    appAgentName,
                    activityName,
                    description,
                    state,
                    openLocalView: prevOpenLocalView || openLocalView,
                    activityEndAction,
                };

                debugActions(
                    `Starting activity: ${JSON.stringify(systemContext.activityContext, undefined, 2)}`,
                );
                systemContext.agents.toggleTransient(
                    DispatcherActivityName,
                    true,
                );
                if (openLocalView) {
                    const port =
                        systemContext.agents.getLocalHostPort(appAgentName);
                    if (port !== undefined) {
                        await systemContext.clientIO.openLocalView(port);
                    }
                }
            }
        }
        actionIndex++;
    }
}

async function clearActivityContext(
    context: CommandHandlerContext,
): Promise<void> {
    const activityContext = context.activityContext;
    if (activityContext?.openLocalView) {
        const port = context.agents.getLocalHostPort(
            activityContext.appAgentName,
        );
        if (port !== undefined) {
            await context.clientIO.closeLocalView(port);
        }
    }
    context.activityContext = undefined;
    context.agents.toggleTransient(DispatcherActivityName, false);
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
