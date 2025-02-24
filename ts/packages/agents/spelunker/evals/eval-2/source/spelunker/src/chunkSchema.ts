// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FileDocumentation } from "./fileDocSchema.js";

export type ChunkId = string;

export interface Blob {
    start: number; // int; 0-based!
    lines: string[];
    breadcrumb?: ChunkId | undefined;
}

export interface Chunk {
    // Names here must match names in chunker.py.
    chunkId: ChunkId;
    treeName: string;
    codeName: string;
    blobs: Blob[];
    parentId: ChunkId;
    children: ChunkId[];
    fileName: string; // Set upon receiving end from ChunkedFile.fileName.
    lineNo: number; // 1-based, calculated from first blob.
    docs?: FileDocumentation; // Computed later by fileDocumenter.
}

export interface ChunkedFile {
    fileName: string;
    chunks: Chunk[];
}

export interface ChunkerErrorItem {
    error: string;
    filename?: string;
    output?: string;
}
