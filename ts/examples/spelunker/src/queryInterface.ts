// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// User interface for querying the index.

import * as iapp from "interactive-app";
import * as knowLib from "knowledge-processor";
import path from "path";
import { ScoredItem } from "typeagent";
import { ChunkyIndex } from "./chunkyIndex.js";
import { FileDocumentation } from "./fileDocSchema.js";
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
        summaries,
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
            debug: {
                description: "Show debug output",
                type: "boolean",
            },
        };
    }

    function summariesDef(): iapp.CommandMetadata {
        return {
            description: "Show all recorded summaries and their postings.",
            options: commonOptions(),
        };
    }
    handlers.summaries.metadata = summariesDef();
    async function summaries(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        await reportIndex(args, io, "codeSummaries");
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
        if (namedArgs.debug) {
            io.writer.writeLine(`[Debug: ${indexName}]`);
            await debugIndex(index, indexName, verbose);
            return;
        }
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
                    `${hit.item.value} (${hit.score.toFixed(3)}) :: ${(hit.item.sourceIds ?? []).join(", ")}`,
                );
            }
        }
    }

    async function debugIndex(
        index: knowLib.TextIndex<string, ChunkId>,
        indexName: string,
        verbose: boolean,
    ): Promise<void> {
        const allTexts = Array.from(index.text());
        for (const text of allTexts) {
            if (verbose) console.log("Text:", text);
            const hits = await index.nearestNeighborsPairs(
                text,
                allTexts.length,
            );
            if (verbose) {
                for (const hit of hits) {
                    console.log(
                        `${hit.score.toFixed(3).padStart(7)} ${hit.item.value}`,
                    );
                }
            }
            if (hits.length < 2) {
                console.log(`No hits for ${text}`);
            } else {
                const end = hits.length - 1;
                console.log(
                    `${hits[0].item.value}: ${hits[1].item.value} (${hits[1].score.toFixed(3)}) -- ${hits[end].item.value} (${hits[end].score.toFixed(3)})`,
                );
            }
        }
    }

    // Define special handlers, then run the console loop.

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
        inputHandler,
        handlers,
        prompt: "\n🤖> ",
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
            for (const id of hit.item.sourceIds ?? []) {
                const oldScore = hitTable.get(id) || 0.0;
                hitTable.set(id, oldScore + hit.score);
            }
        }
    }

    // Next add hits from the code index. (Different API, same idea though.)
    try {
        if (options.verbose) io.writer.writeLine(`[Searching code index...]`);
        const hits: ScoredItem<knowLib.TextBlock<ChunkId>>[] =
            await chunkyIndex.codeSummariesIndex.nearestNeighborsPairs(
                input,
                options.maxHits * 5,
                options.minScore,
            );
        for (const hit of hits) {
            if (options.verbose) {
                for (const chunkId of hit.item.sourceIds ?? []) {
                    const chunk = await chunkyIndex.chunkFolder.get(chunkId);
                    const summary = chunk?.docs?.chunkDocs?.[0]?.summary;
                    io.writer.writeLine(
                        `  ${hit.item} (${hit.score.toFixed(3)}) -- ${summary?.slice(0, 100) ?? "[no data]"}`,
                    );
                }
            }
            hitTable.set(hit.item.value, hit.score);
        }
    } catch (error) {
        io.writer.writeLine(`[Code index query failed; skipping: ${error}]`);
    }

    // Now show the top options.maxHits hits.
    if (!hitTable.size) {
        io.writer.writeLine("No hits.");
        return;
    }
    const results: ScoredItem<ChunkId>[] = Array.from(
        hitTable,
        ([item, score]) => ({ item, score }),
    );
    results.sort((a, b) => b.score - a.score);
    results.splice(options.maxHits);
    io.writer.writeLine(
        `\nFound ${results.length} ${plural("hit", results.length)} for "${input}":`,
    );

    for (let i = 0; i < results.length; i++) {
        const hit = results[i];
        const chunk: Chunk | undefined = await chunkyIndex.chunkFolder.get(
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
        const docs: FileDocumentation | undefined = chunk.docs;
        for (const chunkDoc of docs?.chunkDocs ?? [])
            io.writer.writeLine(
                wordWrap(`${chunkDoc.summary} (${chunkDoc.lineNumber})`),
            );
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
