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

import { asyncArray, ObjectFolder, SemanticIndex } from "typeagent";

import { Chunk, chunkifyPythonFile } from "./pythonChunker.js";
import { ChatModelWithStreaming } from "aiclient";

export async function importPythonFile(
    file: string,
    objectFolder: ObjectFolder<Chunk>,
    codeIndex: SemanticIndex<string>,
    chatModel: ChatModelWithStreaming,
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

    for (const chunk of chunks) {
        chunk.filename = filename;
    }

    // Store the chunks in the database (concurrently).
    const promises: Promise<any>[] = chunks.map((chunk) =>
        objectFolder.put(chunk, chunk.id),
    );
    await Promise.all(promises);

    // Compute and store embeddings (not concurrently -- I get 429 errors).
    await asyncArray.forEachAsync(chunks, 1, async (chunk) => {
        console.log(`[Embedding ${chunk.id}]`);
        const rawText = makeChunkText(chunk);
        const prompt = "Understand the included code and document it where necessary, especially complicated loops.\n" +
            "The docs must be: accurate, active voice, crisp, succinct\n";
        const chatOutput = await chatModel.complete(prompt + rawText);
        if (!chatOutput.success) {
            console.log(`[Error embedding ${chunk.id}: ${chatOutput.message}]`);
        } else {
            const embeddingText = chatOutput.data + "\n" + rawText;
            console.log("====================\n" + embeddingText);
            await codeIndex.put(embeddingText, chunk.id);
        }
    });
}

function makeChunkText(chunk: Chunk): string {
    let text = `${path.basename(chunk.filename ?? "")}\n${chunk.treeName}\n\n`;
    text += chunk.blobs.map((blob) => blob.lines.join("")).join("\n");
    return text;
}
