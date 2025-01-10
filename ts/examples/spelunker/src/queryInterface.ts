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
import { PromptSection } from "typechat";

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
        tags,
        synonyms,
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
                    defaultValue: verbose,
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
        await importAllFiles(files, chunkyIndex, io, namedArgs.verbose);
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
                                writeNote(io, "SUMMARY: None");
                            }
                        } else {
                            const docItem: string[] | undefined = (
                                chunkDoc as any
                            )[name];
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
                writeNote(io, `[Chunk ID ${chunkId} not found]`);
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
                    defaultValue: 10,
                },
                minScore: {
                    description: "Minimum score to return",
                    type: "number",
                    defaultValue: 0.7,
                },
                verbose: {
                    description: "More verbose output",
                    type: "boolean",
                    defaultValue: verbose,
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
            verbose: namedArgs.verbose,
        };
        await processQuery(query, chunkyIndex, io, queryOptions);
    }

    function commonOptions(): Record<string, iapp.ArgDef> {
        return {
            verbose: {
                description: "More verbose output",
                type: "boolean",
                defaultValue: verbose,
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

    function tagsDef(): iapp.CommandMetadata {
        return {
            description: "Show all recorded tags and their postings.",
            options: commonOptions(),
        };
    }
    handlers.tags.metadata = tagsDef();
    async function tags(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        await _reportIndex(args, io, "tags");
    }

    function synonymsDef(): iapp.CommandMetadata {
        return {
            description: "Show all recorded synonyms and their postings.",
            options: commonOptions(),
        };
    }
    handlers.synonyms.metadata = synonymsDef();
    async function synonyms(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        await _reportIndex(args, io, "synonyms");
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
            writeMain(io, "[No files]");
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
                    defaultValue: verbose,
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
        await purgeNormalizedFile(io, chunkyIndex, fileName, namedArgs.verbose);
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
            writeNote(io, `No ${indexName}.`); // E.g., "No keywords."
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
                writeNote(io, `No hits for ${text} in ${indexName}`);
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
        await processQuery(input, chunkyIndex, io, {
            maxHits: 10,
            minScore: 0.7,
            verbose,
        });
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
    // Step 1: Find chunks to remove.
    let toDelete: Set<ChunkId> = new Set();
    for await (const chunk of chunkyIndex.chunkFolder.allObjects()) {
        if (chunk.fileName === fileName) {
            toDelete.add(chunk.id);
        }
    }

    // Step 1a: Logging and early return if nothing to purge.
    if (!toDelete.size) {
        writeNote(io, `[No chunks to purge for file ${fileName}]`);
        return;
    }
    writeNote(
        io,
        `[Need to purge ${toDelete.size} chunks for file ${fileName}]`,
    );

    // Step 2: Remove chunk ids from indexes.
    const chunkIdsToDelete: ChunkId[] = Array.from(toDelete);
    for (const [name, index] of chunkyIndex.allIndexes()) {
        const affectedValues: string[] = [];
        // Collect values from which we need to remove the chunk ids about to be deleted.
        for await (const textBlock of index.entries()) {
            if (
                textBlock?.sourceIds?.some((id) =>
                    chunkIdsToDelete.includes(id),
                )
            ) {
                if (verbose) {
                    writeNote(io, `[Purging ${name} entry ${textBlock.value}]`);
                }
                affectedValues.push(textBlock.value);
            }
        }
        // Actually update the index (can't modify it while it's being iterated over).
        for (const value of affectedValues) {
            const id = await index.getId(value);
            if (!id) {
                writeWarning(io, `[No id for value {value}]`);
            } else {
                await index.remove(id, chunkIdsToDelete);
            }
        }
        writeNote(io, `[Purged ${affectedValues.length} ${name}]`); // name is plural, e.g. "keywords".
    }

    // Step 3: Remove chunks (do this last so if step 2 fails we can try again).
    for (const id of toDelete) {
        if (verbose) {
            writeNote(io, `[Purging chunk ${id}]`);
        }
        await chunkyIndex.chunkFolder.remove(id);
    }
    writeNote(io, `[Purged ${toDelete.size} chunks]`);
}

async function processQuery(
    input: string,
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo,
    queryOptions: QueryOptions,
): Promise<void> {
    // ** Step 0:** Find most recent answers.

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

    // Step 1a: If step 1 gave the answer, print it and exit.
    if ("answer" in proposedQueries) {
        await chunkyIndex.answerFolder.put(proposedQueries.answer);
        reportQuery(
            undefined,
            undefined,
            proposedQueries.answer,
            io,
            queryOptions.verbose,
        );
        writeNote(io, "[Answer produced by stage 1]");
        return;
    }

    // **Step 2:** Run those queries on the indexes.

    const [hitsByIndex, chunkIdScores] = await runIndexQueries(
        proposedQueries,
        chunkyIndex,
        io,
        queryOptions,
    );
    if (!chunkIdScores) return; // Error message already printed by runIndexQueries.

    // **Step 3:** Ask the LLM (answerMaker) to answer the question.

    const answer = await generateAnswer(
        input,
        hitsByIndex,
        chunkIdScores,
        recentAnswers,
        chunkyIndex,
        io,
        queryOptions,
    );
    if (!answer) return; // Error message already printed by generateAnswer.

    // **Step 4:** Print the answer. Also record it for posterity.

    await chunkyIndex.answerFolder.put(answer);
    reportQuery(hitsByIndex, chunkIdScores, answer, io, queryOptions.verbose);
}

async function proposeQueries(
    input: string,
    recentAnswers: NameValue<AnswerSpecs>[],
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo,
    queryOptions: QueryOptions,
): Promise<QuerySpecs | undefined> {
    const t0 = Date.now();

    const promptPreamble = makeQueryMakerPrompt(recentAnswers);
    if (queryOptions.verbose) {
        for (const section of promptPreamble) {
            writeNote(io, `[${section.role}: ${section.content}]`);
        }
    }
    const result = await chunkyIndex.queryMaker.translate(
        input,
        promptPreamble,
    );
    if (!result.success) {
        const t1 = Date.now();
        writeError(
            io,
            `[Error: ${result.message} in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
        );
        return undefined;
    }
    const specs = result.data;
    if (queryOptions.verbose) {
        writeNote(io, `\n[Result: proposed queries]`);
        // Use util.inspect() to colorize JSON; writeColor() doesn't do that.
        io.writer.writeLine(
            util.inspect(specs, { depth: null, colors: true, compact: false }),
        );
    }
    const t1 = Date.now();
    writeNote(
        io,
        `[proposeQueries took ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
    );

    return specs;
}

type HitsMap = Map<string, ScoredItem<knowLib.TextBlock<ChunkId>>[]>; // indexName -> hits from nearestNeighborsPairs

async function runIndexQueries(
    proposedQueries: QuerySpecs,
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo,
    queryOptions: QueryOptions,
): Promise<[HitsMap, Map<ChunkId, ScoredItem<ChunkId>> | undefined]> {
    const t0 = Date.now();

    const hitsByIndex: HitsMap = new Map();
    const chunkIdScores: Map<ChunkId, ScoredItem<ChunkId>> = new Map(); // Record score of each chunk id.
    const totalNumChunks = await chunkyIndex.chunkFolder.size(); // Nominator in IDF calculation.

    for (const [indexName, index] of chunkyIndex.allIndexes()) {
        const spec: QuerySpec | undefined = (proposedQueries as any)[indexName];
        if (spec === undefined) {
            writeNote(io, `[No query specified for ${indexName}]`);
            continue;
        }

        const specMaxHits = spec.maxHits;
        const defaultMaxHits = queryOptions.maxHits;
        const maxHits = specMaxHits ?? defaultMaxHits;
        const maxHitsDisplay =
            maxHits === specMaxHits
                ? maxHits.toString()
                : `${specMaxHits} ?? ${defaultMaxHits}`;

        const hits = await index.nearestNeighborsPairs(
            spec.query,
            maxHits,
            queryOptions.minScore,
        );
        if (!hits.length) {
            writeNote(
                io,
                `[${indexName}: query ${spec.query} (maxHits ${maxHitsDisplay}) no hits]`,
            );
            continue;
        }
        hitsByIndex.set(indexName, hits);

        // Update chunk id scores.
        for (const hit of hits) {
            // Literature suggests setting TF = 1 in this case,
            // but the term's relevance score intuitively makes sense.
            const tf = hit.score;
            // IDF calculation ("inverse document frequency smooth").
            const fraction =
                totalNumChunks / (1 + (hit.item.sourceIds?.length ?? 0));
            const idf = 1 + Math.log(fraction);
            const newScore = tf * idf;
            for (const chunkId of hit.item.sourceIds ?? []) {
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
            `[${indexName}: query '${spec.query}' (maxHits ${maxHitsDisplay}); ${hits.length} hits; ` +
                `scores ${hits[0].score.toFixed(3)}--${hits[end].score.toFixed(3)}; ` +
                `${numChunks} unique chunk ids]`,
        );
    }

    const t1 = Date.now();
    writeNote(
        io,
        `[runIndexQueries took ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
    );

    return [hitsByIndex, chunkIdScores];
}

async function generateAnswer(
    input: string,
    hitsByIndex: HitsMap,
    chunkIdScores: Map<ChunkId, ScoredItem<ChunkId>>,
    recentAnswers: NameValue<AnswerSpecs>[],
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo,
    queryOptions: QueryOptions,
): Promise<AnswerSpecs | undefined> {
    const t0 = Date.now();

    // Step 3a: Compute array of ids sorted by score, truncated to some limit.
    const scoredChunkIds: ScoredItem<ChunkId>[] = Array.from(
        chunkIdScores.values(),
    );

    writeNote(io, `\n[Overall ${scoredChunkIds.length} unique chunk ids]`);

    scoredChunkIds.sort((a, b) => b.score - a.score);

    // Step 3b: Get the chunks themselves.
    const chunks: Chunk[] = [];
    const maxChunks = 30;
    // Take the top N chunks that actually exist.
    for (const scoredChunkId of scoredChunkIds) {
        const maybeChunk = await chunkyIndex.chunkFolder.get(
            scoredChunkId.item,
        );
        if (maybeChunk) {
            chunks.push(maybeChunk);
            if (queryOptions.verbose) {
                writeVerboseReferences(
                    io,
                    [scoredChunkId.item],
                    hitsByIndex,
                    chunkIdScores,
                );
            }
            if (chunks.length >= maxChunks) {
                break;
            }
        } else {
            writeNote(io, `[Chunk ${scoredChunkId.item} not found]`);
        }
    }

    writeNote(io, `[Sending ${chunks.length} chunks to answerMaker]`);

    const preamble = makeAnswerPrompt(recentAnswers, chunks);
    if (queryOptions.verbose) {
        const formatted = util.inspect(preamble, {
            depth: null,
            colors: true,
            compact: false,
        });
        writeNote(io, `Preamble: ${formatted}`);
    }

    // Step 3c: Make the request and check for success.
    const answerResult = await chunkyIndex.answerMaker.translate(
        input,
        preamble,
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

    const t1 = Date.now();
    writeNote(
        io,
        `[generateAnswer took ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
    );

    return answerResult.data;
}

async function findRecentAnswers(
    input: string,
    chunkyIndex: ChunkyIndex,
): Promise<NameValue<AnswerSpecs>[]> {
    // TODO: Allow for multiple concurrent sessions.
    const recentAnswers: NameValue<AnswerSpecs>[] = [];
    for await (const answer of chunkyIndex.answerFolder.all()) {
        recentAnswers.push(answer);
    }
    // Assume the name field (the internal key) is a timestamp.
    recentAnswers.sort((a, b) => b.name.localeCompare(a.name));
    recentAnswers.splice(20); // TODO: Cut off by total size, not count.
    recentAnswers.reverse(); // Most recent last.
    return recentAnswers;
}

function reportQuery(
    hitsByIndex: HitsMap | undefined,
    chunkIdScores: Map<ChunkId, ScoredItem<ChunkId>> | undefined,
    answer: AnswerSpecs,
    io: iapp.InteractiveIo,
    verbose: boolean,
): void {
    writeHeading(
        io,
        `\nAnswer (confidence ${answer.confidence.toFixed(3).replace(/0+$/, "")}):`,
    );

    writeMain(io, wordWrap(answer.answer));

    if (answer.message) {
        writeWarning(io, "\n" + wordWrap(`Message: ${answer.message}`));
    }
    if (answer.references.length) {
        writeNote(
            io,
            `\nReferences (${answer.references.length}): ${answer.references.join(",").replace(/,/g, ", ")}`,
        );
        if (verbose && chunkIdScores && hitsByIndex) {
            writeVerboseReferences(
                io,
                answer.references,
                hitsByIndex,
                chunkIdScores,
            );
        }
    }
    // NOTE: If the user wants to see the contents of any chunk, they can use the @chunk command.
}

function writeVerboseReferences(
    io: iapp.InteractiveIo,
    references: ChunkId[],
    hitsByIndex: HitsMap,
    chunkIdScores: Map<ChunkId, ScoredItem<ChunkId>>,
): void {
    for (const ref of references) {
        const score = chunkIdScores.get(ref)?.score ?? 0;
        writeColor(
            io,
            chalk.blue,
            `  ${ref} (${chalk.white(score.toFixed(3))})`,
        );
        for (const indexName of hitsByIndex.keys()) {
            const hits = hitsByIndex.get(indexName) ?? [];
            for (const hit of hits) {
                if (hit.item.sourceIds?.includes(ref)) {
                    writeColor(
                        io,
                        chalk.green,
                        `    ${chalk.gray(indexName)}: ${hit.item.value} (${chalk.white(hit.score.toFixed(3))})`,
                    );
                }
            }
        }
    }
}

function makeQueryMakerPrompt(
    recentAnswers: NameValue<AnswerSpecs>[],
): PromptSection[] {
    const prompt = `
I have a code project split up in chunks indexed on several categories.
Please produce suitable queries for each applicable index based on
conversation history (especially if the query refers to a previous answer
indirectly, e.g. via "it" or "that"), and the user question given later.
Don't suggest "meta" queries about the conversation itself -- only the code is indexed.
`;
    return makeAnyPrompt(recentAnswers, prompt);
}

function makeAnswerPrompt(
    recentAnswers: NameValue<AnswerSpecs>[],
    chunks: Chunk[],
): PromptSection[] {
    const prompt = `\
Following are the chunks most relevant to the query.
Use the preceding conversation items as context for the user query given later.
`;

    const preamble = makeAnyPrompt(recentAnswers, prompt);
    for (const chunk of chunks) {
        const chunkData = {
            fileName: chunk.fileName,
            chunkId: chunk.id,
            blobs: chunk.blobs,
            summary: chunk.docs?.chunkDocs
                ?.filter((cd) => cd.summary)
                .map((cd) => cd.summary)
                .join("\n"),
        };
        preamble.push({ role: "user", content: JSON.stringify(chunkData) });
    }
    return preamble;
}

function makeAnyPrompt(
    recentAnswers: NameValue<AnswerSpecs>[],
    prompt: string,
): PromptSection[] {
    const preamble: PromptSection[] = [];
    for (const answer of recentAnswers) {
        preamble.push({ role: "user", content: answer.value.question });
        preamble.push({ role: "assistant", content: answer.value.answer });
    }
    preamble.push({ role: "user", content: prompt.trim() });
    return preamble;
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
