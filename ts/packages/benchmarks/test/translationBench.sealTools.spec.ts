// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createSealToolsParameterScore,
    hasSealToolsApiCallReference,
    toTypeAgentEvalRow,
    type TypeAgentEvalRow,
} from "../src/translationBench/public_datasets/Seal-Tools/toTypeAgentSchema.js";
import { getSealToolsTypeAgentOverride } from "../src/translationBench/public_datasets/Seal-Tools/typeAgentOverrides.js";
import fs from "node:fs";

import { buildSealToolsSuite } from "../src/translationBench/public_datasets/Seal-Tools/eval/buildSuite.js";
import {
    parametersMatch,
    validateTranslationBenchSuite,
} from "../src/translationBench/runner/runner.js";
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

it("builds all 700 committed Seal validation rows into a valid suite", () => {
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
    expect(
        suite.cases.filter((row) => row.seed.order === "strict"),
    ).toHaveLength(27);
    expect(
        rows.some((row) => JSON.stringify(row.expectedActions).includes("${")),
    ).toBe(false);
    expect(new Set(rows.map((row) => row.order))).toEqual(
        new Set(["any", "strict"]),
    );
    expect(rows.filter(hasSealToolsApiCallReference)).toHaveLength(28);
    expect(() =>
        validateTranslationBenchSuite(suite, sourceManifest),
    ).toThrow();
    expect(() =>
        validateTranslationBenchSuite(suite, sourceManifest, false),
    ).not.toThrow();
});

it("applies audited TypeAgent gold overrides without changing Seal gold", () => {
    const rows = fs
        .readFileSync(
            "src/translationBench/public_datasets/Seal-Tools/seal-tools-validation.jsonl",
            "utf8",
        )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as TypeAgentEvalRow);
    const cases = new Map(
        buildSealToolsSuite(rows).suite.cases.map((row) => [row.id, row]),
    );
    expect(
        cases.get("sealtools-dev-easy-152")?.seed.expectedActions[0],
    ).toMatchObject({
        actionName: "convertToRGB",
        parameters: { color_code: "50%" },
    });
    expect(
        cases.get("sealtools-dev-easy-163")?.seed.expectedActions[0],
    ).toMatchObject({
        actionName: "checkSpelling",
        parameters: { word: "to" },
    });
    expect(
        getSealToolsTypeAgentOverride("sealtools-dev-easy-199")
            ?.excludeFromScoring,
    ).toBe(true);
    const commandCase = cases.get("sealtools-dev-easy-82")!;
    expect(commandCase.seed.parameterScore?.[0]?.fields).toMatchObject({
        command: "nonempty",
    });
    expect(
        parametersMatch(
            commandCase.seed.expectedActions[0]!,
            {
                ...commandCase.seed.expectedActions[0]!,
                parameters: {
                    ...commandCase.seed.expectedActions[0]!.parameters,
                    command: "open",
                },
            },
            commandCase.seed.parameterScore?.[0],
        ),
    ).toBe(true);
});

it("scores Seal required and optional parameters with normalized values", () => {
    const expected = {
        schemaName: "seal",
        actionName: "lookup",
        parameters: { id: "19.0", note: "Gold note" },
    };
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
    const [spec] = createSealToolsParameterScore([expected], tools);

    expect(spec).toEqual({
        defaultMode: "normalized",
        fields: { note: "optionalNormalized" },
    });
    expect(
        parametersMatch(
            expected,
            {
                ...expected,
                parameters: { id: 19 },
            },
            spec,
        ),
    ).toBe(true);
    expect(
        parametersMatch(
            expected,
            {
                ...expected,
                parameters: { id: 19, note: "gold note" },
            },
            spec,
        ),
    ).toBe(true);
    expect(
        parametersMatch(
            expected,
            {
                ...expected,
                parameters: { id: 19, note: "different" },
            },
            spec,
        ),
    ).toBe(false);
    expect(
        parametersMatch(
            expected,
            { ...expected, parameters: { id: "nineteen" } },
            { ...spec, acceptedValues: { id: ["nineteen"] } },
        ),
    ).toBe(true);
});
