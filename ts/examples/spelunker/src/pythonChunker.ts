// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This requires that python3 is on the PATH
// and the chunker.py script is in the dist directory.

import { exec } from "child_process";
import path from "path";
import { promisify } from "util";
import { fileURLToPath } from "url";

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
    // TODO: Make them consistent -- Py or TS naming style?
    id: IdType;
    treeName: string;
    blobs: Blob[];
    parentId: IdType;
    children: IdType[];
    filename?: string;
}

export interface ErrorItem {
    error: string;
    output?: string;
}

export async function chunkifyPythonFile(
    filename: string,
): Promise<Chunk[] | ErrorItem> {
    let output,
        errors,
        success = false;
    try {
        const chunkerPath = path.join(__dirname, "chunker.py");
        let { stdout, stderr } = await execPromise(
            `python3 ${chunkerPath} ${filename}`,
            { maxBuffer: 16 * 1024 * 1024 }, // Extra large buffer
        );
        output = stdout;
        errors = stderr;
        success = true;
    } catch (error: any) {
        output = error?.stdout || "";
        errors = error?.stderr || error.message || "Unknown error";
    }
    if (!success) {
        return { error: errors, output: output };
    }
    if (errors) {
        return { error: errors, output: output };
    }
    if (!output) {
        return { error: "No output" };
    }
    // TODO: validate JSON
    return JSON.parse(output);
}
