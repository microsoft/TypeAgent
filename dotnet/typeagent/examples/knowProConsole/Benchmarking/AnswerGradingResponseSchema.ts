// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export enum Answer {
    Correct = "correct",
    Incorrect = "incorrect",
    Partial = "partialAnswer"
}

export type GradedQuestion = {
    id: number;
    question: string;
    providedAnswer: string;
    correctAnswer: string;
    isCorrect: Answer;
    feedback: string;
}

export type AnswerGradingResponse = {
    gradedQuestions: GradedQuestion[]
}
