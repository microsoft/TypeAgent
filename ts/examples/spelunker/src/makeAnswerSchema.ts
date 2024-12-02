// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Identifier for a chunk of code.
export type ChunkId = string;

// Answer to the original question.
export type AnswerSpecs = {
    question: string; // Original question (e.g. "How can items be related")
    answer: string; // A paragraph or more of answer text.
    references: ChunkId[]; // Chunks that support this answer.
    confidence: number; // A number between 0 and 1.
    message?: string; // Optional message to the user (notably for low confidence). Might request more input.
};
