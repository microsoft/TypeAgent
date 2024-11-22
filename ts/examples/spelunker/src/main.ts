// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Main program to index python files and query the index.

// System imports
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Local imports
import { importAllFiles } from "./pythonImporter.js";
import { interactiveQueryLoop } from "./queryInterface.js";
import { ChunkyIndex } from "./chunkyIndex.js";

// Set __dirname to emulate old JS behavior
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars (including secrets) from .env
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

// Sample file to load with `-` argument
const sampleFile = path.join(__dirname, "chunker.py");

const usageMessage = `\
Usage:
Loading modules:
    node dist/main.js file1.py [file2.py] ...  # Load files
    node dist/main.js --files filelist.txt     # Load files listed in filelist.txt
    node dist/main.js -  # Load sample file (${path.relative(process.cwd(), sampleFile)})
Interactive query loop:
    node dist/main.js    # Query previously loaded files (use @search --query 'your query')
Verbose mode: add -v or --verbose before any of the above commands.
You can also use 'pnpm start' instead of 'node dist/main.js'.
Actual args: '${process.argv[0]}' '${process.argv[1]}'
`;

await main();

async function main(): Promise<void> {
    // TODO: switch to whatever interactive-app uses to parse the command line?

    const helpFlags = ["-h", "--help", "-?", "--?"];
    const help = helpFlags.some((arg) => process.argv.includes(arg));
    if (help) {
        console.log(usageMessage);
        return;
    }

    const verboseFlags = ["-v", "--verbose"];
    const verbose = verboseFlags.some((arg) => process.argv.includes(arg));
    if (verbose) {
        process.argv = process.argv.filter(
            (arg) => arg !== "-v" && arg !== "--verbose",
        );
    }

    const files = parseCommandLine();

    const homeDir = process.platform === "darwin" ? process.env.HOME || "" : "";
    const databaseRootDir = path.join(homeDir, "/data/spelunker");

    const chunkyIndex = await ChunkyIndex.createInstance(databaseRootDir);

    if (files.length > 0) {
        await importAllFiles(files, chunkyIndex, undefined, verbose);
    } else {
        await interactiveQueryLoop(chunkyIndex, verbose);
    }
}

function parseCommandLine(): string[] {
    let files: string[];
    // TODO: Use a proper command-line parser?
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
