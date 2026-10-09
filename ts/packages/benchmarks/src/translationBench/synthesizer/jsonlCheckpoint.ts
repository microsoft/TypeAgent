// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";

import { readRecoverableJsonlLines as splitTranslationBenchCheckpointLines } from "../runner/scale.js";

function fsyncDirectory(filePath: string): void {
    if (process.platform === "win32") return;
    const directory = fs.openSync(path.dirname(filePath), "r");
    try {
        fs.fsyncSync(directory);
    } finally {
        fs.closeSync(directory);
    }
}

function writeAll(handle: number, buffer: Buffer, position: number): void {
    let offset = 0;
    while (offset < buffer.length) {
        const written = fs.writeSync(
            handle,
            buffer,
            offset,
            buffer.length - offset,
            position + offset,
        );
        if (written === 0) throw new Error("Unable to complete JSONL write");
        offset += written;
    }
}

/** Initializes a JSONL file owned by a single writer. */
export function initializeSyncedJsonlFile(
    filePath: string,
    firstRecord: string,
): void {
    const temporaryPath = `${filePath}.tmp`;
    let handle: number | undefined;
    try {
        handle = fs.openSync(temporaryPath, "w");
        fs.writeFileSync(handle, `${firstRecord}\n`, "utf8");
        fs.fsyncSync(handle);
    } finally {
        if (handle !== undefined) fs.closeSync(handle);
    }
    fs.renameSync(temporaryPath, filePath);
    fsyncDirectory(filePath);
}

export function readRecoverableJsonlLines(filePath: string): string[] {
    return splitTranslationBenchCheckpointLines(
        fs.readFileSync(filePath, "utf8"),
    );
}

/**
 * Repairs a torn final line and appends records for one owning writer.
 * Concurrent calls for the same path are not supported.
 */
export function appendSyncedJsonlRecords(
    filePath: string,
    records: readonly string[],
): void {
    if (records.length === 0) return;
    const handle = fs.openSync(filePath, "r+");
    try {
        const content = fs.readFileSync(handle);
        let appendOffset = content.length;
        let separator = "";
        if (appendOffset > 0 && content.at(-1) !== 0x0a) {
            const lastNewline = content.lastIndexOf(0x0a);
            if (lastNewline < 0) {
                throw new Error(
                    `JSONL file '${filePath}' has no complete line`,
                );
            }
            const tail = content.subarray(lastNewline + 1).toString("utf8");
            try {
                JSON.parse(tail);
                separator = "\n";
            } catch {
                appendOffset = lastNewline + 1;
                fs.ftruncateSync(handle, appendOffset);
            }
        }
        const payload = Buffer.from(
            separator + records.map((record) => `${record}\n`).join(""),
        );
        writeAll(handle, payload, appendOffset);
        fs.fsyncSync(handle);
    } finally {
        fs.closeSync(handle);
    }
}
