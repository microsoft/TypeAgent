// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Main program to test pythonChunker.ts and pythonImporter.ts.

import dotenv from "dotenv";
import * as readlineSync from 'readline-sync';
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

    while (true) {
        const input = readlineSync.question('~> ', {
            history: true,     // Enable history
            keepWhitespace: true,  // Keep leading/trailing whitespace in history
        });
        if (!input) {
            console.log("Bye!");
            return;
        }
        const hits = await codeIndex.nearestNeighbors(input, 2);
        console.log("Hits:");
        for (const hit of hits) {
            console.log(hit);
            const item = await objectFolder.get(hit.item);
            if (item) {
                console.log(item);
                console.log(item.blobs);
            }
        }
    }
}

await main();
