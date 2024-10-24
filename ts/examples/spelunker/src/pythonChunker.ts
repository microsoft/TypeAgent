// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

export async function chunkifyPythonFile(
    filename: string,
): Promise<Object | undefined> {
    let output, errors, success = false;
    try {
        let { stdout, stderr } = await execPromise(`python3 chunker.py ${filename}`);
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
    return JSON.parse(output);
}
