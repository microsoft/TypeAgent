// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This requires that python3 is on the PATH
// and the chunker.py script is in the dist directory.

import { exec } from "child_process";
import path from "path";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { CodeDocumentation } from "code-processor";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execPromise = promisify(exec);

export type IdType = string;

export interface Blob {
    start: number; // int; 0-based!
    lines: string[];
}

export interface Chunk {
    // Names here must match names in chunker.py.
    id: IdType;
    treeName: string;
    blobs: Blob[];
    parentId: IdType;
    children: IdType[];
    filename?: string; // Set on receiving end to reduce JSON size.
    docs?: CodeDocumentation; // Computed on receiving end from file docs.
}

export interface ChunkedFile {
    filename: string;
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
    // TODO: validate JSON
    return JSON.parse(output);
}
