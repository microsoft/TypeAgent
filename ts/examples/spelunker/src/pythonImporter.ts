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

import { ObjectFolder } from "typeagent";
import {
    CodeBlock,
    CodeDocumentation,
    SemanticCodeIndex,
} from "code-processor";

import { Chunk, ChunkedFile, chunkifyPythonFiles } from "./pythonChunker.js";

// TODO: Turn (chunkFolder, codeIndex, summaryFolder) into a single object.

export async function importPythonFiles(
    files: string[],
    chunkFolder: ObjectFolder<Chunk>,
    codeIndex: SemanticCodeIndex,
    summaryFolder: ObjectFolder<CodeDocumentation>,
    firstFile = true,
    verbose = false,
): Promise<boolean> {
    let filenames = files.map((file) =>
        fs.existsSync(file) ? fs.realpathSync(file) : file,
    );
    const result = await chunkifyPythonFiles(filenames);

    // TODO: concurrency.
    for (const item of result) {
        if ("error" in item) {
            console.log(`[Error: ${item.error}]`);
            if (item.output) {
                console.log(`[output: ${item.output}]`);
            }
            continue;
        }
        firstFile = await processChunkedFile(
            item,
            chunkFolder,
            codeIndex,
            summaryFolder,
            firstFile,
            verbose,
        );
    }
    return firstFile;
}

async function processChunkedFile(
    chunkedFile: ChunkedFile,
    chunkFolder: ObjectFolder<Chunk>,
    codeIndex: SemanticCodeIndex,
    summaryFolder: ObjectFolder<CodeDocumentation>,
    firstFile = false,
    verbose = false,
): Promise<boolean> {
    const chunks: Chunk[] = chunkedFile.chunks;
    if (chunks.length === 0) {
        console.log(`[Empty file ${chunkedFile.filename} skipped]`);
        return firstFile;
    }
    console.log(
        `[Processing ${chunks.length} chunks from ${chunkedFile.filename}]`,
    );
    const t0 = Date.now();

    // Compute and store embedding.
    for (const chunk of chunks) {
        chunk.filename = chunkedFile.filename;
    }
    // Handle the first chunk of the first file separately, it waits for API key setup.
    if (firstFile) {
        const chunk = chunks.shift()!;
        await processChunk(
            chunk,
            chunkFolder,
            codeIndex,
            summaryFolder,
            verbose,
        );
    }
    const promises = chunks.map((chunk) =>
        processChunk(chunk, chunkFolder, codeIndex, summaryFolder, verbose),
    );
    await Promise.all(promises);

    const t1 = Date.now();
    console.log(
        `[Processed ${+firstFile + chunks.length} chunks in ${((t1 - t0) * 0.001).toFixed(3)} sec]`,
    );
    return false;
}

async function processChunk(
    chunk: Chunk,
    chunkFolder: ObjectFolder<Chunk>,
    codeIndex: SemanticCodeIndex,
    summaryFolder: ObjectFolder<CodeDocumentation>,
    verbose = false,
): Promise<void> {
    const t0 = Date.now();
    const lineCount = chunk.blobs.reduce(
        (acc, blob) => acc + blob.lines.length,
        0,
    );
    // console.log(`[Embedding ${chunk.id} (${lineCount} lines)]`);
    const putPromise = chunkFolder.put(chunk, chunk.id);
    const blobLines = extractBlobLines(chunk);
    const codeBlock: CodeBlock = { code: blobLines, language: "python" };
    const docs = await codeIndex.put(codeBlock, chunk.id, chunk.filename);
    for (const comment of docs.comments || []) {
        comment.lineNumber += chunk.blobs[0].start;
    }
    await summaryFolder.put(docs, chunk.id);
    await putPromise;
    // for (const comment of docs.comments || []) {
    //     console.log(wordWrap(`${comment.lineNumber}. ${comment.comment}`));
    // }
    const t1 = Date.now();
    if (verbose) {
        console.log(
            `[Embedded ${chunk.id} (${lineCount} lines @ ${chunk.blobs[0].start}) ` +
                `in ${((t1 - t0) * 0.001).toFixed(3)} sec]`,
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
