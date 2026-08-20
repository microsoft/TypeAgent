// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import { parseLlmJsonValue } from "../src/translationBench/synthesizer/llmJson.js";

describe("translation bench LLM JSON", () => {
    it("skips prose braces and respects brackets inside strings", () => {
        const response =
            'Use {braces} in prose. {"message":"keep } and [",' +
            '"nested":[1,{"ok":true}]} trailing [not JSON]';

        expect(parseLlmJsonValue(response, "reviewer")).toEqual({
            message: "keep } and [",
            nested: [1, { ok: true }],
        });
        expect(() => parseLlmJsonValue("{broken}", "reviewer")).toThrow(
            /reviewer returned invalid JSON \(retry\)/,
        );
    });
});
