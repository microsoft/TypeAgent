// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Main program to test pythonChunker.ts and pythonImporter.ts.

import dotenv from "dotenv";
import { createEmbeddingFolder, createObjectFolder, createSemanticIndex } from "typeagent";
import { importPythonFile } from "./pythonImporter.js";
import { Chunk } from "./pythonChunker.js";

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

async function main(): Promise<void> {
    const defaultFile = "sample.py.txt";
    let files: string[];
    if (process.argv.length > 2) {
        files = process.argv.slice(2);
    } else {
        files = [defaultFile];
    }

    const objectFolder = await createObjectFolder<Chunk>(
        "/data/spelunker/chunks",
    );
    const embeddingFolder = await createEmbeddingFolder(
        "/data/spelunker/embeddings",
    );
    const codeIndex = createSemanticIndex(embeddingFolder);

    for (const file of files) {
        await importPythonFile(file, objectFolder, codeIndex);
    }
}

await main();
