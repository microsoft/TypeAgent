// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Main program to index python files and query the index.

// System imports
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Local imports
import { importPythonFiles } from "./pythonImporter.js";
import { runQueryInterface } from "./queryInterface.js";
import { ChunkyIndex } from "./chunkyIndex.js";

// Set __dirname to emulate old JS behavior
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars (including secrets) from .env
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

// Sample file to load with `-` argument
const sampleFile = path.join(__dirname, "sample.py.txt");

await main();

async function main(): Promise<void> {
    const t0 = Date.now();

    // TODO: switch to whatever interactive-app does.
    const help =
        process.argv.includes("-h") ||
        process.argv.includes("--help") ||
        process.argv.includes("-?") ||
        process.argv.includes("--?");
    if (help) {
        console.log(
            "Usage:\n" +
                "Loading modules:\n" +
                "   node main.js file1.py [file2.py] ...  # Load files\n" +
                "   node main.js --files filelist.txt  # Load files listed in filelist.txt\n" +
                `   node main.js -  # Load sample file (${path.relative(process.cwd(), sampleFile)})\n` +
                "Interactive query loop:\n" +
                "   node main.js    # Query previously loaded files (use @search --query 'your query')\n",
        );
        return;
    }

    const verbose =
        process.argv.includes("-v") || process.argv.includes("--verbose");
    if (verbose) {
        process.argv = process.argv.filter(
            (arg) => arg !== "-v" && arg !== "--verbose",
        );
    }

    const files = processArgs();

    let homeDir = process.platform === "darwin" ? process.env.HOME || "" : "";
    const rootDir = path.join(homeDir, "/data/spelunker");
    const chunkyIndex = await ChunkyIndex.createInstance(rootDir);

    const t1 = Date.now();
    console.log(`[Initialized in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`);

    // Import all files. (TODO: Break up very long lists.)
    if (files.length > 0) {
        console.log(`[Importing ${files.length} files]`);
        const t0 = Date.now();

        await importPythonFiles(files, chunkyIndex, true, verbose);

        const t1 = Date.now();
        console.log(
            `[Imported ${files.length} files in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
        );
    } else {
        await runQueryInterface(chunkyIndex, verbose);
    }
}

function processArgs(): string[] {
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
    return files;
}
