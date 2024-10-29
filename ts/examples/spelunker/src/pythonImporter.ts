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
import * as path from "path";

import { ObjectFolder } from "typeagent";
import { CodeBlock, SemanticCodeIndex } from "code-processor";

import { Chunk, chunkifyPythonFile } from "./pythonChunker.js";
import { ChatModel } from "aiclient";

export async function importPythonFile(
    file: string,
    objectFolder: ObjectFolder<Chunk>,
    codeIndex: SemanticCodeIndex,
    chatModel: ChatModel,
): Promise<void> {
    let filename = fs.realpathSync(file);
    const result = await chunkifyPythonFile(filename);
    if (!(result instanceof Array)) {
        console.log(result.output);
        console.error(result.error);
        return;
    }
    const chunks: Chunk[] = result;
    console.log(`[Importing ${chunks.length} chunks from ${filename}]`);

    // Compute and store embedding. (TODO: concurrency.)
    for (const chunk of chunks) {
        const t0 = Date.now();
        chunk.filename = filename;
        const lineCount = chunk.blobs.reduce(
            (acc, blob) => acc + blob.lines.length,
            0,
        );
        console.log(`[Embedding ${chunk.id} (${lineCount} lines)]`);
        const putCall = objectFolder.put(chunk, chunk.id);
        const rawText = makeChunkText(chunk);
        const codeBlock: CodeBlock = { code: rawText, language: "python" };
        let embeddingText = "";
        for (let i = 0; i < 3; i++) {
            try {
                embeddingText = await codeIndex.put(
                    codeBlock,
                    chunk.id,
                    chunk.filename,
                );
                console.log(embeddingText);
                break;
            } catch (error) {
                console.error(`Try ${i + 1}: ${error}`);
            }
        }
        await putCall;
        const t1 = Date.now();
        console.log(
            `[${embeddingText ? "Embedded" : "FAILED TO EMBED"} ` +
                `${chunk.id} (${lineCount} lines) in ${t1 - t0} ms]`,
        );
    }
}

function makeChunkText(chunk: Chunk): string {
    let text = `${path.basename(chunk.filename ?? "")}\n${chunk.treeName}\n\n`;
    text += chunk.blobs.map((blob) => blob.lines.join("")).join("\n");
    return text;
}
