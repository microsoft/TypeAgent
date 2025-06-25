// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";

import * as sqlite from "better-sqlite3";
import { Result, TypeChatJsonTranslator } from "typechat";

import { createLimiter } from "common-utils";
import { ActionResult, Entity } from "@typeagent/agent-sdk";
import {
    createActionResultFromMarkdownDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";

import { keepBestChunks, makeBatches } from "./batching.js";
import {
    Blob,
    Chunk,
    ChunkId,
    ChunkedFile,
    ChunkerErrorItem,
} from "./chunkSchema.js";
import { createDatabase, purgeFile } from "./databaseUtils.js";
import { loadEmbeddings, preSelectChunks } from "./embeddings.js";
import { console_log, resetEpoch } from "./logging.js";
import { OracleSpecs } from "./oracleSchema.js";
import { chunkifyPythonFiles } from "./pythonChunker.js";
import { createQueryContext } from "./queryContext.js";
import { retryOn429 } from "./retryLogic.js";
import { ChunkDescription, SelectorSpecs } from "./selectorSchema.js";
import { SpelunkerContext } from "./spelunkerActionHandler.js";
import { prepareChunks } from "./summarizing.js";
import { chunkifyTypeScriptFiles } from "./typescriptChunker.js";

// Answer a question; called from request and from searchCode action
export async function searchCode(
    context: SpelunkerContext,
    input: string,
): Promise<ActionResult> {
    resetEpoch();
    console_log(`[searchCode question='${input}']`);

    // 0. Check if the focus is set.
    if (!context.focusFolders.length) {
        return createActionResultFromError("Please set the focus to a folder");
    }

    // 1. Create the database, chunkify all files in the focus folders, and store the chunks.
    //    Or use what's in the database if it looks up-to-date.
    if (!context.queryContext) {
        context.queryContext = createQueryContext();
    }
    createDatabase(context);
    await loadDatabase(context);
    const db = context.queryContext!.database!;

    // 2. Load all chunks from the database.
    const allChunks = await readAllChunksFromDatabase(db);

    // 3. Ask a fast LLM for the most relevant chunk Ids, rank them, and keep the best ones.
    const chunks = await selectChunks(context, allChunks, input);
    if (!chunks.length) {
        return createActionResultFromError(
            "No chunks selected (server access problem?)",
        );
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
    const result: OracleSpecs = wrappedResult.data;
    const answer =
        result.answer.trimEnd() + formatReferences(result.references);

    // 6a. Log the answer to a permanent place.
    // Wrong place in the hierarchy, but avoids accidental deletion
    const logFile: string = path.join(process.env.HOME ?? "", ".spelunker.log");
    const logRecord = JSON.stringify(result);
    const fd = fs.openSync(logFile, "a");
    fs.writeSync(fd, logRecord + "\n");
    fs.closeSync(fd);

    // 7. Produce entities and an action result from the result.
    const outputEntities = produceEntitiesFromResult(result, allChunks, db);
    const resultEntity = createResultEntity(input, answer);

    return createActionResultFromMarkdownDisplay(
        answer,
        undefined,
        outputEntities,
        resultEntity,
    );
}

function formatReferences(references: ChunkId[]): string {
    if (!references.length) return "";
    const answer: string[] = ["\n\nReferences: "];
    let prefix: string = " ";
    for (const ref of references) {
        answer.push(`${prefix}${ref}`);
        prefix = ", ";
    }
    return answer.join("");
}

export async function readAllChunksFromDatabase(
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
): Promise<Result<OracleSpecs>> {
    console_log(`[Step 5: Ask the oracle]`);
    return await context.queryContext!.oracle.translate(prompt);
}

function produceEntitiesFromResult(
    result: OracleSpecs,
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
            uniqueId: `${ref}|${chunk.fileName}#${blob.start + 1}`,
        };
        outputEntities.push(entity);
    }
    return outputEntities;
}

function createResultEntity(input: string, answer: string): Entity {
    return {
        name: `answer for ${input}`,
        type: ["text", "answer", "markdown"],
        uniqueId: answer,
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
    console_log(`[Step 3a: Pre-select with fuzzy matching]`);
    const nearestChunkIds = await preSelectChunks(context, input, 500);
    if (!nearestChunkIds.length) {
        // Fail fast if preselection failed.
        console_log(`  [Preselection failed -- server access problem?]`);
        return [];
    }
    allChunks = allChunks.filter((c) => nearestChunkIds.includes(c.chunkId));
    console_log(`  [Pre-selected ${allChunks.length} chunks]`);

    console_log(`[Step 3b: Narrow those down with LLM]`);
    const promises: Promise<ChunkDescription[]>[] = [];
    const maxConcurrency =
        parseInt(process.env.AZURE_OPENAI_MAX_CONCURRENCY ?? "5") ?? 5;
    const limiter = createLimiter(maxConcurrency);
    const batchLimit = process.env.OPENAI_API_KEY ? 100000 : 100000; // TODO: tune
    const batches = makeBatches(allChunks, batchLimit, 60); // TODO: tune
    console_log(
        `  [${batches.length} batches, maxConcurrency ${maxConcurrency}]`,
    );
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const p = limiter(() =>
            selectRelevantChunks(
                context.queryContext!.chunkSelector,
                batch,
                input,
                i,
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
    const maxKeep = process.env.OPENAI_API_KEY ? 100000 : 100000; // TODO: tune
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
    batchIndex: number,
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
    const result = await retryOn429(() => selector.translate(prompt));
    if (!result) {
        console_log(
            `  [Failed to select chunks for batch ${batchIndex + 1} with ${chunks.length} chunks]`,
        );
        return [];
    } else {
        return result.chunkDescs;
    }
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

// TODO: Break into multiple functions.
// Notably the part that compares files in the database and files on disk.
export async function loadDatabase(context: SpelunkerContext): Promise<void> {
    console_log(`[Step 1: Load database]`);
    if (!context.queryContext) {
        context.queryContext = createQueryContext();
    }
    const db = context.queryContext!.database!;

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
    const filesToInsert: FileMtimeSize[] = [];
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
            filesToInsert.push(file);
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
            purgeFile(db, file);
        }
    }

    if (!filesToDo.length) {
        console_log(
            `  [No files to update out of ${files.length}, yay cache!]`,
        );
        return;
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
        purgeFile(db, chunkedFile.fileName);
        db.exec(`BEGIN TRANSACTION`);
        const file = filesToInsert.find((f) => f.file === chunkedFile.fileName);
        if (!file) {
            console_log(
                `  [*** File ${chunkedFile.fileName} is missing from filesToInsert]`,
            );
            continue;
        }
        prepInsertFiles.run(file.file, file.mtime, file.size);
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
    if (!allChunks.length) {
        console_log(`  [No chunks to load]`);
        return;
    }

    // 1c. Store all chunk embeddings.
    await loadEmbeddings(context, allChunks);

    // 1d. Use a fast model to summarize all chunks.
    // await summarizeChunks(context, allChunks);
}
