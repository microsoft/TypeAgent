// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../../internal.js";

export class DisplayCommandHandler implements CommandHandler {
    public readonly description = "Send text to display";
    public readonly parameters = {
        flags: {
            speak: {
                description: "Speak the display for the host that supports TTS",
                default: false,
            },
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
