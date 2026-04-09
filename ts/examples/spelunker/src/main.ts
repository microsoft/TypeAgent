// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Main program to index python files and query the index.

// System imports
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

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
Options: -v/--verbose, -h/--help
You can also use 'pnpm start' instead of 'node dist/main.js'.
Actual args: '${process.argv[0]}' '${process.argv[1]}'
`;

await main();

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({
        args: process.argv.slice(2),
        options: {
            verbose: { type: "boolean", short: "v" },
            files: { type: "string" },
            help: { type: "boolean", short: "h" },
        },
        allowPositionals: true,
    });

    if (values.help) {
        console.log(usageMessage);
        return;
    }

    const verbose = values.verbose ?? false;
    const files = resolveFiles(positionals, values.files);

    const homeDir = process.platform === "darwin" ? process.env.HOME || "" : "";
    const databaseRootDir = path.join(homeDir, "/data/spelunker");

    const chunkyIndex = await ChunkyIndex.createInstance(databaseRootDir);

    if (files.length > 0) {
        await importAllFiles(files, chunkyIndex, undefined, verbose);
    } else {
        await interactiveQueryLoop(chunkyIndex, verbose);
    }
}

function resolveFiles(positionals: string[], filesArg?: string): string[] {
    if (positionals.length === 1 && positionals[0] === "-") {
        return [sampleFile];
    }
    if (filesArg) {
        return fs
            .readFileSync(filesArg, "utf-8")
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && line[0] !== "#");
    }
    return positionals;
}
