// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, AppAction } from "@typeagent/agent-sdk";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import type { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    describeAction,
    describeAgentOrAction,
} from "../describe/describeCore.js";
import type { DescribeAction } from "../schema/describeActionSchema.js";

// Renders agent/action capability discovery for the NL path. Both entry points
// (this handler and the `@describe` command in describeCommandHandlers.ts) call
// the shared describeCore implementation directly and append the rendered
// markdown themselves. We return a no-display result because the markdown is
// already appended above — returning undefined would make the dispatcher tack on
// a generic "Action <name> completed." message (actionHandlers.ts), which is
// just noise on top of the real output.
export async function executeDescribeAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
) {
    const nlAction = action as unknown as DescribeAction;
    const systemContext = context.sessionContext.agentContext;
    let markdown: string;
    let historyText: string;
    switch (nlAction.actionName) {
        case "describeAgent": {
            const { agentName, all } = nlAction.parameters;
            markdown = await describeAgentOrAction(
                systemContext,
                agentName,
                all ?? false,
            );
            historyText = `Described the "${agentName}" agent.`;
            break;
        }
        case "describeAction": {
            const { actionName, agentName } = nlAction.parameters;
            markdown = await describeAction(
                systemContext,
                actionName,
                agentName,
            );
            historyText = `Described the "${actionName}" action.`;
            break;
        }
        default:
            throw new Error(
                `Invalid action name: ${(action as { actionName: string }).actionName}`,
            );
    }
    context.actionIO.appendDisplay({ type: "markdown", content: markdown });
    return createActionResultNoDisplay(historyText);
}
