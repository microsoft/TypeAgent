// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This requires that python3 is on the PATH
// and the chunker.py script is in the current directory.

import { exec } from "child_process";
import { promisify } from "util";

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
    parent_id: IdType;
    parent_slot: number; // int; parent.children[parent_slot] === id
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
        let { stdout, stderr } = await execPromise(
            `python3 chunker.py ${filename}`,
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
