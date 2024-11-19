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

import { ChunkyIndex } from "./chunkyIndex.js";
import { ChunkDoc, FileDocumentation } from "./fileDocSchema.js";
import {
    Chunk,
    ChunkedFile,
    ChunkId,
    chunkifyPythonFiles,
    ErrorItem,
} from "./pythonChunker.js";

export async function importPythonFiles(
    files: string[],
    chunkyIndex: ChunkyIndex,
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
    console.log(
        `[Chunked ${filenames.length} files ` +
            `(${lines} lines, ${blobs} blobs, ${chunks} chunks, ${errors} errors) ` +
            `in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
    );

    const chunkingErrors = results.filter(
        (result): result is ErrorItem => "error" in result,
    );
    for (const error of chunkingErrors) {
        console.log(`[Error: ${error.error}; Output: ${error.output ?? ""}]`);
    }

    const chunkedFiles = results.filter(
        (result): result is ChunkedFile => "chunks" in result,
    );
    console.log(`[Documenting ${chunkedFiles.length} files]`);
    const documentedChunks: FileDocumentation[] = [];
    const tt0 = Date.now();
    await asyncArray.forEachAsync(chunkedFiles, 4, async (chunkedFile) => {
        const t0 = Date.now();
        let docs: FileDocumentation;
        try {
            docs = await chunkyIndex.fileDocumenter.document(
                chunkedFile.chunks,
            );
        } catch (error) {
            console.log(
                `[Error documenting ${chunkedFile.filename}: ${error}]`,
            );
            return;
        }
        const t1 = Date.now();
        console.log(
            `  [Documented ${chunkedFile.chunks.length} chunks in ${((t1 - t0) * 0.001).toFixed(3)} seconds for ${chunkedFile.filename}]`,
        );
        documentedChunks.push(docs);
    });
    const tt1 = Date.now();
    console.log(
        `[Documented ${documentedChunks.length} files in ${((tt1 - tt0) * 0.001).toFixed(3)} seconds]`,
    );

    // Cannot parallelize this because of concurrent writing to TextIndex.
    console.log(`[Embedding ${documentedChunks.length} files]`);
    for (const chunkedFile of chunkedFiles) {
        await embedChunkedFile(chunkedFile, chunkyIndex, verbose);
    }
}

export async function embedChunkedFile(
    chunkedFile: ChunkedFile,
    chunkyIndex: ChunkyIndex,
    verbose = false,
): Promise<void> {
    const chunks: Chunk[] = chunkedFile.chunks;
    if (chunks.length === 0) {
        console.log(`[Skipping empty file ${chunkedFile.filename}]`);
        return;
    }
    const t0 = Date.now();
    for (const chunk of chunkedFile.chunks) {
        await embedChunk(chunk, chunkyIndex, verbose);
    }
    const t1 = Date.now();
    console.log(
        `  [Embedded ${chunks.length} chunks in ${((t1 - t0) * 0.001).toFixed(3)} seconds for ${chunkedFile.filename}]`,
    );
}

async function embedChunk(
    chunk: Chunk,
    chunkyIndex: ChunkyIndex,
    verbose = false,
): Promise<void> {
    const t0 = Date.now();
    const lineCount = chunk.blobs.reduce(
        (acc, blob) => acc + blob.lines.length,
        0,
    );
    const promises: Promise<any>[] = [];
    let p1: Promise<any> | undefined;
    p1 = exponentialBackoff(chunkyIndex.chunkFolder.put, chunk, chunk.id);
    if (p1) promises.push(p1);

    const summaries: string[] = [];
    const chunkDocs: ChunkDoc[] = chunk.docs?.chunkDocs ?? [];
    for (const chunkDoc of chunkDocs) {
        summaries.push(chunkDoc.summary);
    }
    const combinedSummaries = summaries.join("\n").trimEnd();
    if (combinedSummaries) {
        p1 = exponentialBackoff(
            chunkyIndex.summariesIndex.put,
            combinedSummaries,
            [chunk.id],
        );
        if (p1) promises.push(p1);
    }
    for (const chunkDoc of chunkDocs) {
        p1 = writeToIndex(chunk.id, chunkDoc.topics, chunkyIndex.topicsIndex);
        if (p1) promises.push(p1);
        p1 = writeToIndex(
            chunk.id,
            chunkDoc.keywords,
            chunkyIndex.keywordsIndex,
        );
        if (p1) promises.push(p1);
        p1 = writeToIndex(chunk.id, chunkDoc.goals, chunkyIndex.goalsIndex);
        if (p1) promises.push(p1);
        p1 = writeToIndex(
            chunk.id,
            chunkDoc.dependencies,
            chunkyIndex.dependenciesIndex,
        );
        if (p1) promises.push(p1);
    }
    if (promises.length) await Promise.all(promises);
    const t1 = Date.now();
    if (verbose) {
        console.log(
            `  [Embedded ${chunk.id} (${lineCount} lines @ ${chunk.blobs[0].start}) ` +
                `in ${((t1 - t0) * 0.001).toFixed(3)} seconds for ${chunk.filename}]`,
        );
    }
}

// Wrap words in anger. Written by Github Copilot.
// TODO: Wrap each line separately; Honor indents; honor '*' or '-' for bullets.
export function wordWrap(text: string, width: number = 80): string {
    const words = text.split(/\s+/);
    let line = "";
    let lines = [];
    for (const word of words) {
        if (line.length + word.length + 1 > width) {
            lines.push(line);
            line = word;
        } else {
            line += (line.length ? " " : "") + word;
        }
    }
    lines.push(line);
    return lines.join("\n");
}

async function writeToIndex(
    chunkId: ChunkId,
    phrases: string[] | undefined, // List of keywords, topics, etc. in chunk
    index: knowLib.TextIndex<string, ChunkId>,
) {
    for (const phrase of phrases ?? []) {
        await exponentialBackoff(index.put, phrase, [chunkId]);
    }
}

async function exponentialBackoff<T extends any[], R>(
    callable: (...args: T) => Promise<R>,
    ...args: T
): Promise<R> {
    let timeout = 1;
    for (;;) {
        try {
            return await callable(...args);
        } catch (error) {
            if (timeout > 1000) {
                console.log(`[Error: ${error}; giving up]`);
                throw error;
            }
            console.log(`[Error: ${error}; retrying in ${timeout} ms]`);
            await new Promise((resolve) => setTimeout(resolve, timeout));
            timeout *= 2;
        }
    }
}

// Apply URL escaping to key. NOTE: Currently unused. TODO: Therefore remove.
export function sanitizeKey(key: string): string {
    return encodeURIComponent(key).replace(/%20/g, "+"); // Encode spaces as plus, others as %xx.
}
