// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/*

Now what to do with these chunks?

Each chunk needs to be stored in a database, with embeddings from the blobs and
their lines, and possibly other things that might be useful to search for.

We should support indexing many files this way (given by glob patterns).

Then we can define search over that database.

A search should report the relevant chunks, and possibly the relevant lines
within those chunks.

Hopefully we can reuse the indexing and searching also used by codeMemory.ts.

After that we should allow the model to send search queries to the database, and
store conclusions (e.g. summaries or architectural notes) back there.

It's too bad that we don't have a language server to help us with this, but we
can add one for sure.

We should also generalize the chunking to other languages, notably C (and
TypeScript, of course).

*/

import * as fs from "fs";
import * as knowLib from "knowledge-processor";
import { asyncArray } from "typeagent";

import * as iapp from "interactive-app";
import { ChunkyIndex } from "./chunkyIndex.js";
import { ChunkDoc, FileDocumentation } from "./fileDocSchema.js";
import {
    Chunk,
    ChunkedFile,
    ChunkId,
    chunkifyPythonFiles,
    ErrorItem,
} from "./pythonChunker.js";

function log(io: iapp.InteractiveIo | undefined, message: string): void {
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
    log(io, `[Importing ${files.length} files]`);

    const t0 = Date.now();
    await importPythonFiles(files, chunkyIndex, io, verbose);
    const t1 = Date.now();

    log(
        io,
        `[Imported ${files.length} files in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
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

    // Chunkify Python files using a helper program. (TODO: Make generic over languages)
    const t0 = Date.now();
    const results = await chunkifyPythonFiles(filenames);
    const t1 = Date.now();

    // Print stats for chunkifying.
    let lines = 0;
    let blobs = 0;
    let chunks = 0;
    let errors = 0;
    for (const result of results) {
        if ("error" in result) {
            errors++;
        } else {
            const chunkedFile = result;
            chunks += chunkedFile.chunks.length;
            for (const chunk of chunkedFile.chunks) {
                blobs += chunk.blobs.length;
                for (const blob of chunk.blobs) {
                    lines += blob.lines.length;
                }
            }
        }
    }
    log(
        io,
        `[Chunked ${filenames.length} files ` +
            `(${lines} lines, ${blobs} blobs, ${chunks} chunks, ${errors} errors) ` +
            `in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
    );

    const chunkingErrors = results.filter(
        (result): result is ErrorItem => "error" in result,
    );
    for (const error of chunkingErrors) {
        log(io, `[Error: ${error.error}; Output: ${error.output ?? ""}]`);
    }

    const chunkedFiles = results.filter(
        (result): result is ChunkedFile => "chunks" in result,
    );
    log(io, `[Documenting ${chunkedFiles.length} files]`);

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
                docs = await chunkyIndex.fileDocumenter.document(
                    chunkedFile.chunks,
                );
            } catch (error) {
                const t1 = Date.now();
                log(
                    io,
                    `  [Error documenting ${chunkedFile.filename} in ${((t1 - t0) * 0.001).toFixed(3)} seconds: ${error}]`,
                );
                return;
            }
            const t1 = Date.now();

            log(
                io,
                `  [Documented ${chunkedFile.chunks.length} chunks in ${((t1 - t0) * 0.001).toFixed(3)} seconds for ${chunkedFile.filename}]`,
            );
            documentedFiles.push(docs);
        },
    );
    const tt1 = Date.now();

    log(
        io,
        `[Documented ${documentedFiles.length} files (${nChunks} chunks) in ${((tt1 - tt0) * 0.001).toFixed(3)} seconds]`,
    );

    const nonEmptyFiles = chunkedFiles.filter(
        (cf) => cf.chunks.filter((c) => c.docs).length,
    );

    log(io, `[Embedding ${nonEmptyFiles.length} files]`);

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
        log(io, `[Skipping empty file ${chunkedFile.filename}]`);
        return;
    }
    const t0 = Date.now();
    for (const chunk of chunkedFile.chunks) {
        await embedChunk(chunk, chunkyIndex, io, verbose);
    }
    const t1 = Date.now();
    log(
        io,
        `  [Embedded ${chunks.length} chunks in ${((t1 - t0) * 0.001).toFixed(3)} seconds for ${chunkedFile.filename}]`,
    );
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
    if (combinedSummaries) {
        await exponentialBackoff(
            io,
            chunkyIndex.summariesIndex.put,
            combinedSummaries,
            [chunk.id],
        );
    }
    for (const chunkDoc of chunkDocs) {
        await writeToIndex(
            io,
            chunk.id,
            chunkDoc.topics,
            chunkyIndex.topicsIndex,
        );
        await writeToIndex(
            io,
            chunk.id,
            chunkDoc.keywords,
            chunkyIndex.keywordsIndex,
        );
        await writeToIndex(
            io,
            chunk.id,
            chunkDoc.goals,
            chunkyIndex.goalsIndex,
        );
        await writeToIndex(
            io,
            chunk.id,
            chunkDoc.dependencies,
            chunkyIndex.dependenciesIndex,
        );
    }
    const t1 = Date.now();
    if (verbose) {
        log(
            io,
            `  [Embedded ${chunk.id} (${lineCount} lines @ ${chunk.blobs[0].start}) ` +
                `in ${((t1 - t0) * 0.001).toFixed(3)} seconds for ${chunk.filename}]`,
        );
    }
}

async function writeToIndex(
    io: iapp.InteractiveIo | undefined,
    chunkId: ChunkId,
    phrases: string[] | undefined, // List of keywords, topics, etc. in chunk
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
                log(io, `[Error: ${error}; giving up]`);
                throw error;
            }
            log(io, `[Error: ${error}; retrying in ${timeout} ms]`);
            await new Promise((resolve) => setTimeout(resolve, timeout));
            timeout *= 2;
        }
    }
}

// Apply URL escaping to key. NOTE: Currently unused. TODO: Therefore remove.
export function sanitizeKey(key: string): string {
    return encodeURIComponent(key).replace(/%20/g, "+"); // Encode spaces as plus, others as %xx.
}
