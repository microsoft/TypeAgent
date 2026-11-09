// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import {
    TRANSLATION_BENCH_DEFAULT_ACTION_SHAPE,
    assertTranslationBenchExpectedActionArity,
    normalizeTranslationBenchActionShapePolicy,
} from "../src/translationBench/synthesizer/actionShape.js";

describe("action shape policy", () => {
    it("defaults to simple with max 1", () => {
        expect(TRANSLATION_BENCH_DEFAULT_ACTION_SHAPE).toEqual({
            mode: "simple",
            maxActionsPerProbe: 1,
        });
        expect(normalizeTranslationBenchActionShapePolicy()).toEqual({
            mode: "simple",
            maxActionsPerProbe: 1,
        });
    });

    it("rejects multi until implemented", () => {
        expect(() =>
            normalizeTranslationBenchActionShapePolicy({ mode: "multi" }),
        ).toThrow(/not implemented yet/);
    });

    it("rejects simple with maxActionsPerProbe !== 1", () => {
        expect(() =>
            normalizeTranslationBenchActionShapePolicy({
                mode: "simple",
                maxActionsPerProbe: 2,
            }),
        ).toThrow(/maxActionsPerProbe/);
    });

    it("enforces simple positive arity", () => {
        expect(() =>
            assertTranslationBenchExpectedActionArity(
                [{ schemaName: "a", actionName: "b" }],
                "positive",
            ),
        ).not.toThrow();
        expect(() =>
            assertTranslationBenchExpectedActionArity([], "positive"),
        ).toThrow(/exactly one/);
        expect(() =>
            assertTranslationBenchExpectedActionArity(
                [
                    { schemaName: "a", actionName: "b" },
                    { schemaName: "a", actionName: "c" },
                ],
                "seed",
            ),
        ).toThrow(/exactly one/);
    });

    it("requires empty negatives", () => {
        expect(() =>
            assertTranslationBenchExpectedActionArity([], "negative"),
        ).not.toThrow();
        expect(() =>
            assertTranslationBenchExpectedActionArity(
                [{ schemaName: "a", actionName: "b" }],
                "negative",
            ),
        ).toThrow(/no expected actions/);
    });
});
