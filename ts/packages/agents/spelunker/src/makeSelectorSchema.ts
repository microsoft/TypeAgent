// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Identifier for a chunk of code.
export type ChunkId = string;

// A chunk is a function/method, class or module.
// Nested chunks are elided from the chunk text (they are their own chunk).
export type ChunkDescription = {
    chunkId: ChunkId;
    relevance: number; // Float between 0.0 and 1.0
};

// Only produce at most 30 chunks that are most relevant to the question.
export type SelectorSpecs = {
    chunks: ChunkDescription[]; // Empty is fine too, if nothing looks relevant.
    error?: string; // In case nothing appears relevant.
};
