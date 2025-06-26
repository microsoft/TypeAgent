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
import { bingWithGrounding, urlResolver } from "azure-ai-foundry";
import registerDebug from "debug";

export function createURLResolverCommands(
    studio: SchemaStudio,
): CommandHandler {
    const argDef: CommandMetadata = {
        description:
            "Resolves the supplied utterance + URLs in the supplied file",
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
            },
        },
    };

    const handler: CommandHandler = async function handleCommand(
        args: string[],
        io: InteractiveIo,
    ): Promise<CommandResult> {
        const namedArgs = parseNamedArguments(args, argDef);

        registerDebug.enable("*");

        io.writer.writeLine(`Opening file: ${namedArgs.file}`);
        const urls = fs.readFileSync(namedArgs.file, "utf-8").split("\n");

        // ignore the first line which is a comment
        urls.shift();

        io.writer.writeLine(`Loaded ${urls.length} URLs.`);

        // get the grounding config
        const groundingConfig = bingWithGrounding.apiSettingsFromEnv();

        // Start checking each URL
        let passCount = 0;
        let failCount = 0;
        for (const url of urls) {
            const temp = url.split("\t");
            const utterance = temp[0].trim();
            const site = temp[1].trim();

            const resolved = await urlResolver.resolveURLWithSearch(
                utterance,
                groundingConfig,
            );
            let passFail = "";

            if (resolved !== site) {
                passFail = "FAIL";
                failCount++;
            } else {
                passFail = "PASS";
                passCount++;
            }

            io.writer.writeLine(
                `${passFail}: Resolved '${utterance}' to '${resolved}' (expected: ${site})`,
            );

            fs.appendFileSync(
                "examples/schemaStudio/data/resolved.txt",
                `${passFail}\t${utterance}\t${site}\t${resolved}\n`,
            );
        }

        io.writer.writeLine(
            "URL resolution complete. Results written to resolved.txt",
        );
        io.writer.writeLine(`Passed: ${passCount}, Failed: ${failCount}`);
    };

    handler.metadata = argDef;

    return handler;
}

export function createURLValidateCommands(
    studio: SchemaStudio,
): CommandHandler {
    const argDef: CommandMetadata = {
        description: "Validates that supplied utterance and URL matches.",
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
            },
            flushAgents: {
                description:
                    "Deletes all agents except the one in the api settings.",
                type: "boolean",
                defaultValue: false,
            },
            deleteThreads: {
                description: "Deletes all threads.",
                type: "boolean",
                defaultValue: false,
            },
        },
    };

    const handler: CommandHandler = async function handleCommand(
        args: string[],
        io: InteractiveIo,
    ): Promise<CommandResult> {
        const namedArgs = parseNamedArguments(args, argDef);

        if (namedArgs.flushAgents) {
            io.writer.writeLine("Flushing agents...");
            await urlResolver.flushAgent(
                bingWithGrounding.apiSettingsFromEnv(),
            );
            return;
        }

        if (namedArgs.deleteThreads) {
            io.writer.writeLine("Deleting threads...");
            await urlResolver.deleteThreads(
                bingWithGrounding.apiSettingsFromEnv(),
            );
            return;
        }

        registerDebug.enable("*");

        io.writer.writeLine(`Opening file: ${namedArgs.file}`);
        const urls = fs.readFileSync(namedArgs.file, "utf-8").split("\n");

        // ignore the first line which is a comment
        urls.shift();

        io.writer.writeLine(`Loaded ${urls.length} URLs.`);

        // get the grounding config
        const groundingConfig = bingWithGrounding.apiSettingsFromEnv();

        // delete the output file if it exists
        const outputFile = "examples/schemaStudio/data/validated.txt";
        if (fs.existsSync(outputFile)) {
            fs.unlinkSync(outputFile);
        }

        // Start checking each URL
        let passCount = 0;
        let failCount = 0;
        for (const url of urls) {
            const temp = url.split("\t");
            const utterance = temp[0].trim();
            const site = temp[1].trim();

            const siteValidity: urlResolver.urlValidityAction | undefined =
                await urlResolver.validateURL(utterance, site, groundingConfig);

            io.writer.writeLine(
                `${siteValidity?.urlValidity}\t${utterance} (${site})`,
            );

            fs.appendFileSync(
                outputFile,
                `${utterance}\t${site}\t${siteValidity?.urlValidity}\t${siteValidity?.explanation}\n`,
            );
        }

        io.writer.writeLine(
            "URL resolution complete. Results written to resolved.txt",
        );
        io.writer.writeLine(`Passed: ${passCount}, Failed: ${failCount}`);
    };

    handler.metadata = argDef;

    return handler;
}
