// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Schema used to generate benchmark questions from a transcript.
// Mirrors the .NET KnowPro benchmark (BenchmarkQuestionResponseSchema.ts) so
// the REM evaluation and the KnowPro evaluation can be compared apples-to-apples.

export type Category =
    // Find where something was discussed
    | "retrieval"

    // Find when something was discussed
    | "scope"

    // Role attribution (i.e. who said what to whom)
    | "attribution"

    // Questions about specific topics or structure
    | "segmentation"

    // Questions about specific objects/things
    | "entity"

    // Conversation summary/highlights
    | "summary"

    // Questions about how someone felt or the mood of a conversation
    | "sentiment"
    | "outcomes"
    | "intent"

    // create a new category if the above categories do not suffice
    | string;

export type Difficulty = "easy" | "moderate" | "hard";

export type Question = {
    // A question about the transcript
    question: string;

    // A concise, factual answer to the question grounded in the transcript
    answer: string;

    // The category of this question
    category: Category;

    // The difficulty level of the question
    difficulty: Difficulty;
};

export type QuestionGeneratorResponse = {
    questions: Question[];
};
