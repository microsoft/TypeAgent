// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Proposed query for one index.
export type QuerySpec = {
    query: string; // Ask the index for nearest neighbors to this
    maxHits?: number; // 0 means skip; omit uses system default
};

// Proposed queries for all indexes (use message if none apply).
export type QuerySpecs = {
    summaries: QuerySpec; // A paragraph describing the code chunk
    keywords: QuerySpec; // Short key words and phrases extracted from the code
    topics: QuerySpec; // Slightly longer phrases relating to the code
    goals: QuerySpec; // What the code is trying to achhieve (a shorter summary)
    dependencies: QuerySpec; // External dependencies (actually not very useful)

    message?: string; // Optional message to the user (notably for low confidence). Might request more input.
};
