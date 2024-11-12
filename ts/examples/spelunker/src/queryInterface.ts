// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// User interface for querying the index.

import * as iapp from "interactive-app";
import * as knowLib from "knowledge-processor";
import path from "path";
import { ScoredItem } from "typeagent";

import { ChunkyIndex } from "./chunkyIndex.js";
import { CodeDocumentation } from "./codeDocSchema.js";
import { Chunk, ChunkId } from "./pythonChunker.js";
import { wordWrap } from "./pythonImporter.js";

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
        keywords,
        topics,
        goals,
        dependencies,
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

    function keywordsDef(): iapp.CommandMetadata {
        return {
            description: "Show all recorded keywords and their postings.",
        };
    }
    handlers.keywords.metadata = keywordsDef();
    async function keywords(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        await reportIndex(args, io, "keywords");
    }

    function topicsDef(): iapp.CommandMetadata {
        return {
            description: "Show all recorded topics and their postings.",
        };
    }
    handlers.topics.metadata = topicsDef();
    async function topics(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        await reportIndex(args, io, "topics");
    }

    function goalsDef(): iapp.CommandMetadata {
        return {
            description: "Show all recorded goals and their postings.",
        };
    }
    handlers.goals.metadata = goalsDef();
    async function goals(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        await reportIndex(args, io, "goals");
    }

    function dependenciesDef(): iapp.CommandMetadata {
        return {
            description: "Show all recorded dependencies and their postings.",
        };
    }
    handlers.dependencies.metadata = dependenciesDef();
    async function dependencies(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        await reportIndex(args, io, "dependencies");
    }

    async function reportIndex(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
        indexName: string, // E.g. "keywords"
    ): Promise<void> {
        // const namedArgs = iapp.parseNamedArguments(args, keywordsDef());
        const index: knowLib.TextIndex<string, string> = (chunkyIndex as any)[
            indexName + "Index"
        ];
        const iterator: AsyncIterableIterator<knowLib.TextBlock<string>> =
            index.entries();
        const values: knowLib.TextBlock<string>[] = [];
        for await (const value of iterator) {
            values.push(value);
        }
        if (!values.length) {
            io.writer.writeLine(`No ${indexName}.`);
        } else {
            io.writer.writeLine(`Found ${values.length} ${indexName}.`);
            values.sort();
            for (const value of values) {
                io.writer.writeLine(
                    `${value.value} :: ${value.sourceIds?.toString().replace(/,/g, ", ")}`,
                );
            }
        }
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
    // TODO: Find a more type-safe way (so a typo in the index name is caught by the compiler).
    for (const indexType of ["keywords", "topics", "goals", "dependencies"]) {
        // TODO: Make this less pathetic (stemming, substrings etc.).
        const index: knowLib.TextIndex<string, ChunkId> = (chunkyIndex as any)[
            indexType + "Index"
        ];
        if (!index) {
            io.writer.writeLine(`No ${indexType} index.`);
            continue;
        }
        const values = await index.get(input);
        if (values?.length) {
            io.writer.writeLine("");
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
    io.writer.writeLine("");
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
