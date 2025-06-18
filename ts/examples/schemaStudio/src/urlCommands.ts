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
import fs from "fs";
import { bingWithGrounding, urlResolver } from "aiclient";

export function createURLCommands(studio: SchemaStudio): CommandHandler {
    const argDef: CommandMetadata = {
        description: "Validates the supplied names + URLs in the supplied file",
        options: {
            file: {
                description: "The file to open",
                type: "string",
                defaultValue: "examples/schemaStudio/data/urls.txt",
            },
            all: {
                description: "If true, will process all URLs in the file",
                type: "boolean",
                defaultValue: true,
            }
        },
    };

    const handler: CommandHandler = async function handleCommand(
        args: string[],
        io: InteractiveIo,
    ): Promise<CommandResult> {
        const namedArgs = parseNamedArguments(args, argDef);

        io.writer.writeLine(`Opening file: ${namedArgs.file}`);
        const urls = fs.readFileSync(namedArgs.file, "utf-8").split("\n"); 

        // ignore the first line which is a comment
        urls.shift();

        io.writer.writeLine(`Loaded ${urls.length} URLs.`);

        // get the grounding config
        const groundingConfig = bingWithGrounding.apiSettingsFromEnv();

        // Start checking each URL
        for (const url of urls) {
            const temp = url.split("\t"); 
            const utterance = temp[0].trim();
            const site = temp[1].trim();
            
            const resolved = await urlResolver.resolveURLWithSearch(site, groundingConfig);

            io.writer.writeLine(`Resolved '${utterance}' to '${resolved}' (expected: ${site})`);

            fs.appendFileSync("resolved.txt", `${utterance}\t${site}\t${resolved}\n`);

            // if (resolved?.toLocaleLowerCase().trim() === site.toLocaleLowerCase().trim()) {
            //     io.writer.write(`Resolved URL: ${resolved}`);
            // } else {
            //     io.writer.write(`Failed to resolve URL for site: ${site}`);
            // }

            // // Check if the URL is valid
            // try {
            //     new URL(site);
            //     io.writer.write(`Valid URL: ${site}`);
            // } catch (e) {
            //     io.writer.write(`Invalid URL: ${site}`);
            //     continue;
            // }

            // Here you would call your URL resolution logic
            // For now, we just log the utterance and site
            //io.writer.write(`Utterance: ${utterance}, Site: ${site}`);
        }

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