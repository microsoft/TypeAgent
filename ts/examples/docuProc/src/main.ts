// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// System imports
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Local imports
import { importAllFiles } from "./pdfImporter.js";
import { interactiveDocQueryLoop } from "./pdfQNAInteractiveApp.js";
import { ChunkyIndex } from "./pdfChunkyIndex.js";

// Set __dirname to emulate old JS behavior
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars (including secrets) from .env
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

// Files will be loaded from the data folder with `-` argument
const dataFolder = path.join(__dirname, "data");

const usageMessage = `\
Usage:
Loading modules:
    node dist/main.js file1.pdf [file2.pdf] ...  # Load PDF files
    node dist/main.js --files filelist.txt     # Load files listed in filelist.txt
    node dist/main.js -  # Load files from data folder (${path.relative(process.cwd(), "data")})
Interactive query loop:
    node dist/main.js    # Query previously loaded files (use @search --query 'your query')
Verbose mode: add -v or --verbose before any of the above commands.
You can also use 'pnpm start' instead of 'node dist/main.js'.
Actual args: '${process.argv[0]}' '${process.argv[1]}'
`;

async function main(): Promise<void> {
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
    const databaseRootDir = path.join(__dirname, "/papers/docuproc-index");
    const chunkyIndex = await ChunkyIndex.createInstance(databaseRootDir);

    if (files.length > 0) {
        await importAllFiles(files, chunkyIndex, undefined, verbose);
    } else {
        await interactiveDocQueryLoop(chunkyIndex, verbose);
    }
}

function parseCommandLine(): string[] {
    let files: string[];
    if (process.argv.length > 2) {
        files = process.argv.slice(2);
        if (files.length === 1 && files[0] === "-") {
            // Load all PDF files from the data directory
            try {
                const items = fs.readdirSync(dataFolder);
                files = items
                    .filter((item) => item.toLowerCase().endsWith(".pdf"))
                    .map((item) => path.join(dataFolder, item));
            } catch (err) {
                console.error("Error reading directory:", err);
            }
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

await main();
