// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "@typeagent/aiclient";
import { Question, QuestionGeneratorResponse } from "./benchmarkSchema.js";
import { createTranslator } from "./models.js";

const GENERATOR_INSTRUCTIONS = [
    "You are a question generator.",
    "The user provides a transcript and you generate questions about its content.",
    "Distribute difficulty so that roughly half are 'easy', a quarter 'moderate',",
    "and an eighth 'hard'.",
    "Ensure each category has at least one question of each difficulty.",
    "Each answer must be a concise fact grounded in the transcript.",
].join(" ");

// Generate benchmark questions (with reference answers) from a transcript,
// mirroring the .NET KnowPro benchmark's question-generation step.
export async function generateQuestions(
    model: ChatModel,
    transcript: string,
    count: number,
): Promise<Question[]> {
    const translator = createTranslator<QuestionGeneratorResponse>(
        model,
        "benchmarkSchema.ts",
        "QuestionGeneratorResponse",
        GENERATOR_INSTRUCTIONS,
    );
    const request =
        `Generate ${count} questions about the following transcript.\n\n` +
        `TRANSCRIPT:\n${transcript}`;
    const result = await translator.translate(request);
    if (!result.success) {
        throw new Error(`Question generation failed: ${result.message}`);
    }
    return result.data.questions;
}
