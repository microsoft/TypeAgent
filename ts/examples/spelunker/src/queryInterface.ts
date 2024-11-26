// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// User interface for querying the index.

import chalk, { ChalkInstance } from "chalk";
import * as fs from "fs";
import * as util from "util";

import * as iapp from "interactive-app";
import * as knowLib from "knowledge-processor";
import { NameValue, ScoredItem } from "typeagent";

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

function writeColor(
    io: iapp.InteractiveIo | undefined,
    color: ChalkInstance,
    message: string,
): void {
    message = color(message);
    if (io) {
        io.writer.writeLine(message);
    } else {
        console.log(message);
    }
}

function writeNote(io: iapp.InteractiveIo | undefined, message: string): void {
    writeColor(io, chalk.gray, message);
}

function writeMain(io: iapp.InteractiveIo | undefined, message: string): void {
    writeColor(io, chalk.white, message);
}

function writeWarning(
    io: iapp.InteractiveIo | undefined,
    message: string,
): void {
    writeColor(io, chalk.yellow, message);
}

function writeError(io: iapp.InteractiveIo | undefined, message: string): void {
    writeColor(io, chalk.redBright, message);
}

function writeHeading(
    io: iapp.InteractiveIo | undefined,
    message: string,
): void {
    writeColor(io, chalk.green, message);
}

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
        files,
        purgeFile,
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
            writeError(io, "[No files to import (use --? for help)]");
            return;
        }
        await importAllFiles(
            files,
            chunkyIndex,
            io,
            namedArgs.verbose ?? verbose,
        );
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
        writeNote(io, "[All memory and all indexes cleared]");
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
                writeNote(io, `\nCHUNK ID: ${chunkId}`);
                for (const chunkDoc of chunkDocs) {
                    for (const [name, _] of chunkyIndex.allIndexes()) {
                        if (name == "summaries") {
                            if (chunkDoc.summary) {
                                writeNote(io, "SUMMARY:");
                                writeMain(
                                    io,
                                    // Indent by two
                                    wordWrap(chunkDoc.summary).replace(
                                        /^/gm,
                                        "  ",
                                    ),
                                );
                            } else {
                                writeWarning(io, "SUMMARY: None");
                            }
                        } else {
                            const docItem: string[] | undefined =
                                chunkDoc[name];
                            if (docItem?.length) {
                                writeNote(
                                    io,
                                    `${name.toUpperCase()}: ${docItem.join(", ")}`,
                                );
                            }
                        }
                    }
                }
                writeNote(io, "CODE:");
                writeChunkLines(chunk, io, 100);
            } else {
                writeWarning(io, `[Chunk ID ${chunkId} not found]`);
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

    function filesDef(): iapp.CommandMetadata {
        return {
            description: "Show all recorded file names.",
            options: {
                filter: {
                    description: "Only show files containing this string",
                    type: "string",
                },
            },
        };
    }
    handlers.files.metadata = filesDef();
    async function files(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        const namedArgs = iapp.parseNamedArguments(args, filesDef());
        const filter = namedArgs.filter;
        const filesPopularity: Map<string, number> = new Map();
        for await (const chunk of chunkyIndex.chunkFolder.allObjects()) {
            filesPopularity.set(
                chunk.fileName,
                (filesPopularity.get(chunk.fileName) ?? 0) + 1,
            );
        }
        if (!filesPopularity.size) {
            writeWarning(io, "[No files]");
        } else {
            const sortedFiles = Array.from(filesPopularity)
                .filter(([file, _]) => !filter || file.includes(filter))
                .sort();
            writeNote(
                io,
                `Found ${sortedFiles.length} ${filter ? "matching" : "total"} files.`,
            );
            for (const [file, count] of sortedFiles) {
                writeMain(
                    io,
                    `${chalk.blue(count.toFixed(0).padStart(7))} ${chalk.green(file)}`,
                );
            }
        }
    }

    function purgeFileDef(): iapp.CommandMetadata {
        return {
            description: "Purge all mentions of a file.",
            args: {
                fileName: {
                    description: "File to purge",
                    type: "string",
                },
            },
            options: {
                verbose: {
                    description: "More verbose output",
                    type: "boolean",
                },
            },
        };
    }
    handlers.purgeFile.metadata = purgeFileDef();
    async function purgeFile(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        const namedArgs = iapp.parseNamedArguments(args, purgeFileDef());
        const file = namedArgs.fileName as string;
        const fileName = fs.existsSync(file) ? fs.realpathSync(file) : file;
        await purgeNormalizedFile(
            io,
            chunkyIndex,
            fileName,
            namedArgs.verbose ?? verbose,
        );
    }

    async function _reportIndex(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
        indexName: IndexType,
    ): Promise<void> {
        const namedArgs = iapp.parseNamedArguments(args, keywordsDef());
        const index = chunkyIndex.getIndexByName(indexName);
        if (namedArgs.debug) {
            writeNote(io, `[Debug: ${indexName}]`);
            await _debugIndex(io, index, indexName, verbose);
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
            writeWarning(io, `No ${indexName}.`); // E.g., "No keywords."
            return;
        } else {
            writeNote(io, `Found ${hits.length} ${indexName}.`);

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
                writeMain(
                    io,
                    `${hit.score.toFixed(3).padStart(7)}: ${chalk.green(hit.item.value)} :: ${(hit.item.sourceIds ?? []).join(", ")}`,
                );
            }
        }
    }

    async function _debugIndex(
        io: iapp.InteractiveIo,
        index: knowLib.TextIndex<string, ChunkId>,
        indexName: string,
        verbose: boolean,
    ): Promise<void> {
        const allTexts = Array.from(index.text());
        for (const text of allTexts) {
            if (verbose) writeNote(io, `Text: ${text}`);
            const hits = await index.nearestNeighborsPairs(
                text,
                allTexts.length,
            );
            if (verbose) {
                for (const hit of hits) {
                    writeNote(
                        io,
                        `${hit.score.toFixed(3).padStart(7)} ${hit.item.value}`,
                    );
                }
            }
            if (hits.length < 2) {
                writeWarning(io, `No hit for ${text}`);
            } else {
                const end = hits.length - 1;
                writeMain(
                    io,
                    `${chalk.green(hits[0].item.value)}: ${chalk.blue(hits[1].item.value)} (${hits[1].score.toFixed(3)}) -- ` +
                        `${chalk.blue(hits[end].item.value)} (${hits[end].score.toFixed(3)})`,
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

export async function purgeNormalizedFile(
    io: iapp.InteractiveIo | undefined,
    chunkyIndex: ChunkyIndex,
    fileName: string,
    verbose: boolean,
): Promise<void> {
    // Step 1: find chunks to remove.
    let toDelete: Set<ChunkId> = new Set();
    for await (const chunk of chunkyIndex.chunkFolder.allObjects()) {
        if (chunk.fileName === fileName) {
            toDelete.add(chunk.id);
            if (verbose) writeNote(io, `[Purging chunk ${chunk.id}]`);
        }
    }
    if (!toDelete.size) {
        writeNote(io, `[No chunks to purge for file ${fileName}]`);
        return;
    }

    // Step 2: remove chunks.
    writeNote(
        io,
        `[Purging ${toDelete.size} existing chunks for file ${fileName}]`,
    );
    for (const id of toDelete) {
        if (verbose) writeNote(io, `[Purging chunk ${id}]`);
        await chunkyIndex.chunkFolder.remove(id);
    }

    // Step 3: remove chunk ids from indexes.
    const deletions: ChunkId[] = Array.from(toDelete);
    for (const [name, index] of chunkyIndex.allIndexes()) {
        let updates = 0;
        for await (const textBlock of index.entries()) {
            if (textBlock?.sourceIds?.some((id) => deletions.includes(id))) {
                if (verbose) {
                    writeNote(io, `[Purging ${name} entry ${textBlock.value}]`);
                }
                await index.remove(textBlock.value, deletions);
                updates++;
            }
        }
        writeNote(io, `[Purged ${updates} ${name}]`); // name is plural, e.g. "keywords".
    }
}

async function processQuery(
    input: string,
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo,
    queryOptions: QueryOptions,
): Promise<void> {
    // ** Step 0:** Find the five most recent answers (presumably in this session).

    const recentAnswers: NameValue<AnswerSpecs>[] = await findRecentAnswers(
        input,
        chunkyIndex,
    );

    // **Step 1:** Ask LLM (queryMaker) to propose queries for each index.

    const proposedQueries = await proposeQueries(
        input,
        recentAnswers,
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
        recentAnswers,
        chunkyIndex,
        io,
        queryOptions,
    );
    if (!answer) return; // Error message already printed by generateAnswer.

    // **Step 4:** Print the answer. Also record it for posterity.

    await chunkyIndex.answerFolder.put(answer);
    reportQuery(answer, io);
}

async function proposeQueries(
    input: string,
    recentAnswers: NameValue<AnswerSpecs>[],
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo,
    queryOptions: QueryOptions,
): Promise<QuerySpecs | undefined> {
    const promptPreamble = makeQueryMakerPrompt(input, recentAnswers);
    const result = await chunkyIndex.queryMaker.translate(
        input,
        promptPreamble,
    );
    if (!result.success) {
        writeError(io, `[Error: ${result.message}]`);
        return undefined;
    }
    const specs = result.data;
    if (queryOptions.verbose) {
        // Use util.inspect() to colorize JSON; writeColor() doesn't do that.
        io.writer.writeLine(
            util.inspect(specs, { depth: null, colors: true, compact: false }),
        );
    }
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

    for (const [indexName, index] of chunkyIndex.allIndexes()) {
        const spec: QuerySpec | undefined = (proposedQueries as any)[indexName];
        if (!spec) {
            writeWarning(io, `[No query for ${indexName}]`);
            continue;
        }
        const hits = await index.nearestNeighborsPairs(
            spec.query,
            spec.maxHits ?? queryOptions.maxHits,
            spec.minScore ?? queryOptions.minScore,
        );
        if (!hits.length) {
            writeWarning(io, `[No hits for ${indexName}]`);
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
            writeNote(
                io,
                `\nFound ${hits.length} ${indexName} for '${spec.query}':`,
            );
            for (const hit of hits) {
                writeNote(
                    io,
                    `${hit.score.toFixed(3).padStart(7)}: ${hit.item.value} -- ${hit.item.sourceIds?.join(", ")}`,
                );
            }
        }

        // Regular logging.
        const numChunks = new Set(hits.flatMap((h) => h.item.sourceIds)).size;
        const end = hits.length - 1;
        writeNote(
            io,
            `[${indexName}: query '${spec.query}'; ${hits.length} hits; ` +
                `scores ${hits[0].score.toFixed(3)}--${hits[end].score.toFixed(3)}; ` +
                `${numChunks} unique chunk ids]`,
        );
    }

    if (proposedQueries.unknownText) {
        writeWarning(io, `[Unknown text: ${proposedQueries.unknownText}]`);
    }

    return chunkIdScores;
}

async function generateAnswer(
    input: string,
    chunkIdScores: Map<ChunkId, ScoredItem<ChunkId>>,
    recentAnswers: NameValue<AnswerSpecs>[],
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo,
    queryOptions: QueryOptions,
): Promise<AnswerSpecs | undefined> {
    // Step 3a: Compute array of ids sorted by score, truncated to some limit.
    const scoredChunkIds: ScoredItem<ChunkId>[] = Array.from(
        chunkIdScores.values(),
    );

    writeNote(io, `\n[Overall ${scoredChunkIds.length} unique chunk ids]`);

    scoredChunkIds.sort((a, b) => b.score - a.score);
    scoredChunkIds.splice(20); // Arbitrary number. (TODO: Make it an option.)

    // Step 3b: Get the chunks themselves.
    const chunks: Chunk[] = [];

    for (const chunkId of scoredChunkIds) {
        const maybeChunk = await chunkyIndex.chunkFolder.get(chunkId.item);
        if (maybeChunk) chunks.push(maybeChunk);
        else {
            writeWarning(io, `[Chunk ${chunkId.item} not found]`);
        }
    }

    writeNote(io, `[Sending ${chunks.length} chunks to answerMaker]`);

    // Step 3c: Make the request and check for success.
    const request = { chunks, pastAnswers: recentAnswers };

    if (queryOptions.verbose) {
        writeNote(io, `Request: ${JSON.stringify(request, null, 2)}`);
    }

    const answerResult = await chunkyIndex.answerMaker.translate(
        JSON.stringify(request),
        makeAnswerPrompt(input),
    );

    if (!answerResult.success) {
        writeError(io, `[Error: ${answerResult.message}]`);
        return undefined;
    }

    if (queryOptions.verbose) {
        writeNote(
            io,
            `AnswerResult: ${JSON.stringify(answerResult.data, null, 2)}`,
        );
    }

    return answerResult.data;
}

async function findRecentAnswers(
    input: string,
    chunkyIndex: ChunkyIndex,
): Promise<NameValue<AnswerSpecs>[]> {
    const recentAnswers: NameValue<AnswerSpecs>[] = [];
    for await (const answer of chunkyIndex.answerFolder.all()) {
        recentAnswers.push(answer);
    }
    // Assume the name field (the internal key) is a timestamp.
    recentAnswers.sort((a, b) => b.name.localeCompare(a.name));
    recentAnswers.splice(5); // Arbitrary number. (TODO: Make it an option.)
    recentAnswers.reverse(); // Most recent last.
    return recentAnswers;
}

function reportQuery(answer: AnswerSpecs, io: iapp.InteractiveIo): void {
    writeHeading(
        io,
        `\nAnswer (confidence ${answer.confidence.toFixed(3).replace(/0+$/, "")}):`,
    );
    writeMain(io, wordWrap(answer.answer));
    if (answer.message)
        writeWarning(io, "\n" + wordWrap(`Message: ${answer.message}`));
    if (answer.references.length) {
        writeNote(
            io,
            `\nReferences (${answer.references.length}): ${answer.references.join(",").replace(/,/g, ", ")}`,
        );
    }
    // NOTE: If the user wants to see the contents of any chunk, they can use the @chunk command.
}

function makeQueryMakerPrompt(
    input: string,
    recentAnswers: NameValue<AnswerSpecs>[],
): string {
    return `\
I have indexed a code base written in Python. I divided each
file up in "chunks", one per function or class or module, and
asked an AI to provide for each chunk:

- a summary
- keywords
- topics
- goals
- dependencies

Now that I've indexed this, I can do a "nearest neighbors" search
on any query string on each of the five categories. I will next write
down a question and ask you to produce *queries* for each of the five
indexes whose answers will help you answer my question. Don't try to
answer the question (you haven't seen the code yet) -- just tell me the
query strings for each index.

If you have low confidence in your queries, explain in 'message'.

Here are up to 5 recent answers to use as conversation context:

${JSON.stringify(recentAnswers, null, 2)}

My question is:

${input}
`;
}

function makeAnswerPrompt(input: string): string {
    return `\
Here is a JSON representation of a set of query results on indexes for keywords, topics, goals, etc.
For each index you see a list of text items, where each item has a value (e.g. a topic) and a list of "source ids".
The source ids reference code chunks, which are provided separately.
There are also up to 5 recent answers to use as conversation context.

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
                writeNote(io, "   ...");
                break outer;
            }
            writeMain(
                io,
                `${(1 + blob.start + i).toString().padStart(6)}: ${blob.lines[i].trimEnd()}`,
            );
        }
    }
}

// Wrap long lines.
export function wordWrap(text: string, wrapLength: number = 80): string {
    let inCodeBlock = false;
    const lines: string[] = [];
    const prefixRegex = /^\s*((-|\*|\d+\.)\s+)?/;
    for (let line of text.split(/[ ]*\r?\n/)) {
        if (line.startsWith("```")) inCodeBlock = !inCodeBlock; // TODO: Colorize code blocks.
        if (line.length <= wrapLength || inCodeBlock) {
            // The whole line is deemed to fit.
            lines.push(line);
            continue;
        }
        // We must try to break.
        const prefixLength = prefixRegex.exec(line)?.[0]?.length ?? 0;
        const indent = " ".repeat(prefixLength);
        while (line.length > wrapLength) {
            const shortenedLine = line.slice(0, wrapLength + 1);
            let index = shortenedLine.lastIndexOf(" ");
            if (index <= prefixLength) {
                index = line.indexOf(" ", wrapLength);
                if (index < 0) break; // The rest of the line is one "word".
            }
            lines.push(line.slice(0, index).trimEnd());
            line = indent + line.slice(index + 1).trimStart();
        }
        lines.push(line);
    }
    return lines.join("\n");
}

export function testWordWrap(): void {
    const sampleText = `\
This is a long line that should be wrapped at some point. It's not clear where.
    This is another long line but it is also indented. Let's make sure the breaks are also indented.
    - This is a bullet point that should be wrapped at some point. It's not clear where.
    12. This is a numbered point that should be wrapped at some point. It's not clear where.
\`\`\`python
def generate_id() -> IdType:
    """Generate a new unique ID.

    IDs are really timestamps formatted as YYYY_MM_DD-HH_MM_SS.UUUUUU,
    where UUUUUU is microseconds.

    To ensure IDs are unique, if the next timestamp isn't greater than the last one,
    we add 1 usec to the last one. This has the advantage of "gracefully" handling
    time going backwards.
    """
    global last_ts
    next_ts = datetime.datetime.now()  # Local time, for now
    if next_ts <= last_ts:
        next_ts = last_ts + datetime.timedelta(microseconds=1)
    last_ts = next_ts
    return next_ts.strftime("%Y%m%d-%H%M%S.%f")
\`\`\`
This is a short line.
  * A short bullet.
  * Another short one.
    A short indented line.
End.
`;
    console.log(wordWrap(sampleText, 40));
}

// testWordWrap();
