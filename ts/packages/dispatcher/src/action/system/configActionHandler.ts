// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ConfigAction } from "../../translation/system/configActionSchema.js";
import { AppAction, ActionContext } from "@typeagent/agent-sdk";

export async function executeConfigAction(
    action: AppAction,
    context: ActionContext,
) {
    const configAction = action as unknown as ConfigAction;
    switch (configAction.actionName) {
        case "toggleBot":
            await context.sessionContext.issueCommand(
                `@config bot ${configAction.parameters.enable ? "on" : "off"}`,
            );
            break;

        case "toggleExplanation":
            await context.sessionContext.issueCommand(
                `@config explanation ${configAction.parameters.enable ? "on" : "off"}`,
            );
            break;

        case "toggleDeveloperMode":
            await context.sessionContext.issueCommand(
                `@config dev ${configAction.parameters.enable ? "on" : "off"}`,
            );
            break;

        default:
            throw new Error(`Invalid action name: ${action.actionName}`);
    }
    return undefined;
}
