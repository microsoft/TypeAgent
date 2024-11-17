// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Proposed query for one index.
export type QuerySpec = {
    query: string;
    maxHits?: number;
    minScore?: number;
};

// Proposed queries for all indices (or unknownText if none apply).
export type QuerySpecs = {
    summaries: QuerySpec;
    keywords: QuerySpec;
    topics: QuerySpec;
    goals: QuerySpec;
    dependencies: QuerySpec;

    unknownText?: string; // Fallback if nothing applies
};
