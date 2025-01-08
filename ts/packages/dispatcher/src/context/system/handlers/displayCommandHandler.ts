// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";

export class DisplayCommandHandler implements CommandHandler {
    public readonly description = "Send text to display";
    public readonly parameters = {
        flags: {
            speak: {
                description: "Speak the display for the host that supports TTS",
                default: false,
            },
            type: {
                description: "Display type",
                default: "text",
            },
            inline: {
                description: "Display inline",
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

        if (
            flags.type !== "text" &&
            flags.type !== "html" &&
            flags.type !== "markdown" &&
            flags.type !== "iframe"
        ) {
            throw new Error(`Invalid display type: ${flags.type}`);
        }
        for (const content of args.text) {
            context.actionIO.appendDisplay(
                {
                    type: flags.type,
                    content,
                    speak: flags.speak,
                },
                flags.inline ? "inline" : "block",
            );
        }
    }
}
