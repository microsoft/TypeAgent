// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// User interface for querying the index.

import * as fs from "fs";

import * as iapp from "interactive-app";
import * as knowLib from "knowledge-processor";
import { ScoredItem } from "typeagent";

import { IndexType, ChunkyIndex } from "./chunkyIndex.js";
import { QuerySpec, QuerySpecs } from "./makeQuerySchema.js";
import { Chunk, ChunkId } from "./pythonChunker.js";
import { importAllFiles } from "./pythonImporter.js";
import { AnswerSpecs } from "./makeAnswerSchema.js";

type QueryOptions = {
    maxHits: number;
    minScore: number;
    verbose: boolean;
};

export async function interactiveQueryLoop(
    chunkyIndex: ChunkyIndex,
    verbose = false,
): Promise<void> {
    const handlers: Record<string, iapp.CommandHandler> = {
        import: importHandler, // Since you can't name a function "import".
        clearMemory,
        chunk,
        search,
        summaries,
        keywords,
        topics,
        goals,
        dependencies,
    };
    iapp.addStandardHandlers(handlers);

    function importDef(): iapp.CommandMetadata {
        return {
            description: "Import a file or files of Python code.",
            options: {
                fileName: {
                    description:
                        "File to import (or multiple files separated by commas)",
                    type: "string",
                },
                files: {
                    description: "File containing the list of files to import",
                    type: "string",
                },
                verbose: {
                    description: "More verbose output",
                    type: "boolean",
                },
            },
        };
    }
    handlers.import.metadata = importDef();
    async function importHandler(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        const namedArgs = iapp.parseNamedArguments(args, importDef());
        const files = namedArgs.fileName
            ? (namedArgs.fileName as string).trim().split(",")
            : namedArgs.files
              ? fs
                    .readFileSync(namedArgs.files as string, "utf-8")
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0 && line[0] !== "#")
              : [];
        if (!files.length) {
            io.writer.writeLine("[No files to import (use --? for help)]");
            return;
        }
        await importAllFiles(files, chunkyIndex, namedArgs.verbose ?? verbose);
    }

    handlers.clearMemory.metadata = "Clear all memory (and all indexes)";
    async function clearMemory(
        args: string[],
        io: iapp.InteractiveIo,
    ): Promise<void> {
        await fs.promises.rm(chunkyIndex.rootDir, {
            recursive: true,
            force: true,
        });
        await chunkyIndex.reInitialize(chunkyIndex.rootDir);
        io.writer.writeLine("[All memory and all indexes cleared]");
        // Actually the embeddings cache isn't. But we shouldn't have to care.
    }

    handlers.chunk.metadata = "Print one or more chunks";
    async function chunk(
        args: string[],
        io: iapp.InteractiveIo,
    ): Promise<void> {
        const joinedArgs = args.join(" ");
        const splitArgs = joinedArgs.trim().split(/[\s,]+/);
        for (const chunkId of splitArgs) {
            const chunk = await chunkyIndex.chunkFolder.get(chunkId);
            if (chunk) {
                const chunkDocs = chunk.docs?.chunkDocs ?? [];
                io.writer.writeLine(`\nCHUNK ID: ${chunkId}`);
                for (const chunkDoc of chunkDocs) {
                    for (const pair of chunkyIndex.allIndexes()) {
                        if (pair.name == "summaries") {
                            if (chunkDoc.summary) {
                                io.writer.writeLine("SUMMARY:");
                                io.writer.writeLine(
                                    // Indent by two
                                    wordWrap(chunkDoc.summary).replace(
                                        /^/gm,
                                        "  ",
                                    ),
                                );
                            } else {
                                io.writer.writeLine("SUMMARY: None");
                            }
                        } else {
                            const docItem: string[] | undefined =
                                chunkDoc[pair.name];
                            if (docItem?.length) {
                                io.writer.writeLine(
                                    `${pair.name.toUpperCase()}: ${docItem.join(", ")}`,
                                );
                            }
                        }
                    }
                }
                io.writer.writeLine("CODE:");
                writeChunkLines(chunk, io, 100);
            } else {
                io.writer.writeLine(`[Chunk ID ${chunkId} not found]`);
            }
        }
    }

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
        const queryOptions: QueryOptions = {
            maxHits: namedArgs.maxHits,
            minScore: namedArgs.minScore,
            verbose: namedArgs.verbose ?? verbose,
        };
        await processQuery(query, chunkyIndex, io, queryOptions);
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
        await _reportIndex(args, io, "summaries");
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
        await _reportIndex(args, io, "keywords");
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
        await _reportIndex(args, io, "topics");
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
        await _reportIndex(args, io, "goals");
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
        await _reportIndex(args, io, "dependencies");
    }

    async function _reportIndex(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
        indexName: IndexType,
    ): Promise<void> {
        const namedArgs = iapp.parseNamedArguments(args, keywordsDef());
        const index = chunkyIndex.getIndexByName(indexName);
        if (namedArgs.debug) {
            io.writer.writeLine(`[Debug: ${indexName}]`);
            await _debugIndex(index, indexName, verbose);
            return;
        }

        let matches: ScoredItem<knowLib.TextBlock<ChunkId>>[] = [];
        if (namedArgs.query) {
            matches = await index.nearestNeighborsPairs(
                namedArgs.query,
                namedArgs.maxHits,
                namedArgs.minScore,
            );
        } else {
            for await (const textBlock of index.entries()) {
                matches.push({
                    score: 1,
                    item: textBlock,
                });
            }
        }

        let hits: ScoredItem<knowLib.TextBlock<ChunkId>>[] = [];
        if (!namedArgs.filter) {
            hits = matches;
        } else {
            const filterWords: string[] = (namedArgs.filter as string)
                .split(" ")
                .filter(Boolean)
                .map((w) => w.toLowerCase());
            for await (const match of matches) {
                const valueWords: string[] = match.item.value
                    .split(/\s+/)
                    .filter(Boolean)
                    .map((w) => w.toLowerCase());
                if (filterWords.every((word) => valueWords.includes(word))) {
                    hits.push(match);
                }
            }
        }

        if (!hits.length) {
            io.writer.writeLine(`No ${indexName}.`);
            return;
        } else {
            io.writer.writeLine(`Found ${hits.length} ${indexName}.`);

            // TFIDF = TF(t) * IDF(t) = 1 * log(N / (1 + nt))
            // - t is a term (in other contexts, a term occurring in a given chunk)
            // - nt the number of chunks occurring for that term in this index
            // - N the total number of chunks in the system
            const numChunks = await chunkyIndex.chunkFolder.size();
            for (const hit of hits) {
                const numSourceIds: number = hit.item.sourceIds?.length ?? 0;
                hit.score *= Math.log(numChunks / (1 + numSourceIds));
            }

            hits.sort((a, b) => {
                if (a.score != b.score) return b.score - a.score;
                return a.item.value.localeCompare(b.item.value);
            });
            for (const hit of hits) {
                io.writer.writeLine(
                    `${hit.score.toFixed(3).padStart(7)}: ${hit.item.value} :: ${(hit.item.sourceIds ?? []).join(", ")}`,
                );
            }
        }
    }

    async function _debugIndex(
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

    async function _inputHandler(
        input: string,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        await processQuery(input, chunkyIndex, io, {} as QueryOptions);
    }

    await iapp.runConsole({
        inputHandler: _inputHandler,
        handlers,
        prompt: "\n🤖> ",
    });
}

