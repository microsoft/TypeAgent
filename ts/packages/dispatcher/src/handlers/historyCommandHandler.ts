// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { StopWatch } from "common-utils";
import { CommandHandler, HandlerTable } from "./common/commandHandler.js";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";

export class HistoryListCommandHandler implements CommandHandler {
    public readonly description = "List history";
    public async run(input: string, context: CommandHandlerContext) {

        context.profiler?.start(context, this);

        const history = context.chatHistory;

        let index = 0;
        const output = [];
        for (const entry of history.entries) {
            output.push(`${index}: ${JSON.stringify(entry, undefined, 2)}`);
            index++;
        }
        const h = output.join("\n");

        context.profiler?.stop(context, this);

        context.requestIO.result(h);
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
