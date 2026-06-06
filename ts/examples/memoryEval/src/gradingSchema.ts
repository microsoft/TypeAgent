// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Schema used by the LLM judge to grade answers.
// Mirrors the .NET KnowPro benchmark (AnswerGradingResponseSchema.ts).

export type Grade = "correct" | "incorrect" | "partial";

export type Difficulty = "easy" | "moderate" | "hard";

export type GradedQuestion = {
    // The id of the answer being graded (1-based; identifies which system produced it)
    id: number;

    // The question that was asked
    question: string;

    // The answer produced by the system under test
    answer: string;

    // The reference (correct) answer
    correctAnswer: string;

    // Whether the system answer is correct, incorrect, or a partial match
    isCorrect: Grade;

    // Feedback explaining the grade and how the answer could be improved
    feedback: string;

    // The difficulty level of the question
    difficulty: Difficulty;

    // The category of the question
    category: string;
};

export type AnswerGradingResponse = {
    // The graded answers, one per candidate answer that was submitted
    gradedQuestions: GradedQuestion[];

    // The id of the best answer among the candidates, or -1 if they are equal
    bestAnswer: number;

    // A short explanation of why the best answer was chosen
    whyBestAnswer: string;
};
