// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TODO: Most of this is not Python specific; generalize to other languages.

import chalk, { ChalkInstance } from "chalk";
import * as fs from "fs";
import * as knowLib from "knowledge-processor";
import { asyncArray } from "typeagent";

import * as iapp from "interactive-app";
import { ChunkyIndex, IndexNames } from "./chunkyIndex.js";
import { ChunkDoc, FileDocumentation } from "./fileDocSchema.js";
import {
    Chunk,
    ChunkedFile,
    ChunkId,
    chunkifyPythonFiles,
    ErrorItem,
} from "./pythonChunker.js";
import { purgeNormalizedFile } from "./queryInterface.js";

function log(
    io: iapp.InteractiveIo | undefined,
    message: string,
    color: ChalkInstance,
): void {
    message = color(message);
    if (io) {
        io.writer.writeLine(message);
    } else {
        console.log(message);
    }
}

export async function importAllFiles(
    files: string[],
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo | undefined,
    verbose: boolean,
): Promise<void> {
    log(io, `[Importing ${files.length} files]`, chalk.grey);

    const t0 = Date.now();
    await importPythonFiles(files, chunkyIndex, io, verbose);
    const t1 = Date.now();

    log(
        io,
        `[Imported ${files.length} files in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
        chalk.grey,
    );
}

async function importPythonFiles(
    files: string[],
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo | undefined,
    verbose = false,
): Promise<void> {
    // Canonicalize filenames.
    let filenames = files.map((file) =>
        fs.existsSync(file) ? fs.realpathSync(file) : file,
    );

    // Purge previous occurrences of these files.
    for (const fileName of filenames) {
        await purgeNormalizedFile(io, chunkyIndex, fileName, verbose);
    }

    // Chunkify Python files using a helper program. (TODO: Make generic over languages)
    const t0 = Date.now();
    const results = await chunkifyPythonFiles(filenames);
    const t1 = Date.now();
    if (results.length !== filenames.length) {
        log(
            io,
            `[Some over-long files were split into multiple partial files]`,
            chalk.yellow,
        );
    }

    // Print stats for chunkifying.
    let numLines = 0;
    let numBlobs = 0;
    let numChunks = 0;
    let numErrors = 0;
    for (const result of results) {
        if ("error" in result) {
            numErrors++;
        } else {
            const chunkedFile = result;
            numChunks += chunkedFile.chunks.length;
            for (const chunk of chunkedFile.chunks) {
                numBlobs += chunk.blobs.length;
                for (const blob of chunk.blobs) {
                    numLines += blob.lines.length;
                }
            }
        }
    }
    log(
        io,
        `[Chunked ${results.length} files ` +
            `(${numLines} lines, ${numBlobs} blobs, ${numChunks} chunks, ${numErrors} errors) ` +
            `in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
        chalk.gray,
    );

    const chunkingErrors = results.filter(
        (result): result is ErrorItem => "error" in result,
    );
    for (const error of chunkingErrors) {
        log(
            io,
            `[Error: ${error.error}; Output: ${error.output ?? ""}]`,
            chalk.redBright,
        );
    }

    const chunkedFiles = results.filter(
        (result): result is ChunkedFile => "chunks" in result,
    );
    log(io, `[Documenting ${chunkedFiles.length} files]`, chalk.grey);

    const tt0 = Date.now();
    const documentedFiles: FileDocumentation[] = [];
    const concurrency = 8; // TODO: Make this a function argument
    let nChunks = 0;
    await asyncArray.forEachAsync(
        chunkedFiles,
        concurrency,
        async (chunkedFile) => {
            const t0 = Date.now();
            let docs: FileDocumentation;
            nChunks += chunkedFile.chunks.length;
            try {
                docs = await exponentialBackoff(
                    io,
                    chunkyIndex.fileDocumenter.document,
                    chunkedFile.chunks,
                );
            } catch (error) {
                const t1 = Date.now();
                log(
                    io,
                    `  [Error documenting ${chunkedFile.fileName} in ${((t1 - t0) * 0.001).toFixed(3)} seconds: ${error}]`,
                    chalk.redBright,
                );
                return;
            }
            const t1 = Date.now();

            if (verbose) {
                log(
                    io,
                    `  [Documented ${chunkedFile.chunks.length} chunks in ${((t1 - t0) * 0.001).toFixed(3)} seconds for ${chunkedFile.fileName}]`,
                    chalk.grey,
                );
            }
            documentedFiles.push(docs);
        },
    );
    const tt1 = Date.now();

    log(
        io,
        `[Documented ${documentedFiles.length} files (${nChunks} chunks) in ${((tt1 - tt0) * 0.001).toFixed(3)} seconds]`,
        chalk.grey,
    );

    const nonEmptyFiles = chunkedFiles.filter(
        (cf) => cf.chunks.filter((c) => c.docs).length,
    );

    log(io, `[Embedding ${nonEmptyFiles.length} files]`, chalk.grey);

    if (nonEmptyFiles.length) {
        const ttt0 = Date.now();
        // Cannot parallelize this because of concurrent writing to TextIndex.
        // TODO: Try pre-computing embeddings in parallel to fill the embeddings cache (is that cache safe?)
        for (const chunkedFile of nonEmptyFiles) {
            await embedChunkedFile(chunkedFile, chunkyIndex, io, verbose);
        }
        const ttt1 = Date.now();

        log(
            io,
            `[Embedded ${documentedFiles.length} files in ${((ttt1 - ttt0) * 0.001).toFixed(3)} seconds]`,
            chalk.grey,
        );
    }
}

export async function embedChunkedFile(
    chunkedFile: ChunkedFile,
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo | undefined,
    verbose = false,
): Promise<void> {
    const chunks: Chunk[] = chunkedFile.chunks;
    if (chunks.length === 0) {
        log(io, `[Skipping empty file ${chunkedFile.fileName}]`, chalk.yellow);
        return;
    }
    const t0 = Date.now();
    for (const chunk of chunkedFile.chunks) {
        await embedChunk(chunk, chunkyIndex, io, verbose);
    }
    const t1 = Date.now();
    if (verbose) {
        log(
            io,
            `  [Embedded ${chunks.length} chunks in ${((t1 - t0) * 0.001).toFixed(3)} seconds for ${chunkedFile.fileName}]`,
            chalk.grey,
        );
    }
}

async function embedChunk(
    chunk: Chunk,
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo | undefined,
    verbose = false,
): Promise<void> {
    const t0 = Date.now();
    const lineCount = chunk.blobs.reduce(
        (acc, blob) => acc + blob.lines.length,
        0,
    );
    await exponentialBackoff(io, chunkyIndex.chunkFolder.put, chunk, chunk.id);

    const summaries: string[] = [];
    const chunkDocs: ChunkDoc[] = chunk.docs?.chunkDocs ?? [];
    for (const chunkDoc of chunkDocs) {
        summaries.push(chunkDoc.summary);
    }
    const combinedSummaries = summaries.join("\n").trimEnd();

    for (const chunkDoc of chunkDocs) {
        for (const indexName of IndexNames) {
            let data: string[];
            if (indexName == "summaries") {
                data = [combinedSummaries];
            } else {
                data = (chunkDoc as any)[indexName];
            }
            const index = chunkyIndex.indexes.get(indexName)!;
            if (data && index) {
                await writeToIndex(io, chunk.id, data, index);
            }
        }
    }

    const t1 = Date.now();
    if (verbose) {
        log(
            io,
            `  [Embedded ${chunk.id} (${lineCount} lines @ ${chunk.blobs[0].start + 1}) ` +
                `in ${((t1 - t0) * 0.001).toFixed(3)} seconds for ${chunk.fileName}]`,
            chalk.gray,
        );
    }
}

async function writeToIndex(
    io: iapp.InteractiveIo | undefined,
    chunkId: ChunkId,
    phrases: string[] | undefined, // List of summaries, keywords, tags, etc. in chunk
    index: knowLib.TextIndex<string, ChunkId>,
) {
    for (const phrase of phrases ?? []) {
        await exponentialBackoff(io, index.put, phrase, [chunkId]);
    }
}

async function exponentialBackoff<T extends any[], R>(
    io: iapp.InteractiveIo | undefined,
    callable: (...args: T) => Promise<R>,
    ...args: T
): Promise<R> {
    let timeout = 1;
    for (;;) {
        try {
            return await callable(...args);
        } catch (error) {
            if (timeout > 1000) {
                log(io, `[Error: ${error}; giving up]`, chalk.redBright);
                throw error;
            }
            log(
                io,
                `[Error: ${error}; retrying in ${timeout} ms]`,
                chalk.redBright,
            );
            await new Promise((resolve) => setTimeout(resolve, timeout));
            timeout *= 2;
        }
    }
}

// Apply URL escaping to key. NOTE: Currently unused. TODO: Therefore remove.
export function sanitizeKey(key: string): string {
    return encodeURIComponent(key).replace(/%20/g, "+"); // Encode spaces as plus, others as %xx.
}
