// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Action, Actions } from "agent-cache";
import {
    CommandHandlerContext,
    changeContextConfig,
    getAppAgent,
} from "../handlers/common/commandHandlerContext.js";
import registerDebug from "debug";
import { getAppAgentName } from "../translation/agentTranslators.js";
import {
    ActionIO,
    createTurnImpressionFromLiteral,
    AppAgent,
    SessionContext,
    AppAgentIO,
    TurnImpression,
    turnImpressionToString,
    DynamicDisplay,
    DisplayType,
} from "@typeagent/agent-sdk";
import { processCommandNoLock } from "../command.js";
import { MatchResult } from "agent-cache";
import { getStorage } from "./storageImpl.js";
import { getUserProfileDir } from "../utils/userData.js";

const debugActions = registerDebug("typeagent:actions");

export async function initializeActionContext(agents: Map<string, AppAgent>) {
    return Object.fromEntries(
        await Promise.all(
            Array.from(agents.entries()).map(async ([name, agent]) => [
                name,
                await agent.initializeAgentContext?.(),
            ]),
        ),
    );
}

function getActionContext(
    name: string,
    context: CommandHandlerContext,
    actionIndex: number,
) {
    const sessionContext = getSessionContext(name, context);
    const actionIO: ActionIO = {
        get type() {
            return sessionContext.agentIO.type;
        },
        setActionDisplay(content: string): void {
            sessionContext.agentIO.setActionStatus(content, actionIndex);
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
    };
}

function getSessionContext(
    name: string,
    context: CommandHandlerContext,
): SessionContext {
    return (
        context.sessionContext.get(name) ?? createSessionContext(name, context)
    );
}

function createSessionContext(
    name: string,
    context: CommandHandlerContext,
): SessionContext {
    const sessionDirPath = context.session.getSessionDirPath();
    const storage = sessionDirPath
        ? getStorage(name, sessionDirPath)
        : undefined;
    const profileStorage = getStorage(name, getUserProfileDir());
    const agentIO: AppAgentIO = {
        get type() {
            return context.requestIO.type;
        },
        status(message: string) {
            context.requestIO.status(message);
        },
        success(message: string) {
            context.requestIO.success(message);
        },
        setActionStatus(message: string, actionIndex: number) {
            context.requestIO.setActionStatus(message, actionIndex, name);
        },
    };
    const agentContext: SessionContext = {
        get agentContext() {
            return context.action[name];
        },
        get agentIO() {
            return agentIO;
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
    const appAgentName = getAppAgentName(translatorName);
    const appAgent = getAppAgent(appAgentName, context);
    await appAgent.updateAgentContext?.(
        enable,
        getSessionContext(appAgentName, context),
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
    const appAgent = getAppAgent(appAgentName, context);
    if (appAgent.getDynamicDisplay === undefined) {
        throw new Error(`Dynamic display not supported by '${appAgentName}'`);
    }
    const sessionContext = getSessionContext(appAgentName, context);
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
    const appAgent = getAppAgent(appAgentName, context);

    // Update the current translator.
    context.currentTranslatorName = translatorName;

    if (appAgent.executeAction === undefined) {
        throw new Error(
            `Agent ${appAgentName} does not support executeAction.`,
        );
    }
    const actionContext = getActionContext(appAgentName, context, actionIndex);
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
        context.requestIO.error(result.error);
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
                appAgentName,
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
            result.impressionInterpreter,
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
        const appAgent = getAppAgent(appAgentName, context);
        const sessionContext = getSessionContext(appAgentName, context);
        if (
            (await appAgent.validateWildcardMatch?.(action, sessionContext)) ===
            false
        ) {
            return false;
        }
    }
    return true;
}

export function streamPartialAction(
    translatorName: string,
    actionName: string,
    name: string,
    value: string,
    partial: boolean,
    context: CommandHandlerContext,
) {
    const appAgentName = getAppAgentName(translatorName);
    const appAGent = getAppAgent(appAgentName, context);
    const sessionContext = getSessionContext(appAgentName, context);
    if (appAGent.streamPartialAction === undefined) {
        // The config declared that there are streaming action, but the agent didn't implement it.
        throw new Error(
            `Agent ${appAgentName} does not support streamPartialAction.`,
        );
    }

    appAGent.streamPartialAction(
        actionName,
        name,
        value,
        partial,
        sessionContext,
    );
}
