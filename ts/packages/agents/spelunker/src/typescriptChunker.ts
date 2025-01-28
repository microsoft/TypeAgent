// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// import ts from "typescript";

import {
    // ChunkId,
    // Chunk,
    ChunkedFile,
    ChunkerErrorItem,
} from "./chunkSchema.js";

export async function chunkifyTypeScriptFiles(
    filenames: string[],
): Promise<(ChunkedFile | ChunkerErrorItem)[]> {
    return filenames.map((filename) => {
        return {
            error: `TypeScript chunking not yet implemented for ${filename}`,
            filename,
        };
    });
}
