// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, AppAction } from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { processCommandNoLock } from "../../../command/command.js";
import {
    DeleteHistoryAction,
    HistoryAction,
} from "../schema/historyActionSchema.js";

export async function executeHistoryAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
) {
    const historyAction = action as HistoryAction;
    switch (historyAction.actionName) {
        case "deleteHistory":
            const deleteAction = historyAction as DeleteHistoryAction;
            await processCommandNoLock(
                `@history delete ${deleteAction.parameters.messageNumber}`,
                context.sessionContext.agentContext,
            );
            break;
        case "clearHistory":
            await processCommandNoLock(
                `@history clear`,
                context.sessionContext.agentContext,
            );
            break;
        case "listHistory":
            await processCommandNoLock(
                `@history list`,
                context.sessionContext.agentContext,
            );
            break;
        default:
            throw new Error(`Invalid action name: ${action.actionName}`);
    }
    return undefined;
}
