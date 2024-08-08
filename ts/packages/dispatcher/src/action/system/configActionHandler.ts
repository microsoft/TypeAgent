// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ConfigAction } from "../../translation/system/configActionSchema.js";
import { DispatcherAgentContext, DispatcherAction } from "dispatcher-agent";

export async function executeConfigAction(
    action: DispatcherAction,
    context: DispatcherAgentContext<undefined>,
) {
    const configAction = action as unknown as ConfigAction;
    switch (configAction.actionName) {
        case "toggleBot":
            await context.issueCommand(
                `@config bot ${configAction.parameters.enable ? "on" : "off"}`,
            );
            break;

        case "toggleExplanation":
            await context.issueCommand(
                `@config explanation ${configAction.parameters.enable ? "on" : "off"}`,
            );
            break;

        case "toggleDeveloperMode":
            await context.issueCommand(
                `@config dev ${configAction.parameters.enable ? "on" : "off"}`,
            );
            break;

        default:
            throw new Error(`Invalid action name: ${action.actionName}`);
    }
    return undefined;
}
