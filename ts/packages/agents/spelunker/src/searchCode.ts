// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";

import Database, * as sqlite from "better-sqlite3";

import { createJsonTranslator, Result, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import { ChatModel, openai } from "aiclient";
import { createLimiter } from "common-utils";

import {
    ActionResult,
    ActionResultSuccess,
    Entity,
} from "@typeagent/agent-sdk";
import { createActionResultFromError } from "@typeagent/agent-sdk/helpers/action";
import { loadSchema } from "typeagent";

import { Blob, Chunk, ChunkedFile, ChunkerErrorItem } from "./chunkSchema.js";
import { OracleSpecs } from "./oracleSchema.js";
import { chunkifyPythonFiles } from "./pythonChunker.js";
import { ChunkDescription, SelectorSpecs } from "./selectorSchema.js";
import { SpelunkerContext } from "./spelunkerActionHandler.js";
import { SummarizerSpecs } from "./summarizerSchema.js";
import { chunkifyTypeScriptFiles } from "./typescriptChunker.js";

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
    oracle: TypeChatJsonTranslator<OracleSpecs>;
    miniModel: ChatModel;
    chunkSelector: TypeChatJsonTranslator<SelectorSpecs>;
    chunkSummarizer: TypeChatJsonTranslator<SummarizerSpecs>;
    databaseLocation: string;
    database: sqlite.Database | undefined;
}

