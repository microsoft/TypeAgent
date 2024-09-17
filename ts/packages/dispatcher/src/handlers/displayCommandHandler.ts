// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandler } from "@typeagent/agent-sdk/helpers/commands";
import { CommandHandlerContext } from "../internal.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { parseCommandArgs } from "../utils/args.js";

export class DisplayCommandHandler implements CommandHandler {
    public readonly description = "Send text to display";
    public async run(
        input: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        const { flags, args } = parseCommandArgs(input, {
            speak: false,
        });

        for (const arg of args) {
            context.actionIO.appendDisplay(
                {
                    type: "text",
                    content: arg,
                    speak: flags.speak,
                },
                "block",
            );
        }
    }
}
