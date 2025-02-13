// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Chunk } from "./chunkSchema.js";
import { console_log } from "./logging.js";

export function makeBatches(
    chunks: Chunk[],
    batchSize: number, // In characters
    maxChunks: number, // How many chunks at most per batch
): Chunk[][] {
    const batches: Chunk[][] = [];
    let batch: Chunk[] = [];
    let size = 0;
    function flush(): void {
        batches.push(batch);
        console_log(
            `    [Batch ${batches.length} has ${batch.length} chunks and ${size} characters]`,
        );
        batch = [];
        size = 0;
    }
    for (const chunk of chunks) {
        const chunkSize = getChunkSize(chunk);
        if (
            size &&
            (size + chunkSize > batchSize || batch.length >= maxChunks)
        ) {
            flush();
        }
        batch.push(chunk);
        size += chunkSize;
    }
    if (size) {
        flush();
    }
    return batches;
}

export function getChunkSize(chunk: Chunk): number {
    // This is all an approximation
    let size = chunk.fileName.length + 50;
    for (const blob of chunk.blobs) {
        size += blob.lines.join("").length + 4 * blob.lines.length;
    }
    return size;
}
