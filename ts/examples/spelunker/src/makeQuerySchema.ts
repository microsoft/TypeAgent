// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AnswerSpecs } from "./makeAnswerSchema.js";

// Proposed query for one index.
export type QuerySpec = {
    query: string; // Query the index for nearest neighbors to this
    maxHits?: number; // Omit to use system default
    confidence: number; // Between 0 and 1 (how much value you expect from this query)
};

// Proposed queries for some of the indexes; or a direct answer.
export type QuerySpecs = {
    // Queries directed to various indexes. Comments describe what's in each index.
    summaries?: QuerySpec; // A paragraph describing the code
    keywords?: QuerySpec; // Short key words and phrases extracted from the code
    topics?: QuerySpec; // Slightly longer phrases relating to the code
    goals?: QuerySpec; // What the code is trying to achieve
    dependencies?: QuerySpec; // External dependencies

    // If the question can be answered based on chat history and general knowledge.
    answer?: AnswerSpecs;
};
