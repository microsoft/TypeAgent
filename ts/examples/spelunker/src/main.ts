// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Main program to test pythonChunker.ts and pythonImporter.ts.

import { createObjectFolder } from "typeagent";
import { importPythonFile } from "./pythonImporter.js";
import { Chunk } from "./pythonChunker.js";

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
    for (const file of files) {
        await importPythonFile(file, objectFolder);
    }
}

await main();
