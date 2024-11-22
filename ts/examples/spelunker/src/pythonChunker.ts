// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This requires that python3 is on the PATH
// and the chunker.py script is in the dist directory.

import { exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

import { FileDocumentation } from "./fileDocSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execPromise = promisify(exec);

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
        let { stdout, stderr } = await execPromise(
            `python3 ${chunkerPath} ${filenames.join(" ")}`,
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

function fileSize(file: ChunkedFile): number {
    return file.chunks.reduce((acc, chunk) => acc + chunkSize(chunk), 0);
}

const FILE_SIZE_LIMIT = 50000; // ~50 Kbytes; assume 128K token limit.
const CHUNK_COUNT_LIMIT = 30; // Max 30 chunks regardless of size.

// First attempt. Split eagerly, without regard to dependencies.

function splitLargeFiles(
    results: (ChunkedFile | ErrorItem)[],
): (ChunkedFile | ErrorItem)[] {
    const largeFiles = results.filter(
        (result): result is ChunkedFile =>
            !("error" in result) && fileSize(result) > FILE_SIZE_LIMIT,
    );
    results = results.filter(
        (result) => "error" in result || fileSize(result) <= FILE_SIZE_LIMIT,
    );
    for (const file of largeFiles) {
        const fileName = file.fileName;
        const chunkMap: Map<ChunkId, Chunk> = new Map(
            file.chunks.map((chunk) => [chunk.id, chunk]),
        );
        let chunks = Array.from(file.chunks); // A copy to mess around with.
        outer: while (true) {
            let totalSize = 0;
            for (let i = 0; i < chunks.length; i++) {
                const currentChunk = chunks[i];
                const size = chunkSize(currentChunk);
                if (
                    (totalSize && totalSize + size > FILE_SIZE_LIMIT) ||
                    i >= CHUNK_COUNT_LIMIT
                ) {
                    const prefix: Chunk[] = chunks.slice(0, i);
                    results.push({ fileName: file.fileName, chunks: prefix });
                    totalSize = 0;
                    // Now remove the chunks we just pushed, except for ancestors of the current chunk.
                    const ancestors: Chunk[] = [];
                    for (
                        let c: Chunk | undefined = currentChunk;
                        c;
                        c = chunkMap.get(c.parentId)
                    ) {
                        ancestors.unshift(c);
                    }
                    if (ancestors.length >= i)
                        throw new Error("Splitting is not making progress");
                    chunks = [...ancestors, ...chunks.slice(i)];
                    continue outer;
                }
            }
            // We get here when we exhausted todo without hitting the size limit.
            results.push({ fileName, chunks });
            break;
        }
    }
    return results;
}
