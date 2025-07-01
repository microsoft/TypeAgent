// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import { displayInfo } from "@typeagent/agent-sdk/helpers/display";
import {
    toExecutableActions,
    ExecutableAction,
    FullAction,
    RequestAction,
} from "agent-cache";
import chalk from "chalk";
import { getColorElapsedString } from "common-utils";
import { getActionTemplateEditConfig } from "./actionTemplate.js";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { validateAction } from "action-schema";
import { getActionSchema } from "./actionSchemaFileCache.js";
import { DispatcherName } from "../context/dispatcher/dispatcherUtils.js";

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
        const actionInfo = getActionSchema(action, systemContext.agents);
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
        const messages = [];

        messages.push(
            `${source}: ${chalk.blueBright(
                ` ${requestAction.toString()}`,
            )} ${getColorElapsedString(elapsedMs)}`,
        );
        messages.push();

        const prettyStr = JSON.stringify(actions, undefined, 2);
        messages.push(`${chalk.italic(chalk.cyanBright(prettyStr))}`);
        displayInfo(messages.join("\n"), context);
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
        templateSequence,
        systemContext.requestId,
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
