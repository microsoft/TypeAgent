// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect, test } from "@jest/globals";
import { scoreSealTools } from "../src/translationBench/index.js";
import { PythonNumber } from "../src/translationBench/public_datasets/pythonLiteral.js";
import { toTypeAgentEvalRow } from "../src/translationBench/public_datasets/Seal-Tools/toTypeAgentSchema.js";

test("preserves Seal-compatible matching and counting", () => {
    const score = scoreSealTools(
        [
            {
                gold: [
                    { api: "A", parameters: { P: { V: "X" } } },
                    { api: "A", parameters: { P: { V: "other" } } },
                ],
                predictions: [
                    { actionName: "a", parameters: { p: { v: "x" } } },
                    { actionName: "a", parameters: { p: { v: "x" } } },
                ],
            },
            { gold: [] },
        ],
        { ignoreStringCase: true },
    );
    expect(score.counts.correctParameters).toBe(2);

    const miss = scoreSealTools([
        {
            gold: [{ api: "A", parameters: {} }],
            predictions: [{ actionName: "B" }],
        },
    ]);
    expect(miss.tool).toEqual({ precision: 0, recall: 0, f1: 0 });
    expect(
        scoreSealTools([{ gold: [], predictions: [{ actionName: "A" }] }]).tool,
    ).toEqual({ precision: 0, recall: undefined, f1: undefined });
    expect(scoreSealTools([{ gold: [] }]).formatAccuracy).toBe(0);
    expect(scoreSealTools([]).formatAccuracy).toBeUndefined();
    expect(
        scoreSealTools([{ gold: [{ api: "A", parameters: {} }] }]).tool,
    ).toEqual({ precision: undefined, recall: 0, f1: undefined });
    expect(() =>
        scoreSealTools([
            {
                gold: [],
                predictions: [{ actionName: "A", parameters: [] as never }],
            },
        ]),
    ).toThrow("Case 0 prediction 0 parameters must be an object");
});

test("compares serialized Python number gold after JSONL round trip", () => {
    const row = toTypeAgentEvalRow(
        {
            id: "dev-easy-numbers",
            domain: "test",
            conversations: [
                {
                    from: "human",
                    value:
                        `api_list = [{'api_name': 'lookup', 'parameters': {}, 'required': []}]\n` +
                        `task_instruction = "Look up the record."\nOutput:\n`,
                },
                {
                    from: "gpt",
                    value: `[{"api": "lookup", "parameters": {"age": 44.0, "ranges": [1.50]}, "responses": []}]`,
                },
            ],
        },
        0,
    );
    expect(row).toBeDefined();
    const gold = JSON.parse(
        JSON.stringify(row!.sealToolsGoldActions),
    ) as NonNullable<typeof row>["sealToolsGoldActions"];
    expect(gold).toEqual([
        {
            api: "lookup",
            parameters: {
                age: { __pythonNumber: "44.0" },
                ranges: [{ __pythonNumber: "1.5" }],
            },
            responses: [],
        },
    ]);
    const score = scoreSealTools([
        {
            gold,
            predictions: [
                {
                    actionName: "lookup",
                    parameters: {
                        age: new PythonNumber("44.0"),
                        ranges: [new PythonNumber("1.5")],
                    },
                },
            ],
        },
    ]);
    expect(score.counts.correctParameters).toBe(2);
    expect(
        scoreSealTools([
            {
                gold,
                predictions: [
                    { actionName: "lookup", parameters: { age: 44 } },
                ],
            },
        ]).counts.correctParameters,
    ).toBe(0);
});
