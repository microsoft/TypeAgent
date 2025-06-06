// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { processCommandNoLock } from "../../../command/command.js";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { SessionAction } from "../schema/sessionActionSchema.js";
import { ActionContext, TypeAgentAction } from "@typeagent/agent-sdk";

export async function executeSessionAction(
    action: TypeAgentAction<SessionAction>,
    context: ActionContext<CommandHandlerContext>,
) {
    switch (action.actionName) {
        case "newSession":
            await processCommandNoLock(
                `@session new ${action.parameters.name ?? ""}`,
                context.sessionContext.agentContext,
            );
            break;
        case "listSession":
            await processCommandNoLock(
                "@session list",
                context.sessionContext.agentContext,
            );
            break;
        case "showSessionInfo":
            await processCommandNoLock(
                "@session info",
                context.sessionContext.agentContext,
            );
            break;
        default:
            throw new Error(
                `Invalid action name: ${(action as TypeAgentAction).actionName}`,
            );
    }
    return undefined;
}
