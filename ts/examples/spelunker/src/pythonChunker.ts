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
    fileName: string; // Set on receiving end to reduce JSON size.
    docs?: FileDocumentation; // Computed on receiving end from file docs.
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
    return results;
}
