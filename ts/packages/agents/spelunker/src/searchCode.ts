// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";

import Database, * as sqlite from "better-sqlite3";

import { ChatModel, openai } from "aiclient";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import {
    ActionResult,
    ActionResultSuccess,
    Entity,
} from "@typeagent/agent-sdk";
import { createActionResultFromError } from "@typeagent/agent-sdk/helpers/action";
import { loadSchema } from "typeagent";

import { AnswerSpecs } from "./makeAnswerSchema.js";
import { ChunkDescription, SelectorSpecs } from "./makeSelectorSchema.js";
import { SpelunkerContext } from "./spelunkerActionHandler.js";
import {
    Chunk,
    ChunkedFile,
    chunkifyPythonFiles,
    ErrorItem,
} from "./pythonChunker.js";
import { SummarizeSpecs } from "./makeSummarizeSchema.js";
import { createRequire } from "module";

let epoch: number = 0;

function console_log(...rest: any[]): void {
    if (!epoch) {
        epoch = Date.now();
        console.log(""); // Start new epoch with a blank line
    }
    const t = Date.now();
    console.log(((t - epoch) / 1000).toFixed(3).padStart(6), ...rest);
}

export interface QueryContext {
    chatModel: ChatModel;
    answerMaker: TypeChatJsonTranslator<AnswerSpecs>;
    miniModel: ChatModel;
    chunkSelector: TypeChatJsonTranslator<SelectorSpecs>;
    chunkSummarizer: TypeChatJsonTranslator<SummarizeSpecs>;
    databaseLocation: string;
    database: sqlite.Database | undefined;
}

