//import { dateTime, getFileName, readAllText } from "typeagent";
//import { ConversationSettings } from "knowpro";
import {
    PdfDocument,
    //PdfChunkMessageMeta
} from "./pdfDocument.js";
import path from "node:path";
import * as fs from "node:fs";
import chalk, { ChalkInstance } from "chalk";
import * as iapp from "interactive-app";
import { ChunkedFile, ErrorItem } from "./pdfDocSchema.js";
import { promisify } from "node:util";
import { exec } from "node:child_process";
import {
    OUTPUT_DIR,
    CHUNKED_DOCS_DIR,
    resolveFilePath,
    resolveAndValidateFiles,
} from "../common.js";
import {
    getPaperIdFromFilename,
    loadCatalogWithMeta,
} from "../pdfDownLoader.js";

const execPromise = promisify(exec);

function log(
    io: iapp.InteractiveIo | undefined,
    message: string,
    color: ChalkInstance,
): void {
    message = color(message);
    if (io) {
        io.writer.writeLine(message);
    } else {
        console.log(message);
    }
}

export async function chunkifyPdfFiles(
    outputDir: string,
    filenames: string[],
): Promise<(ChunkedFile | ErrorItem)[]> {
    let output,
        errors,
        success = false;
    try {
        const absChunkerPath = resolveFilePath("srag/pdfChunkerV2.py");
        const absFilenames = resolveAndValidateFiles(filenames);

        if (!fs.existsSync(CHUNKED_DOCS_DIR)) {
            fs.mkdirSync(CHUNKED_DOCS_DIR, { recursive: true });
        }

        let { stdout, stderr } = await execPromise(
            `python3 -X utf8 "${absChunkerPath}" -files ${absFilenames.join(" ")} -outdir ${CHUNKED_DOCS_DIR}`,
            { maxBuffer: 64 * 1024 * 1024 }, // Super large buffer
        );
        output = stdout;
        errors = stderr;
        success = true;
    } catch (error: any) {
        output = error?.stdout || "";
        errors = error?.stderr || error.message || "Unknown error";
    }

    if (!success) {
        return [{ error: errors, output: output }];
    }
    if (errors) {
        return [{ error: errors, output: output }];
    }
    if (!output) {
        return [{ error: "No output from chunker script" }];
    }

    const results: (ChunkedFile | ErrorItem)[] = JSON.parse(output);
    for (const result of results) {
        if ("error" in result) {
            console.error("Error in chunker output:", result.error);
            continue;
        }
    }
    return results;
}

export async function loadPdfChunksFromJson(
    rootDir: string,
    filenames: string[],
): Promise<(ChunkedFile | ErrorItem)[]> {
    let results: (ChunkedFile | ErrorItem)[] = [];
    try {
        const chunkedDocsDir = path.join(rootDir, "chunked-docs");
        for (const filename of filenames) {
            const chunkedFilename = path.join(
                chunkedDocsDir,
                path.parse(filename).name,
                path.basename(filename) + "-chunked.json",
            );
            try {
                if (
                    await fs.promises
                        .access(chunkedFilename, fs.constants.F_OK)
                        .then(() => true)
                        .catch(() => false)
                ) {
                    const data = JSON.parse(
                        await fs.promises.readFile(chunkedFilename, "utf-8"),
                    );
                    results.push(data);
                } else {
                    results.push({
                        error: "File not found",
                        filename: chunkedFilename,
                    } as ErrorItem);
                }
            } catch (error: any) {
                const errors =
                    error?.stderr || error.message || "Unknown error";
                results.push({
                    error: errors,
                    filename: chunkedFilename,
                } as ErrorItem);
            }
        }
    } catch (error: any) {
        const errors = error?.stderr || error.message || "Unknown error";
        results.push({ error: errors } as ErrorItem);
    }
    return results;
}

export async function importPdf(
    io: iapp.InteractiveIo | undefined,
    pdfFilePath: string,
    outputDir: string | undefined,
    verbose = false,
    fChunkPdfFiles: boolean = true,
    maxPagesToProcess: number = -1,
): Promise<PdfDocument | undefined> {
    if (!pdfFilePath) {
        log(io, "No PDF file path provided.", chalk.red);
        return undefined;
    }

    if (outputDir === undefined) {
        outputDir = OUTPUT_DIR;
    }

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Run the PDF chunking step
    const t0 = Date.now();
    let t1 = t0;
    let results = undefined;

    if (fChunkPdfFiles) {
        results = await chunkifyPdfFiles(outputDir, [pdfFilePath]);
        t1 = Date.now();
    } else {
        results = await loadPdfChunksFromJson(outputDir, [pdfFilePath]);
        t1 = Date.now();
    }

    let numLines = 0;
    let numBlobs = 0;
    let numChunks = 0;
    let numErrors = 0;
    for (const result of results) {
        if ("error" in result) {
            numErrors++;
        } else {
            const chunkedFile = result;
            numChunks += chunkedFile.chunks.length;
            for (const chunk of chunkedFile.chunks) {
                numBlobs += chunk.blobs.length;
                //numLines += await getLinesInChunk(chunk);
            }
        }
    }
    log(
        io,
        `[Chunked ${results.length} files ` +
            `(${numLines} lines, ${numBlobs} blobs, ${numChunks} chunks, ${numErrors} errors) ` +
            `in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
        chalk.gray,
    );

    const chunkingErrors = results.filter(
        (result: any): result is ErrorItem => "error" in result,
    );
    for (const error of chunkingErrors) {
        log(
            io,
            `[Error: ${error.error}; Output: ${error.output ?? ""}]`,
            chalk.redBright,
        );
    }

    if (chunkingErrors.length <= 0) {
        indexPdfChunks(pdfFilePath, results);
    }
    return undefined;
}

async function indexPdfChunks(
    pdfFile: string,
    chunks: any[] = [],
): Promise<void> {
    const rootDir = OUTPUT_DIR;
    const paperId = getPaperIdFromFilename(pdfFile);
    const pdfCatalog = await loadCatalogWithMeta();

    if (pdfCatalog !== undefined) {
        const pdfDoc = pdfCatalog[paperId];
        if (pdfDoc) {
            // You can safely use pdfDoc here
            console.log(pdfDoc.meta.title);
        }
    }

    const filenames = [
        "chunked-docs/2023-09-01_10-00-00_0000.pdf-chunked.json",
        "chunked-docs/2023-09-01_10-00-00_0001.pdf-chunked.json",
    ];
    const chunkedDocsDir = path.join(rootDir, "chunked-docs");
    const chunkedFilename = path.join(
        chunkedDocsDir,
        path.parse(filenames[0]).name,
        path.basename(filenames[0]) + "-chunked.json",
    );
    console.log(chunkedFilename);
}
