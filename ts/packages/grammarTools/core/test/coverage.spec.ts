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

    it("tracks coverage across nested rule references", () => {
        const nested = `<Start> = do $(x:<Action>) -> x;
<Action> = play $(song:string) -> { action: "play", song };
<Action> = pause -> { action: "pause" };`;

        const result = loadGrammarFromBuffer("test.agr", nested);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const report = computeCoverage(result.grammar, ["do play something"]);

        // Both Start and Action should have hits
        const startRule = report.perRule.find((r) => r.id === "Start");
        const actionRule = report.perRule.find((r) => r.id === "Action");
        expect(startRule).toBeDefined();
        expect(actionRule).toBeDefined();
        if (startRule) expect(startRule.hits).toBeGreaterThan(0);
        if (actionRule) expect(actionRule.hits).toBeGreaterThan(0);
    });

    it("assigns parts to the correct owning rule", () => {
        const multiRule = `<Start> = play $(song:string) -> { action: "play", song };
<Start> = do $(x:<Other>) -> x;
<Other> = pause -> { action: "pause" };
<Other> = stop -> { action: "stop" };`;

        const result = loadGrammarFromBuffer("test.agr", multiRule);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const report = computeCoverage(result.grammar, ["play something"]);

        // Check that there are per-rule entries for both Start and Other
        const ruleNames = report.perRule.map((r) => r.id);
        expect(ruleNames).toContain("Start");
        expect(ruleNames).toContain("Other");

        // Start should have hits, Other should not
        const startHits = report.perRule
            .filter((r) => r.id === "Start")
            .reduce((sum, r) => sum + r.hits, 0);
        const otherHits = report.perRule
            .filter((r) => r.id === "Other")
            .reduce((sum, r) => sum + r.hits, 0);
        expect(startHits).toBeGreaterThan(0);
        expect(otherHits).toBe(0);
    });

    it("reports correct totals for repeated inputs", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const report = computeCoverage(result.grammar, [
            "play a",
            "play b",
            "play c",
            "pause",
            "stop",
        ]);

        // All 5 inputs should match
        expect(report.unmatchedInputs).toHaveLength(0);
        // All rules should be hit
        expect(report.perRule.every((r) => r.hits > 0)).toBe(true);
    });
});
