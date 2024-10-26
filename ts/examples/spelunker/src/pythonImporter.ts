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
import { Chunk, chunkifyPythonFile } from "./pythonChunker.js";
import { ObjectFolder, SemanticIndex } from "typeagent";

export async function importPythonFile(
    file: string,
    objectFolder: ObjectFolder<Chunk>,
    codeIndex: SemanticIndex<string>,
): Promise<void> {
    let filename = fs.realpathSync(file);
    const result = await chunkifyPythonFile(filename);
    if (!(result instanceof Array)) {
        console.log(result.output);
        console.error(result.error);
        return;
    }

    console.log(`[Importing ${result.length} chunks from ${filename}]`);

    // Store the chunks in the database.
    // TODO: Paralellize? Or batch (e.g. putMultiple)?
    for (const chunk of result) {
        chunk.filename = filename;
        await objectFolder.put(chunk, chunk.id);
        await codeIndex.put(chunk.blobs.join(""), chunk.id);
        // TODO: Also log the "date/time created" for the chunk.
    }
}
