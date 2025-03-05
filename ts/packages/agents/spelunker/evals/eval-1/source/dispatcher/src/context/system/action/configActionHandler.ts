// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { processCommandNoLock } from "../../../command/command.js";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { ConfigAction } from "../schema/configActionSchema.js";
import { AppAction, ActionContext } from "@typeagent/agent-sdk";

export async function executeConfigAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
) {
    const configAction = action as unknown as ConfigAction;
    switch (configAction.actionName) {
        case "listAgents":
            await processCommandNoLock(
                `@config agent`,
                context.sessionContext.agentContext,
            );
            break;
        case "toggleAgent":
            const cmdParam: string = configAction.parameters.enable
                ? ``
                : `--off`;

            await processCommandNoLock(
                `@config agent ${cmdParam} ${configAction.parameters.agentNames.join(" ")}`,
                context.sessionContext.agentContext,
            );
            break;

        case "toggleExplanation":
            await processCommandNoLock(
                `@config explainer ${configAction.parameters.enable ? "on" : "off"}`,
                context.sessionContext.agentContext,
            );
            break;

        case "toggleDeveloperMode":
            await processCommandNoLock(
                `@config dev ${configAction.parameters.enable ? "on" : "off"}`,
                context.sessionContext.agentContext,
            );
            break;

        default:
            throw new Error(`Invalid action name: ${action.actionName}`);
    }
    return undefined;
}