async function processQuery(
    input: string,
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo,
    queryOptions: QueryOptions,
): Promise<void> {
    // **Step 1:** Ask LLM (queryMaker) to propose queries for each index.

    const proposedQueries = await proposeQueries(
        input,
        chunkyIndex,
        io,
        queryOptions,
    );
    if (!proposedQueries) return; // Error message already printed by proposeQueries.

    // **Step 2:** Run those queries on the indexes.

    const chunkIdScores = await runIndexQueries(
        proposedQueries,
        chunkyIndex,
        io,
        queryOptions,
    );
    if (!chunkIdScores) return; // Error message already printed by runIndexQueries.

    // **Step 3:** Ask the LLM (answerMaker) to answer the question.

    const answer = await generateAnswer(
        input,
        chunkIdScores,
        chunkyIndex,
        io,
        queryOptions,
    );
    if (!answer) return; // Error message already printed by generateAnswer.

    // **Step 4:** Print the answer.

    reportQuery(answer, io);
}

async function proposeQueries(
    input: string,
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo,
    queryOptions: QueryOptions,
): Promise<QuerySpecs | undefined> {
    const result = await chunkyIndex.queryMaker.translate(
        input,
        makeQueryMakerPrompt(input),
    );
    if (!result.success) {
        io.writer.writeLine(`[Error: ${result.message}]`);
        return undefined;
    }
    const specs = result.data;
    if (queryOptions.verbose)
        io.writer.writeLine(JSON.stringify(specs, null, 2));
    return specs;
}

