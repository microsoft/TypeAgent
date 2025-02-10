// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Identifier for a chunk of code.
export type ChunkId = string;

// Indicates the relevance of a chunk (from the context) to the user question.
// Only report chunks that have medium-to-high relevance to the question.
export type ChunkDescription = {
    chunkId: ChunkId;
    relevance: number; // Float between 0.0 and 1.0 giving how relevant this chunk is to the question.
};

// Only report chunks that have medium-to-high relevance to the question.
export type SelectorSpecs = {
    chunkDescs: ChunkDescription[]; // Empty is fine too, if no chunk looks relevant.
    error?: string; // In case nothing appears relevant.
};
