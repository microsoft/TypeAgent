// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";

export class HistoryListCommandHandler implements CommandHandlerNoParams {
    public readonly description = "List history";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const systemContext = context.sessionContext.agentContext;
        const history = systemContext.chatHistory;

        let index = 0;
        const output = [];
        for (const entry of history.entries) {
            output.push(`${index}: ${JSON.stringify(entry, undefined, 2)}`);
            index++;
        }

        displayResult(output, context);
    }
}

export class HistoryClearCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Clear the history";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const systemContext = context.sessionContext.agentContext;
        const history = systemContext.chatHistory;

        history.entries.length = 0;

        displayResult("Chat history cleared.", context);
    }
}

export class HistoryDeleteCommandHandler implements CommandHandler {
    public readonly description =
        "Delete a specific message from the chat history";
    public readonly parameters = {
        args: {
            index: {
                description: "Chat history index to delete.",
                type: "number",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        param: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const { index } = param.args;

        if (index < 0 || index >= systemContext.chatHistory.entries.length) {
            throw new Error(
                `The supplied index (${index}) is outside the range of available indicies (0, ${systemContext.chatHistory.entries.length})`,
            );
        } else if (isNaN(index)) {
            throw new Error(
                `The supplied value '${index}' is not a valid index.`,
            );
        }

        systemContext.chatHistory.entries.splice(index, 1);
        displayResult(
            `Message ${index} deleted. ${systemContext.chatHistory.entries.length} messages remain in the chat history.`,
            context,
        );
    }
}

export function getHistoryCommandHandlers(): CommandHandlerTable {
    return {
        description: "History commands",
        defaultSubCommand: "list",
        commands: {
            list: new HistoryListCommandHandler(),
            clear: new HistoryClearCommandHandler(),
            delete: new HistoryDeleteCommandHandler(),
        },
    };
}