async function runIndexQueries(
    proposedQueries: QuerySpecs,
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo,
    queryOptions: QueryOptions,
): Promise<Map<ChunkId, ScoredItem<ChunkId>> | undefined> {
    const chunkIdScores: Map<ChunkId, ScoredItem<ChunkId>> = new Map(); // Record score of each chunk id.
    const totalNumChunks = await chunkyIndex.chunkFolder.size(); // Nominator in IDF calculation.

    for (const namedIndex of chunkyIndex.allIndexes()) {
        const indexName = namedIndex.name;
        const index = namedIndex.index;
        const spec: QuerySpec | undefined = (proposedQueries as any)[indexName];
        if (!spec) {
            io.writer.writeLine(`[No query for ${indexName}]`);
            continue;
        }
        const hits = await index.nearestNeighborsPairs(
            spec.query,
            spec.maxHits ?? queryOptions.maxHits,
            spec.minScore ?? queryOptions.minScore,
        );
        if (!hits.length) {
            io.writer.writeLine(`[No hits for ${indexName}]`);
            continue;
        }

        // Update chunk id scores.
        for (const hit of hits) {
            // IDF only depends on the term.
            const fraction =
                totalNumChunks / (1 + (hit.item.sourceIds?.length ?? 0));
            const idf = 1 + Math.log(fraction);
            for (const chunkId of hit.item.sourceIds ?? []) {
                // Binary TF is 1 for all chunks in the list.
                // As a tweak, we multiply by the term's relevance score.
                const newScore = hit.score * idf;
                const oldScoredItem = chunkIdScores.get(chunkId);
                const oldScore = oldScoredItem?.score ?? 0;
                // Combine scores by addition. (Alternatives: max, possibly others.)
                const combinedScore = oldScore + newScore;
                if (oldScoredItem) {
                    oldScoredItem.score = combinedScore;
                } else {
                    chunkIdScores.set(chunkId, {
                        score: oldScore + newScore,
                        item: chunkId,
                    });
                }
            }
        }

        // Verbose logging.
        if (queryOptions.verbose) {
            io.writer.writeLine(
                `\nFound ${hits.length} ${indexName} for '${spec.query}':`,
            );
            for (const hit of hits) {
                io.writer.writeLine(
                    `${hit.score.toFixed(3).padStart(7)}: ${hit.item.value} -- ${hit.item.sourceIds?.join(", ")}`,
                );
            }
        }

        // Regular logging.
        const nchunks = new Set(hits.flatMap((h) => h.item.sourceIds)).size;
        const end = hits.length - 1;
        io.writer.writeLine(
            `[${indexName}: query '${spec.query}'; ${hits.length} hits; scores ${hits[0].score.toFixed(3)}--${hits[end].score.toFixed(3)}; ${nchunks} unique chunk ids]`,
        );
    }

    if (proposedQueries.unknownText) {
        io.writer.writeLine(`[Unknown text: ${proposedQueries.unknownText}]`);
    }

    return chunkIdScores;
}

async function generateAnswer(
    input: string,
    chunkIdScores: Map<ChunkId, ScoredItem<ChunkId>>,
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo,
    queryOptions: QueryOptions,
): Promise<AnswerSpecs | undefined> {
    // Step 3a: Compute array of ids sorted by score, truncated to some limit.
    const scoredChunkIds: ScoredItem<ChunkId>[] = Array.from(
        chunkIdScores.values(),
    );

    io.writer.writeLine(
        `\n[Overall ${scoredChunkIds.length} unique chunk ids]`,
    );

    scoredChunkIds.sort((a, b) => b.score - a.score);
    scoredChunkIds.splice(20); // Arbitrary number. (TODO: Make it an option.)

    // Step 3b: Get the chunks themselves.
    const chunks: Chunk[] = [];

    for (const chunkId of scoredChunkIds) {
        const maybeChunk = await chunkyIndex.chunkFolder.get(chunkId.item);
        if (maybeChunk) chunks.push(maybeChunk);
    }

    io.writer.writeLine(`[Sending ${chunks.length} chunks to answerMaker]`);

    // Step 3c: Make the request and check for success.
    const request = JSON.stringify(chunks);

    if (queryOptions.verbose) {
        io.writer.writeLine(`Request: ${JSON.stringify(chunks, null, 2)}`);
    }

    const answerResult = await chunkyIndex.answerMaker.translate(
        request,
        makeAnswerPrompt(input),
    );

    if (!answerResult.success) {
        io.writer.writeLine(`[Error: ${answerResult.message}]`);
        return undefined;
    }

    if (queryOptions.verbose) {
        io.writer.writeLine(
            `AnswerResult: ${JSON.stringify(answerResult.data, null, 2)}`,
        );
    }

    return answerResult.data;
}

