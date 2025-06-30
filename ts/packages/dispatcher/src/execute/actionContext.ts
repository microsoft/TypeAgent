// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionIO,
    DisplayContent,
    ActionContext,
    DisplayAppendMode,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { makeClientIOMessage } from "../context/interactiveIO.js";

export type ActionContextWithClose = {
    actionContext: ActionContext<unknown>;
    actionIndex: number | undefined;
    closeActionContext: () => void;
};

export function getActionContext(
    appAgentName: string,
    systemContext: CommandHandlerContext,
    requestId: string,
    actionIndex?: number,
    action?: TypeAgentAction | string[],
): ActionContextWithClose {
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
        appendDiagnosticData(data): void {
            context.clientIO.appendDiagnosticData(requestId, data);
        },
    };
    const actionContext: ActionContext<unknown> = {
        streamingContext: undefined,
        activityContext:
            // Only make activityContext available if the action is from the same agent.
            context.activityContext?.appAgentName === appAgentName
                ? structuredClone(context.activityContext)
                : undefined,
        get sessionContext() {
            return sessionContext;
        },
        get actionIO() {
            return actionIO;
        },
        async queueToggleTransientAgent(subAgentName: string, active: boolean) {
            if (!subAgentName.startsWith(`${appAgentName}.`)) {
                throw new Error(`Invalid sub agent name: ${subAgentName}`);
            }
            const state = context.agents.getTransientState(subAgentName);
            if (state === undefined) {
                throw new Error(
                    `Transient sub agent not found: ${subAgentName}`,
                );
            }
            context.pendingToggleTransientAgents.push([subAgentName, active]);
        },
    };
    return {
        actionContext,
        actionIndex,
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
    for (const [name] of Object.entries(descriptors)) {
        // TODO: Note this doesn't prevent the function continue to be call if is saved.
        Object.defineProperty(o, name, {
            get: () => {
                throw new Error("Context is closed.");
            },
        });
    }
}
