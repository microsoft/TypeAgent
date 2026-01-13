// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Grade =
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
    // the answer being graded
    answer: string;
    correctAnswer: string;
    isCorrect: Grade;
    feedback: string;
    difficulty: Difficulty;
    category: string;
}

export type AnswerGradingResponse = {
    gradedQuestions: GradedQuestion[];

    // of the supplied answers, which one is "better"
    // if the answers are equally good, return -1
    bestAnswer: number;

    // the rational of why one answer was better than another
    whyBestAnswer: string;
}
