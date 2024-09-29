// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
import { parseCommandArgs } from "../utils/args.js";

export class HistoryListCommandHandler implements CommandHandler {
    public readonly description = "List history";
    public async run(
        input: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
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

export class HistoryClearCommandHandler implements CommandHandler {
    public readonly description = "Clear the history";
    public async run(
        input: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const history = systemContext.chatHistory;

        history.entries.length = 0;

        displayResult("Chat history cleared.", context);
    }
}

export class HistoryDeleteCommandHandler implements CommandHandler {
    public readonly description =
        "Delete a specific message from the chat history";
    public async run(
        request: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const { args } = parseCommandArgs(request);
        if (args.length > 1) {
            throw new Error("Too many arguments.");
        }
        const index: number = parseInt(args[0]);
        if (index < 0 || index >= systemContext.chatHistory.entries.length) {
            throw new Error(
                `The supplied index (${index}) is outside the range of available indicies (0, ${systemContext.chatHistory.entries.length})`,
            );
        } else if (isNaN(index)) {
            throw new Error(
                `The supplied value '${index}' is not a valid index.`,
            );
        } else if (args.length === 1) {
            systemContext.chatHistory.entries.splice(index, 1);
            displayResult(
                `Message ${index} deleted. ${systemContext.chatHistory.entries.length} messages remain in the chat history.`,
                context,
            );
        } else {
            throw new Error(
                "You must supply an index number of the message to delete.",
            );
        }
    }
}

export function getHistoryCommandHandlers(): CommandHandlerTable {
    return {
        description: "History commands",
        defaultSubCommand: new HistoryListCommandHandler(),
        commands: {
            list: new HistoryListCommandHandler(),
            clear: new HistoryClearCommandHandler(),
            delete: new HistoryDeleteCommandHandler(),
        },
    };
}