function reportQuery(answer: AnswerSpecs, io: iapp.InteractiveIo): void {
    io.writer.writeLine(
        `\nAnswer (confidence ${answer.confidence.toFixed(3).replace(/0+$/, "")}):`,
    );
    io.writer.writeLine(wordWrap(answer.answer));
    if (answer.message) io.writer.writeLine(`Message: ${answer.message}`);
    if (answer.references.length) {
        io.writer.writeLine(
            `\nReferences (${answer.references.length}): ${answer.references.join(",").replace(/,/g, ", ")}`,
        );
    }
    // NOTE: If the user wants to see the contents of any chunk, they can use the @chunk command.
}

function makeQueryMakerPrompt(input: string): string {
    return `\
I have indexed a mid-sized code base written in Python. I divided each
file up in "chunks", one per function or class or toplevel scope, and
asked an AI to provide for each chunk:

- a summary
- keywords
- topics
- goals
- dependencies

For example, in JSON, a typical chunk might have this output from the AI:

"docs": {
    "chunkDocs": [
        {
        "lineNumber": 33,
        "name": "Blob",
        "summary": "Represents a sequence of text lines along withmetadata, including the starting line number and a flag indicating whether the blob should be ignored during reconstruction.",
        "keywords": [
            "text",
            "metadata",
            "blob"
        ],
        "topics": [
            "data structure",
            "text processing"
        ],
        "goals": [
            "Store text lines",
            "Manage reconstruction"
        ],
        "dependencies": []
        }
    ]
}

This is just an example though. The real code base looks different -- it
just uses the same format.

Anyway, now that I've indexed this, I can do an efficient fuzzy search
on any query string on each of the five categories. I will next write
down a question and ask you to produce *queries* for each of the five
indexes whose answers will help you answer my question. Don't try to
answer the question (you haven't seen the code yet) -- just tell me the
query strings for each index.

My question is:

${input}
`;
}

function makeAnswerPrompt(input: string): string {
    return `\
Here is a JSON representation of a set of query results on indexes for keywords, topics, goals, etc.
For each index you see a list of scored items, where each item has a value (e.g. a topic) and a list of "source ids".
The source ids reference code chunks, which are provided separately.

Using the query results and scores, please answer this question:

${input}
`;
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

// Wrap long lines. Bugs by Github Copilot.
export function wordWrap(text: string, wrapLength: number = 80): string {
    const wrappedLines: string[] = [];

    text.split("\n").forEach((line) => {
        let match = line.match(/^(\s*[-*]\s+|\s*)/); // Match leading indent or "- ", "* ", etc.
        let indent = match ? match[0] : "";
        let baseIndent = indent;

        // Special handling for list items: add 2 spaces to the indent for overflow lines
        if (match && /^(\s*[-*]\s+)/.test(indent)) {
            // const listMarkerLength = indent.length - indent.trimStart().length;
            indent = " ".repeat(indent.length + 2);
        }

        let currentLine = "";
        line.trimEnd()
            .split(/\s+/)
            .forEach((word) => {
                if (
                    currentLine.length + word.length + 1 > wrapLength &&
                    currentLine.length > 0
                ) {
                    wrappedLines.push(baseIndent + currentLine.trimEnd());
                    currentLine = indent + word + " ";
                } else {
                    currentLine += word + " ";
                }
            });

        if (currentLine.trimEnd()) {
            wrappedLines.push(baseIndent + currentLine.trimEnd());
        }
    });

    return wrappedLines.join("\n");
}
