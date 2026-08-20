// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { toTypeAgentEvalRow } from "../src/translationBench/public_datasets/Seal-Tools/toTypeAgentSchema.js";
import fs from "node:fs";

import { buildSealToolsSuite } from "../src/translationBench/public_datasets/Seal-Tools/eval/buildSuite.js";
import type { TypeAgentEvalRow } from "../src/translationBench/public_datasets/Seal-Tools/toTypeAgentSchema.js";
import { validateTranslationBenchSuite } from "../src/translationBench/runner/runner.js";

it("preserves IDs after malformed inner quotes in task instructions", () => {
    const row = toTypeAgentEvalRow(
        {
            id: "dev-easy-1",
            domain: "social",
            conversations: [
                {
                    from: "human",
                    value:
                        `api_list = [{'api_name': 'getSocialMediaEngagement', ` +
                        `'parameters': {}, 'required': []}]\n` +
                        `task_instruction = "Tell me the engagement metrics for ` +
                        `the Facebook post with the ID "rOBhSVKGVKe."\nOutput:\n`,
                },
                {
                    from: "gpt",
                    value:
                        `[{"api": "getSocialMediaEngagement", "parameters": ` +
                        `{"post_id": "rOBhSVKGVKe"}, "responses": []}]`,
                },
            ],
        },
        1,
    );

    expect(row?.utterance).toBe(
        'Tell me the engagement metrics for the Facebook post with the ID "rOBhSVKGVKe."',
    );
});

it("builds all 700 Seal validation rows into a valid suite", () => {
    const rows = fs
        .readFileSync(
            "src/translationBench/public_datasets/Seal-Tools/seal-tools-validation.jsonl",
            "utf8",
        )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as TypeAgentEvalRow);
    const { suite, sourceManifest } = buildSealToolsSuite(rows);

    expect(suite.cases).toHaveLength(700);
    expect(() =>
        validateTranslationBenchSuite(suite, sourceManifest, false),
    ).not.toThrow();
});
