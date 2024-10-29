// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Main program to index python files and query the index.

import dotenv from "dotenv";
import * as readlineSync from "readline-sync";
import {
    createEmbeddingFolder,
    createObjectFolder,
    createSemanticIndex,
} from "typeagent";
import { importPythonFile } from "./pythonImporter.js";
import { Chunk } from "./pythonChunker.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { openai } from "aiclient";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

async function main(): Promise<void> {
    const defaultFile = path.join(__dirname, "sample.py.txt");
    let files: string[];
    // TODO: Use a proper command-line parser.
    if (process.argv.length > 2) {
        files = process.argv.slice(2);
        if (files.length === 1 && files[0] === "-") {
            files = [];
        } else if (files.length === 2 && files[0] === "--files") {
            // Read list of files from a file.
            const fileList = files[1];
            files = fs
                .readFileSync(fileList, "utf-8")
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0 && line[0] !== "#");
        }
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
    const chatModel = openai.createChatModelDefault("chat");

    // Import all files. (TODO: concurrently but avoid timestamp conflicts)
    for (const file of files) {
        await importPythonFile(file, objectFolder, codeIndex, chatModel);
    }

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
        const hits = await codeIndex.nearestNeighbors(searchKey, 2, 0.6);
        console.log(`Got ${hits.length} hit${hits.length == 0 ? "s." : hits.length === 1 ? ":" : "s:"}`);
        for (const hit of hits) {
            const chunk: Chunk | undefined = await objectFolder.get(hit.item);
            if (!chunk) {
                console.log(hit, "--> [No data]");
            } else {
                console.log(`score: ${hit.score}, id: ${chunk.id}, file: ${chunk.filename}, node type: ${chunk.treeName}`);
                for (const blob of chunk.blobs) {
                    let lineno = 1 + blob.start;
                    for (const index in blob.lines) {
                        console.log(`${lineno}: ${blob.lines[index].trimEnd()}`);
                        lineno += 1;
                    }
                    console.log("");
                }
            }
        }
    }
}

await main();
