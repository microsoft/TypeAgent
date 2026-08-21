// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import {
    createTranslationBenchRunFingerprint,
    getTranslationBenchShardIndex,
    readRecoverableJsonlLines,
} from "../src/translationBench/runner/scale.js";

describe("translation bench checkpoint primitives", () => {
    it("uses canonical fingerprints and stable shards", () => {
        expect(createTranslationBenchRunFingerprint({ b: 2, a: 1 })).toBe(
            createTranslationBenchRunFingerprint({ a: 1, b: 2 }),
        );
        expect(getTranslationBenchShardIndex("case-1", 8)).toBe(
            getTranslationBenchShardIndex("case-1", 8),
        );
    });

    it("drops only an incomplete trailing JSONL row", () => {
        expect(readRecoverableJsonlLines('{"header":1}\n{"row":')).toEqual([
            '{"header":1}',
        ]);
    });
});
