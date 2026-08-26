// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ActionResult, AppAction } from "@typeagent/agent-sdk";
import type { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    DeleteHistoryAction,
    HistoryAction,
} from "../schema/historyActionSchema.js";
import {
    CommandHandlerTable,
    executeCommandFromHandlers,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandParams } from "./actionParams.js";

// The command table is passed in rather than imported: importing it here would
// make this module depend on the command tree, which depends back on the system
// agent that dispatches these actions.
export async function executeHistoryAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
    handlers: CommandHandlerTable,
): Promise<ActionResult | undefined> {
    const historyAction = action as HistoryAction;
    const execute = (commands: string[], params?: CommandParams) =>
        executeCommandFromHandlers(handlers, commands, params, context);

    switch (historyAction.actionName) {
        case "deleteHistory": {
            const deleteAction = historyAction as DeleteHistoryAction;
            return execute(["delete"], {
                args: { messageNumber: deleteAction.parameters.messageNumber },
                flags: undefined,
            } as unknown as CommandParams);
        }
        case "clearHistory":
            return execute(["clear"]);
        case "listHistory":
            return execute(["list"]);
        case "saveHistory":
            return execute(["save"], {
                args: { file: historyAction.parameters.file },
                flags: undefined,
            } as unknown as CommandParams);
        case "insertHistory": {
            let messages: unknown;
            try {
                messages = JSON.parse(historyAction.parameters.messagesJson);
            } catch (e) {
                throw new Error(
                    `Invalid chat history JSON in messagesJson: ${e instanceof Error ? e.message : String(e)}`,
                );
            }
            return execute(["insert"], {
                args: { messages },
                flags: undefined,
            } as unknown as CommandParams);
        }
        case "listHistoryEntities":
            return execute(["entities", "list"], {
                args: {},
                flags: undefined,
            } as unknown as CommandParams);
        case "deleteHistoryEntity":
            return execute(["entities", "delete"], {
                args: { entityId: historyAction.parameters.entityId },
                flags: undefined,
            } as unknown as CommandParams);
        default:
            throw new Error(`Invalid action name: ${action.actionName}`);
    }
}
