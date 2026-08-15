// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, TypeAgentAction } from "@typeagent/agent-sdk";

import { processCommandNoLock } from "../../../command/command.js";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { LogAction } from "../schema/logActionSchema.js";

// Keep @log as the canonical implementation so command and natural-language
// behavior cannot drift.
export async function executeLogAction(
    action: TypeAgentAction<LogAction>,
    context: ActionContext<CommandHandlerContext>,
) {
    let command: string;
    switch (action.actionName) {
        case "showLogStatus":
            command = "@log status";
            break;
        case "setLogProfile":
            command = `@log profile ${action.parameters.profile}`;
            break;
        case "setLogDebugCopy":
            command = `@log debug-copy ${action.parameters.enabled ? "on" : "off"}`;
            break;
        case "clearLogSettings":
            command = "@log clear";
            break;
        default:
            throw new Error(
                `Invalid log action: ${(action as TypeAgentAction).actionName}`,
            );
    }

    await processCommandNoLock(command, context.sessionContext.agentContext);
}
