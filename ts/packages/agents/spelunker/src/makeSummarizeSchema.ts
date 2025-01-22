// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Identifier for a chunk of code.
export type ChunkId = string;

export type Summary = {
    chunkId: ChunkId;
    summary: string; // A one-line summary of the chunk, explaining what it does at a high level, concisely but with attention for detail. Do not duplicate the signature
    signature: string; // For functions, 'def foo(bar: int) -> str:'; for classes, 'class Foo:'; for modules, 'module foo.bar'
};

// Produce a brief summary for each chunk.
export type SummarizeSpecs = {
    summaries: Summary[]; // A summary for every chunk
};
