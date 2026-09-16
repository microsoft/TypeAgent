// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createSealToolsParameterScore,
    toTypeAgentEvalRow,
} from "../src/translationBench/public_datasets/Seal-Tools/toTypeAgentSchema.js";
import { getSealToolsTypeAgentOverride } from "../src/translationBench/public_datasets/Seal-Tools/typeAgentOverrides.js";

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
    expect(row?.expectedActions).toEqual([
        {
            schemaName: "sealtools",
            actionName: "getSocialMediaEngagement",
            parameters: { post_id: "rOBhSVKGVKe" },
        },
    ]);
});

it("marks optional parameters for normalized scoring", () => {
    const expected = [
        {
            schemaName: "sealtools",
            actionName: "lookup",
            parameters: { id: "19.0", note: "Gold note" },
        },
    ];
    const tools = [
        {
            type: "function" as const,
            function: {
                name: "lookup",
                description: "",
                parameters: {
                    type: "object",
                    properties: {
                        id: { type: "string" },
                        note: { type: "string" },
                    },
                    required: ["id"],
                },
            },
        },
    ];

    expect(createSealToolsParameterScore(expected, tools)).toEqual([
        {
            defaultMode: "normalized",
            fields: { note: "optionalNormalized" },
        },
    ]);
});

it("retains audited TypeAgent-only scoring exclusions", () => {
    expect(
        getSealToolsTypeAgentOverride("sealtools-dev-easy-199")
            ?.excludeFromScoring,
    ).toBe(true);
});
