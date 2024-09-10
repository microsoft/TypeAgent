// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Action, Actions } from "agent-cache";
import {
    closeCommandHandlerContext,
    CommandHandlerContext,
} from "../handlers/common/commandHandlerContext.js";
import registerDebug from "debug";
import { getAppAgentName } from "../translation/agentTranslators.js";
import {
    ActionIO,
    createTurnImpressionFromLiteral,
    AppAgentEvent,
    SessionContext,
    TurnImpression,
    turnImpressionToString,
    DynamicDisplay,
    DisplayType,
    AppAgent,
} from "@typeagent/agent-sdk";
import { MatchResult } from "agent-cache";
import { getStorage } from "./storageImpl.js";
import { getUserProfileDir } from "../utils/userData.js";
import { Profiler } from "common-utils";
import { CommandHandlerBase } from "../handlers/common/commandHandlerBase.js";

const debugAgent = registerDebug("typeagent:agent");
const debugActions = registerDebug("typeagent:actions");

function getActionContext(
    appAgentName: string,
    context: CommandHandlerContext,
    requestId: string,
    actionIndex: number,
) {
    const sessionContext = context.agents.getSessionContext(appAgentName);
    const actionIO: ActionIO = {
        get type() {
            return context.requestIO.type;
        },
        setActionDisplay(content: string): void {
            context.requestIO.setActionDisplay(
                content,
                actionIndex,
                appAgentName,
            );
        },
    };
    return {
        get agentContext() {
            return sessionContext.agentContext;
        },
        get sessionStorage() {
            return sessionContext.sessionStorage;
        },
        get profileStorage() {
            return sessionContext.profileStorage;
        },
        get sessionContext() {
            return sessionContext;
        },
        get actionIO() {
            return actionIO;
        },
        performanceMark(markName: string) {
            Profiler.getInstance().mark(requestId, markName);
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
        notify(event: AppAgentEvent, data: any) {
            context.requestIO.notify(event, data, name);
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

export async function partialInput(
    text: string,
    context: CommandHandlerContext,
) {
    // For auto completion
    throw new Error("NYI");
}

export async function getDynamicDisplay(
    appAgentName: string,
    type: DisplayType,
    displayId: string,
    context: CommandHandlerContext,
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
): Promise<TurnImpression | undefined> {
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
    const actionContext = getActionContext(
        appAgentName,
        context,
        context.requestId!,
        actionIndex,
    );
    const returnedResult: TurnImpression | undefined =
        await appAgent.executeAction(action, actionContext);

    let result: TurnImpression;
    if (returnedResult === undefined) {
        result = createTurnImpressionFromLiteral(
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
        debugActions(turnImpressionToString(result));
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
        actionContext.actionIO.setActionDisplay(result.displayText);
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
) {
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

    return (name: string, value: string, partial: boolean) => {
        appAgent.streamPartialAction!(
            actionName,
            name,
            value,
            partial,
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
        -1,
    );
    const appAgent = context.agents.getAppAgent(appAgentName);
    if (appAgent.executeCommand === undefined) {
        throw new Error(
            `Agent ${appAgentName} does not support executeCommand.`,
        );
    }
    return appAgent.executeCommand(command, args, actionContext, attachments);
}