function createQueryContext(): QueryContext {
    const chatModel = openai.createChatModelDefault("spelunkerChat");
    const answerMaker = createTranslator<AnswerSpecs>(
        chatModel,
        "makeAnswerSchema.ts",
        "AnswerSpecs",
    );
    const miniModel = openai.createChatModel(
        "GPT_4_0_MINI",
        undefined,
        undefined,
        ["spelunkerMini"],
    );
    const chunkSelector = createTranslator<SelectorSpecs>(
        miniModel,
        "makeSelectorSchema.ts",
        "SelectorSpecs",
    );
    const chunkSummarizer = createTranslator<SummarizeSpecs>(
        miniModel,
        "makeSummarizeSchema.ts",
        "SummarizeSpecs",
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
    const databaseLocation = path.join(databaseFolder, "database.db");
    const database = undefined;
    return {
        chatModel,
        answerMaker,
        miniModel,
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

    // 0. Check if the focus is set.
    if (!context.focusFolders.length) {
        return createActionResultFromError("Please set the focus to a folder");
    }

    // 1. Create the database, chunkify all files in the focus folders, and store the chunks.
    //    Or use what's in the database if it looks up-to-date.
    console_log(`[Step 1: Load database]`);
    const db = await loadDatabase(context);

    // 2. Load all chunks from the database.
    console_log(`[Step 2: Load chunks from database]`);
    const allChunks: Chunk[] = [];
    const selectAllChunks = db.prepare(`SELECT * FROM chunks`);
    const chunkRows: any[] = selectAllChunks.all();
    for (const chunkRow of chunkRows) {
        const blobRows: any[] = db
            .prepare(`SELECT * FROM blobs WHERE chunkId = ?`)
            .all(chunkRow.chunkId);
        const childRows: any[] = db
            .prepare(`SELECT * FROM chunks WHERE parentId = ?`)
            .all(chunkRow.chunkId);
        const chunk: Chunk = {
            chunkId: chunkRow.chunkId,
            treeName: chunkRow.treeName,
            blobs: blobRows, // Ignoring chunkId
            parentId: chunkRow.parentId,
            children: childRows.map((row) => row.chunkId),
            fileName: chunkRow.fileName,
        };
        allChunks.push(chunk);
    }

    // 3. Ask a fast LLM for the most relevant chunks, rank them, and keep tthe best 30.
    // This is done concurrently for real-time speed.
    console_log(`[Step 3: Select 30 most relevant chunks]`);
    const chunkDescs: ChunkDescription[] = await selectChunks(
        context,
        allChunks,
        input,
    );
    if (!chunkDescs.length) {
        throw new Error("No chunks selected");
    }

    // 4. Construct a prompt from those chunks.
    console_log(`[Step 4: Construct a prompt for the smart LLM]`);
    const preppedChunks: Chunk[] = chunkDescs
        .map((chunkDesc) => prepChunk(chunkDesc, allChunks))
        .filter(Boolean) as Chunk[];
    // TODO: Prompt engineering; more efficient preparation of summaries and chunks
    const prompt = `\
        Please answer the user question using the given context and summaries.

        Summaries of all chunks in the code base:

        ${prepareSummaries(db)}

        Context:

        ${prepareChunks(preppedChunks)}

        User question: "${input}"
        `;
    // console_log(`[${prompt.slice(0, 1000)}]`);

    // 5. Send prompt to smart, code-savvy LLM.
    console_log(`[Step 5: Ask the smart LLM]`);
    const wrappedResult =
        await context.queryContext!.answerMaker.translate(prompt);
    if (!wrappedResult.success) {
        console_log(`  [It's a failure: ${wrappedResult.message}]`);
        return createActionResultFromError(
            `Failed to get an answer: ${wrappedResult.message}`,
        );
    }
    console_log(`  [It's a success]`);
    const result = wrappedResult.data;
    console_log(`  [References: ${result.references.join(", ")}]`);
    // console_log(`[${JSON.stringify(result, undefined, 2).slice(0, 1000)}]`);

    // 6. Extract answer and references from result.
    const answer = result.answer;
    // TODO: References

    // 7. Produce an action result from that.
    const entities: Entity[] = []; // TODO: Construct from references
    return createActionResultFromMarkdownDisplay(answer, entities);
}

function prepChunk(
    chunkDesc: ChunkDescription,
    allChunks: Chunk[],
): Chunk | undefined {
    const chunks = allChunks.filter(
        (chunk) => chunk.chunkId === chunkDesc.chunkId,
    );
    if (chunks.length !== 1) return undefined;
    return chunks[0];
}

async function selectChunks(
    context: SpelunkerContext,
    chunks: Chunk[],
    input: string,
): Promise<ChunkDescription[]> {
    console_log(`  [Starting chunk selection ...]`);
    const promises: Promise<ChunkDescription[]>[] = [];
    // TODO: Throttle if too many concurrent calls (e.g. > AZURE_OPENAI_MAX_CONCURRENCY)
    const maxConcurrency =
        parseInt(process.env.AZURE_OPENAI_MAX_CONCURRENCY ?? "0") ?? 40;
    const chunksPerJob =
        chunks.length / maxConcurrency < 5
            ? 5
            : Math.ceil(chunks.length / maxConcurrency);
    const numJobs = Math.ceil(chunks.length / chunksPerJob);
    console_log(
        `  [maxConcurrency = ${maxConcurrency}, chunksPerJob = ${chunksPerJob}, numJobs = ${numJobs}]`,
    );
    for (let i = 0; i < chunks.length; i += chunksPerJob) {
        const slice = chunks.slice(i, i + chunksPerJob);
        const p = selectRelevantChunks(
            context.queryContext!.chunkSelector,
            slice,
            input,
        );
        promises.push(p);
    }
    const allChunks: ChunkDescription[] = [];
    for (const p of promises) {
        const chunks = await p;
        if (chunks.length) {
            // console_log(
            //     "Pushing",
            //     chunks.length,
            //     "for",
            //     chunks[0].chunkId,
            //     "--",
            //     chunks[chunks.length - 1].chunkId,
            // );
            allChunks.push(...chunks);
        }
    }
    console_log(`  [Total ${allChunks.length} chunks]`);
    allChunks.sort((a, b) => b.relevance - a.relevance);
    // console_log(`  [${allChunks.map((c) => (c.relevance)).join(", ")}]`);
    allChunks.splice(30);
    console_log(`  [Keeping ${allChunks.length} chunks]`);
    // console_log(`  [${allChunks.map((c) => [c.chunkId, c.relevance])}]`);
    return allChunks;
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
    Provide a relevance scsore between 0 and 1 (float).
    Report only the chunk ID and relevance for each selected chunk.
    Omit irrelevant chunks. It's fine to select fewer than 30.

    User question: "{input}"

    Chunks:
    ${prepareChunks(chunks)}
    `;
    // console_log(prompt);
    const wrappedResult = await selector.translate(prompt);
    // console_log(wrappedResult);
    if (!wrappedResult.success) {
        console_log(`[Error selecting chunks: ${wrappedResult.message}]`);
        return [];
    }
    const result = wrappedResult.data;
    return result.chunks;
}

function prepareChunks(chunks: Chunk[]): string {
    // TODO: Format the chunks more efficiently
    return JSON.stringify(chunks, undefined, 2);
}

function prepareSummaries(db: sqlite.Database): string {
    const selectAllSummaries = db.prepare(`SELECT * FROM Summaries`);
    const summaryRows: any[] = selectAllSummaries.all();
    // TODO: format as code: # <summary> / <signature>
    return JSON.stringify(summaryRows, undefined, 2);
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

/**
 * Recursively gathers all .py files under a given directory synchronously.
 *
 * @param dir - The directory to search within.
 * @returns An array of absolute paths to .py files.
 *
 * (Written by ChatGPT)
 */
function getAllPyFilesSync(dir: string): string[] {
    let results: string[] = [];

    // Resolve the directory to an absolute path
    const absoluteDir = path.isAbsolute(dir) ? dir : path.resolve(dir);

    // Read the contents of the directory
    const list = fs.readdirSync(absoluteDir);

    list.forEach((file) => {
        const filePath = path.join(absoluteDir, file);
        const stat = fs.statSync(filePath);

        if (stat && !stat.isSymbolicLink() && stat.isDirectory()) {
            // Recursively search in subdirectories
            results = results.concat(getAllPyFilesSync(filePath));
        } else if (stat && stat.isFile() && path.extname(file) === ".py") {
            // If it's a .py file, add to the results
            results.push(filePath);
        }
    });

    return results;
}

// Should be in actionHelpers.ts
function createActionResultFromMarkdownDisplay(
    markdownText: string,
    entities?: Entity[],
): ActionResultSuccess {
    return {
        literalText: markdownText,
        entities: entities ?? [],
        displayContent: { type: "markdown", content: markdownText },
    };
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
    const prepCountChunks = db.prepare(
        `SELECT COUNT(*) FROM Chunks WHERE fileName = ?`,
    );
    const prepInsertChunks = db.prepare(
        `INSERT OR REPLACE INTO Chunks (chunkId, treeName, parentId, fileName) VALUES (?, ?, ?, ?)`,
    );
    const prepInsertBlobs = db.prepare(
        `INSERT INTO Blobs (chunkId, start, lines, breadcrumb) VALUES (?, ?, ?, ?)`,
    );

    // 1a. Find all .py files in the focus directories (locally, using a subprocess).
    // TODO: Factor into simpler functions
    console_log(`[Step 1a: Find .py files]`);
    const files: string[] = []; // TODO: Include mtime and size, since we do a stat anyways
    for (let i = 0; i < context.focusFolders.length; i++) {
        files.push(...getAllPyFilesSync(context.focusFolders[i]));
    }

    // Compare files found and files in the database.
    const filesToDo: string[] = [];
    const filesInDb: Map<string, { mtime: number; size: number }> = new Map();
    const fileRows: any[] = prepSelectAllFiles.all();
    for (const fileRow of fileRows) {
        filesInDb.set(fileRow.fileName, {
            mtime: fileRow.mtime,
            size: fileRow.size,
        });
    }
    for (const file of files) {
        // TODO: Error handling
        const stat = fs.statSync(file);
        const dbStat = filesInDb.get(file);
        if (
            !dbStat ||
            dbStat.mtime !== stat.mtimeMs * 0.001 ||
            dbStat.size !== stat.size
        ) {
            // console_log(`  [Need to update ${file} (mtime/size mismatch)]`);
            filesToDo.push(file);
            // TODO: Make this insert part of the transaction for this file
            prepInsertFiles.run(file, stat.mtimeMs * 0.001, stat.size);
            filesInDb.set(file, {
                mtime: stat.mtimeMs * 0.001,
                size: stat.size,
            });
        }
        if (!filesToDo.includes(file)) {
            // If there are no chunks, also add to filesToDo
            // TODO: Zero chunks is not reliable, empty files haalso ve zero chunks
            const count: number = (prepCountChunks.get(file) as any)[
                "COUNT(*)"
            ];
            if (!count) {
                // console_log(`  [Need to update ${file} (no chunks)]`);
                filesToDo.push(file);
            }
        }
    }
    const filesToDelete: string[] = [...filesInDb.keys()].filter(
        (file) => !files.includes(file),
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
    const allItems: (ChunkedFile | ErrorItem)[] =
        await chunkifyPythonFiles(filesToDo);
    const allErrorItems = allItems.filter(
        (item): item is ErrorItem => "error" in item,
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
            // TODO: Assuming this never throws, just remove this
            if (!chunk.fileName) {
                throw new Error(`Chunk ${chunk.chunkId} has no fileName`);
            }
            allChunks.push(chunk);
            prepInsertChunks.run(
                chunk.chunkId,
                chunk.treeName,
                chunk.parentId || null,
                chunk.fileName,
            );
            for (const blob of chunk.blobs) {
                prepInsertBlobs.run(
                    chunk.chunkId,
                    blob.start,
                    blob.lines.map((line) => line.trimEnd()).join("\n"),
                    blob.breadcrumb ? 1 : 0,
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

const databaseSchema = `
CREATE TABLE IF NOT EXISTS Files (
    fileName TEXT PRIMARY KEY,
    mtime FLOAT NOT NULL,
    size INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS Chunks (
    chunkId TEXT PRIMARY KEY,
    treeName TEXT NOT NULL,
    parentId TEXT KEY REFERENCES chunks(chunkId), -- May be null
    fileName TEXT KEY REFERENCES files(fileName) NOT NULL
);
CREATE TABLE IF NOT EXISTS Blobs (
    chunkId TEXT KEY REFERENCES chunks(chunkId) NOT NULL,
    start INTEGER NOT NULL, -- 0-based
    lines TEXT NOT NULL,
    breadcrumb BOOLEAN NOT NULL -- Values: 0 or 1
);
CREATE TABLE IF NOT EXISTS Summaries (
    chunkId TEXT PRIMARY KEY REFERENCES chunks(chunkId),
    summary TEXT,
    signature TEXT
)
`;

function getDbOptions() {
    if (process?.versions?.electron !== undefined) {
        return undefined;
    }
    const r = createRequire(import.meta.url);
    const betterSqlitePath = r.resolve("better-sqlite3/package.json");
    const nativeBinding = path.join(
        betterSqlitePath,
        "../build/Release/better_sqlite3.n.node",
    );
    return { nativeBinding };
}

function createDatabase(context: SpelunkerContext): sqlite.Database {
    if (!context.queryContext) {
        context.queryContext = createQueryContext();
    }
    const loc = context.queryContext.databaseLocation;
    const db0 = context.queryContext.database;
    if (db0) {
        console_log(`  [Using database at ${loc}]`);
        return db0;
    }
    if (fs.existsSync(loc)) {
        console_log(`  [Opening database at ${loc}]`);
    } else {
        console_log(`  [Creating database at ${loc}]`);
    }
    const db = new Database(loc, getDbOptions());
    // Write-Ahead Logging, improving concurrency and performance
    db.pragma("journal_mode = WAL");
    // Fix permissions to be read/write only by the owner
    fs.chmodSync(context.queryContext.databaseLocation, 0o600);
    // Create all the tables we'll use
    db.exec(databaseSchema);
    context.queryContext.database = db;
    return db;
}

async function summarizeChunks(
    context: SpelunkerContext,
    chunks: Chunk[],
): Promise<void> {
    console_log(
        `[Step 1c: Summarizing ${chunks.length} chunks (may take a while)]`,
    );
    const maxConcurrency =
        parseInt(process.env.AZURE_OPENAI_MAX_CONCURRENCY ?? "0") ?? 40;
    let chunksPerJob = Math.ceil(chunks.length / maxConcurrency);
    if (chunksPerJob < 5) {
        chunksPerJob = 5;
    }
    // TODO: Use a semaphore to limit parallelism
    const promises: Promise<void>[] = [];
    for (let i = 0; i < chunks.length; i += chunksPerJob) {
        const slice = chunks.slice(i, i + chunksPerJob);
        promises.push(summarizeChunkSlice(context, slice));
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
    const wrappedResult = await summarizer.translate(prompt);
    // console_log(wrappedResult);
    if (!wrappedResult.success) {
        console_log(`  [Error summarizing chunks: ${wrappedResult.message}]`);
        return;
    }
    const summarizeSpecs = wrappedResult.data;
    // console_log(`  [Received ${result.summaries.length} summaries]`);
    // Enter them into the database
    const db = context.queryContext!.database!;
    const prepInsertSummary = db.prepare(`
        INSERT OR REPLACE INTO Summaries (chunkId, summary, signature) VALUES (?, ?, ?)
    `);
    let errors = 0;
    for (const summary of summarizeSpecs.summaries) {
        // console_log(summary);
        try {
            prepInsertSummary.run(
                summary.chunkId,
                summary.summary,
                summary.signature,
            );
        } catch (error) {
            errors += 1;
            // console_log(`*** Error for ${JSON.stringify(summary)}: ${error}`);
        }
    }
    if (errors) console_log(`  [${errors} errors]`);
}
