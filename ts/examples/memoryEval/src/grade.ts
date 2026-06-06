// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "aiclient";
import { Question } from "./benchmarkSchema.js";
import { AnswerGradingResponse, GradedQuestion } from "./gradingSchema.js";
import { createTranslator } from "./models.js";

const GRADER_INSTRUCTIONS = [
    "You are a question grader.",
    "The user provides a question, the correct answer, and one or more candidate",
    "answers produced by memory systems.",
    "Grade each candidate as 'correct', 'incorrect', or 'partial' based on how well",
    "it matches the correct answer.",
    "If a candidate adds extra correct context it is still 'correct'; note the extra",
    "context in feedback.",
    "If a candidate says it does not have the information in memory and the correct",
    "answer is non-trivial, grade it 'incorrect'.",
    "Choose the best candidate by id, or -1 if they are equal.",
].join(" ");

export type Candidate = {
    // 1-based id identifying which system produced this answer.
    id: number;
    answer: string;
};

// Grade a set of candidate answers for one question against its reference
// answer using the LLM judge. Mirrors the .NET benchmark's grading step.
export async function gradeAnswers(
    model: ChatModel,
    question: Question,
    candidates: Candidate[],
): Promise<AnswerGradingResponse> {
    const translator = createTranslator<AnswerGradingResponse>(
        model,
        "gradingSchema.ts",
        "AnswerGradingResponse",
        GRADER_INSTRUCTIONS,
    );
    const candidateText = candidates
        .map(
            (c) => `Candidate answer id=${c.id}:\n${c.answer || "(no answer)"}`,
        )
        .join("\n\n");
    const request =
        `QUESTION: ${question.question}\n` +
        `CATEGORY: ${question.category}\n` +
        `DIFFICULTY: ${question.difficulty}\n` +
        `CORRECT ANSWER: ${question.answer}\n\n` +
        `${candidateText}`;
    const result = await translator.translate(request);
    if (!result.success) {
        throw new Error(`Grading failed: ${result.message}`);
    }
    // Carry through the question metadata the model may not echo precisely.
    for (const g of result.data.gradedQuestions) {
        g.question = question.question;
        g.correctAnswer = question.answer;
        g.category = question.category;
        g.difficulty = question.difficulty;
    }
    return result.data;
}

export type { GradedQuestion };
