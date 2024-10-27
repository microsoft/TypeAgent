// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Main program to test pythonChunker.ts and pythonImporter.ts.

import dotenv from "dotenv";
import * as readlineSync from "readline-sync";
import {
    createEmbeddingFolder,
    createObjectFolder,
    createSemanticIndex,
} from "typeagent";
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

    let homeDir = "";
    if (process.platform === "darwin") {
        homeDir = process.env.HOME || "";
    }
    const dataRoot = `${homeDir}/data`;
    const spelunkerRoot = `${dataRoot}/spelunker`;
    const objectFolder = await createObjectFolder<Chunk>(
        `${spelunkerRoot}/chunks`,
    );
    const embeddingFolder = await createEmbeddingFolder(
        `${spelunkerRoot}/embeddings`,
    );
    const codeIndex = createSemanticIndex(embeddingFolder);

    // Import all files concurrently.
    const promises = files.map((file) =>
        importPythonFile(file, objectFolder, codeIndex),
    );
    await Promise.all(promises);

    while (true) {
        const input = readlineSync.question("~> ", {
            history: true, // Enable history
            keepWhitespace: true, // Keep leading/trailing whitespace in history
        });
        if (!input) {
            console.log("Bye!");
            return;
        }
        const searchKey = input.replace(/\W+/g, " ").trim();
        const hits = await codeIndex.nearestNeighbors(searchKey, 2, 0.7);
        console.log(`Got ${hits.length} hits:`);
        for (const hit of hits) {
            // console.log(hit);
            const item = await objectFolder.get(hit.item);
            if (item) {
                // console.log(item);
                console.log(hit, "-->", item.blobs);
            }
        }
    }
}

await main();
