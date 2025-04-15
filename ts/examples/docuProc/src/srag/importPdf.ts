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
    rootDir: string,
    filenames: string[],
): Promise<(ChunkedFile | ErrorItem)[]> {
    let output,
        errors,
        success = false;
    try {
        const chunkerPath = path.join(__dirname, "pdfChunker.py");
        const absChunkerPath = path.resolve(chunkerPath);
        const absFilenames = filenames.map(
            (f) => `"${path.join(__dirname, f)}"`,
        );
        const outputDir = path.join(rootDir, "chunked-docs");
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
    cachePath: string | undefined,
    verbose = false,
    fChunkPdfFiles: boolean = true,
    maxPagesToProcess: number = -1,
): Promise<PdfDocument | undefined> {
    if (!fs.existsSync(pdfFilePath)) {
        log(io, `The file path '${pdfFilePath}' does not exist.`, chalk.red);
        throw Error(`The file path '${pdfFilePath}' does not exist.`);
    }

    const pdfFolderPath = path.dirname(pdfFilePath);
    if (cachePath !== undefined) {
        if (!fs.existsSync(cachePath)) {
            fs.mkdirSync(cachePath);
        }
    } else {
        cachePath = pdfFolderPath;
    }

    // Run the PDF chunking step
    const t0 = Date.now();
    let t1 = t0;
    //let results = undefined;

    if (fChunkPdfFiles) {
        //results = await chunkifyPdfFiles(chunkyIndex.rootDir, filenames);
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
