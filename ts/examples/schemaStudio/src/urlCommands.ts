// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandler,
    CommandMetadata,
    CommandResult,
    InteractiveIo,
    parseNamedArguments,
} from "interactive-app";
import { SchemaStudio } from "./studio.js";
impor

export function createURLCommands(studio: SchemaStudio): CommandHandler {
    const argDef: CommandMetadata = {
        description: "Validates the supplied names + URLs in the supplied file",
        args: {
            file: {
                description: "The file to open",
                type: "string",
                defaultValue: "../data/urls.txt"
            },
        },
    };

    const handler: CommandHandler = async function handleCommand(
        args: string[],
        io: InteractiveIo,
    ): Promise<CommandResult> {
        const namedArgs = parseNamedArguments(args, argDef);

        io.writer.write(`Opening file: ${namedArgs.file}`);
        const urls = fs.readFileSync("test/data/urls.txt", "utf-8").split("\n"); 

        // const list = await generateOutputTemplate(
        //     studio.model,
        //     namedArgs.example,
        //     namedArgs.count,
        //     namedArgs.facets,
        //     namedArgs.lang,
        // );
        // io.writer.writeList(list);
    }
    
    handler.metadata = argDef;

    return handler;
}