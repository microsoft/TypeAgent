// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Main program to test pythonChunker.ts.
// This requires that python3 is on the PATH
// and the chunker.py script is in the current directory.

import { chunkifyPythonFile } from "./pythonChunker.js";

async function main(): Promise<void> {
    let filename = "sample.py.txt";
    if (process.argv.length > 2) {
        // argv[0] is "node", argv[1] is the script name.
        filename = process.argv[2];
    }
    console.log(`[Chunkifying ${filename}]`);
    const result = (await chunkifyPythonFile(filename)) as {
        error?: string;
        output?: string;
    };
    if (result.error) {
        console.log(result.output);
        console.error(result.error);
        return;
    }
    console.log(JSON.stringify(result, null, 2));
}

await main();
