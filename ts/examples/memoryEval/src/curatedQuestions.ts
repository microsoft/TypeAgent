// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Question } from "./benchmarkSchema.js";

// Curated question set for the Episode 53 (Adrian Tchaikovsky) transcript.
//
// Two groups, per the eval design:
//  1. `episode53Queries` — the natural-language query strings reused from the
//     KnowPro test fixture (Episode_53_nlpQuery.txt). They ship without
//     reference answers; the harness fills those in via the transcript oracle.
//  2. `curatedQuestions` — hand-authored questions whose answers are
//     unambiguous from the transcript's framing. Answers are provided so the
//     judge does not depend solely on the oracle.

// A curated question; `answer` is optional and filled by the oracle when absent.
export type CuratedQuestion = Omit<Question, "answer"> & { answer?: string };

// Reused verbatim from packages/knowPro/test/data/Episode_53_nlpQuery.txt.
// (Deduplicated; KnowPro CLI flags stripped.)
export const episode53Queries: CuratedQuestion[] = [
    { question: "List all books", category: "entity", difficulty: "easy" },
    {
        question: "List all books and movies",
        category: "entity",
        difficulty: "moderate",
    },
    {
        question: "List all books that are also movies",
        category: "entity",
        difficulty: "hard",
    },
    {
        question: "Do we have anything on the novel empire in black and gold?",
        category: "retrieval",
        difficulty: "moderate",
    },
    {
        question:
            "Do we have anything on empire of black and gold or children of ruin?",
        category: "retrieval",
        difficulty: "hard",
    },
];

// Hand-authored questions grounded in the transcript's framing/metadata.
export const curatedQuestions: CuratedQuestion[] = [
    {
        question: "What is the name of the podcast?",
        answer: "Behind the Tech with Kevin Scott.",
        category: "summary",
        difficulty: "easy",
    },
    {
        question: "Who hosts the podcast?",
        answer: "Kevin Scott, Chief Technology Officer for Microsoft.",
        category: "attribution",
        difficulty: "easy",
    },
    {
        question: "Who is the guest in this episode?",
        answer: "Adrian Tchaikovsky.",
        category: "entity",
        difficulty: "easy",
    },
    {
        question:
            "How long did Adrian Tchaikovsky write unsuccessfully before finding success?",
        answer: "About 15 years, producing roughly a book a year.",
        category: "outcomes",
        difficulty: "moderate",
    },
];

// All curated questions (queries + hand-authored), tagged for reporting.
export function allCuratedQuestions(): CuratedQuestion[] {
    return [...episode53Queries, ...curatedQuestions];
}
