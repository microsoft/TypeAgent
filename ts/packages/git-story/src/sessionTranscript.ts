// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { BigIntStats } from "node:fs";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

const CHUNK_BYTES = 64 * 1024;

export function fileIdentity(stat: BigIntStats): string {
    return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}

export function matchesTranscriptIdentity(
    stat: BigIntStats,
    identity: string,
    minimumSize: bigint,
): boolean {
    return (
        stat.isFile() &&
        fileIdentity(stat) === identity &&
        stat.size >= minimumSize
    );
}

export async function verifyTranscript(
    file: FileHandle,
    transcriptPath: string,
    initialStat: BigIntStats,
): Promise<void> {
    // Append-only source contract: no prefix hashing on every poll or restart.
    // TODO: Support in-place rewrites/truncate-and-regrow with explicit recovery.
    const opened = await file.stat({ bigint: true });
    const current = await fs.stat(transcriptPath, { bigint: true });
    if (
        !matchesTranscriptIdentity(
            opened,
            fileIdentity(initialStat),
            initialStat.size,
        ) ||
        !matchesTranscriptIdentity(
            current,
            fileIdentity(initialStat),
            initialStat.size,
        )
    ) {
        throw new Error("Transcript changed during capture");
    }
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
    let next = start;
    let count = 0;
    for await (const { line, offset } of completeRecords(file, start, end)) {
        consume(line, offset);
        next = offset + line.length;
        if (++count >= maxRecords) break;
    }
    return next;
}

// Keeps only a read chunk and the current record; breaking closes the iterator,
// not the caller-owned file. A consumer can batch without reopening or rereading.
export async function* completeRecords(
    file: FileHandle,
    start: number,
    end: number,
): AsyncGenerator<{ line: Buffer; offset: number }> {
    let position = start;
    let recordStart = start;
    let parts: Buffer[] = [];
    while (position < end) {
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
        for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] !== 0x0a) continue;
            parts.push(buffer.subarray(segmentStart, i + 1));
            yield { line: Buffer.concat(parts), offset: recordStart };
            recordStart = position + i + 1;
            segmentStart = i + 1;
            parts = [];
        }
        parts.push(buffer.subarray(segmentStart, bytesRead));
        position += bytesRead;
    }
    // No decoding or progress for the unfinished tail, including split UTF-8.
}
