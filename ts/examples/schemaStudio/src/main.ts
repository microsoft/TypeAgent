// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import {
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    NamedArgs,
    dispatchCommand,
    getArg,
    parseCommandLine,
    parseNamedArguments,
    runConsole,
} from "interactive-app";
import {
    NameValue,
    getAbsolutePath,
    VariationSettings,
    VariationType,
    generateVariationsRecursive,
    readAllLines,
    writeAllLines,
    dedupeList,
    dedupeLineFile,
} from "typeagent";
import { generateActionPhrases, loadActionSchema } from "schema-author";
import { NodeType, SchemaParser } from "action-schema";
import { createStudio } from "./studio.js";
import { createTemplateCommand } from "./templateCommand.js";
import {
    createURLResolverCommands,
    createURLValidateCommands,
} from "./urlCommands.js";

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

interface VariationOptions extends VariationSettings {
    depth: number;
}

async function runStudio(): Promise<void> {
    const playerSchemaFile =
        "../../../packages/player/src/agent/playerSchema.ts";
    const playerSchemaPath = getAbsolutePath(playerSchemaFile, import.meta.url);

    const studio = await createStudio();
    // Setup commands
    const commands: Record<string, CommandHandler> = {
        ...studio.commands,
        schema,
        fromSchema,
        variations,
        temperature,
        dedupeFile: dedupeFile_,
        template: createTemplateCommand(studio),
        urlResolver: createURLResolverCommands(studio),
        urlValidate: createURLValidateCommands(studio),
    };

    studio.commands = commands;
    await runConsole({ inputHandler, commandHandler });

    async function inputHandler(line: string, io: InteractiveIo) {
        return generateVariations(line, io);
    }

    async function generateVariations(line: string, io: InteractiveIo) {
        const args = parseCommandLine(line);
        if (args && args.length > 0) {
            await variations(args, io);
        }
    }

    async function commandHandler(line: string, io: InteractiveIo) {
        return dispatchCommand(line, commands, io, true, ["--help", "--?"]);
    }

    async function schema(args: string[], io: InteractiveIo) {
        const testPath = playerSchemaPath;
        const allSchema = getActionSchema(testPath);
        for (const schema of allSchema) {
            io.writer.writeLine("====");
            io.writer.writeLine(schema.name);
            io.writer.writeLine(schema.value);
        }
    }

    commands.temperature.metadata = "Get or Set the model temperature";
    commands.temperature.usage = "temperature [TEMPERATURE]";
    async function temperature(args: string[], io: InteractiveIo) {
        if (args.length === 0) {
            io.writer.writeLine(
                studio.model.completionSettings.temperature ?? 0,
            );
        } else {
            studio.model.completionSettings.temperature = Number(args[0]);
        }
    }

    commands.dedupeFile.metadata = "Dedupe a text file with lines in-place";
    commands.dedupeFile.usage = "dedupeFile FILEPATH";
    async function dedupeFile_(args: string[], io: InteractiveIo) {
        const filePath = getArg(args, 0);
        await dedupeLineFile(filePath);
    }

    function fromSchemaArgs(): CommandMetadata {
        return {
            description:
                "Generate phrases that can translate to an action schema",
            options: {
                action: {
                    description: "Type name of the Action",
                    defaultValue: "PlayAction",
                },
                count: {
                    description: "Generate upto these many variations",
                    defaultValue: 20,
                    type: "integer",
                },
                descr: {
                    description: "Description of the Action",
                },
                facets: {
                    description: "Facets to vary in phrases",
                    defaultValue: "phrase structure",
                },
                schemaPath: {
                    description: "Load action schema from this file",
                    defaultValue: playerSchemaPath,
                },
                type: {
                    description:
                        "Type of variation. E.g. likely, unlikely, similar, alternatives, etc",
                    defaultValue: "most likely",
                },
                language: {
                    description: "Language to use",
                },
            },
        };
    }
    commands.fromSchema.metadata = fromSchemaArgs();
    /**
     * Generate phrases that can be translated into an action
     * @param args
     * @param io
     * @returns
     */
    async function fromSchema(args: string[], io: InteractiveIo) {
        const namedArgs = parseNamedArguments(args, fromSchemaArgs());
        // Options
        const example = namedArgs.example;
        const examplePath = namedArgs.path("examplePath", false);

        const schema = loadActionSchema(namedArgs.schemaPath, namedArgs.action);
        if (!schema) {
            io.writer.writeLine("Schema not found");
            return;
        }

        const existingData = namedArgs.existing
            ? await loadExisting(namedArgs.existing)
            : undefined;

        let list: string[];
        let printLines = true;
        if (examplePath) {
            list = [];
            printLines = false;
            let lines = await readAllLines(examplePath);
            lines = dedupeList(lines);
            for (const example of lines) {
                let exampleList = await generateActionPhrases(
                    namedArgs.type,
                    studio.model,
                    schema,
                    namedArgs.description,
                    namedArgs.count,
                    namedArgs.facets,
                    example,
                    namedArgs.language,
                );
                if (existingData) {
                    exampleList = removeExisting(exampleList, existingData);
                }
                exampleList = dedupeList(exampleList);
                exampleList.sort();
                io.writer.writeList(exampleList);
                list.push(...exampleList);
            }
        } else {
            list = await generateActionPhrases(
                namedArgs.type,
                studio.model,
                schema,
                namedArgs.description,
                namedArgs.count,
                namedArgs.facets,
                example,
                namedArgs.language,
            );
            if (existingData) {
                list = removeExisting(list, existingData);
            }
        }
        list = dedupeList(list);
        list.sort();
        if (namedArgs.output) {
            await writeAllLines(list, namedArgs.output);
        }
        if (printLines) {
            io.writer.writeList(list);
        }
    }

    commands.variations.metadata = "Generate variations on a seed phrase";
    /**
     * Generate variations from a seed phrase
     * @param args
     * @param io
     */
    async function variations(args: string[], io: InteractiveIo) {
        const phrase = args[0];
        args.shift();
        const options = parseNamedArguments(args);
        const showProgress = options.progress !== undefined;
        const typeName = options.schema;
        const variationOptions = getVariationOptions(options);
        if (typeName) {
            variationOptions.schema = loadActionSchema(
                playerSchemaPath,
                typeName,
            );
        }
        // Facets are any remaining options
        let list = await generateVariationsRecursive(
            studio.model,
            phrase,
            variationOptions,
            variationOptions.depth,
            showProgress
                ? (s: string, l: string[]) => generationProgress(s, l, io)
                : undefined,
        );
        list.sort();
        io.writer.writeList(list);
    }

    function getVariationOptions(args: NamedArgs): VariationOptions {
        const variationOptions: VariationOptions = {
            type: <VariationType>args.type ?? "most likely",
            count: args.integer("count") ?? 10,
            depth: args.integer("depth") ?? 1,
            hints: args.hints,
            facets: args.facets,
        };
        return variationOptions;
    }

    function generationProgress(
        seedPhrase: string,
        list: string[],
        io: InteractiveIo,
    ): void {
        io.writer.writeLine(seedPhrase);
        io.writer.writeList(list, { type: "ol" });
        io.writer.writeLine();
    }

    async function loadExisting(filePath: string): Promise<Set<string>> {
        const requests = await readAllLines(filePath);
        const unique = getUnique(requests);
        return unique;
    }

    function removeExisting(items: string[], existing: Set<string>): string[] {
        return items.filter((v) => !existing.has(v.toLocaleLowerCase()));
    }

    function getUnique(
        items: string[],
        caseSensitive: boolean = false,
    ): Set<string> {
        return caseSensitive
            ? new Set(items)
            : new Set(items.map((v) => v.toLocaleLowerCase()));
    }

    return;
}

function getActionSchema(filePath: string): NameValue[] {
    const schema = new SchemaParser();
    schema.loadSchema(filePath);
    const types = schema.actionTypeNames();
    const schemas: NameValue[] = [];
    for (const type of types) {
        const node = schema.openActionNode(type);
        let schemaText = node?.symbol.value!;
        for (const subType of node!.children) {
            if (subType.symbol.type === NodeType.TypeReference) {
                schemaText += "\n\n" + subType.symbol.value;
            }
        }
        schemas.push({ name: node?.symbol.name!, value: schemaText });
    }
    return schemas;
}

await runStudio();
