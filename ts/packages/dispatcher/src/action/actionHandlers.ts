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
} from "dispatcher-agent";
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
        Array.from((await getDispatcherAgents()).entries()).map(
            ([name, agent]) => [name, agent.initializeAgentContext?.()],
        ),
    );
}

function getDispatcherAgentContext(
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
        getAlternativeAgentContext(name: string) {
            return context.action[name];
        },
        getSessionDirPath() {
            return context.session.getSessionDirPath();
        },
        getUpdateActionStatus() {
            return context.clientIO?.updateActionStatus.bind(context.clientIO);
        },
        searchMenuCommand(menuId, command, prefix?, choices?, visible?): void {
            return context.clientIO?.searchMenuCommand(
                menuId,
                command,
                prefix,
                choices,
                visible,
            );
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
    if (!getTranslatorConfig(translatorName).injected) {
        context.currentTranslatorName = translatorName;
    }

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
    const dispatcherAgentName = getDispatcherAgentName(
        context.currentTranslatorName,
    );
    const dispatcherAgent = await getDispatcherAgent(dispatcherAgentName);
    return dispatcherAgent.partialInput?.(
        text,
        getDispatcherAgentContext(dispatcherAgentName, context),
    );
}

export async function executeActions(
    actions: Actions,
    context: CommandHandlerContext,
) {
    debugActions(`Executing actions: ${JSON.stringify(actions, undefined, 2)}`);
    const requestIO = context.requestIO;
    let actionIndex = 0;
    for (const action of actions) {
        const result =
            (await executeAction(action, context, actionIndex)) ??
            createTurnImpressionFromLiteral(`
                Action ${action.fullActionName} completed.`);
        if (debugActions.enabled) {
            debugActions(turnImpressionToString(result));
        }
        if (result.error !== undefined) {
            requestIO.error(result.error);
            context.chatHistory.addEntry(
                `Action ${action.fullActionName} failed: ${result.error}`,
                [],
                "assistant",
                requestIO.getRequestId(),
            );
        } else {
            requestIO.setActionStatus(result.displayText, actionIndex, context.currentTranslatorName);
            context.chatHistory.addEntry(
                result.literalText
                    ? result.literalText
                    : `Action ${action.fullActionName} completed.`,
                result.entities,
                "assistant",
                requestIO.getRequestId(),
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
