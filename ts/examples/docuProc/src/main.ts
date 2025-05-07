// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// System imports
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Local imports
import { importAllFiles } from "./pdfImporter.js";
import { interactiveAppLoop } from "./pdfQNAInteractiveApp.js";
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

enum AppFlags {
    Verbose = "verbose",
    Help = "help",
    RagImport = "import files and add then to the rag index",
    SRagImport = "import files and add then to the srag index",
    App = "Run in interactive mode",
}

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

    const { mode, files } = parseCommandLine();
    const databaseRootDir = path.join(__dirname, "/papers/docuproc-index");
    const chunkyIndex = await ChunkyIndex.createInstance(databaseRootDir);

    switch (mode) {
        case AppFlags.RagImport:
        case AppFlags.SRagImport:
            console.log(
                `Importing files using ${mode === AppFlags.RagImport ? "RAG" : "Structured RAG"}`,
            );
            await importAllFiles(
                files,
                chunkyIndex,
                undefined,
                verbose,
                true,
                -1,
            );
            break;
        default:
            console.log("Running interactive query loop using RAG");
            await interactiveAppLoop(chunkyIndex, verbose);
            break;
    }
}

function parseCommandLine() {
    const args = process.argv.slice(2);
    let files: string[] = [];

    const isRagImport = args.includes("--rag-import");
    const isSRagImport = args.includes("--srag-import");

    const fileFlagIndex = args.findIndex(
        (arg) => arg === "-file" || arg === "--files",
    );

    let mode = undefined;

    if (isRagImport) mode = AppFlags.RagImport;
    else if (isSRagImport) mode = AppFlags.SRagImport;
    else mode = AppFlags.App;

    if (fileFlagIndex !== -1 && args[fileFlagIndex + 1]) {
        const fileListPath = args[fileFlagIndex + 1];
        try {
            files = fs
                .readFileSync(fileListPath, "utf-8")
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith("#"));

            mode = isSRagImport ? AppFlags.SRagImport : AppFlags.RagImport;
        } catch (err) {
            console.error("Error reading file list:", err);
        }
    } else if (args.includes("-")) {
        try {
            files = fs
                .readdirSync(dataFolder)
                .filter((item) => item.toLowerCase().endsWith(".pdf"))
                .map((item) => path.join(dataFolder, item));

            mode = isSRagImport ? AppFlags.SRagImport : AppFlags.RagImport;
        } catch (err) {
            console.error("Error reading data folder:", err);
        }
    }
    return { mode, files };
}

await main();
