// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This requires that python3 is on the PATH
// and the chunker.py script is in the dist directory.

import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

import { ChunkedFile, ChunkerErrorItem } from "./chunkSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execFilePromise = promisify(execFile);

export async function chunkifyPythonFiles(
    filenames: string[],
): Promise<(ChunkedFile | ChunkerErrorItem)[]> {
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

    const results: (ChunkedFile | ChunkerErrorItem)[] = JSON.parse(output);
    // TODO: validate that JSON matches our schema.

    // Ensure all chunks have a filename.
    for (const result of results) {
        if (!("error" in result)) {
            for (const chunk of result.chunks) {
                chunk.fileName = result.fileName;
                chunk.lineNo = chunk.blobs.length
                    ? chunk.blobs[0].start + 1
                    : 1;
            }
        }
    }
    return results;
}
