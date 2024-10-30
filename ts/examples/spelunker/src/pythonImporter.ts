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

import { Chunk, chunkifyPythonFile } from "./pythonChunker.js";

export async function importPythonFile(
    file: string,
    objectFolder: ObjectFolder<Chunk>,
    codeIndex: SemanticCodeIndex,
    summaryFolder: ObjectFolder<CodeDocumentation>,
): Promise<void> {
    let filename = fs.realpathSync(file);
    const result = await chunkifyPythonFile(filename);
    if (!(result instanceof Array)) {
        console.log(result.output);
        console.error(result.error);
        return;
    }
    const chunks: Chunk[] = result;
    console.log(
        `[Importing ${chunks.length} chunk${chunks.length === 1 ? "" : "s"} from ${filename}]`,
    );

    // Compute and store embedding. (TODO: Concurrency -- can do but debug output is garbled.)
    for (const chunk of chunks) {
        const t0 = Date.now();
        chunk.filename = filename;
        const lineCount = chunk.blobs.reduce(
            (acc, blob) => acc + blob.lines.length,
            0,
        );
        console.log(`[Embedding ${chunk.id} (${lineCount} lines)]`);
        const putPromise = objectFolder.put(chunk, chunk.id);
        const blobLines = extractBlobLines(chunk);
        const codeBlock: CodeBlock = { code: blobLines, language: "python" };
        const docs = await codeIndex.put(codeBlock, chunk.id, chunk.filename);
        for (const comment of docs.comments || []) {
            comment.lineNumber += chunk.blobs[0].start;
        }
        await summaryFolder.put(docs, chunk.id);
        await putPromise;
        for (const comment of docs.comments || []) {
            console.log(wordWrap(`${comment.lineNumber}. ${comment.comment}`));
        }
        const t1 = Date.now();
        console.log(
            `[Embedded ${chunk.id} (${lineCount} lines @ ${chunk.blobs[0].start}) ` +
                `in ${((t1 - t0) * 0.001).toFixed(3)} sec]\n`,
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
