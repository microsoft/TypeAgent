// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AnswerSpecs } from "./pdfDocAnswerSchema.js";

// Proposed query for one index.
export type QuerySpec = {
    query: string; // Query the index for nearest neighbors to this
    maxHits?: number; // Omit to use system default
    confidence: number; // Between 0 and 1 (how much value you expect from this query)
};

// Proposed queries for some of the indexes; or a direct answer.
export type QuerySpecs = {
    // Queries directed to various indexes. Comments describe what's in each index.
    summaries?: QuerySpec; // A paragraph describing the paper paragraph
    keywords?: QuerySpec; // Short key words and phrases extracted from the text
    tags?: QuerySpec; // Optional high-level labels (e.g. "algorithmic", "scientific")
    synonyms?: QuerySpec; // Additional synonyms or related domain concepts
    docinfos?: QuerySpec; // Document information like title, authors, emails, references, links

    // If the question can be answered based on chat history and general knowledge.
    answer?: AnswerSpecs;
};
