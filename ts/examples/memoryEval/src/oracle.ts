// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "aiclient";

const ORACLE_SYSTEM = [
    "You are an oracle that answers questions using ONLY the provided transcript.",
    "Answer concisely and factually.",
    "If the transcript does not contain the answer, reply exactly: NOT IN TRANSCRIPT.",
].join(" ");

// Produce a reference ("correct") answer for a question by reading the full
// transcript closed-book. Used to fill in reference answers for curated
// questions that ship without one (e.g. the reused Episode 53 query strings).
export async function answerFromTranscript(
    model: ChatModel,
    transcript: string,
    question: string,
): Promise<string> {
    const prompt =
        `TRANSCRIPT:\n${transcript}\n\n` + `QUESTION: ${question}\n\nAnswer:`;
    const response = await model.complete([
        { role: "system" as const, content: ORACLE_SYSTEM },
        { role: "user" as const, content: prompt },
    ]);
    if (!response.success) {
        throw new Error(`Oracle answer failed: ${response.message}`);
    }
    return response.data.trim();
}
