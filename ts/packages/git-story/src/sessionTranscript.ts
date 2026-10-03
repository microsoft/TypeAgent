// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, type Hash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";

const CHUNK_BYTES = 64 * 1024;

export function fileIdentity(stat: BigIntStats): string {
    return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}

export async function hashPrefix(file: FileHandle, end: number): Promise<Hash> {
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(CHUNK_BYTES);
    let offset = 0;
    while (offset < end) {
        const { bytesRead } = await file.read(
            buffer,
            0,
            Math.min(buffer.length, end - offset),
            offset,
        );
        if (bytesRead === 0)
            throw new Error("Transcript changed during capture");
        hash.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
    }
    return hash;
}

export async function assertRecordBoundary(
    file: FileHandle,
    offset: number,
): Promise<void> {
    if (offset === 0) return;
    const buffer = Buffer.alloc(1);
    const { bytesRead } = await file.read(buffer, 0, 1, offset - 1);
    if (bytesRead !== 1 || buffer[0] !== 0x0a) {
        throw new Error("Capture checkpoint is not a complete record boundary");
    }
}

export async function readCompleteRecords(
    file: FileHandle,
    start: number,
    end: number,
    maxRecords: number,
    consume: (line: Buffer, offset: number) => void,
): Promise<number> {
    let position = start;
    let recordStart = start;
    let count = 0;
    let parts: Buffer[] = [];
    while (position < end && count < maxRecords) {
        const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, end - position));
        const { bytesRead } = await file.read(
            buffer,
            0,
            buffer.length,
            position,
        );
        if (bytesRead === 0)
            throw new Error("Transcript changed during capture");
        let segmentStart = 0;
        for (let i = 0; i < bytesRead && count < maxRecords; i++) {
            if (buffer[i] !== 0x0a) continue;
            parts.push(buffer.subarray(segmentStart, i + 1));
            consume(Buffer.concat(parts), recordStart);
            recordStart = position + i + 1;
            segmentStart = i + 1;
            parts = [];
            count++;
        }
        parts.push(buffer.subarray(segmentStart, bytesRead));
        position += bytesRead;
    }
    // No decoding or progress for the unfinished tail, including split UTF-8.
    return recordStart;
}
