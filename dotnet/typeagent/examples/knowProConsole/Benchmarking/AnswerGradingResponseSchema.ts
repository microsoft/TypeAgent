// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Answer =
    | "correct"
    | "incorrect"
    | "partial";

export type Difficulty = 
    | "easy"
    | "moderate"
    | "hard";

export type GradedQuestion = {
    id: number;
    question: string;
    providedAnswer: string;
    correctAnswer: string;
    isCorrect: Answer;
    feedback: string;
    difficulty: Difficulty;
    category: string;
}

export type AnswerGradingResponse = {
    gradedQuestions: GradedQuestion[]
}
