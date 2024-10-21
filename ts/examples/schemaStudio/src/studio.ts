// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, openai } from "aiclient";
import { CommandHandler, InteractiveIo, displayHelp } from "interactive-app";
import Path from "path";

export interface SchemaStudio {
    readonly model: ChatModel;
    commands: Record<string, CommandHandler>;
}

export async function createStudio(): Promise<SchemaStudio> {
    const model = openai.createChatModel([ Path.parse(__filename).name ], undefined, { temperature: 0.3 });
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
