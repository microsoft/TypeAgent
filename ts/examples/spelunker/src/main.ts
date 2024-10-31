// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Main program to index python files and query the index.

// System imports
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// 3rd party package imports
import * as readlineSync from "readline-sync";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

// Workspace package imports
import { ChatModel, openai } from "aiclient";
import {
    CodeBlock,
    CodeDocumentation,
    CodeDocumenter,
    createSemanticCodeIndex,
} from "code-processor";
import { createObjectFolder, loadSchema } from "typeagent";

// Local imports
import { ChunkDocumentation } from "./chunkDocSchema.js";
import { Chunk } from "./pythonChunker.js";
import { importPythonFiles, wordWrap } from "./pythonImporter.js";

// Set __dirname to emulate old JS behavior
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars (including secrets) from .env
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

// Usage: node main.js [file1.py] [file2.py] ...
// OR:    node main.js --files filelist.txt
// OR:    node main.js -  # Load sample file (sample.py.txt)
// OR:    node main.js    # Query previously loaded files
async function main(): Promise<void> {
    const verbose = false;
    let files: string[];
    // TODO: Use a proper command-line parser.
    if (process.argv.length > 2) {
        files = process.argv.slice(2);
        if (files.length === 1 && files[0] === "-") {
            const sampleFile = path.join(__dirname, "sample.py.txt");
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

    let homeDir = process.platform === "darwin" ? process.env.HOME || "" : "";
    const dataRoot = homeDir + "/data";
    const spelunkerRoot = dataRoot + "/spelunker";

    const chunkFolder = await createObjectFolder<Chunk>(
        spelunkerRoot + "chunks",
        { serializer: (obj) => JSON.stringify(obj, null, 2) },
    );
    const chatModel = openai.createChatModelDefault("spelunkerChat");
    const codeDocumenter = await createCodeDocumenter(chatModel);
    const codeIndex = await createSemanticCodeIndex(
        spelunkerRoot + "index",
        codeDocumenter,
        undefined,
        (obj) => JSON.stringify(obj, null, 2),
    );
    const summaryFolder = await createObjectFolder<CodeDocumentation>(
        spelunkerRoot + "summaries",
        { serializer: (obj) => JSON.stringify(obj, null, 2) },
    );

    // Import all files. (TODO: Break up very long lists.)
    console.log(`[Importing ${files.length} files]`);
    await importPythonFiles(
        files,
        chunkFolder,
        codeIndex,
        summaryFolder,
        true,
        verbose,
    );

    // Loop processing searches. (TODO: Use interactiveApp.)
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
        const hits = await codeIndex.find(searchKey, 2);
        console.log(
            `Got ${hits.length} hit${hits.length == 0 ? "s." : hits.length === 1 ? ":" : "s:"}`,
        );
        for (const hit of hits) {
            const chunk: Chunk | undefined = await chunkFolder.get(hit.item);
            if (!chunk) {
                console.log(hit, "--> [No data]");
            } else {
                console.log(
                    `score: ${hit.score.toFixed(3)}, ` +
                        `id: ${chunk.id}, ` +
                        `file: ${path.relative(process.cwd(), chunk.filename!)}, ` +
                        `type: ${chunk.treeName}`,
                );
                const summary: CodeDocumentation | undefined =
                    await summaryFolder.get(hit.item);
                if (
                    summary &&
                    summary.comments &&
                    summary.comments.length > 0
                ) {
                    for (const comment of summary.comments)
                        console.log(
                            wordWrap(
                                `${comment.lineNumber}. ${comment.comment}`,
                            ),
                        );
                }
                for (const blob of chunk.blobs) {
                    let lineno = 1 + blob.start;
                    for (const index in blob.lines) {
                        console.log(
                            `${String(lineno).padStart(3)}: ${blob.lines[index].trimEnd()}`,
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

// We have our own code documenter to pass to createSemanticCodeIndex.

async function createCodeDocumenter(model: ChatModel): Promise<CodeDocumenter> {
    const docTranslator = await createDocTranslator(model);
    return {
        document,
    };

    async function document(code: CodeBlock): Promise<CodeDocumentation> {
        const text =
            typeof code.code === "string" ? code.code : code.code.join("");
        const promptPrefix =
            `Document the following ${code.language} code:\n\n${text}\n\n` +
            "Return 1-3 short paragraphs of text describing the code, " +
            "its purpose, and any relevant details.\n" +
            "The docs must be: accurate, active voice, crisp, succinct.";
        const result = await docTranslator.translate(text, promptPrefix);
        if (result.success) {
            return {
                comments: [{ lineNumber: 1, comment: result.data.description }],
            };
        } else {
            throw new Error(result.message);
        }
    }
}

async function createDocTranslator(
    model: ChatModel,
): Promise<TypeChatJsonTranslator<ChunkDocumentation>> {
    const typeName = "ChunkDocumentation";
    const schema = loadSchema(["chunkDocSchema.ts"], import.meta.url);
    const validator = createTypeScriptJsonValidator<ChunkDocumentation>(
        schema,
        typeName,
    );
    const translator = createJsonTranslator<ChunkDocumentation>(
        model,
        validator,
    );
    return translator;
}
