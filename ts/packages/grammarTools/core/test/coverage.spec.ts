// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    computeCoverage,
    loadGrammarFromBuffer,
    MissingDebugInfoError,
} from "../src/index.js";
import type { LoadedGrammar } from "../src/index.js";

describe("computeCoverage", () => {
    const source = `<Start> = play $(song:string) -> { action: "play", song };
<Start> = pause -> { action: "pause" };
<Start> = stop -> { action: "stop" };`;

    it("counts rule hits for matching inputs", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const report = computeCoverage(result.grammar, [
            "play something",
            "play another thing",
            "pause",
        ]);

        expect(report.totals.rules).toBeGreaterThan(0);
        expect(report.totals.ruleHits).toBeGreaterThan(0);
        expect(report.unmatchedInputs).toHaveLength(0);
    });

    it("reports unmatched inputs", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const report = computeCoverage(result.grammar, [
            "play something",
            "xyz nothing matches this",
        ]);

        expect(report.unmatchedInputs).toHaveLength(1);
        expect(report.unmatchedInputs[0].input).toBe(
            "xyz nothing matches this",
        );
    });

    it("returns zero hits for rules with no matching inputs", () => {
        const multiRule = `<Start> = play $(song:string) -> { action: "play", song };
<Start> = do $(x:<Action>) -> x;
<Action> = pause -> { action: "pause" };
<Unused> = something weird -> { action: "weird" };`;

        const result = loadGrammarFromBuffer("test.agr", multiRule);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // Only match "play" inputs - "Unused" should have zero hits
        const report = computeCoverage(result.grammar, ["play something"]);

        const zeroRules = report.perRule.filter((r) => r.hits === 0);
        expect(zeroRules.length).toBeGreaterThan(0);
    });

    it("includes grammarHash from debugInfo", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const report = computeCoverage(result.grammar, ["pause"]);
        expect(report.grammarHash).toBeTruthy();
        expect(typeof report.grammarHash).toBe("string");
    });

    it("part hit counts increase with more matching inputs", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const report1 = computeCoverage(result.grammar, ["pause"]);
        const report2 = computeCoverage(result.grammar, [
            "pause",
            "pause",
            "pause",
        ]);

        expect(report2.totals.partHits).toBeGreaterThanOrEqual(
            report1.totals.partHits,
        );
    });

    it("throws MissingDebugInfoError when debugInfo is absent", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // Strip debugInfo to simulate a grammar without it
        const { debugInfo: _, ...rest } = result.grammar;
        const stripped = rest as LoadedGrammar;

        expect(() => computeCoverage(stripped, ["pause"])).toThrow(
            MissingDebugInfoError,
        );
    });

    it("handles empty corpus", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const report = computeCoverage(result.grammar, []);

        expect(report.totals.ruleHits).toBe(0);
        expect(report.totals.partHits).toBe(0);
        expect(report.unmatchedInputs).toHaveLength(0);
    });
});
