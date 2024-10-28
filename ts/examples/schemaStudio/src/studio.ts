// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, openai } from "aiclient";
import { CommandHandler, InteractiveIo, displayHelp } from "interactive-app";

export interface SchemaStudio {
    readonly model: ChatModel;
    commands: Record<string, CommandHandler>;
}

export async function createStudio(): Promise<SchemaStudio> {
    const model = openai.createChatModelDefault("schemaStudio");
    const studio = {
        model,
        commands: {
            help,
            "--help": help,
            "--?": help,
        },
    };

    async function help(args: string[], io: InteractiveIo) {
        displayHelp(args, studio.commands, io);
    }
    help.metadata = "help [commandName]";

    return studio;
}
