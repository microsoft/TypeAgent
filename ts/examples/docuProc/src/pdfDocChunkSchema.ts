// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Extracted information for a chunk of text.
export interface PdfDocChunk{
    // Optional identifier for this chunk.
    chunkid: string;

    // If the chunk contains a text blob with a title, this is the title.
    sectionName?: string;

    // One paragraph summary of the chunk.
    // Concise, informative, but enough to undersatnd the paragraph .
    summary: string;

    // Propose keywords/phrases capturing the chunk's key concepts,
    // context, and notable traits. Make them concise but descriptive,
    // ensuring users can find these points with common queries or synonyms.
    keywords?: string[];

    // Optional high-level labels (e.g., "algorithmic", "I/O").
    tags?: string[];

    // Additional synonyms or related domain concepts.
    synonyms?: string[];

    // References to other chunks or external files.
    dependencies?: string[];
}

export type PdfFileDocumentation = {
    chunkDocs?: PdfDocChunk[];
};

