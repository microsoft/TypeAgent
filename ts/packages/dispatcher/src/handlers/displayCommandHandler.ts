// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandler,
    ParsedCommandParams,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../internal.js";
import { ActionContext } from "@typeagent/agent-sdk";

export class DisplayCommandHandler implements CommandHandler {
    public readonly description = "Send text to display";
    public readonly parameters = {
        flags: {
            speak: false,
        },
        args: {
            text: {
                description: "text to display",
                multiple: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { flags, args } = params;

        for (const content of args.text) {
            context.actionIO.appendDisplay(
                {
                    type: "text",
                    content,
                    speak: flags.speak,
                },
                "block",
            );
        }
    }
}
