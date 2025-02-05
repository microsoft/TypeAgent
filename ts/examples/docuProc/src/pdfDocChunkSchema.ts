// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Extracted information for a chunk of text.
export type PdfDocChunk = {
    // Optional file identifier for this chunk.
    fileName?: string;

    // paragraph number in the file
    paraNumber?: number;

    name: string;

    // One paragraph summary of the pdf chunk.
    // Concise and informative.
    summary: string;

    // Propose keywords/phrases capturing the chunk's highlights,
    // context, and notable topics. Make them concise but descriptive,
    // ensuring users can find these points with common queries or synonyms.
    keywords?: string[];

    // Optional high-level labels (e.g., "transformer", "algorithm").
    tags?: string[];

    // Additional synonyms or related domain concepts.
    synonyms?: string[];

    // References to other chunks or external files.
    dependencies?: string[];
};

export type PdfFileDocumentation = {
    chunkDocs?: PdfDocChunk[];
};
