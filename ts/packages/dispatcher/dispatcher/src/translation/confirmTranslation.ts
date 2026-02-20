// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import {
    toExecutableActions,
    ExecutableAction,
    FullAction,
    RequestAction,
} from "agent-cache";
import { getActionTemplateEditConfig } from "./actionTemplate.js";
import {
    type CommandHandlerContext,
    getRequestId,
} from "../context/commandHandlerContext.js";
import { validateAction } from "@typeagent/action-schema";
import { DispatcherName } from "../context/dispatcher/dispatcherUtils.js";
import { tryGetActionSchema } from "./actionSchemaFileCache.js";

function validateReplaceActions(
    actions: unknown,
    systemContext: CommandHandlerContext,
): actions is FullAction[] {
    if (actions === null) {
        throw new Error("Request cancelled");
    }
    if (actions === undefined) {
        return false;
    }
    if (!Array.isArray(actions)) {
        throw new Error("Invalid replacement");
    }
    for (const action of actions) {
        if (typeof action !== "object") {
            throw new Error("Invalid replacement");
        }
        const actionInfo = tryGetActionSchema(action, systemContext.agents);
        if (actionInfo === undefined) {
            throw new Error("Invalid replacement");
        }

        validateAction(actionInfo, action);
    }

    return true;
}

export async function confirmTranslation(
    elapsedMs: number,
    source: string,
    requestAction: RequestAction,
    context: ActionContext<CommandHandlerContext>,
): Promise<{
    requestAction: RequestAction;
    replacedAction?: ExecutableAction[];
}> {
    const actions = requestAction.actions;
    const systemContext = context.sessionContext.agentContext;
    if (!systemContext.developerMode || systemContext.batchMode) {
        // Non-developer mode: skip inline display of translation result.
        // Action data is still accessible via the clickable label above the bubble.
        return { requestAction };
    }
    const preface =
        "Use the buttons to run or cancel the following action(s). You can also press [Enter] to run it, [Del] to edit it, or [Escape] to cancel it.";
    const editPreface = `Edit the following action(s) to match your requests.  Click on the values to start editing. Use the ➕/✕ buttons to add/delete optional fields.`;

    const templateSequence = getActionTemplateEditConfig(
        systemContext,
        actions,
        preface,
        editPreface,
    );

    const newActions = await systemContext.clientIO.proposeAction(
        getRequestId(systemContext),
        templateSequence,
        DispatcherName,
    );

    return validateReplaceActions(newActions, systemContext)
        ? {
              requestAction: new RequestAction(
                  requestAction.request,
                  toExecutableActions(newActions),
                  requestAction.history,
              ),
              replacedAction: actions,
          }
        : { requestAction };
}
