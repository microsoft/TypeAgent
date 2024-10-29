// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Main program to index python files and query the index.

// System imports
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { createObjectFolder } from "typeagent";
import { fileURLToPath } from "url";

// 3rd party package imports
import * as readlineSync from "readline-sync";

// Workspace package imports
import { openai } from "aiclient";
import { createCodeReviewer, createSemanticCodeIndex } from "code-processor";

// Local imports
import { Chunk } from "./pythonChunker.js";
import { importPythonFile } from "./pythonImporter.js";

// Set __dirname to emulate old JS behavior
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars (including secrets) from .env
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

// Usage: node main.js [file1.py] [file2.py] ...
// OR:    node main.js --files filelist.txt
// OR:    node main.js -  # Load sample file (sample.py.txt)
async function main(): Promise<void> {
    const sampleFile = path.join(__dirname, "sample.py.txt");
    let files: string[];
    // TODO: Use a proper command-line parser.
    if (process.argv.length > 2) {
        files = process.argv.slice(2);
        if (files.length === 1 && files[0] === "-") {
            files = [sampleFile];
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
        files = [];
    }

    let homeDir = "";
    if (process.platform === "darwin") {
        homeDir = process.env.HOME || "";
    }
    const dataRoot = `${homeDir}/data`;
    const spelunkerRoot = `${dataRoot}/spelunker`;
    const objectFolder = await createObjectFolder<Chunk>(
        `${spelunkerRoot}/chunks`,
        { serializer: (obj) => JSON.stringify(obj, null, 2) },
    );
    const chatModel = openai.createChatModelDefault("spelunkerChat");
    const codeReviewer = createCodeReviewer(chatModel);
    const codeIndex = await createSemanticCodeIndex(
        `${spelunkerRoot}/index`,
        codeReviewer,
        undefined,
        (obj) => JSON.stringify(obj, null, 2),
    );

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
        const hits = await codeIndex.find(searchKey, 5);
        console.log(
            `Got ${hits.length} hit${hits.length == 0 ? "s." : hits.length === 1 ? ":" : "s:"}`,
        );
        for (const hit of hits) {
            const chunk: Chunk | undefined = await objectFolder.get(hit.item);
            if (!chunk) {
                console.log(hit, "--> [No data]");
            } else {
                console.log(
                    `score: ${hit.score.toFixed(3)}, ` +
                        `id: ${chunk.id}, ` +
                        `file: ${path.relative(process.cwd(), chunk.filename!)}, ` +
                        `type: ${chunk.treeName}`,
                );
                for (const blob of chunk.blobs) {
                    let lineno = 1 + blob.start;
                    for (const index in blob.lines) {
                        console.log(
                            `${lineno}: ${blob.lines[index].trimEnd()}`,
                        );
                        lineno += 1;
                    }
                    console.log("");
                }
            }
        }
    }
}

await main();
