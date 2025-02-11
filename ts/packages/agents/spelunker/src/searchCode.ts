// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";

import * as sqlite from "better-sqlite3";

import { createJsonTranslator, Result, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import { ChatModel, EmbeddingModel, openai } from "aiclient";
import { createLimiter } from "common-utils";

import {
    ActionResult,
    Entity,
} from "@typeagent/agent-sdk";
import { createActionResultFromMarkdownDisplay, createActionResultFromError } from "@typeagent/agent-sdk/helpers/action";
import { loadSchema } from "typeagent";

import {
    Blob,
    Chunk,
    ChunkedFile,
    ChunkerErrorItem,
    ChunkId,
} from "./chunkSchema.js";
import { OracleSpecs } from "./oracleSchema.js";
import { chunkifyPythonFiles } from "./pythonChunker.js";
import { ChunkDescription, SelectorSpecs } from "./selectorSchema.js";
import { SpelunkerContext } from "./spelunkerActionHandler.js";
import { SummarizerSpecs } from "./summarizerSchema.js";
import { chunkifyTypeScriptFiles } from "./typescriptChunker.js";
import { createDatabase } from "./databaseUtils.js";

let epoch: number = 0;

export function console_log(...rest: any[]): void {
    if (!epoch) {
        epoch = Date.now();
        console.log(""); // Start new epoch with a blank line
    }
    const t = Date.now();
    console.log(((t - epoch) / 1000).toFixed(3).padStart(6), ...rest);
}

export interface QueryContext {
    chatModel: ChatModel;
    miniModel: ChatModel;
    embeddingModel: EmbeddingModel<ChunkId>;
    oracle: TypeChatJsonTranslator<OracleSpecs>;
    chunkSelector: TypeChatJsonTranslator<SelectorSpecs>;
    chunkSummarizer: TypeChatJsonTranslator<SummarizerSpecs>;
    databaseLocation: string;
    database: sqlite.Database | undefined;
}

function captureTokenStats(req: any, response: any): void {
    const inputTokens = response.usage.prompt_tokens;
    const outputTokens = response.usage.completion_tokens;
    const cost = inputTokens * 0.000005 + outputTokens * 0.000015;
    console_log(
        `    [Tokens used: prompt=${inputTokens}, ` +
            `completion=${outputTokens}, ` +
            `cost=\$${cost.toFixed(2)}]`,
    );
}

function createQueryContext(): QueryContext {
    const chatModel = openai.createChatModelDefault("spelunkerChat");
    chatModel.completionCallback = captureTokenStats;

    const miniModel = openai.createChatModel(
        undefined, // "GPT_4_O_MINI" is slower than default model?!
        undefined,
        undefined,
        ["spelunkerMini"],
    );
    miniModel.completionCallback = captureTokenStats;

    const embeddingModel = openai.createEmbeddingModel("spelunkerEmbed");

    const oracle = createTranslator<OracleSpecs>(
        chatModel,
        "oracleSchema.ts",
        "OracleSpecs",
    );
    const chunkSelector = createTranslator<SelectorSpecs>(
        miniModel,
        "selectorSchema.ts",
        "SelectorSpecs",
    );
    const chunkSummarizer = createTranslator<SummarizerSpecs>(
        miniModel,
        "summarizerSchema.ts",
        "SummarizerSpecs",
    );

    const databaseFolder = path.join(
        process.env.HOME ?? "/",
        ".typeagent",
        "agents",
        "spelunker",
    );
    const mkdirOptions: fs.MakeDirectoryOptions = {
        recursive: true,
        mode: 0o700,
    };
    fs.mkdirSync(databaseFolder, mkdirOptions);

    const databaseLocation = path.join(databaseFolder, "codeSearchDatabase.db");
    const database = undefined;
    return {
        chatModel,
        miniModel,
        embeddingModel,
        oracle,
        chunkSelector,
        chunkSummarizer,
        databaseLocation,
        database,
    };
}

// Answer a question; called from request and from searchCode action
export async function searchCode(
    context: SpelunkerContext,
    input: string,
): Promise<ActionResult> {
    epoch = 0; // Reset logging clock
    console_log(`[searchCode question='${input}']`);

    // 0. Check if the focus is set.
    if (!context.focusFolders.length) {
        return createActionResultFromError("Please set the focus to a folder");
    }

    // 1. Create the database, chunkify all files in the focus folders, and store the chunks.
    //    Or use what's in the database if it looks up-to-date.
    const db = await loadDatabaseAndChunks(context);

    // 2. Load all chunks from the database.
    const allChunks = await loadAllChunksFromDatabase(db);

    // 3. Ask a fast LLM for the most relevant chunk Ids, rank them, and keep the best ones.
    const chunks = await selectChunks(context, allChunks, input);
    if (!chunks.length) {
        throw new Error("No chunks selected");
    }

    // 4. Construct a prompt from those chunks.
    const prompt = constructPrompt(input, chunks);

    // 5. Send the prompt to the oracle.
    const wrappedResult = await queryOracle(context, prompt);
    if (!wrappedResult.success) {
        return createActionResultFromError(
            `Failed to get an answer: ${wrappedResult.message}`,
        );
    }

    // 6. Extract answer from result.
    const result = wrappedResult.data;
    const answer = result.answer;

    // 7. Produce entities and an action result from the result.
    const outputEntities = produceEntitiesFromResult(result, allChunks, db);
    const resultEntity = createResultEntity(input, answer);

    return createActionResultFromMarkdownDisplay(
        answer,
        outputEntities,
        resultEntity,
    );
}

async function loadDatabaseAndChunks(
    context: SpelunkerContext,
): Promise<sqlite.Database> {
    console_log(`[Step 1: Load database]`);
    return await loadDatabase(context);
}

async function loadAllChunksFromDatabase(
    db: sqlite.Database,
): Promise<Chunk[]> {
    console_log(`[Step 2: Load chunks from database]`);
    const allChunks: Chunk[] = [];
    const selectAllChunks = db.prepare(`SELECT * FROM chunks`);
    const chunkRows: any[] = selectAllChunks.all();
    for (const chunkRow of chunkRows) {
        const blobRows: any[] = db
            .prepare(`SELECT * FROM blobs WHERE chunkId = ?`)
            .all(chunkRow.chunkId);
        for (const blob of blobRows) {
            blob.lines = blob.lines.split("\n");
            while (
                blob.lines.length &&
                !blob.lines[blob.lines.length - 1].trim()
            ) {
                blob.lines.pop();
            }
            for (let i = 0; i < blob.lines.length; i++) {
                blob.lines[i] = blob.lines[i] + "\n";
            }
        }
        const childRows: any[] = db
            .prepare(`SELECT * FROM chunks WHERE parentId = ?`)
            .all(chunkRow.chunkId);
        const chunk: Chunk = {
            chunkId: chunkRow.chunkId,
            treeName: chunkRow.treeName,
            codeName: chunkRow.codeName,
            blobs: blobRows, // Ignoring chunkId
            parentId: chunkRow.parentId,
            children: childRows.map((row) => row.chunkId),
            fileName: chunkRow.fileName,
            lineNo: chunkRow.lineNo,
        };
        allChunks.push(chunk);
    }
    console_log(`  [Loaded ${allChunks.length} chunks]`);
    return allChunks;
}

function constructPrompt(input: string, chunks: Chunk[]): string {
    console_log(`[Step 4: Construct a prompt for the oracle]`);
    return `\
        Please answer the user question using the given context.

        User question: "${input}"

        Context: ${prepareChunks(chunks)}

        User question: "${input}"
        `;
}

async function queryOracle(
    context: SpelunkerContext,
    prompt: string,
): Promise<Result<any>> {
    console_log(`[Step 5: Ask the oracle]`);
    return await context.queryContext!.oracle.translate(prompt);
}

function produceEntitiesFromResult(
    result: any,
    allChunks: Chunk[],
    db: sqlite.Database,
): Entity[] {
    console_log(`  [Success:]`);
    const outputEntities: Entity[] = [];
    for (const ref of result.references) {
        const chunk = allChunks.find((c) => c.chunkId === ref);
        if (!chunk) continue;
        const blob = db
            .prepare(
                `SELECT * FROM Blobs WHERE chunkId = ? ORDER BY start ASC LIMIT 1`,
            )
            .get(ref) as Blob | undefined;
        if (!blob) continue;
        const entity = {
            name: chunk.codeName,
            type: ["code", chunk.treeName.replace(/Def$/, "").toLowerCase()],
            uniqueId: ref,
            additionalEntityText: `${chunk.fileName}#${blob.start + 1}`,
        };
        outputEntities.push(entity);
    }
    return outputEntities;
}

function createResultEntity(input: string, answer: string): Entity {
    return {
        name: `answer for ${input}`,
        type: ["text", "answer", "markdown"],
        uniqueId: "", // TODO
        additionalEntityText: answer,
    };
}

export async function selectChunks(
    context: SpelunkerContext,
    allChunks: Chunk[],
    input: string,
): Promise<Chunk[]> {
    console_log(
        `[Step 3: Select relevant chunks from ${allChunks.length} chunks]`,
    );
    const promises: Promise<ChunkDescription[]>[] = [];
    const maxConcurrency =
        parseInt(process.env.AZURE_OPENAI_MAX_CONCURRENCY ?? "5") ?? 5;
    const limiter = createLimiter(maxConcurrency);
    const batchLimit = process.env.OPENAI_API_KEY ? 100000 : 250000; // TODO: tune
    const batches = makeBatches(allChunks, batchLimit);
    console_log(
        `  [${batches.length} batches, maxConcurrency ${maxConcurrency}]`,
    );
    for (const batch of batches) {
        const p = limiter(() =>
            selectRelevantChunks(
                context.queryContext!.chunkSelector,
                batch,
                input,
            ),
        );
        promises.push(p);
    }
    const allChunkDescs: ChunkDescription[] = [];
    for (const p of promises) {
        const chunkDescs = await p;
        if (chunkDescs.length) {
            allChunkDescs.push(...chunkDescs);
        }
    }
    // Reminder: There's no overlap in chunkIds between the slices
    console_log(
        `  [Total ${allChunkDescs.length} chunks selected out of a total of ${allChunks.length}]`,
    );

    allChunkDescs.sort((a, b) => b.relevance - a.relevance);
    // console_log(`  [${allChunks.map((c) => (c.relevance)).join(", ")}]`);
    const maxKeep = process.env.OPENAI_API_KEY ? 100000 : 200000; // TODO: tune
    const chunks = keepBestChunks(allChunkDescs, allChunks, maxKeep);
    console_log(`  [Keeping ${chunks.length} chunks]`);
    // for (let i = 0; i < chunks.length; i++) {
    //     const chunk = chunks[i];
    //     const chunkDesc = allChunkDescs[i];
    //     console_log(
    //         `    [${chunkDesc.relevance} ${path.basename(chunk.fileName)}:${chunk.codeName} ${chunk.chunkId}]`,
    //     );
    // }
    return chunks;
}

async function selectRelevantChunks(
    selector: TypeChatJsonTranslator<SelectorSpecs>,
    chunks: Chunk[],
    input: string,
): Promise<ChunkDescription[]> {
    // TODO: Prompt engineering
    const prompt = `\
    Please select up to 30 chunks that are relevant to the user question.
    Consider carefully how relevant each chunk is to the user question.
    Provide a relevance score between 0 and 1 (float).
    Report only the chunk ID and relevance for each selected chunk.
    Omit irrelevant or empty chunks. It's fine to select fewer than 30.

    User question: "${input}"

    Chunks:
    ${prepareChunks(chunks)}
    `;
    // console_log(prompt);
    const result = await retryTranslateOn429(() => selector.translate(prompt));
    if (!result) {
        console_log(`  [Failed to select chunks for ${chunks.length} chunks]`);
        return [];
    } else {
        return result.chunkDescs;
    }
}

function prepareChunks(chunks: Chunk[]): string {
    chunks.sort(
        // Sort by file name and chunk ID (should order by line number)
        (a, b) => {
            let cmp = a.fileName.localeCompare(b.fileName);
            if (!cmp) {
                cmp = a.lineNo - b.lineNo;
            }
            return cmp;
        },
    );
    const output: string[] = [];
    function put(line: string): void {
        // console_log(line.trimEnd());
        output.push(line);
    }
    let lastFn = "";
    let lineNo = 0;
    for (const chunk of chunks) {
        if (chunk.fileName !== lastFn) {
            lastFn = chunk.fileName;
            lineNo = 0;
            put("\n");
            put(`** file=${chunk.fileName}\n`);
        }
        put(
            `* chunkId=${chunk.chunkId} kind=${chunk.treeName} name=${chunk.codeName}\n`,
        );
        for (const blob of chunk.blobs) {
            lineNo = blob.start;
            for (const line of blob.lines) {
                lineNo += 1;
                put(`${lineNo} ${line}`);
            }
        }
    }
    return output.join("");
}

// TODO: Make the values two elements, comment start and comment end
// (and then caller should ensure comment end doesn't occur in the comment text).
const languageCommentMap: { [key: string]: string } = {
    python: "#",
    typescript: "//",
};

// TODO: Remove export once we're using summaries again.
export function prepareSummaries(db: sqlite.Database): string {
    const selectAllSummaries = db.prepare(`SELECT * FROM Summaries`);
    const summaryRows: any[] = selectAllSummaries.all();
    if (summaryRows.length > 100) {
        console_log(`  [Over 100 summary rows, skipping summaries in prompt]`);
        return "";
    }
    const lines: string[] = [];
    for (const summaryRow of summaryRows) {
        const comment = languageCommentMap[summaryRow.language] ?? "#";
        lines.push("");
        lines.push(`${comment} ${summaryRow.summary}`);
        lines.push(summaryRow.signature);
    }
    return lines.join("\n");
}

function createTranslator<T extends object>(
    model: ChatModel,
    schemaFile: string,
    typeName: string,
): TypeChatJsonTranslator<T> {
    const schema = loadSchema([schemaFile], import.meta.url);
    const validator = createTypeScriptJsonValidator<T>(schema, typeName);
    const translator = createJsonTranslator<T>(model, validator);
    return translator;
}

export interface FileMtimeSize {
    file: string;
    mtime: number;
    size: number;
}

// Recursively gather all .py and .ts files under a given directory.
function getAllSourceFiles(dir: string): FileMtimeSize[] {
    const supportedExtensions = [".py", ".ts"];
    const skipDirectories = ["node_modules", ".git", "dist"];

    let results: FileMtimeSize[] = [];

    // Resolve the directory to an absolute path
    const absoluteDir = path.isAbsolute(dir) ? dir : path.resolve(dir);

    // Read the contents of the directory
    const files = fs.readdirSync(absoluteDir);

    for (const file of files) {
        const filePath = path.join(absoluteDir, file);
        const lstat = fs.lstatSync(filePath);
        if (!lstat || lstat.isSymbolicLink()) {
            // Skip symlinks and files that failed to stat
            continue;
        }

        if (lstat.isDirectory() && !skipDirectories.includes(file)) {
            // Recursively search in subdirectories
            results = results.concat(getAllSourceFiles(filePath));
        } else if (
            lstat.isFile() &&
            supportedExtensions.includes(path.extname(file))
        ) {
            // It's a supported file type, add to the results
            results.push({
                file: filePath,
                mtime: lstat.mtimeMs / 1000,
                size: lstat.size,
            });
        }
    }

    return results;
}

async function loadDatabase(
    context: SpelunkerContext,
): Promise<sqlite.Database> {
    if (!context.queryContext) {
        context.queryContext = createQueryContext();
    }
    const db = createDatabase(context);

    const prepDeleteSummaries = db.prepare(`
        DELETE FROM Summaries WHERE chunkId IN (
            SELECT chunkId
            FROM chunks
            WHERE fileName = ?
        )
    `);
    const prepDeleteBlobs = db.prepare(`
        DELETE FROM Blobs WHERE chunkId IN (
            SELECT chunkId
            FROM chunks
            WHERE filename = ?
        )
    `);
    const prepDeleteChunks = db.prepare(
        `DELETE FROM Chunks WHERE fileName = ?`,
    );
    const prepDeleteFiles = db.prepare(`DELETE FROM files WHERE fileName = ?`);
    const prepInsertFiles = db.prepare(
        `INSERT OR REPLACE INTO Files (fileName, mtime, size) VALUES (?, ?, ?)`,
    );
    const prepSelectAllFiles = db.prepare(
        `SELECT fileName, mtime, size FROM Files`,
    );
    const prepInsertChunks = db.prepare(
        `INSERT OR REPLACE INTO Chunks (chunkId, treeName, codeName, parentId, fileName, lineNo) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const prepInsertBlobs = db.prepare(
        `INSERT INTO Blobs (chunkId, start, lines, breadcrumb) VALUES (?, ?, ?, ?)`,
    );

    // 1a. Find all source files in the focus directories (locally, using a recursive walk).
    // TODO: Factor into simpler functions
    console_log(`[Step 1a: Find supported source files]`);
    const files: FileMtimeSize[] = [];
    for (let i = 0; i < context.focusFolders.length; i++) {
        files.push(...getAllSourceFiles(context.focusFolders[i]));
    }

    // Compare files found and files in the database.
    const filesToDo: string[] = [];
    const filesInDb: Map<string, FileMtimeSize> = new Map();
    const fileRows: any[] = prepSelectAllFiles.all();
    for (const fileRow of fileRows) {
        filesInDb.set(fileRow.fileName, {
            file: fileRow.fileName,
            mtime: fileRow.mtime,
            size: fileRow.size,
        });
    }
    for (const file of files) {
        const dbStat = filesInDb.get(file.file);
        if (
            !dbStat ||
            dbStat.mtime !== file.mtime ||
            dbStat.size !== file.size
        ) {
            // console_log(`  [Need to update ${file} (mtime/size mismatch)]`);
            filesToDo.push(file.file);
            // TODO: Make this insert part of the transaction for this file
            prepInsertFiles.run(file.file, file.mtime, file.size);
            filesInDb.set(file.file, {
                file: file.file,
                mtime: file.mtime,
                size: file.size,
            });
        }
    }
    const filesSet: Set<string> = new Set(files.map((file) => file.file));
    const filesToDelete: string[] = [...filesInDb.keys()].filter(
        (file) => !filesSet.has(file),
    );
    if (filesToDelete.length) {
        console_log(`  [Deleting ${filesToDelete.length} files from database]`);
        for (const file of filesToDelete) {
            // console_log(`  [Deleting ${file} from database]`);
            db.exec(`BEGIN TRANSACTION`);
            prepDeleteSummaries.run(file);
            prepDeleteBlobs.run(file);
            prepDeleteChunks.run(file);
            prepDeleteFiles.run(file);
            db.exec(`COMMIT`);
        }
    }

    if (!filesToDo.length) {
        console_log(
            `  [No files to update out of ${files.length}, yay cache!]`,
        );
        return db;
    }

    // 1b. Chunkify all new files (without LLM help).
    // TODO: Make this into its own function.
    // TODO: Numbers may look weird when long files are split by pythonChunker.
    console_log(
        `[Step 1b: Chunking ${filesToDo.length} out of ${files.length} files]`,
    );
    const filesToDoPy = filesToDo.filter((f) => f.endsWith(".py"));
    const filesToDoTs = filesToDo.filter((f) => f.endsWith(".ts"));
    const allItems: (ChunkedFile | ChunkerErrorItem)[] = [];
    if (filesToDoPy.length) {
        const pyItems = await chunkifyPythonFiles(filesToDoPy);
        allItems.push(...pyItems);
    }
    if (filesToDoTs.length) {
        const tsItems = await chunkifyTypeScriptFiles(filesToDoTs);
        allItems.push(...tsItems);
    }
    const allErrorItems = allItems.filter(
        (item): item is ChunkerErrorItem => "error" in item,
    );
    for (const errorItem of allErrorItems) {
        // TODO: Use appendDisplay (requires passing actionContext)
        console_log(`[Error: ${errorItem.error}; Output: ${errorItem.output}]`);
    }
    const allChunkedFiles = allItems.filter(
        (item): item is ChunkedFile => "chunks" in item,
    );
    const allChunks: Chunk[] = [];
    for (const chunkedFile of allChunkedFiles) {
        db.exec(`BEGIN TRANSACTION`);
        prepDeleteSummaries.run(chunkedFile.fileName);
        prepDeleteBlobs.run(chunkedFile.fileName);
        prepDeleteChunks.run(chunkedFile.fileName);
        for (const chunk of chunkedFile.chunks) {
            allChunks.push(chunk);
            prepInsertChunks.run(
                chunk.chunkId,
                chunk.treeName,
                chunk.codeName,
                chunk.parentId || null,
                chunk.fileName,
                chunk.lineNo,
            );
            for (const blob of chunk.blobs) {
                prepInsertBlobs.run(
                    chunk.chunkId,
                    blob.start,
                    blob.lines.map((line) => line.trimEnd()).join("\n"),
                    blob.breadcrumb,
                );
            }
        }
        db.exec(`COMMIT`);
    }
    console_log(
        `  [Chunked ${allChunkedFiles.length} files into ${allChunks.length} chunks]`,
    );

    // 1c. Use a fast model to summarize all chunks.
    if (allChunks.length) {
        await summarizeChunks(context, allChunks);
    }

    return db;
}

async function summarizeChunks(
    context: SpelunkerContext,
    chunks: Chunk[],
): Promise<void> {
    console_log(`[Step 1c: Summarizing ${chunks.length} chunks]`);
    // NOTE: We cannot stuff the buffer, because the completion size
    // is limited to 4096 tokens, and we expect a certain number of
    // tokens per chunk. Experimentally, 40 chunks per job works great.
    const maxConcurrency =
        parseInt(process.env.AZURE_OPENAI_MAX_CONCURRENCY ?? "0") ?? 5;
    let chunksPerJob = 40;
    let numJobs = Math.ceil(chunks.length / chunksPerJob);
    console_log(
        `  [${chunksPerJob} chunks/job, ${numJobs} jobs, maxConcurrency ${maxConcurrency}]`,
    );
    const limiter = createLimiter(maxConcurrency);
    const promises: Promise<void>[] = [];
    for (let i = 0; i < chunks.length; i += chunksPerJob) {
        const slice = chunks.slice(i, i + chunksPerJob);
        promises.push(limiter(() => summarizeChunkSlice(context, slice)));
    }
    await Promise.all(promises);
}

async function summarizeChunkSlice(
    context: SpelunkerContext,
    chunks: Chunk[],
): Promise<void> {
    const summarizer = context.queryContext!.chunkSummarizer;
    // TODO: Prompt engineering
    const prompt = `\
    Please summarize each of the given chunks.
    A summary should be a one-line description of the chunk.
    Also include the signature of the chunk.

    Chunks:
    ${prepareChunks(chunks)}
    `;
    // console_log(prompt);
    const result = await retryTranslateOn429(() =>
        summarizer.translate(prompt),
    );
    if (!result) {
        console_log(
            `  [Failed to summarize chunks for ${chunks.length} chunks]`,
        );
        return;
    }

    const summarizeSpecs = result;
    // console_log(`  [Received ${result.summaries.length} summaries]`);
    // Enter them into the database
    const db = context.queryContext!.database!;
    const prepInsertSummary = db.prepare(
        `INSERT OR REPLACE INTO Summaries (chunkId, language, summary, signature) VALUES (?, ?, ?, ?)`,
    );
    const prepGetBlobWithBreadcrumb = db.prepare(
        `SELECT lines, breadcrumb FROM Blobs WHERE breadcrumb = ?`,
    );
    const prepUpdateBlob = db.prepare(
        "UPDATE Blobs SET lines = ? WHERE breadcrumb = ?",
    );
    let errors = 0;
    for (const summary of summarizeSpecs.summaries) {
        // console_log(summary);
        try {
            prepInsertSummary.run(
                summary.chunkId,
                summary.language,
                summary.summary,
                summary.signature,
            );
        } catch (error) {
            console_log(
                `*** Db error for insert summary ${JSON.stringify(summary)}: ${error}`,
            );
            errors += 1;
        }
        try {
            type BlobRowType = { lines: string; breadcrumb: ChunkId };
            const blobRow: BlobRowType = prepGetBlobWithBreadcrumb.get(
                summary.chunkId,
            ) as any;
            if (blobRow) {
                let blobLines: string = blobRow.lines;
                // Assume it doesn't start with a blank line /(^\s*\r?\n)*/
                const indent = blobLines?.match(/^(\s*)\S/)?.[1] ?? ""; // Whitespace followed by non-whitespace
                blobLines =
                    `${indent}${languageCommentMap[summary.language ?? "python"]} ${summary.summary}\n` +
                    `${indent}${summary.signature} ...\n`;
                // console_log(
                //     `  [Replacing\n'''\n${blobRow.lines}'''\nwith\n'''\n${blobLines}\n''']`,
                // );
                const res = prepUpdateBlob.run(blobLines, summary.chunkId);
                if (res.changes !== 1) {
                    console_log(
                        `  [*** Failed to update blob lines for ${summary.chunkId}]`,
                    );
                }
            }
        } catch (error) {
            console_log(
                `*** Db error for update blob ${JSON.stringify(summary)}: ${error}`,
            );
            errors += 1;
        }
    }
    if (errors) console_log(`  [${errors} errors]`);
}

async function retryTranslateOn429<T>(
    translate: () => Promise<Result<T>>,
    retries: number = 3,
    defaultDelay: number = 5000,
): Promise<T | undefined> {
    let wrappedResult: Result<T>;
    do {
        retries--;
        wrappedResult = await translate();
        // console_log(wrappedResult);
        if (!wrappedResult.success) {
            if (
                retries > 0 &&
                wrappedResult.message.includes("fetch error: 429:")
            ) {
                let delay = defaultDelay;
                const azureTime = wrappedResult.message.match(
                    /after (\d+) milliseconds/,
                );
                const openaiTime = wrappedResult.message.match(
                    /Please try again in (\d+\.\d*|\.\d+|\d+m)s./,
                );
                if (azureTime || openaiTime) {
                    if (azureTime) {
                        delay = parseInt(azureTime[1]);
                    } else if (openaiTime) {
                        delay = parseFloat(openaiTime[1]);
                        if (!openaiTime[1].endsWith("m")) {
                            delay *= 1000;
                        }
                    }
                } else {
                    console_log(
                        `  [Couldn't find msec in '${wrappedResult.message}'`,
                    );
                }
                console_log(`    [Retry on 429 error: sleep ${delay} ms]`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            console_log(`  [${wrappedResult.message}]`);
            return undefined;
        }
    } while (!wrappedResult.success);
    return wrappedResult.data;
}

