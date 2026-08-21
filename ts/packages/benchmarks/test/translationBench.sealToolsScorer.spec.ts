// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect, test } from "@jest/globals";
import { scoreSealTools } from "../src/translationBench/index.js";

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
