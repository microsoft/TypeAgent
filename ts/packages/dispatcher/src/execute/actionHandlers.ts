// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ExecutableAction,
    FullAction,
    getFullActionName,
    PromptEntity,
} from "agent-cache";
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
import { IncrementalJsonValueCallBack } from "common-utils";
import { ProfileNames } from "../utils/profileNames.js";
import { UnknownAction } from "../context/dispatcher/schema/dispatcherActionSchema.js";
import {
    DispatcherName,
    isUnknownAction,
} from "../context/dispatcher/dispatcherUtils.js";
import { isPendingRequestAction } from "../translation/pendingRequest.js";
import {
    isSwitchEnabled,
    translatePendingRequestAction,
} from "../translation/translateRequest.js";
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
import { setActivityContext } from "./activityContext.js";
import { tryGetActionSchema } from "../translation/actionSchemaFileCache.js";

const debugActions = registerDebug("typeagent:dispatcher:actions");
const debugCommandExecError = registerDebug(
    "typeagent:dispatcher:command:exec:error",
);
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

export function isProtocolRequest(
    systemContext: CommandHandlerContext,
): boolean {
    const requestId = systemContext.requestId;

    if (!requestId) {
        return false;
    }

    

    if (
        systemContext.clientIO &&
        typeof (systemContext.clientIO as any).getProtocolRequestWebSocket === "function"
    ) {
        const protocolInfo = (systemContext.clientIO as any).getProtocolRequestWebSocket(requestId);

        return protocolInfo !== undefined;
    }

    return false;
}

export function shouldDelegateAction(
    schemaName: string,
    systemContext: CommandHandlerContext,
): boolean {


    const config = systemContext.agents.getActionConfig(schemaName);
    

    if (!config.delegatable) {
        return false;
    }

    const envValue = process.env.TYPEAGENT_EXTERNAL_CHAT_DELEGATION;
    const delegationEnabled = envValue === undefined || envValue.toLowerCase() === "true" || envValue === "1";

    if (!delegationEnabled) {
        debugActions("External chat delegation disabled via config");
        return false;
    }

    const isProtocol = isProtocolRequest(systemContext);

    if (isProtocol) {
        debugActions(`Protocol request ${systemContext.requestId}, delegating action to external service`);
    } else {
        debugActions(`[Dispatcher:Delegation] ✗ Local request ${systemContext.requestId} - processing with TypeAgent`);
    }

    return isProtocol;
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


    if (shouldDelegateAction(schemaName, systemContext)) {
        console.warn(`[Dispatcher:Delegation] ⚠️  OLD DELEGATION PATH HIT - This should have been caught in translation phase!`);
        debugActions(`[Dispatcher:Delegation] ===> DELEGATING ${schemaName} action to external service (fallback path)`);
        debugActions(`Delegating ${schemaName} action to external service (fallback path)`);

        const query = (action.parameters as any)?.originalRequest ||
                     (action.parameters as any)?.query ||
                     (action.parameters as any)?.request ||
                     "";


        const delegationData = JSON.stringify({
            _delegationType: "external_chat",
            query,
            requestId: systemContext.requestId,
        });


        // Send delegation marker directly through appendDisplay
        debugActions("[Dispatcher:Delegation] Sending delegation marker through appendDisplay (late)");
        context.actionIO.appendDisplay({
            type: "text",
            content: delegationData,
        }, "block");

        // Return a result without displayContent since we already sent it
        return {
            entities: [],
            historyText: delegationData,
        };
    }

    debugActions(`[Dispatcher:Delegation] ===> EXECUTING ${schemaName} action locally with TypeAgent`);

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
            actionContext.actionIO.appendDisplay(
                result.displayContent,
                "block",
            );
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
        
        // Skip delegated actions - they were already handled in translation phase
        if (action.schemaName === "system" && action.actionName === "delegated") {
            debugActions("[Dispatcher:Execute] Skipping delegated action - delegation signal already sent");
            actionIndex++;
            continue;
        }
        
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

        // add the action result to memory whether it has error or not.
        addActionResultToMemory(
            systemContext,
            executableAction,
            resolvedEntities,
            action.schemaName,
            result,
        );

        if (result.error !== undefined) {
            // Stop executing further action on error.
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

        if (result.activityContext !== undefined) {
            if (actionQueue.length > 0) {
                throw new Error(
                    `Cannot change activity context when there are pending actions.`,
                );
            }

            debugActions(
                `Result activity context: ${JSON.stringify(result.activityContext, undefined, 2)}`,
            );
            const prevActivityContext = systemContext.activityContext;
            const openLocalView = setActivityContext(
                action.schemaName,
                result.activityContext,
                systemContext,
            );
            if (openLocalView !== undefined) {
                if (openLocalView) {
                    const port =
                        systemContext.agents.getLocalHostPort(appAgentName);
                    if (port !== undefined) {
                        await systemContext.clientIO.openLocalView(port);
                    }
                } else if (prevActivityContext !== undefined) {
                    const port = systemContext.agents.getLocalHostPort(
                        prevActivityContext.appAgentName,
                    );
                    if (port !== undefined) {
                        await systemContext.clientIO.closeLocalView(port);
                    }
                }
            }
            if (systemContext.activityContext !== undefined) {
                debugActions(
                    `Starting activity: ${JSON.stringify(systemContext.activityContext, undefined, 2)}`,
                );
            } else if (prevActivityContext !== undefined) {
                // Activity context cleared.
                debugActions(
                    `Stopped activity: ${JSON.stringify(prevActivityContext, undefined, 2)}`,
                );
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

        const actionInfo = tryGetActionSchema(fullAction, context.agents);
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

        try {
            return await appAgent.executeCommand(
                commands,
                params,
                actionContext,
                attachments,
            );
        } catch (e: any) {
            displayError(`ERROR: ${e.message}`, actionContext);
            debugCommandExecError(e.stack);
        }
    } finally {
        actionContext.profiler?.stop();
        actionContext.profiler = undefined;
        closeActionContext();
    }
}