function keepBestChunks(
    chunkDescs: ChunkDescription[], // Sorted by descending relevance
    allChunks: Chunk[],
    batchSize: number, // In characters
): Chunk[] {
    const chunks: Chunk[] = [];
    let size = 0;
    for (const chunkDesc of chunkDescs) {
        const chunk = allChunks.find((c) => c.chunkId === chunkDesc.chunkId);
        if (!chunk) continue;
        const chunkSize = getChunkSize(chunk);
        if (size + chunkSize > batchSize && chunks.length) {
            break;
        }
        chunks.push(chunk);
        size += chunkSize;
    }
    return chunks;
}

function makeBatches(
    chunks: Chunk[],
    batchSize: number, // In characters
): Chunk[][] {
    const batches: Chunk[][] = [];
    let batch: Chunk[] = [];
    let size = 0;
    function flush(): void {
        batches.push(batch);
        console_log(
            `    [Batch ${batches.length} has ${batch.length} chunks and ${size} bytes]`,
        );
        batch = [];
        size = 0;
    }
    for (const chunk of chunks) {
        const chunkSize = getChunkSize(chunk);
        if (size + chunkSize > batchSize && batch.length) {
            flush();
        }
        batch.push(chunk);
        size += chunkSize;
    }
    if (batch.length) {
        flush();
    }
    return batches;
}

function getChunkSize(chunk: Chunk): number {
    // This is all an approximation
    let size = chunk.fileName.length + 50;
    for (const blob of chunk.blobs) {
        size += blob.lines.join("").length + 4 * blob.lines.length;
    }
    return size;
}
