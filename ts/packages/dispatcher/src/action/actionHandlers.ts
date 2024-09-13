// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Action, Actions } from "agent-cache";
import { CommandHandlerContext } from "../handlers/common/commandHandlerContext.js";
import registerDebug from "debug";
import { getAppAgentName } from "../translation/agentTranslators.js";
import {
    ActionIO,
    createActionResult,
    AppAgentEvent,
    SessionContext,
    ActionResult,
    actionResultToString,
    DynamicDisplay,
    DisplayType,
    DisplayContent,
    ActionContext,
} from "@typeagent/agent-sdk";
import { MatchResult } from "agent-cache";
import { getStorage } from "./storageImpl.js";
import { getUserProfileDir } from "../utils/userData.js";
import { IncrementalJsonValueCallBack } from "../../../commonUtils/dist/incrementalJsonParser.js";
import { ProfileNames } from "../utils/profileNames.js";

const debugAgent = registerDebug("typeagent:agent");
const debugActions = registerDebug("typeagent:actions");

function getActionContext(
    appAgentName: string,
    context: CommandHandlerContext,
    requestId: string,
    actionIndex: number,
): ActionContext<unknown> {
    const sessionContext = context.agents.getSessionContext(appAgentName);
    const actionIO: ActionIO = {
        get type() {
            return context.requestIO.type;
        },
        setDisplay(content: DisplayContent): void {
            context.requestIO.setDisplay(content, actionIndex, appAgentName);
        },
        appendDisplay(content: DisplayContent): void {
            context.requestIO.appendDisplay(content, actionIndex, appAgentName);
        },
    };
    return {
        streamingContext: undefined,
        get sessionContext() {
            return sessionContext;
        },
        get actionIO() {
            return actionIO;
        },
    };
}

export function createSessionContext<T = unknown>(
    name: string,
    agentContext: T,
    context: CommandHandlerContext,
): SessionContext<T> {
    const sessionDirPath = context.session.getSessionDirPath();
    const storage = sessionDirPath
        ? getStorage(name, sessionDirPath)
        : undefined;
    const profileStorage = getStorage(name, getUserProfileDir());
    const sessionContext: SessionContext<T> = {
        get agentContext() {
            return agentContext;
        },
        get sessionStorage() {
            return storage;
        },
        get profileStorage() {
            return profileStorage;
        },
        notify(event: AppAgentEvent, message: string) {
            context.requestIO.notify(event, undefined, message, name);
        },
        async toggleTransientAgent(subAgentName: string, enable: boolean) {
            if (!subAgentName.startsWith(`${name}.`)) {
                throw new Error(`Invalid sub agent name: ${subAgentName}`);
            }
            if (context.transientAgents[subAgentName] === undefined) {
                throw new Error(
                    `Transient sub agent not found: ${subAgentName}`,
                );
            }

            if (context.transientAgents[subAgentName] === enable) {
                return;
            }

            // acquire the lock to prevent change the state while we are processing a command.
            // WARNING: deadlock if this is call because we are processing a request
            return context.commandLock(async () => {
                debugAgent(
                    `Toggle transient agent: ${subAgentName} to ${enable}`,
                );
                context.transientAgents[subAgentName] = enable;
                // Because of the embedded switcher, we need to clear the cache.
                context.translatorCache.clear();
                if (enable) {
                    // REVIEW: is switch current translator the right behavior?
                    context.lastActionTranslatorName = subAgentName;
                } else if (context.lastActionTranslatorName === subAgentName) {
                    context.lastActionTranslatorName = name;
                }
            });
        },
    };
    (sessionContext as any).conversationManager = context.conversationManager;
    return sessionContext;
}

export async function getDynamicDisplay(
    context: CommandHandlerContext,
    appAgentName: string,
    type: DisplayType,
    displayId: string,
): Promise<DynamicDisplay> {
    const appAgent = context.agents.getAppAgent(appAgentName);
    if (appAgent.getDynamicDisplay === undefined) {
        throw new Error(`Dynamic display not supported by '${appAgentName}'`);
    }
    const sessionContext = context.agents.getSessionContext(appAgentName);
    return appAgent.getDynamicDisplay(type, displayId, sessionContext);
}

