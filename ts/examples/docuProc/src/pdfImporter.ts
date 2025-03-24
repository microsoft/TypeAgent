// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk, { ChalkInstance } from "chalk";
import * as fs from "fs";
import * as knowLib from "knowledge-processor";
import { asyncArray } from "typeagent";

import * as iapp from "interactive-app";
import { ChunkyIndex, IndexNames } from "./pdfChunkyIndex.js";
import { PdfFileDocumentation } from "./pdfDocChunkSchema.js";
import {
    Chunk,
    ChunkedFile,
    ChunkId,
    chunkifyPdfFiles,
    loadPdfChunksFromJson,
    ErrorItem,
} from "./pdfChunker.js";
import { purgeNormalizedFile } from "./pdfQNAInteractiveApp.js";
import path from "path";

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
    fChunkPdfFiles: boolean = true,
    maxPagesToProcess: number = -1,
): Promise<void> {
    log(io, `[Importing ${files.length} files]`, chalk.grey);

    const t0 = Date.now();
    await importPdfFiles(
        files,
        chunkyIndex,
        io,
        verbose,
        fChunkPdfFiles,
        maxPagesToProcess,
    );
    const t1 = Date.now();

    log(
        io,
        `[Imported ${files.length} files in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
        chalk.grey,
    );
}

async function getLinesInChunk(chunk: Chunk): Promise<number> {
    let numLines = 0;
    for (const blob of chunk.blobs) {
        if (blob.blob_type === "text" && blob.content) {
            if (Array.isArray(blob.content)) {
                numLines += blob.content
                    .flatMap((text) => text.split(/[\n.]+/)) // Split each string and flatten the results
                    .filter((line) => line.trim().length > 0).length;
            } else {
                numLines += blob.content
                    .split(/[\n.]+/)
                    .filter((line) => line.trim().length > 0).length;
            }
        }
    }
    return numLines;
}

async function importPdfFiles(
    files: string[],
    chunkyIndex: ChunkyIndex,
    io: iapp.InteractiveIo | undefined,
    verbose = false,
    fChunkPdfFiles: boolean = true,
    maxPagesToProcess: number = -1,
): Promise<void> {
    // Canonicalize filenames.
    let filenames = files.map((file) =>
        fs.existsSync(file) ? fs.realpathSync(file) : file,
    );

    // Purge previous occurrences of these files.
    for (const fileName of filenames) {
        await purgeNormalizedFile(io, chunkyIndex, fileName, verbose);
    }

    // Chunkify PDF files using a helper program.
    const t0 = Date.now();
    let t1 = t0;
    let results = undefined;
    if (fChunkPdfFiles) {
        results = await chunkifyPdfFiles(chunkyIndex.rootDir, filenames);
        t1 = Date.now();
    } else {
        results = await loadPdfChunksFromJson(chunkyIndex.rootDir, filenames);
        t1 = Date.now();
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
                numLines += await getLinesInChunk(chunk);
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
        (result: any): result is ErrorItem => "error" in result,
    );
    for (const error of chunkingErrors) {
        log(
            io,
            `[Error: ${error.error}; Output: ${error.output ?? ""}]`,
            chalk.redBright,
        );
    }

    const chunkedFiles = results.filter(
        (result: any): result is ChunkedFile => "chunks" in result,
    );
    log(io, `[Documenting ${chunkedFiles.length} files]`, chalk.grey);

    const tt0 = Date.now();
    const documentedFiles: PdfFileDocumentation[] = [];
    const concurrency = 8;
    let nChunks = 0;
    await asyncArray.forEachAsync(
        chunkedFiles,
        concurrency,
        async (chunkedFile) => {
            const t0 = Date.now();
            let docs: PdfFileDocumentation;
            nChunks += chunkedFile.chunks.length;
            try {
                docs = await exponentialBackoff(
                    io,
                    chunkyIndex.fileDocumenter.document,
                    path.basename(chunkedFile.fileName),
                    chunkedFile.chunks,
                    maxPagesToProcess,
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
        (cf) => cf.chunks.filter((c) => c.chunkDoc).length,
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

    // First consolidate the document info from all the chunks.
    // The first chunk of a file is a root chunk of the first page.

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
    const lineCount = chunk.blobs.reduce((acc, blob) => {
        if (!blob.content) return acc;

        const countLines = (text: string) =>
            text.split(/[\n.!?]+/).filter(Boolean).length;

        if (Array.isArray(blob.content)) {
            return (
                acc +
                blob.content.reduce((sum, text) => sum + countLines(text), 0)
            );
        }

        return acc + countLines(blob.content);
    }, 0);
    console.log(`Chunk#:(${chunk.id}) approximate line count: ${lineCount}`);
    await exponentialBackoff(io, chunkyIndex.chunkFolder.put, chunk, chunk.id);

    for (const indexName of IndexNames) {
        let data: string[] | undefined;
        if (indexName == "docinfos") {
            if (chunk.chunkDoc !== undefined) {
                data = [JSON.stringify(chunk.chunkDoc?.docinfo)];
            }
        } else if (indexName == "summaries") {
            data = chunk.chunkDoc?.summary ? [chunk.chunkDoc.summary] : [];
        } else {
            const possibleData = (chunk.chunkDoc as any)?.[indexName];
            data = Array.isArray(possibleData) ? possibleData : undefined;
        }
        const index = chunkyIndex.indexes.get(indexName)!;
        if (data !== undefined && index) {
            await writeToIndex(io, chunk.id, data, index);
        }
    }

    const t1 = Date.now();
    if (verbose) {
        const numLines = getLinesInChunk(chunk);
        log(
            io,
            `  [Embedded ${chunk.id} of (${chunk.pageid} lines @ ${numLines}) ` +
                `in ${((t1 - t0) * 0.001).toFixed(3)} seconds for ${chunk.fileName}]`,
            chalk.gray,
        );
    }
}

export async function writeToIndex(
    io: iapp.InteractiveIo | undefined,
    chunkId: ChunkId,
    phrases: string[] | undefined, // List of summaries, keywords, tags, docinfo, etc. in chunk
    index: knowLib.TextIndex<string, ChunkId>,
) {
    for (const phrase of phrases ?? []) {
        await exponentialBackoff(io, index.put, phrase, [chunkId]);
    }
}

export async function exponentialBackoff<T extends any[], R>(
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
