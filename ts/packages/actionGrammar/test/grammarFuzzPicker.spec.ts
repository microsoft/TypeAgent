// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit tests for the fuzz generator's weighted-selection helpers.
 *
 * Covers the statistical contract of `weightedPick` and the
 * mode-skipping behavior of `pickSpacingMode`, both of which are
 * relied on by every other fuzz dimension.
 */

import {
    makeRng,
    weightedPick,
    pickSpacingMode,
    clamp01,
} from "../src/fuzz/fuzzHarness.js";

describe("weightedPick", () => {
    it("returns undefined when all weights are <= 0", () => {
        const rng = makeRng(1);
        expect(
            weightedPick(rng, [
                ["a", 0],
                ["b", 0],
                ["c", -1],
            ]),
        ).toBeUndefined();
    });

    it("never returns a zero-weight entry", () => {
        const rng = makeRng(42);
        for (let i = 0; i < 1000; i++) {
            const r = weightedPick(rng, [
                ["a", 1],
                ["b", 0],
                ["c", 1],
            ]);
            expect(r === "a" || r === "c").toBe(true);
        }
    });

    it("approximates the requested weight ratios", () => {
        const rng = makeRng(0xc0ffee);
        const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
        const N = 20000;
        for (let i = 0; i < N; i++) {
            const r = weightedPick(rng, [
                ["a", 8],
                ["b", 1],
                ["c", 1],
            ])!;
            counts[r]++;
        }
        // Expected: a ≈ 80%, b ≈ 10%, c ≈ 10%.  Allow ±2% slack.
        expect(counts.a / N).toBeGreaterThan(0.78);
        expect(counts.a / N).toBeLessThan(0.82);
        expect(counts.b / N).toBeGreaterThan(0.08);
        expect(counts.b / N).toBeLessThan(0.12);
        expect(counts.c / N).toBeGreaterThan(0.08);
        expect(counts.c / N).toBeLessThan(0.12);
    });

    it("is uniform when all positive weights are equal", () => {
        const rng = makeRng(7);
        const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
        const N = 20000;
        for (let i = 0; i < N; i++) {
            const r = weightedPick(rng, [
                ["a", 1],
                ["b", 1],
                ["c", 1],
                ["d", 1],
            ])!;
            counts[r]++;
        }
        for (const k of Object.keys(counts)) {
            expect(counts[k] / N).toBeGreaterThan(0.22);
            expect(counts[k] / N).toBeLessThan(0.28);
        }
    });
});

describe("pickSpacingMode", () => {
    it("returns undefined when every mode weight is 0", () => {
        const rng = makeRng(1);
        expect(
            pickSpacingMode(rng, {
                required: 0,
                optional: 0,
                none: 0,
                auto: 0,
            }),
        ).toBeUndefined();
    });

    it("never picks a zeroed mode", () => {
        const rng = makeRng(99);
        for (let i = 0; i < 500; i++) {
            const r = pickSpacingMode(rng, {
                required: 1,
                optional: 0,
                none: 1,
                auto: 0,
            });
            expect(r === "required" || r === "none").toBe(true);
        }
    });

    it("biases toward the heaviest mode", () => {
        const rng = makeRng(0xdeadbeef);
        const counts: Record<string, number> = {
            required: 0,
            optional: 0,
            none: 0,
            auto: 0,
        };
        const N = 10000;
        for (let i = 0; i < N; i++) {
            const r = pickSpacingMode(rng, {
                required: 7,
                optional: 1,
                none: 1,
                auto: 1,
            })!;
            counts[r]++;
        }
        // required ≈ 70%, others ≈ 10% each.
        expect(counts.required / N).toBeGreaterThan(0.66);
        expect(counts.required / N).toBeLessThan(0.74);
    });
});

describe("clamp01", () => {
    it("clamps below 0 and above 1", () => {
        expect(clamp01(-1)).toBe(0);
        expect(clamp01(0)).toBe(0);
        expect(clamp01(0.5)).toBe(0.5);
        expect(clamp01(1)).toBe(1);
        expect(clamp01(2)).toBe(1);
        expect(clamp01(NaN)).toBe(0);
    });
});