function createQueryContext(): QueryContext {
    const chatModel = openai.createChatModelDefault("spelunkerChat");
    const oracle = createTranslator<OracleSpecs>(
        chatModel,
        "oracleSchema.ts",
        "OracleSpecs",
    );
    const miniModel = openai.createChatModel(
        undefined, // "GPT_4_O_MINI" is slower than default model?!
        undefined,
        undefined,
        ["spelunkerMini"],
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
        oracle,
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
    console_log(`[searchCode question='${input}']`);

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

    // 3. Ask a fast LLM for the most relevant chunks, rank them, and keep the best N.
    // This is done concurrently for real-time speed.
    const keep = 50; // N
    console_log(`[Step 3: Select ${keep} most relevant chunks]`);
    const chunkDescs: ChunkDescription[] = await selectChunks(
        context,
        allChunks,
        input,
        50,
    );
    if (!chunkDescs.length) {
        throw new Error("No chunks selected");
    }

    // 4. Construct a prompt from those chunks.
    console_log(`[Step 4: Construct a prompt for the oracle]`);
    const preppedChunks: Chunk[] = chunkDescs
        .map((chunkDesc) => prepChunk(chunkDesc, allChunks))
        .filter(Boolean) as Chunk[];
    // TODO: Prompt engineering
    // TODO: Include summaries in the prompt
    const prompt = `\
        Please answer the user question using the given context.

        User question: "${input}"

        Context: ${prepareChunks(preppedChunks)}

        User question: "${input}"
        `;
    // console_log(`[${prompt.slice(0, 1000)}]`);

    // 5. Send prompt to smart, code-savvy LLM.
    console_log(`[Step 5: Ask the oracle]`);
    const wrappedResult = await context.queryContext!.oracle.translate(prompt);
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

    // 7. Produce an action result from that.
    const outputEntities: Entity[] = [];
    console_log(`  [Entities returned:]`);
    for (const ref of result.references) {
        const chunk = allChunks.find((c) => c.chunkId === ref);
        if (!chunk) continue;
        // Need the first blob; blob.start + 1 gives the line number
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
            // TODO: Include summary and signature somehow?
        };
        outputEntities.push(entity);
        console_log(
            `    [${entity.name} (${entity.type}) ${entity.uniqueId} ${entity.additionalEntityText}]`,
        );
    }

    const resultEntity: Entity = {
        name: `answer for ${input}`,
        type: ["text", "answer", "markdown"],
        uniqueId: "", // TODO
        additionalEntityText: answer,
    };
    return createActionResultFromMarkdownDisplay(
        answer,
        outputEntities,
        resultEntity,
    );
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
    keep: number,
): Promise<ChunkDescription[]> {
    console_log(`  [Starting chunk selection ...]`);
    const promises: Promise<ChunkDescription[]>[] = [];
    const maxConcurrency =
        parseInt(process.env.AZURE_OPENAI_MAX_CONCURRENCY ?? "0") ?? 40;
    const limiter = createLimiter(maxConcurrency);
    const chunksPerJob = 30;
    const numJobs = Math.ceil(chunks.length / chunksPerJob);
    console_log(
        `  [maxConcurrency = ${maxConcurrency}, chunksPerJob = ${chunksPerJob}, numJobs = ${numJobs}]`,
    );
    for (let i = 0; i < chunks.length; i += chunksPerJob) {
        const slice = chunks.slice(i, i + chunksPerJob);
        const p = limiter(() =>
            selectRelevantChunks(
                context.queryContext!.chunkSelector,
                slice,
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
    console_log(`  [Total ${allChunkDescs.length} chunks selected]`);

    allChunkDescs.sort((a, b) => b.relevance - a.relevance);
    // console_log(`  [${allChunks.map((c) => (c.relevance)).join(", ")}]`);
    allChunkDescs.splice(keep);
    console_log(`  [Keeping ${allChunkDescs.length} chunks]`);
    // console_log(`  [${allChunks.map((c) => [c.chunkId, c.relevance])}]`);
    return allChunkDescs;
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
        const chunkSummary = chunks
            .map((c) => `${path.basename(c.fileName)}:${c.codeName}`)
            .join(", ");
        console_log(`  [Failed to select chunks for ${chunkSummary}]`);
        return [];
    } else {
        return result.chunks;
    }
}

function prepareChunks(chunks: Chunk[]): string {
    chunks.sort(
        // Sort by file name and chunk ID (should order by line number)
        (a, b) => {
            let cmp = a.fileName.localeCompare(b.fileName);
            if (!cmp) {
                cmp = a.chunkId.localeCompare(b.chunkId);
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

// TODO: Remove export once we're using summaries again.
export function prepareSummaries(db: sqlite.Database): string {
    const languageCommentMap: { [key: string]: string } = {
        python: "#",
        typescript: "//",
    };
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

// Should be in actionHelpers.ts
function createActionResultFromMarkdownDisplay(
    literalText: string,
    entities: Entity[] = [],
    resultEntity?: Entity,
): ActionResultSuccess {
    return {
        literalText,
        entities,
        resultEntity,
        displayContent: { type: "markdown", content: literalText },
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
    const prepInsertChunks = db.prepare(
        `INSERT OR REPLACE INTO Chunks (chunkId, treeName, codeName, parentId, fileName, lineNo) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const prepInsertBlobs = db.prepare(
        `INSERT INTO Blobs (chunkId, start, lines, breadcrumb) VALUES (?, ?, ?, ?)`,
    );

    // 1a. Find all source files in the focus directories (locally, using a recursive walk).
    // TODO: Factor into simpler functions
    console_log(`[Step 1a: Find source files (of supported languages)]`);
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

    // Let's see how things go without summaries.
    // They are slow and don't fit in the oracle's buffer.
    // TODO: Restore this feature.

    // // 1c. Use a fast model to summarize all chunks.
    // if (allChunks.length) {
    //     await summarizeChunks(context, allChunks);
    // }

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
    codeName TEXT NOT NULL,
    parentId TEXT KEY REFERENCES Chunks(chunkId), -- May be null
    fileName TEXT KEY REFERENCES files(fileName) NOT NULL,
    lineNo INTEGER NOT NULL -- 1-based
);
CREATE TABLE IF NOT EXISTS Blobs (
    chunkId TEXT KEY REFERENCES Chunks(chunkId) NOT NULL,
    start INTEGER NOT NULL, -- 0-based
    lines TEXT NOT NULL,
    breadcrumb TEXT -- Chunk ID or empty string or NULL
);
CREATE TABLE IF NOT EXISTS Summaries (
    chunkId TEXT PRIMARY KEY REFERENCES Chunks(chunkId),
    language TEXT, -- "python", "typescript", etc.
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

export async function summarizeChunks(
    context: SpelunkerContext,
    chunks: Chunk[],
): Promise<void> {
    console_log(
        `[Step 1c: Summarizing ${chunks.length} chunks (may take a while)]`,
    );
    const maxConcurrency =
        parseInt(process.env.AZURE_OPENAI_MAX_CONCURRENCY ?? "0") ?? 40;
    let chunksPerJob = 30;
    let numJobs = Math.ceil(chunks.length / chunksPerJob);
    console_log(
        `  [maxConcurrency = ${maxConcurrency}, chunksPerJob = ${chunksPerJob}, numJobs = ${numJobs}]`,
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
        const chunkSummary = chunks
            .map((c) => `${path.basename(c.fileName)}:${c.codeName}`)
            .join(", ");
        console_log(`  [Failed to summarize chunks for ${chunkSummary}]`);
        return;
    }

    const summarizeSpecs = result;
    // console_log(`  [Received ${result.summaries.length} summaries]`);
    // Enter them into the database
    const db = context.queryContext!.database!;
    const prepInsertSummary = db.prepare(`
        INSERT OR REPLACE INTO Summaries (chunkId, language, summary, signature) VALUES (?, ?, ?, ?)
    `);
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
                `*** Db error for INSERT INTO Summaries ${JSON.stringify(summary)}: ${error}`,
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
                const msec = wrappedResult.message.match(
                    /after (\d+) milliseconds/,
                );
                if (msec) {
                    delay = parseInt(msec[1]) ?? defaultDelay;
                } else {
                    console_log(
                        `  [Couldn't find msec in '${wrappedResult.message}'`,
                    );
                }
                console_log(`  [Retry on 429 error: sleep ${delay} ms]`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            console_log(`  [${wrappedResult.message}]`);
            return undefined;
        }
    } while (!wrappedResult.success);
    return wrappedResult.data;
}
