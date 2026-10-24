// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { OfficialQuestion } from "./types.js";

export const officialJudgeSha256 =
    "ecce9c4c79dc89d99534ac17b383a5cbb5b9f0c69ee98adaf0684742e3d95251";

export const digest = (value: string | Uint8Array) =>
    createHash("sha256").update(value).digest("hex");

export function officialJudgeTemplates(source: string): string[] {
    assert.equal(
        digest(source),
        officialJudgeSha256,
        "Official judge source changed",
    );
    const templates = [
        ...source.matchAll(/template = ("(?:[^"\\]|\\.)*")/g),
    ].map((match) => JSON.parse(match[1]));
    assert.equal(templates.length, 5, "Official judge template layout changed");
    return templates;
}

export function judgePrompt(
    templates: string[],
    reference: Pick<
        OfficialQuestion,
        "question_id" | "question_type" | "question" | "answer"
    >,
    hypothesis: string,
) {
    const groups = [
        ["single-session-user", "single-session-assistant", "multi-session"],
        ["temporal-reasoning"],
        ["knowledge-update"],
        ["single-session-preference"],
    ];
    const index = reference.question_id.endsWith("_abs")
        ? 4
        : groups.findIndex((types) => types.includes(reference.question_type));
    assert.ok(index >= 0, "Unsupported official question type");
    const values = [reference.question, String(reference.answer), hypothesis];
    let next = 0;
    const prompt = templates[index].replace(/\{\}/g, () => values[next++]);
    assert.equal(next, 3, "Official judge placeholders changed");
    return prompt;
}
