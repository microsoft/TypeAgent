// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Action, Actions } from "agent-cache";
import { CommandHandlerContext } from "../handlers/common/commandHandlerContext.js";
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
} from "@typeagent/agent-sdk";
import {
    createActionResult,
    actionResultToString,
} from "@typeagent/agent-sdk/helpers/action";
import {
    displayError,
    displayStatus,
} from "@typeagent/agent-sdk/helpers/display";
import { MatchResult } from "agent-cache";
import { getStorage } from "./storageImpl.js";
import { getUserProfileDir } from "../utils/userData.js";
import { IncrementalJsonValueCallBack } from "../../../commonUtils/dist/incrementalJsonParser.js";
import { ProfileNames } from "../utils/profileNames.js";
import { conversation } from "knowledge-processor";

const debugActions = registerDebug("typeagent:dispatcher:actions");

export function getTranslatorPrefix(
    translatorName: string,
    systemContext: CommandHandlerContext,
) {
    const config = systemContext.agents.getTranslatorConfig(translatorName);
    return `[${config.emojiChar} ${translatorName}] `;
}

function getActionContext(
    appAgentName: string,
    systemContext: CommandHandlerContext,
    requestId: string,
    actionIndex?: number,
) {
    let context = systemContext;
    const sessionContext = context.agents.getSessionContext(appAgentName);
    const actionIO: ActionIO = {
        get type() {
            return context.requestIO.type;
        },
        setDisplay(content: DisplayContent): void {
            context.requestIO.setDisplay(content, actionIndex, appAgentName);
        },
        appendDisplay(
            content: DisplayContent,
            mode: DisplayAppendMode = "inline",
        ): void {
            context.requestIO.appendDisplay(
                content,
                actionIndex,
                appAgentName,
                mode,
            );
        },
        takeAction(action: string): void {
            context.requestIO.takeAction(action);
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

async function executeAction(
    action: Action,
    context: ActionContext<CommandHandlerContext>,
    actionIndex: number,
): Promise<ActionResult | undefined> {
    const translatorName = action.translatorName;

    if (translatorName === undefined) {
        throw new Error(`Cannot execute action without translator name.`);
    }

    const systemContext = context.sessionContext.agentContext;
    const appAgentName = getAppAgentName(translatorName);
    const appAgent = systemContext.agents.getAppAgent(appAgentName);

    // Update the last action translator.
    systemContext.lastActionTranslatorName = translatorName;

    if (appAgent.executeAction === undefined) {
        throw new Error(
            `Agent ${appAgentName} does not support executeAction.`,
        );
    }

    // Reuse the same streaming action context if one is available.
    const { actionContext, closeActionContext } =
        actionIndex === 0 && systemContext.streamingActionContext
            ? systemContext.streamingActionContext
            : getActionContext(
                  appAgentName,
                  systemContext,
                  systemContext.requestId!,
                  actionIndex,
              );

    systemContext.streamingActionContext = undefined;

    actionContext.profiler = systemContext.commandProfiler?.measure(
        ProfileNames.executeAction,
        true,
        actionIndex,
    );
    let returnedResult: ActionResult | undefined;
    try {
        const prefix = getTranslatorPrefix(
            action.translatorName,
            systemContext,
        );
        displayStatus(
            `${prefix}Executing action ${action.fullActionName}`,
            context,
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
        displayError(result.error, context);
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
            systemContext.clientIO?.setDynamicDisplay(
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

export async function executeActions(
    actions: Actions,
    context: ActionContext<CommandHandlerContext>,
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

    const actionContextWithClose = getActionContext(
        appAgentName,
        context,
        context.requestId!,
        0,
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
) {
    const appAgent = context.agents.getAppAgent(appAgentName);
    if (appAgent.executeCommand === undefined) {
        throw new Error(
            `Agent ${appAgentName} does not support executeCommand.`,
        );
    }

    const { actionContext, closeActionContext } = getActionContext(
        appAgentName,
        context,
        context.requestId!,
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
