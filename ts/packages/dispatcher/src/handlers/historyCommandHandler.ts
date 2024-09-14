// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/commands";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { displayResult } from "./common/interactiveIO.js";

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

export function getHistoryCommandHandlers(): CommandHandlerTable {
    return {
        description: "History commands",
        defaultSubCommand: new HistoryListCommandHandler(),
        commands: {
            list: new HistoryListCommandHandler(),
        },
    };
}
