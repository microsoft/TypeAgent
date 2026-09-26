// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export async function readStdin(): Promise<string> {
    let inputData = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
        inputData += chunk;
    }
    return inputData;
}

export function writeHookOutput(output: unknown): void {
    process.stdout.write(`${JSON.stringify(output)}\n`);
}

export function logHookError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[typeagent-memory] ${message}\n`);
}
