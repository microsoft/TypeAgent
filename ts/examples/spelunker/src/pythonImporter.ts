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

import { asyncArray, ObjectFolder } from "typeagent";
import { CodeDocumentation, SemanticCodeIndex } from "code-processor";

import { Chunk, ChunkedFile, chunkifyPythonFiles } from "./pythonChunker.js";
import { CodeBlockWithDocs, FileDocumenter } from "./main.js";

// TODO: Turn (chunkFolder, codeIndex, summaryFolder) into a single object.

export async function importPythonFiles(
    files: string[],
    fileDocumenter: FileDocumenter,
    chunkFolder: ObjectFolder<Chunk>,
    codeIndex: SemanticCodeIndex,
    summaryFolder: ObjectFolder<CodeDocumentation>,
    firstFile = true,
    verbose = false,
): Promise<boolean> {
    let filenames = files.map((file) =>
        fs.existsSync(file) ? fs.realpathSync(file) : file,
    );
    const t0 = Date.now();
    const results = await chunkifyPythonFiles(filenames);
    const t1 = Date.now();

    // Compute some stats for log message.
    let lines = 0;
    let blobs = 0;
    let errors = 0;
    for (const result of results) {
        if ("error" in result) {
            errors++;
        } else {
            const chunkedFile = result;
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
            `(${lines} lines, ${blobs} blobs, ${errors} errors) ` +
            `in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
    );

    // TODO: concurrency.
    for (const item of results) {
        if ("error" in item) {
            console.log(`[Error: ${item.error}]`);
            if (item.output) {
                console.log(`[output: ${item.output}]`);
            }
            continue;
        }
        const chunkedFile = item;
        const chunks = chunkedFile.chunks;
        for (const chunk of chunks) {
            chunk.filename = chunkedFile.filename;
        }
        console.log(
            `[Documenting ${chunks.length} chunks from ${chunkedFile.filename}]`,
        );
        const t0 = Date.now();
        const docs = await fileDocumenter.document(chunks);
        const t1 = Date.now();
        console.log(docs);
        console.log(
            `[Documented ${chunks.length} chunks in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
        );
        firstFile = await processChunkedFile(
            chunkedFile,
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
    chunkedFile: ChunkedFile, // TODO: Use a type with filename and docs guaranteed present.
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
        `[Embedding ${chunks.length} chunks from ${chunkedFile.filename}]`,
    );
    const t0 = Date.now();

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

    // Limit concurrency to avoid 429 errors.
    await asyncArray.forEachAsync(
        chunks,
        4,
        async (chunk) =>
            await processChunk(
                chunk,
                chunkFolder,
                codeIndex,
                summaryFolder,
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
    // console.log(`  [Embedding ${chunk.id} (${lineCount} lines)]`);
    const putPromise = chunkFolder.put(chunk, chunk.id);
    const blobLines = extractBlobLines(chunk);
    const codeBlock: CodeBlockWithDocs = {
        code: blobLines,
        language: "python",
        docs: chunk.docs!,
    };
    const docs = await codeIndex.put(codeBlock, chunk.id, chunk.filename);
    await summaryFolder.put(docs, chunk.id);
    await putPromise;
    // for (const comment of docs.comments || []) {
    //     console.log(wordWrap(`    ${comment.lineNumber}. ${comment.comment}`));
    // }
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
