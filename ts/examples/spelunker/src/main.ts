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
    SemanticCodeIndex,
} from "code-processor";
import { createObjectFolder, loadSchema, ObjectFolder } from "typeagent";

// Local imports
import { Chunk } from "./pythonChunker.js";
import { importPythonFiles, wordWrap } from "./pythonImporter.js";

// Set __dirname to emulate old JS behavior
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars (including secrets) from .env
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

const verbose = true; // true for more, false for less chatty output.

await main();

// Usage: node main.js [file1.py] [file2.py] ...
// OR:    node main.js --files filelist.txt
// OR:    node main.js -  # Load sample file (sample.py.txt)
// OR:    node main.js    # Query previously loaded files
async function main(): Promise<void> {
    console.log("[Hi!]");

    const t0 = Date.now();

    const files = processArgs();

    let homeDir = process.platform === "darwin" ? process.env.HOME || "" : "";
    const dataRoot = homeDir + "/data";
    const spelunkerRoot = dataRoot + "/spelunker";

    const chunkFolder = await createObjectFolder<Chunk>(
        spelunkerRoot + "/chunks",
        { serializer: (obj) => JSON.stringify(obj, null, 2) },
    );
    const chatModel = openai.createChatModelDefault("spelunkerChat");
    const fileDocumenter = await createFileDocumenter(chatModel);
    const fakeCodeDocumenter = await createFakeCodeDocumenter();
    const codeIndex = await createSemanticCodeIndex(
        spelunkerRoot + "/index",
        fakeCodeDocumenter,
        undefined,
        (obj) => JSON.stringify(obj, null, 2),
    );
    const summaryFolder = await createObjectFolder<CodeDocumentation>(
        spelunkerRoot + "/summaries",
        { serializer: (obj) => JSON.stringify(obj, null, 2) },
    );

    const t1 = Date.now();
    console.log(`[Initialized in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`);

    // Import all files. (TODO: Break up very long lists.)
    if (files.length > 0) {
        console.log(`[Importing ${files.length} files]`);
        const t0 = Date.now();

        await importPythonFiles(
            files,
            fileDocumenter,
            chunkFolder,
            codeIndex,
            summaryFolder,
            true,
            verbose,
        );

        const t1 = Date.now();
        console.log(
            `[Imported ${files.length} files in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
        );
    }

    // Loop processing searches. (TODO: Use interactiveApp.)
    while (true) {
        const input = readlineSync.question("~> ", {
            history: true, // Enable history
            keepWhitespace: true, // Keep leading/trailing whitespace in history
        });
        if (!input.trim()) {
            console.log("[Bye!]");
            return;
        }
        await processQuery(input, chunkFolder, codeIndex, summaryFolder);
    }
}

function processArgs() {
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
    return files;
}

async function processQuery(
    input: string,
    chunkFolder: ObjectFolder<Chunk>,
    codeIndex: SemanticCodeIndex,
    summaryFolder: ObjectFolder<CodeDocumentation>,
): Promise<void> {
    let hits;
    try {
        hits = await codeIndex.find(input, 2);
    } catch (error) {
        console.log(`[${error}]`);
        return;
    }
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
            if (summary?.comments?.length) {
                for (const comment of summary.comments)
                    console.log(
                        wordWrap(`${comment.lineNumber}. ${comment.comment}`),
                    );
            }
            for (const blob of chunk.blobs) {
                for (let index = 0; index < blob.lines.length; index++) {
                    console.log(
                        `${(1 + blob.start + index).toString().padStart(3)}: ${blob.lines[index].trimEnd()}`,
                    );
                }
                console.log("");
            }
        }
    }
}

// Fake code documenter to pass to creteCodeIndex.

export interface CodeBlockWithDocs extends CodeBlock {
    docs: CodeDocumentation;
}

async function createFakeCodeDocumenter(): Promise<CodeDocumenter> {
    return {
        document,
    };

    async function document(
        code: CodeBlock | CodeBlockWithDocs,
    ): Promise<CodeDocumentation> {
        if ("docs" in code && code.docs) {
            return code.docs;
        }
        return {};
    }
}

export interface FileDocumenter {
    document(chunks: Chunk[]): Promise<CodeDocumentation>;
}

async function createFileDocumenter(model: ChatModel): Promise<FileDocumenter> {
    const fileDocTranslator = await createFileDocTranslator(model);
    return {
        document,
    };

    async function document(chunks: Chunk[]): Promise<CodeDocumentation> {
        let text = "";
        for (const chunk of chunks) {
            text += `***: Docmument the following ${chunk.treeName}:\n`;
            for (const blob of chunk.blobs) {
                for (let i = 0; i < blob.lines.length; i++) {
                    text += `[${blob.start + i + 1}]: ${blob.lines[i]}\n`;
                }
            }
        }
        const request =
            "Document the given Python code, its purpose, and any relevant details.\n" +
            "The code has (non-contiguous) line numbers, e.g.: `[1]: def foo():`\n" +
            "There are also marker lines, e.g.: `***: Document the following FuncDef`\n" +
            "Write a concise paragraph for EACH marker. Also write a paragraph about the whole file." +
            "DON'T document any lines without markers!\n";
        const result = await fileDocTranslator.translate(request, text);

        // Now assign each comment to its chunk.
        if (result.success) {
            const codeDocs: CodeDocumentation = result.data;
            // Assign each comment to its chunk.
            for (const comment of codeDocs.comments ?? []) {
                for (const chunk of chunks) {
                    for (const blob of chunk.blobs) {
                        if (
                            blob.start < comment.lineNumber &&
                            comment.lineNumber <= blob.start + blob.lines.length
                        ) {
                            if (chunk.docs === undefined) {
                                chunk.docs = { comments: [comment] };
                            } else {
                                chunk.docs.comments!.push(comment);
                            }
                        }
                    }
                }
            }
            return codeDocs;
        } else {
            throw new Error(result.message);
        }
    }
}

async function createFileDocTranslator(
    model: ChatModel,
): Promise<TypeChatJsonTranslator<CodeDocumentation>> {
    const typeName = "CodeDocumentation";
    const schema = loadSchema(["codeDocSchema.ts"], import.meta.url);
    const validator = createTypeScriptJsonValidator<CodeDocumentation>(
        schema,
        typeName,
    );
    const translator = createJsonTranslator<CodeDocumentation>(
        model,
        validator,
    );
    return translator;
}
