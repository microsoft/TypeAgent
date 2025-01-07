// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Extracted information for a chunk of code.
export type ChunkDoc = {
    // Optional file identifier or language context for this chunk.
    fileName?: string;

    lineNumber: number;

    name: string; // Function, class or method name (fully qualified)

    // Optional list of base classes, for classes.
    bases?: string[];

    // Optional list of parameter names/types used by this chunk.
    // E.g. ["x: list[int]", "y"]  # y is untyped
    // Take from `__new__` or `__init__` for classes.
    parameters?: string[];

    // Optional return type or output specification.
    // E.g. "dict[str, int]" or "None".
    // Don't set for classes.
    returnType?: string;

    // One paragraph summary of the code chunk starting at that line.
    // Concise, informative, don't explain Python or stdlib features.
    summary: string;

    // Propose keywords/phrases capturing the chunk's functionality,
    // context, and notable traits. Make them concise but descriptive,
    // ensuring users can find these points with common queries or synonyms.
    keywords?: string[];

    // Optional high-level labels (e.g., "algorithmic", "I/O").
    tags?: string[];

    // Additional synonyms or related domain concepts.
    synonyms?: string[];

    // References to other chunks or external files.
    dependencies?: string[];
};

export type FileDocumentation = {
    chunkDocs?: ChunkDoc[];
};
