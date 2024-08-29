// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionAction } from "../../translation/system/sessionActionSchema.js";
import { DispatcherAction, ActionContext } from "@typeagent/agent-sdk";

export async function executeSessionAction(
    action: DispatcherAction,
    context: ActionContext,
) {
    const sessionAction = action as SessionAction;
    switch (sessionAction.actionName) {
        case "new":
            await context.sessionContext.issueCommand(
                `@session new ${sessionAction.parameters.name ?? ""}`,
            );
            break;
        case "list":
            await context.sessionContext.issueCommand("@session list");
            break;
        case "showInfo":
            await context.sessionContext.issueCommand("@session info");
            break;
        case "toggleHistory":
            await context.sessionContext.issueCommand(
                `@session history ${sessionAction.parameters.enable ? "on" : "off"}`,
            );
            break;
        default:
            throw new Error(`Invalid action name: ${action.actionName}`);
    }
    return undefined;
}
