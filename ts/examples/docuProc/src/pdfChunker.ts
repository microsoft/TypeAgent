// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This requires that python3 is on the PATH
// and the pdfChunker.py script is in the dist directory.

import { execFile } from "child_process";
import path, { resolve } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import fs from "fs/promises";

import { PdfChunkDocumentation, PdfDocumentInfo } from "./pdfDocChunkSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execFilePromise = promisify(execFile);

export type ChunkId = string;

export interface Blob {
    /** Stores text, table, or image data plus metadata. */
    blob_type:
        | "text"
        | "table"
        | "page_image"
        | "image"
        | "image_label"
        | "table_label"; // e.g. "text", "table", "image"
    start: number; // Page number (0-based)
    content?: string | string[]; // e.g. chunk of text
    bbox?: number[]; // Optional bounding box
    img_name?: string; // Optional image name
    img_path?: string; // Optional image path
    para_id?: number; // Optional paragraph ID
    image_chunk_ref?: string[]; // Optional reference to image chunk(s)
}

export interface Chunk {
    // A chunk at any level of nesting (e.g., a page, a paragraph, an image, a table).
    // Names here must match names in pdfChunker.py.
    id: string;
    pageid: string;
    blobs: Blob[];
    parentId?: ChunkId;
    children?: ChunkId[];
    fileName?: string;
    chunkDoc?: PdfChunkDocumentation;
    docInfo?: PdfDocumentInfo; // Computed later by documenter.
}
export interface ChunkedFile {
    fileName: string;
    chunks: Chunk[];
}
export interface ErrorItem {
    error: string;
    filename?: string;
    output?: string;
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
                    await fs
                        .access(chunkedFilename)
                        .then(() => true)
                        .catch(() => false)
                ) {
                    const data = JSON.parse(
                        await fs.readFile(chunkedFilename, "utf-8"),
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

export async function chunkifyPdfFiles(
    rootDir: string,
    filenames: string[],
): Promise<(ChunkedFile | ErrorItem)[]> {
    let output,
        errors,
        success = false;
    try {
        const chunkerPath = path.join(__dirname, "pdfChunker.py");
        const absChunkerPath = resolve(chunkerPath);
        const absFilenames = filenames.map((f) => path.join(__dirname, f));
        const outputDir = path.join(rootDir, "chunked-docs");
        let { stdout, stderr } = await execFilePromise(
            "python3",
            [
                "-X",
                "utf8",
                absChunkerPath,
                "-files",
                ...absFilenames,
                "-outdir",
                outputDir,
            ],
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

export function chunkSize(chunk: Chunk): number {
    let totalChars = 0;
    for (const blob of chunk.blobs) {
        if (blob.blob_type === "text" && blob.content) {
            if (Array.isArray(blob.content)) {
                totalChars += blob.content.reduce(
                    (sum, line) => sum + line.length,
                    0,
                );
            } else {
                totalChars += blob.content.length;
            }
        }
    }
    return totalChars;
}
