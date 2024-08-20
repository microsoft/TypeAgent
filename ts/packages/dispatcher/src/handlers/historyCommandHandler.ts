// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandler, HandlerTable } from "./common/commandHandler.js";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";

export class HistoryListCommandHandler implements CommandHandler {
    public readonly description = "List history";
    public async run(input: string, context: CommandHandlerContext) {
        const history = context.chatHistory;

        let index = 0;
        const output = [];
        for (const entry of history.entries) {
            output.push(`${index}: ${JSON.stringify(entry, undefined, 2)}`);
            index++;
        }
        context.requestIO.result(output.join("\n"));
    }
}

export function getHistoryCommandHandlers(): HandlerTable {
    return {
        description: "History commands",
        defaultSubCommand: new HistoryListCommandHandler(), 
        commands: {
            list: new HistoryListCommandHandler(),
        },
    };
}
