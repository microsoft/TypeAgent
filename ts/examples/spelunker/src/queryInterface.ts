// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// User interface for querying the index.

import * as iapp from "interactive-app";
import * as knowLib from "knowledge-processor";
import path from "path";
import { ScoredItem } from "typeagent";

import { ChunkyIndex } from "./chunkyIndex.js";
import { CodeDocumentation } from "./codeDocSchema.js";
import { Chunk } from "./pythonChunker.js";
import { sanitizeKey, wordWrap } from "./pythonImporter.js";

type QueryOptions = {
    maxHits: number;
    minScore: number;
    verbose: boolean;
};

export async function runQueryInterface(
    chunkyIndex: ChunkyIndex,
    verbose = false,
): Promise<void> {
    const handlers: Record<string, iapp.CommandHandler> = {
        search,
    };
    iapp.addStandardHandlers(handlers);

    function searchDef(): iapp.CommandMetadata {
        return {
            description: "Search for a query string in the code index.",
            args: {
                query: {
                    description: "Natural language query",
                    type: "string",
                },
            },
            options: {
                maxHits: {
                    description: "Maximum number of hits to return",
                    type: "integer",
                    defaultValue: 3,
                },
                minScore: {
                    description: "Minimum score to return",
                    type: "number",
                    defaultValue: 0.7,
                },
                verbose: {
                    description: "More verbose output",
                    type: "boolean",
                },
            },
        };
    }
    handlers.search.metadata = searchDef();
    async function search(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        const namedArgs = iapp.parseNamedArguments(args, searchDef());
        const query: string = namedArgs.query;
        const options: QueryOptions = {
            maxHits: namedArgs.maxHits,
            minScore: namedArgs.minScore,
            verbose: namedArgs.verbose ?? verbose,
        };
        await processQuery(query, chunkyIndex, io, options);
    }

    // Define special handlers, then run the console loop.

    async function onStart(io: iapp.InteractiveIo): Promise<void> {
        io.writer.writeLine("Welcome to the query interface!");
    }
    async function inputHandler(
        input: string,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        const options: QueryOptions = {
            maxHits: 3,
            minScore: 0.7,
            verbose: false,
        };
        await processQuery(input, chunkyIndex, io, options);
    }

    await iapp.runConsole({
        onStart,
        inputHandler,
        handlers,
    });
}

async function processQuery(
    input: string,
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo,
    options: QueryOptions,
): Promise<void> {
    const key = sanitizeKey(input);
    // TODO: Find a more type-safe way (so a typo in the index name is caught by the compiler).
    for (const indexType of ["keywords", "topics", "goals", "dependencies"]) {
        // TODO: Make this less pathetic (stemming, substrings etc.).
        const index: knowLib.KeyValueIndex<string, string> = (
            chunkyIndex as any
        )[indexType + "Index"];
        if (!index) {
            io.writer.writeLine(`No ${indexType} index.`);
            continue;
        }
        const values = await index.get(key);
        if (values?.length) {
            io.writer.writeLine(
                `Found ${values.length} ${indexType} ${plural("hit", values.length)}:`,
            );
            for (let i = 0; i < values.length; i++) {
                const value = values[i];
                const chunk = await chunkyIndex.chunkFolder!.get(value);
                if (!chunk) {
                    io.writer.writeLine(
                        `Hit ${i + 1}: id: ${value} --> [No data]`,
                    );
                    continue;
                }
                io.writer.writeLine(
                    `Hit ${i + 1}: ` +
                        `id: ${chunk.id}, ` +
                        `file: ${path.relative(process.cwd(), chunk.filename!)}, ` +
                        `type: ${chunk.treeName}`,
                );
                if (chunk) {
                    io.writer.writeLine(
                        `    ${path.relative(process.cwd(), chunk.filename!)}`,
                    );
                    writeChunkLines(chunk, io, options.verbose ? 50 : 5);
                }
            }
            io.writer.writeLine("");
        }
    }
    let hits: ScoredItem<string>[];
    try {
        hits = await chunkyIndex.codeIndex!.find(
            input,
            options.maxHits,
            options.minScore,
        );
    } catch (error) {
        io.writer.writeLine(`[${error}]`);
        return;
    }
    if (!hits.length) {
        io.writer.writeLine("No hits.");
        return;
    }
    io.writer.writeLine(
        `Found ${hits.length} embedding ${plural("hit", hits.length)}:`,
    );

    for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        const chunk: Chunk | undefined = await chunkyIndex.chunkFolder!.get(
            hit.item,
        );
        if (!chunk) {
            io.writer.writeLine(`${hit} --> [No data]`);
            continue;
        }

        io.writer.writeLine(
            `Hit ${i + 1}: score: ${hit.score.toFixed(3)}, ` +
                `id: ${chunk.id}, ` +
                `file: ${path.relative(process.cwd(), chunk.filename!)}, ` +
                `type: ${chunk.treeName}`,
        );
        const summary: CodeDocumentation | undefined =
            await chunkyIndex.summaryFolder!.get(hit.item);
        if (summary?.comments?.length) {
            for (const comment of summary.comments)
                io.writer.writeLine(
                    wordWrap(`${comment.comment} (${comment.lineNumber})`),
                );
        }
        writeChunkLines(chunk, io, options.verbose ? 100 : 10);
    }
}

function writeChunkLines(
    chunk: Chunk,
    io: iapp.InteractiveIo,
    lineBudget = 10,
): void {
    // TODO: limit how much we write per blob too (if there are multiple).
    outer: for (const blob of chunk.blobs) {
        for (let i = 0; i < blob.lines.length; i++) {
            if (lineBudget-- <= 0) {
                io.writer.writeLine("   ...");
                break outer;
            }
            io.writer.writeLine(
                `${(1 + blob.start + i).toString().padStart(6)}: ${blob.lines[i].trimEnd()}`,
            );
        }
    }
}

function plural(s: string, n: number): string {
    // TOO: Use Intl.PluralRules.
    return n === 1 ? s : s + "s";
}
