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
    AppAction,
    ActionResultActivityContext,
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
import {
    addActionResultToMemory,
    addResultToMemory,
} from "../context/memory.js";

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
    let result: ActionResult;
    try {
        result =
            (await appAgent.executeAction(action, actionContext)) ??
            createActionResult(
                `Action ${getFullActionName(executableAction)} completed.`,
            );
    } catch (e: any) {
        result = createActionResultFromError(e.message);
    }
    actionContext.profiler?.stop();
    actionContext.profiler = undefined;

    if (debugActions.enabled) {
        debugActions(actionResultToString(result));
    }

    // Display the action result.
    if (result.error !== undefined) {
        displayError(result.error, actionContext);
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
        addResultToMemory(systemContext, lines.join("\n"), DispatcherName);

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
        addResultToMemory(systemContext, message, DispatcherName);
        displayWarn(message, context);
        return false;
    }

    return true;
}

export function setActivityContext(
    schemaName: string,
    resultActivityContext: ActionResultActivityContext,
    systemContext: CommandHandlerContext,
) {
    if (resultActivityContext === null) {
        // Clear the activity context.
        clearActivityContext(systemContext);
        return undefined;
    }

    const appAgentName = getAppAgentName(schemaName);
    // TODO: validation
    const {
        activityName,
        description,
        state,
        openLocalView,
        activityEndAction,
    } = resultActivityContext;

    let action: AppAction | undefined;
    if (activityEndAction !== undefined) {
        action = structuredClone(activityEndAction);
        if (action.schemaName === undefined) {
            action.schemaName = schemaName;
        } else {
            if (
                getAppAgentName(action.schemaName) !==
                getAppAgentName(schemaName)
            ) {
                throw new Error(
                    `Action schema name '${action.schemaName}' does not match the activity app agent name '${getAppAgentName(schemaName)}'.`,
                );
            }
        }
    }

    const prevOpenLocalView = systemContext.activityContext?.openLocalView;
    const activityContext = {
        appAgentName,
        activityName,
        description,
        state,
        openLocalView: prevOpenLocalView || openLocalView,
        activityEndAction: action,
    };

    systemContext.activityContext = activityContext;
    systemContext.agents.toggleTransient(DispatcherActivityName, true);
    return activityContext;
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
        context,
        actions,
        entities,
    );

    if (!(await canExecute(actions, context))) {
        return;
    }

    debugActions(`Executing actions: ${JSON.stringify(actions, undefined, 2)}`);
    let actionIndex = 0;

    while (actionQueue.length !== 0) {
        const pending = actionQueue.shift()!;
        const executableAction = pending.executableAction;

        const action = executableAction.action;
        if (isPendingRequestAction(action)) {
            const translationResult = await translatePendingRequestAction(
                action,
                context,
                actionIndex,
            );

            const requestAction = translationResult.requestAction;
            actionQueue.unshift(
                ...(await toPendingActions(
                    context,
                    requestAction.actions,
                    requestAction.history?.entities,
                )),
            );
            continue;
        }
        const appAgentName = getAppAgentName(action.schemaName);
        // resolve result entities.
        const resultEntityResolver = pending.resultEntityResolver;
        let resolvedEntities = pending.resolvedEntities;
        if (resultEntityResolver !== undefined) {
            const resultResolvedEntities = await resolveEntities(
                systemContext.agents,
                action,
                resultEntityResolver,
            );
            if (resultResolvedEntities !== undefined) {
                if (resolvedEntities === undefined) {
                    resolvedEntities = [];
                }
                resolvedEntities.push(...resultResolvedEntities);
            }
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

        // add the action result to memory.
        addActionResultToMemory(
            systemContext,
            executableAction,
            resolvedEntities,
            action.schemaName,
            result,
        );

        if (result.activityContext !== undefined) {
            if (actionQueue.length > 0) {
                throw new Error(
                    `Cannot change activity context when there are pending actions.`,
                );
            }

            const activityContext = setActivityContext(
                action.schemaName,
                result.activityContext,
                systemContext,
            );
            if (activityContext === undefined) {
                // Activity context cleared.
                debugActions(
                    `Clear activity: ${JSON.stringify(systemContext.activityContext, undefined, 2)}`,
                );
                continue;
            }
            debugActions(
                `Starting activity: ${JSON.stringify(systemContext.activityContext, undefined, 2)}`,
            );

            if (activityContext.openLocalView) {
                const port =
                    systemContext.agents.getLocalHostPort(appAgentName);
                if (port !== undefined) {
                    await systemContext.clientIO.openLocalView(port);
                }
            }
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
                    ...(await toPendingActions(context, actions, undefined)),
                );
            } catch (e) {
                throw new Error(
                    `${action.schemaName}.${action.actionName} returned an invalid action: ${e}`,
                );
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
