// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, AppAction } from "@typeagent/agent-sdk";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { processCommandNoLock } from "../../../command/command.js";
import { DescribeAction } from "../schema/describeActionSchema.js";

// Quote a value for interpolation into a `@describe` command string,
// escaping backslashes and embedded double quotes so free-form LLM-extracted
// names can't break out of the quoted token (see parameters.ts's tokenizer).
function quoteArg(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Forwards to the `@describe` command, following the same convention as the
// other system NL handlers (e.g. configActionHandler.ts, historyActionHandler.ts):
// the command is the single shared implementation; the NL path just builds
// the equivalent command string. The command appends the rendered markdown
// itself, so we return a no-display result — returning undefined would make
// the dispatcher tack on a generic "Action <name> completed." message
// (actionHandlers.ts), which is just noise on top of the real output.
export async function executeDescribeAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
) {
    const nlAction = action as unknown as DescribeAction;
    switch (nlAction.actionName) {
        case "describeAgent": {
            const { agentName, all } = nlAction.parameters;
            await processCommandNoLock(
                `@describe ${quoteArg(agentName)}${all ? " --all" : ""}`,
                context.sessionContext.agentContext,
            );
            return createActionResultNoDisplay(
                `Described the "${agentName}" agent.`,
            );
        }
        case "describeAction": {
            const { actionName, agentName } = nlAction.parameters;
            const command =
                agentName !== undefined
                    ? `@describe ${quoteArg(agentName)} ${quoteArg(actionName)}`
                    : `@describe ${quoteArg(actionName)}`;
            await processCommandNoLock(
                command,
                context.sessionContext.agentContext,
            );
            return createActionResultNoDisplay(
                `Described the "${actionName}" action.`,
            );
        }
        default:
            throw new Error(
                `Invalid action name: ${(action as { actionName: string }).actionName}`,
            );
    }
}
