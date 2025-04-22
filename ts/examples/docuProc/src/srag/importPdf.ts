//import { dateTime, getFileName, readAllText } from "typeagent";
//import { ConversationSettings } from "knowpro";
import {
    PdfDocument,
    //PdfChunkMessageMeta
} from "./pdfDocument.js";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk, { ChalkInstance } from "chalk";
import * as iapp from "interactive-app";
import { ChunkedFile, ErrorItem } from "./pdfDocSchema.js";
import { promisify } from "node:util";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";

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

function resolveFilePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    return path.join(__dirname, filePath);
}

export async function chunkifyPdfFiles(
    outputDir: string,
    filenames: string[],
): Promise<(ChunkedFile | ErrorItem)[]> {
    let output,
        errors,
        success = false;
    try {
        const absChunkerPath = resolveFilePath("pdfChunkerV2.py");
        const absFilenames = filenames.map(
            (f) => `"${resolveFilePath(f)}"`,
        );
       
        let { stdout, stderr } = await execPromise(
            `python3 -X utf8 "${absChunkerPath}" -files ${absFilenames.join(" ")} -outdir ${outputDir}`,
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
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const distRoot = path.dirname(__dirname);
        outputDir = path.join(distRoot, "output-data", "chunked-docs");
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
        if (Array.isArray(results) && results.some((item) => "error" in item)) {
            const errorItem = results.find((item) => "error" in item) as ErrorItem;
            log(io, `Error chunking PDF: ${errorItem.error}`, chalk.red);
        }
        t1 = Date.now();
    } else {
        //results = await loadPdfChunksFromJson(chunkyIndex.rootDir, filenames);
        t1 = Date.now();
    }

    log(
        io,
        `[chunked ${pdfFilePath} in ${((t1 - t0) * 0.001).toFixed(3)} seconds]`,
        chalk.grey,
    );

    // Index the chunks
    return undefined;
}
