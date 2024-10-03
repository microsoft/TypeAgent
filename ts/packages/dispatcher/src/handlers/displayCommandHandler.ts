// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../internal.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { parseCommandArgs } from "../utils/args.js";

export class DisplayCommandHandler implements CommandHandler {
    public readonly description = "Send text to display";
    public readonly parameters = {
        flags: {
            speak: false,
        },
        args: true,
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        input: string,
    ) {
        const { flags, args } = parseCommandArgs(input, this.parameters);

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
