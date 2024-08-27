// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Actions } from "agent-cache";
import {
    CommandHandlerContext,
    changeContextConfig,
} from "../handlers/common/commandHandlerContext.js";
import registerDebug from "debug";
import {
    getDispatcherAgentName,
    getTranslatorConfig,
} from "../translation/agentTranslators.js";
import {
    createTurnImpressionFromLiteral,
    DispatcherAction,
    DispatcherAgentContext,
    TurnImpression,
    turnImpressionToString,
} from "@typeagent/agent-sdk";
import {
    getDispatcherAgent,
    getDispatcherAgents,
} from "../agent/agentConfig.js";
import { processCommandNoLock } from "../command.js";
import { MatchResult } from "agent-cache";
import { getStorage } from "./storageImpl.js";
import { getUserProfileDir } from "../utils/userData.js";

const debugActions = registerDebug("typeagent:actions");

export async function initializeActionContext() {
    return Object.fromEntries(
        await Promise.all(
            Array.from((await getDispatcherAgents()).entries()).map(
                async ([name, agent]) => [
                    name,
                    await agent.initializeAgentContext?.(),
                ],
            ),
        ),
    );
}

function getDispatcherAgentContext(
    name: string,
    context: CommandHandlerContext,
): DispatcherAgentContext {
    return (
        context.sessionContext.get(name) ??
        createDispatcherAgentContext(name, context)
    );
}

function createDispatcherAgentContext(
    name: string,
    context: CommandHandlerContext,
): DispatcherAgentContext {
    const sessionDirPath = context.session.getSessionDirPath();
    const storage = sessionDirPath
        ? getStorage(name, sessionDirPath)
        : undefined;
    const profileStorage = getStorage(name, getUserProfileDir());
    const agentContext: DispatcherAgentContext = {
        get context() {
            return context.action[name];
        },
        get requestIO() {
            return context.requestIO;
        },
        get requestId() {
            return context.requestId;
        },
        get currentTranslatorName() {
            return context.currentTranslatorName;
        },
        get sessionStorage() {
            return storage;
        },
        get profileStorage() {
            return profileStorage;
        },
        set currentTranslatorName(value: string) {
            context.currentTranslatorName = value;
        },
        issueCommand(command: string) {
            return processCommandNoLock(command, context);
        },
        getUpdateActionStatus() {
            return context.clientIO?.updateActionStatus.bind(context.clientIO);
        },
        async toggleAgent(name: string, enable: boolean) {
            await changeContextConfig(
                {
                    translators: { [name]: enable },
                    actions: { [name]: enable },
                },
                context,
            );
        },
    };
    (agentContext as any).conversationManager = context.conversationManager;
    context.sessionContext.set(name, agentContext);
    return agentContext;
}

export async function updateActionContext(
    changed: { [key: string]: boolean },
    context: CommandHandlerContext,
) {
    const newChanged = { ...changed };
    const failed: any = {};
    const entries = Object.entries(changed);
    for (const [translatorName, enable] of entries) {
        try {
            await updateAgentContext(translatorName, enable, context);
        } catch (e: any) {
            context.requestIO.error(
                `[${translatorName}]: Failed to ${enable ? "enable" : "disable"} action: ${e.message}`,
            );
            failed[translatorName] = !enable;
            delete newChanged[translatorName];
        }
    }
    const failedCount = Object.keys(failed).length;
    if (failedCount !== 0) {
        context.session.setConfig({ actions: failed });
    }

    return entries.length === failedCount ? undefined : newChanged;
}

async function updateAgentContext(
    translatorName: string,
    enable: boolean,
    context: CommandHandlerContext,
) {
    const dispatcherAgentName = getDispatcherAgentName(translatorName);
    const dispatcherAgent = await getDispatcherAgent(dispatcherAgentName);
    await dispatcherAgent.updateAgentContext?.(
        enable,
        getDispatcherAgentContext(dispatcherAgentName, context),
        translatorName,
    );
}

export async function closeActionContext(context: CommandHandlerContext) {
    for (const [name, enabled] of Object.entries(context.action)) {
        if (enabled) {
            try {
                await updateAgentContext(name, false, context);
            } catch {}
        }
    }
}

async function executeAction(
    action: DispatcherAction,
    context: CommandHandlerContext,
    actionIndex: number,
): Promise<TurnImpression | undefined> {
    const translatorName = action.translatorName;

    if (translatorName === undefined) {
        throw new Error(`Cannot execute action without translator name.`);
    }
    const dispatcherAgentName = getDispatcherAgentName(translatorName);
    const dispatcherAgent = await getDispatcherAgent(dispatcherAgentName);

    // Update the current translator.
    context.currentTranslatorName = translatorName;

    if (dispatcherAgent.executeAction === undefined) {
        throw new Error(
            `Agent ${dispatcherAgentName} does not support executeAction.`,
        );
    }
    return dispatcherAgent.executeAction(
        action,
        getDispatcherAgentContext(dispatcherAgentName, context),
        actionIndex,
    );
}

export async function partialInput(
    text: string,
    context: CommandHandlerContext,
) {
    // For auto completion
    throw new Error("NYI");
}

export async function executeActions(
    actions: Actions,
    context: CommandHandlerContext,
) {
    debugActions(`Executing actions: ${JSON.stringify(actions, undefined, 2)}`);
    const requestIO = context.requestIO;
    let actionIndex = 0;
    for (const action of actions) {
        let result: TurnImpression;
        const returnedResult = await executeAction(
            action,
            context,
            actionIndex,
        );
        if (returnedResult === undefined) {
            result = createTurnImpressionFromLiteral(`
                Action ${action.fullActionName} completed.`);
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
            requestIO.error(result.error);
            context.chatHistory.addEntry(
                `Action ${action.fullActionName} failed: ${result.error}`,
                [],
                "assistant",
                context.requestId,
            );
        } else {
            requestIO.setActionStatus(
                result.displayText,
                actionIndex,
                context.currentTranslatorName,
            );
            context.chatHistory.addEntry(
                result.literalText
                    ? result.literalText
                    : `Action ${action.fullActionName} completed.`,
                result.entities,
                "assistant",
                context.requestId,
                result.impressionInterpreter,
            );
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
        const dispatcherAgentName = getDispatcherAgentName(translatorName);
        const dispatcherAgent = await getDispatcherAgent(dispatcherAgentName);
        const dispatcherContext = getDispatcherAgentContext(
            dispatcherAgentName,
            context,
        );
        if (
            (await dispatcherAgent.validateWildcardMatch?.(
                action,
                dispatcherContext,
            )) === false
        ) {
            return false;
        }
    }
    return true;
}
