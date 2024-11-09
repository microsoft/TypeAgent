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

import { asyncArray } from "typeagent";

import { Chunk, ChunkedFile, chunkifyPythonFiles } from "./pythonChunker.js";
import { CodeBlockWithDocs } from "./fileDocumenter.js";
import { ChunkyIndex } from "./chunkyIndex.js";

// TODO: Turn (chunkFolder, codeIndex, summaryFolder) into a single object.

export async function importPythonFiles(
    files: string[],
    chunkyIndex: ChunkyIndex,
    firstFile = true,
    verbose = false,
): Promise<boolean> {
    // Canonicalize filenames.
    let filenames = files.map((file) =>
        fs.existsSync(file) ? fs.realpathSync(file) : file,
    );

    // Chunkify Python files. (TODO: Make generic over languages)
    const t0 = Date.now();
    const results = await chunkifyPythonFiles(filenames);
    const t1 = Date.now();

    // Compute some stats for log message.
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

    // TODO: concurrency.
    for (const result of results) {
        if ("error" in result) {
            console.log(`[Error: ${result.error}]`);
            if (result.output) {
                console.log(`[output: ${result.output}]`);
            }
            continue;
        }
        const chunkedFile = result;
        const chunks = chunkedFile.chunks;
        for (const chunk of chunks) {
            chunk.filename = chunkedFile.filename;
        }
        console.log(
            `[Documenting ${chunks.length} chunks from ${chunkedFile.filename}]`,
        );
        const t0 = Date.now();
        try {
            const docs = await chunkyIndex.fileDocumenter.document(chunks);
            if (verbose) console.log(JSON.stringify(docs, null, 4));
        } catch (error) {
            console.log(
                `[Error documenting ${chunkedFile.filename}: ${error}]`,
            );
            continue;
        }
        const t1 = Date.now();
        console.log(
            `[Documented ${chunks.length} chunks in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
        );
        firstFile = await processChunkedFile(
            chunkedFile,
            chunkyIndex,
            firstFile,
            verbose,
        );
    }
    return firstFile;
}

async function processChunkedFile(
    chunkedFile: ChunkedFile, // TODO: Use a type with filename and docs guaranteed present.
    chunkyIndex: ChunkyIndex,
    firstFile = false,
    verbose = false,
): Promise<boolean> {
    const chunks: Chunk[] = chunkedFile.chunks;
    if (chunks.length === 0) {
        console.log(`[Empty file ${chunkedFile.filename} skipped]`);
        return firstFile;
    }
    console.log(
        `[Embedding ${chunks.length} chunks from ${chunkedFile.filename}]`,
    );
    const t0 = Date.now();

    // Handle the first chunk of the first file separately, it waits for API key setup.
    if (firstFile) {
        const chunk = chunks.shift()!;
        await processChunk(
            chunk,
            chunkyIndex,
            verbose,
        );
    }

    // Limit concurrency to avoid 429 errors.
    await asyncArray.forEachAsync(
        chunks,
        verbose ? 1 : 4,
        async (chunk) =>
            await processChunk(
                chunk,
                chunkyIndex,
                verbose,
            ),
    );

    const t1 = Date.now();
    console.log(
        `[Embedded ${+firstFile + chunks.length} chunks in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
    );
    return false;
}

async function processChunk(
    chunk: Chunk,
    chunkyIndex: ChunkyIndex,
    verbose = false,
): Promise<void> {
    const t0 = Date.now();
    const lineCount = chunk.blobs.reduce(
        (acc, blob) => acc + blob.lines.length,
        0,
    );
    if (verbose) console.log(`  [Embedding ${chunk.id} (${lineCount} lines)]`);
    const putPromise = chunkyIndex.chunkFolder!.put(chunk, chunk.id);
    const blobLines = extractBlobLines(chunk);
    const codeBlock: CodeBlockWithDocs = {
        code: blobLines,
        language: "python",
        docs: chunk.docs!,
    };
    const docs = await chunkyIndex.codeIndex!.put(codeBlock, chunk.id, chunk.filename);
    await chunkyIndex.summaryFolder!.put(docs, chunk.id);
    await putPromise;
    if (verbose) {
        for (const comment of docs.comments || []) {
            console.log(
                wordWrap(`    ${comment.lineNumber}. ${comment.comment}`),
            );
        }
    }
    const t1 = Date.now();
    if (verbose) {
        console.log(
            `  [Embedded ${chunk.id} (${lineCount} lines @ ${chunk.blobs[0].start}) ` +
                `in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
        );
    }
}

function extractBlobLines(chunk: Chunk): string[] {
    const lines: string[] = [];
    for (const blob of chunk.blobs) {
        lines.push(...blob.lines);
    }
    return lines;
}

// Wrap words in anger. Written by Github Copilot.
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
