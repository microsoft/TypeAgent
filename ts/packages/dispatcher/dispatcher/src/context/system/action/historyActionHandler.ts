// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, AppAction } from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { processCommandNoLock } from "../../../command/command.js";
import {
    DeleteHistoryAction,
    HistoryAction,
} from "../schema/historyActionSchema.js";
import { executeCommandFromHandlers } from "@typeagent/agent-sdk/helpers/command";
import { historyCommandHandlers } from "../handlers/historyCommandHandler.js";
import { CommandParams } from "./actionParams.js";

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
        case "saveHistory":
            await executeCommandFromHandlers(
                historyCommandHandlers,
                ["save"],
                {
                    args: { file: historyAction.parameters.file },
                    flags: undefined,
                },
                context,
            );
            break;
        case "insertHistory":
            await executeCommandFromHandlers(
                historyCommandHandlers,
                ["insert"],
                {
                    args: {
                        messages: JSON.parse(
                            historyAction.parameters.messagesJson,
                        ),
                    },
                    flags: undefined,
                } as unknown as CommandParams,
                context,
            );
            break;
        case "listHistoryEntities":
            await executeCommandFromHandlers(
                historyCommandHandlers,
                ["entities", "list"],
                { args: {}, flags: undefined },
                context,
            );
            break;
        case "deleteHistoryEntity":
            await executeCommandFromHandlers(
                historyCommandHandlers,
                ["entities", "delete"],
                {
                    args: { entityId: historyAction.parameters.entityId },
                    flags: undefined,
                },
                context,
            );
            break;
        default:
            throw new Error(`Invalid action name: ${action.actionName}`);
    }
    return undefined;
}