async function executeAction(
    action: Action,
    context: CommandHandlerContext,
    actionIndex: number,
): Promise<ActionResult | undefined> {
    const translatorName = action.translatorName;

    if (translatorName === undefined) {
        throw new Error(`Cannot execute action without translator name.`);
    }
    const appAgentName = getAppAgentName(translatorName);
    const appAgent = context.agents.getAppAgent(appAgentName);

    // Update the last action translator.
    context.lastActionTranslatorName = translatorName;

    if (appAgent.executeAction === undefined) {
        throw new Error(
            `Agent ${appAgentName} does not support executeAction.`,
        );
    }

    // Reuse the same streaming action context if one is available.
    const actionContext =
        actionIndex === 0 && context.streamingActionContext
            ? context.streamingActionContext
            : getActionContext(
                  appAgentName,
                  context,
                  context.requestId!,
                  actionIndex,
              );

    actionContext.profiler = context.commandProfiler?.measure(
        ProfileNames.executeAction,
        true,
        actionIndex,
    );
    let returnedResult: ActionResult | undefined;
    try {
        context.requestIO.status(
            `Executing action ${action.fullActionName}`,
            action.translatorName,
        );
        returnedResult = await appAgent.executeAction(action, actionContext);
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
            context.conversationManager
        ) {
            // TODO: convert entity values to facets
            context.conversationManager.addMessage(
                returnedResult.literalText,
                returnedResult.entities,
                new Date(),
            );
        }
        result = returnedResult;
    }
    if (debugActions.enabled) {
        debugActions(actionResultToString(result));
    }
    if (result.error !== undefined) {
        context.requestIO.error(result.error, translatorName);
        context.chatHistory.addEntry(
            `Action ${action.fullActionName} failed: ${result.error}`,
            [],
            "assistant",
            context.requestId,
        );
    } else {
        if (result.displayContent !== undefined) {
            actionContext.actionIO.setDisplay(result.displayContent);
        }
        if (result.dynamicDisplayId !== undefined) {
            context.clientIO?.setDynamicDisplay(
                translatorName,
                context.requestId,
                actionIndex,
                result.dynamicDisplayId,
                result.dynamicDisplayNextRefreshMs!,
            );
        }
        context.chatHistory.addEntry(
            result.literalText
                ? result.literalText
                : `Action ${action.fullActionName} completed.`,
            result.entities,
            "assistant",
            context.requestId,
        );
    }
    return result;
}

export async function executeActions(
    actions: Actions,
    context: CommandHandlerContext,
) {
    debugActions(`Executing actions: ${JSON.stringify(actions, undefined, 2)}`);
    let actionIndex = 0;
    for (const action of actions) {
        await executeAction(action, context, actionIndex);
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

    const actionContext = getActionContext(
        appAgentName,
        context,
        context.requestId!,
        0,
    );

    context.streamingActionContext = actionContext;

    return (name: string, value: any, delta?: string) => {
        appAgent.streamPartialAction!(
            actionName,
            name,
            value,
            delta,
            actionContext,
        );
    };
}

export async function executeCommand(
    command: string[] | undefined,
    args: string,
    appAgentName: string,
    context: CommandHandlerContext,
    attachments?: string[],
) {
    const actionContext = getActionContext(
        appAgentName,
        context,
        context.requestId!,
        0,
    );

    const appAgent = context.agents.getAppAgent(appAgentName);
    if (appAgent.executeCommand === undefined) {
        throw new Error(
            `Agent ${appAgentName} does not support executeCommand.`,
        );
    }

    actionContext.profiler = context.commandProfiler?.measure(
        ProfileNames.executeCommand,
        true,
    );

    try {
        return await appAgent.executeCommand(
            command,
            args,
            actionContext,
            attachments,
        );
    } finally {
        actionContext.profiler?.stop();
        actionContext.profiler = undefined;
    }
}
