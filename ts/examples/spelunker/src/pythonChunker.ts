// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This requires that python3 is on the PATH
// and the chunker.py script is in the dist directory.

import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

import { FileDocumentation } from "./fileDocSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execFilePromise = promisify(execFile);

export type ChunkId = string;

export interface Blob {
    start: number; // int; 0-based!
    lines: string[];
    breadcrumb?: boolean;
}

export interface Chunk {
    // Names here must match names in chunker.py.
    id: ChunkId;
    treeName: string;
    blobs: Blob[];
    parentId: ChunkId;
    children: ChunkId[];
    fileName: string; // Set upon receiving end from ChunkedFile.fileName.
    docs?: FileDocumentation; // Computed later by fileDocumenter.
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

export async function chunkifyPythonFiles(
    filenames: string[],
): Promise<(ChunkedFile | ErrorItem)[]> {
    let output,
        errors,
        success = false;
    try {
        const chunkerPath = path.join(__dirname, "chunker.py");
        let { stdout, stderr } = await execFilePromise(
            "python3",
            ["-X", "utf8", chunkerPath, ...filenames],
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
    // TODO: validate that JSON matches our schema.

    // Ensure all chunks have a filename.
    for (const result of results) {
        if (!("error" in result)) {
            for (const chunk of result.chunks) {
                chunk.fileName = result.fileName;
            }
        }
    }
    return splitLargeFiles(results);
}

const CHUNK_COUNT_LIMIT = 25; // How many chunks at most.
const FILE_SIZE_LIMIT = 25000; // How many characters at most.

function splitLargeFiles(
    items: (ChunkedFile | ErrorItem)[],
): (ChunkedFile | ErrorItem)[] {
    const results: (ChunkedFile | ErrorItem)[] = [];
    for (const item of items) {
        if (
            "error" in item ||
            (item.chunks.length <= CHUNK_COUNT_LIMIT &&
                fileSize(item) <= FILE_SIZE_LIMIT)
        ) {
            results.push(item);
        } else {
            results.push(...splitFile(item));
        }
    }
    return results;
}

// This algorithm is too complex. I needed a debugger and logging to get it right.
function splitFile(file: ChunkedFile): ChunkedFile[] {
    const fileName = file.fileName;
    const parentMap: Map<ChunkId, Chunk> = new Map();
    for (const chunk of file.chunks) {
        // Only nodes with children will be looked up in this map.
        if (chunk.children.length) parentMap.set(chunk.id, chunk);
    }

    const results: ChunkedFile[] = []; // Where output accumulates.
    let chunks = Array.from(file.chunks); // The chunks yet to emit.
    let minNumChunks = 1;

    outer: while (true) {
        // Keep going until we exit the inner loop.
        let totalSize = 0; // Size in characters of chunks to be output.
        for (let i = 0; i < chunks.length; i++) {
            // Iterate in pre-order.
            const currentChunk = chunks[i];
            const size = chunkSize(currentChunk);
            if (
                i < minNumChunks ||
                (i < CHUNK_COUNT_LIMIT && totalSize + size <= FILE_SIZE_LIMIT)
            ) {
                totalSize += size;
                continue;
            }

            // Split the file here (current chunk goes into ancestors).
            const rest = chunks.splice(i);
            if (rest.shift() !== currentChunk)
                throw Error(
                    "Internal error: expected current chunk at head of rest",
                );
            results.push({ fileName, chunks });
            const ancestors: Chunk[] = [];

            let c: Chunk | undefined = currentChunk;
            do {
                ancestors.unshift(c);
                c = parentMap.get(c.parentId);
            } while (c);
            // Note that the current chunk is the last ancestor.
            chunks = [...ancestors, ...rest];
            minNumChunks = ancestors.length;
            continue outer;
        }
        // Append the final chunk.
        results.push({ fileName, chunks });
        break;
    }
    // console.log(
    //     `Split ${file.fileName} (${file.chunks.length} chunks) into ${results.length} files.`,
    // );
    // console.log(`Sizes: ${results.map((f) => f.chunks.length).join(", ")}`);
    return results;
}

function fileSize(file: ChunkedFile): number {
    return file.chunks.reduce((acc, chunk) => acc + chunkSize(chunk), 0);
}

function chunkSize(chunk: Chunk): number {
    let totalCharacters = 0;
    for (const blob of chunk.blobs) {
        if (!blob.breadcrumb) {
            for (const line of blob.lines) {
                totalCharacters += line.length;
            }
        }
    }
    return totalCharacters;
}
