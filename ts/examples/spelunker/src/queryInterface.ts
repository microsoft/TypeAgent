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

    function commonOptions(): Record<string, iapp.ArgDef> {
        return {
            verbose: {
                description: "More verbose output",
                type: "boolean",
            },
            filter: {
                description: "Filter by keyword",
                type: "string",
            },
            query: {
                description: "Natural language query",
                type: "string",
            },
            maxHits: {
                description:
                    "Maximum number of hits to return (only for query)",
                type: "integer",
                defaultValue: 10,
            },
            minScore: {
                description: "Minimum score to return (only for query)",
                type: "number",
                defaultValue: 0.7,
            },
        };
    }

    function keywordsDef(): iapp.CommandMetadata {
        return {
            description: "Show all recorded keywords and their postings.",
            options: commonOptions(),
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
            options: commonOptions(),
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
            options: commonOptions(),
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
            options: commonOptions(),
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
        const namedArgs = iapp.parseNamedArguments(args, keywordsDef());
        const index: knowLib.TextIndex<string, ChunkId> = (chunkyIndex as any)[
            indexName + "Index"
        ];
        let matches: ScoredItem<knowLib.TextBlock<ChunkId>>[] = [];
        if (namedArgs.query) {
            matches = await index.nearestNeighborsPairs(
                namedArgs.query,
                namedArgs.maxHits,
                namedArgs.minScore,
            );
            // TODO: Merge matches with the same score and item.value
        } else {
            for await (const textBlock of index.entries()) {
                matches.push({
                    score: 1.0,
                    item: textBlock,
                });
            }
        }
        let hits: ScoredItem<knowLib.TextBlock<ChunkId>>[] = [];
        if (!namedArgs.filter) {
            hits = matches;
        } else {
            for await (const match of matches) {
                if (namedArgs.filter) {
                    const valueWords: string[] = match.item.value
                        .split(/\s+/)
                        .filter(Boolean)
                        .map((w) => w.toLowerCase());
                    const filterWords: string[] = (namedArgs.filter as string)
                        .split(/\s+/)
                        .filter(Boolean)
                        .map((w) => w.toLowerCase());
                    if (
                        filterWords.every((word) => valueWords.includes(word))
                    ) {
                        if (match.score === 1.0) {
                            match.score =
                                filterWords.length / valueWords.length;
                        }
                        hits.push(match);
                    }
                }
            }
        }
        if (!hits.length) {
            io.writer.writeLine(`No ${indexName}.`);
        } else {
            io.writer.writeLine(`Found ${hits.length} ${indexName}.`);
            hits.sort((a, b) => {
                if (a.score != b.score) return b.score - a.score;
                return a.item.value.localeCompare(b.item.value);
            });
            for (const hit of hits) {
                io.writer.writeLine(
                    `${hit.item.value} (${hit.score.toFixed(3)}) :: ${(hit.item.sourceIds || []).join(", ")}`,
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
    const hitTable = new Map<ChunkId, number>();

    // First gather hits from keywords, topics etc. indexes.
    for (const indexType of ["keywords", "topics", "goals", "dependencies"]) {
        // TODO: Find a more type-safe way (so a typo in the index name is caught by the compiler).
        const index: knowLib.TextIndex<string, ChunkId> = (chunkyIndex as any)[
            indexType + "Index"
        ];
        if (!index) {
            io.writer.writeLine(`[No ${indexType} index.]`);
            continue;
        }
        if (options.verbose)
            io.writer.writeLine(`[Searching ${indexType} index...]`);
        // TODO: try/catch like below? Embeddings can fail too...
        const hits: ScoredItem<knowLib.TextBlock<ChunkId>>[] =
            await index.nearestNeighborsPairs(
                input,
                options.maxHits * 5,
                options.minScore,
            );
        for (const hit of hits) {
            if (options.verbose) {
                io.writer.writeLine(
                    `  ${hit.item.value} (${hit.score.toFixed(3)}) -- ${hit.item.sourceIds}`,
                );
            }
            for (const id of hit.item.sourceIds || []) {
                const oldScore = hitTable.get(id) || 0.0;
                hitTable.set(id, oldScore + hit.score);
            }
        }
    }

    // Next add hits from the code index. (Different API, same idea though.)
    try {
        if (options.verbose) io.writer.writeLine(`[Searching code index...]`);
        const hits: ScoredItem<ChunkId>[] = await chunkyIndex.codeIndex!.find(
            input,
            options.maxHits * 5,
            options.minScore,
        );
        for (const hit of hits) {
            if (options.verbose) {
                const comment = (await chunkyIndex.summaryFolder!.get(hit.item))
                    ?.comments?.[0]?.comment;
                io.writer.writeLine(
                    `  ${hit.item} (${hit.score.toFixed(3)}) -- ${comment?.slice(0, 100) ?? "[no data]"}`,
                );
            }
            hitTable.set(hit.item, hit.score);
        }
    } catch (error) {
        io.writer.writeLine(`[Code index query failed; skipping: ${error}]`);
    }

    // Now show the top options.maxHits hits.
    if (!hitTable.size) {
        io.writer.writeLine("No hits.");
        return;
    }
    const hits: ScoredItem<ChunkId>[] = Array.from(
        hitTable,
        ([item, score]) => ({ item, score }),
    );
    hits.sort((a, b) => b.score - a.score);
    hits.splice(options.maxHits);
    io.writer.writeLine(`Found ${hits.length} ${plural("hit", hits.length)}:`);

    for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        const chunk: Chunk | undefined = await chunkyIndex.chunkFolder!.get(
            hit.item,
        );
        if (!chunk) {
            io.writer.writeLine(`${hit.item} --> [No data]`);
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
        writeChunkLines(chunk, io, options.verbose ? 100 : 5);
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
