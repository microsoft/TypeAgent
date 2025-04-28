//import { dateTime, getFileName, readAllText } from "typeagent";
//import { ConversationSettings } from "knowpro";
import {
    PdfChunkMessageMeta,
    PdfChunkMessage,
    PdfDocument,
} from "./pdfDocument.js";
import path from "node:path";
import * as fs from "node:fs";
import chalk, { ChalkInstance } from "chalk";
import * as iapp from "interactive-app";
import { Chunk, ChunkedFile, ErrorItem } from "./pdfDocSchema.js";
import { promisify } from "node:util";
import { exec } from "node:child_process";
import {
    OUTPUT_DIR,
    CHUNKED_DOCS_DIR,
    resolveFilePath,
    resolveAndValidateFiles,
} from "../common.js";
import {
    CatalogEntryWithMeta,
    getPaperIdFromFilename,
    loadCatalogWithMeta,
} from "../pdfDownLoader.js";
import { assert } from "node:console";

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
        for (const filename of filenames) {
            const paperId = getPaperIdFromFilename(filename);
            const chunkedDocsDir = path.join(rootDir, "chunked-docs", paperId);
            const chunkedFilename = path.join(
                chunkedDocsDir,
                `${paperId}-chunked.json`,
            );

            // should we return or keep doing other files
            if (!fs.existsSync(chunkedFilename)) {
                console.error(
                    `File not found: ${chunkedFilename}. Please run the chunker first.`,
                );
                return [
                    {
                        error: `File not found: ${chunkedFilename}. Please run the chunker first.`,
                    },
                ];
            }

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
        indexPdfChunks(io, verbose, results);
    }
    return undefined;
}

export function processPdfChunks(
    catEntry: CatalogEntryWithMeta,
    chunks: Chunk[],
): PdfChunkMessage[] {
    let chunkMessages: PdfChunkMessage[] = [];
    const pageChunksMap: Record<
        string,
        { pageRootChunk: Chunk; pageChunks: Chunk[] }
    > = {};

    for (const chunk of chunks) {
        if (!chunk.parentId) {
            pageChunksMap[chunk.pageid] = {
                pageRootChunk: chunk,
                pageChunks: [],
            };
        }
    }

    let pageCount = 0;
    for (const pageid in pageChunksMap) {
        pageCount++;
        const { pageRootChunk, pageChunks } = pageChunksMap[pageid];
        console.log(
            `Processing page ${pageCount} with root chunk ID: ${pageRootChunk.id}`,
        );
        for (const chunk of pageChunks) {
            const chunkIdentifier = chunk.id;

            for (const blob of chunk.blobs) {
                let chunkMessageMeta: PdfChunkMessageMeta =
                    new PdfChunkMessageMeta();
                chunkMessageMeta.docChunkId = chunkIdentifier;
                chunkMessageMeta.pageNumber = pageCount.toString();
                let chunkMessage: PdfChunkMessage = new PdfChunkMessage(
                    [],
                    chunkMessageMeta,
                );

                if (blob.content !== undefined) {
                    chunkMessage.addContent(blob.content);
                }
                chunkMessages.push(chunkMessage);
            }
        }
    }

    return chunkMessages;
}

export async function indexPdfChunks(
    io: iapp.InteractiveIo | undefined,
    fVerbose: boolean,
    chunkResults: (ChunkedFile | ErrorItem)[] = [],
): Promise<void> {
    const pdfCatalog = await loadCatalogWithMeta();

    if (pdfCatalog !== undefined) {
        const chunkedFiles = chunkResults.filter(
            (result: any): result is ChunkedFile => "chunks" in result,
        );
        log(io, `[Documenting ${chunkedFiles.length} files]`, chalk.grey);

        // for each chunked file, index the chunks in a loop
        for (const chunkedFile of chunkedFiles) {
            const pdfFile = chunkedFile.fileName;
            assert(fs.existsSync(pdfFile), `File not found: ${pdfFile}`);
            const paperId = getPaperIdFromFilename(pdfFile);

            let catEntry = pdfCatalog[paperId];
            if (catEntry !== undefined) {
                await processPdfChunks(catEntry, chunkedFile.chunks);
            }
        }
    }
}
