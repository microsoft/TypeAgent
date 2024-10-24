// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Main program to test pythonChunker.ts.

import { chunkifyPythonFile } from "./pythonChunker.js";

async function main() {
    const result = await chunkifyPythonFile("sample.py.txt");
    console.log(JSON.stringify(result, null, 2));
}

await main();
