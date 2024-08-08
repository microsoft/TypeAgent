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
import { generateOutputTemplate } from "schema-author";

export function createTemplateCommand(studio: SchemaStudio): CommandHandler {
    const argDef = defineArgs();
    const handler: CommandHandler = handleCommand;
    handler.metadata = argDef;
    return handler;

    function defineArgs(): CommandMetadata {
        return {
            description:
                "Generate variations on parameterized string generation templates",
            args: {
                example: {
                    description: "Example phrase",
                },
            },
            options: {
                count: {
                    description: "Generate upto these many variations",
                    defaultValue: 20,
                    type: "integer",
                },
                facets: {
                    description: "Facets to vary in phrases",
                    defaultValue: "phrase structure, position of parameters",
                },
                lang: {
                    description: "Code language",
                    defaultValue: "Typescript",
                },
            },
        };
    }

    async function handleCommand(
        args: string[],
        io: InteractiveIo,
    ): Promise<CommandResult> {
        const namedArgs = parseNamedArguments(args, argDef);
        const list = await generateOutputTemplate(
            studio.model,
            namedArgs.example,
            namedArgs.count,
            namedArgs.facets,
            namedArgs.lang,
        );
        io.writer.writeList(list);
    }
}
