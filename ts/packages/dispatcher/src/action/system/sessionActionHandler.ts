// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionAction } from "../../translation/system/sessionActionSchema.js";
import { DispatcherAgentContext, DispatcherAction } from "dispatcher-agent";

export async function executeSessionAction(
    action: DispatcherAction,
    context: DispatcherAgentContext<undefined>,
) {
    const sessionAction = action as SessionAction;
    switch (sessionAction.actionName) {
        case "new":
            await context.issueCommand(
                `@session new ${sessionAction.parameters.name ?? ""}`,
            );
            break;
        case "list":
            await context.issueCommand("@session list");
            break;
        case "showInfo":
            await context.issueCommand("@session info");
            break;
        case "toggleHistory":
            await context.issueCommand(
                `@session history ${sessionAction.parameters.enable ? "on" : "off"}`,
            );
            break;
        default:
            throw new Error(`Invalid action name: ${action.actionName}`);
    }
    return undefined;
}
