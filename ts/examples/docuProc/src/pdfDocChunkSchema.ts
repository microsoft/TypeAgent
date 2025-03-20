// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Extracted information for a chunk of text.
export interface PdfChunkDocumentation {
    // Optional file identifier for this chunk.
    fileName?: string;

    // Optional identifier for this chunk.
    chunkid?: string;

    // Document title
    title?: string;

    // Extract the section name from the chunk if possible.
    // or come up with a section name, some document section names are of the form e.g,[Abstract]:, [1 Introduction]:, etc.
    // They are of the form [section name]: [sub-section name]:
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

    // Document information like title, authors, emails, references, links.
    // Only include docInfo in the output if it contains at least one valid field (title, authors, emails, references, or links). If none of these are present, omit docInfo entirely from the output.
    docinfo?: PdfDocumentInfo;
}
export interface PdfDocumentInfo {
    title?: string; // title of the document/page
    authorInfos?: PdfAuthorInfo[]; // author(s) of the document, only include if non-empty
    // The references can occur in a different chunk/page (only include if non-empty), e.g., "see [1]" or entire reference like "[1] Author1, Author2, Title, Journal, Paper link, Year"
    // The references are typically in the format "[1] Author1, Author2, Title, Journal, Paper link, Year"
    references?: PdfReference[];
    // These are the links from the document (only include if non-empty), e.g., "https://doi.org/10.1000/xyz123"
    links?: string[]; // these are the links from the document
}

export type PdfAuthorInfo = {
    author: string; // the author name
    email?: string; // the author email
    affiliation?: string; // the author affiliation
    orcid?: string; // the author orcid
};

export type PdfReference = {
    refernceNum: string; // the reference number, typically format is like [1]
    reference?: string; // the entire reference, typically format is like "[1] Author1, Author2, Title, Journal, Paper link, Year"
    authors?: string[]; // author(s) in the reference
    emails?: string[]; // email(s) mentioned as part of reference
    title?: string; // title of the paper in the reference
};

export type PdfFileDocumentation = {
    chunkDocs?: PdfChunkDocumentation[];
};
