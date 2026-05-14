// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    minePatterns,
    parsePatternsJsonl,
    type PatternRow,
} from "../src/neighborhoods/optimize/patternMiner.js";

function row(overrides: Partial<PatternRow> = {}): PatternRow {
    return {
        runId: "run-1",
        caseId: "case-001",
        schemaName: "player",
        actionName: "playTrack",
        neighborhoodId: "nbh-a",
        failurePattern: "similar-verb",
        failurePatternHeuristic: "similar-verb",
        lever: "jsdoc",
        mechanism: "widen-identity",
        guidelineHook: "schema-shape-work-with-llm-intent",
        depth: 0,
        rescues: 2,
        regressions: 0,
        netDelta: 2,
        score: 2,
        isWinner: false,
        regressionPhrases: [],
        evaluationPath: "/x",
        ...overrides,
    };
}

describe("parsePatternsJsonl", () => {
    it("parses one JSON object per line", () => {
        const lines = [row({ caseId: "a" }), row({ caseId: "b" })];
        const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
        const parsed = parsePatternsJsonl(text);
        expect(parsed).toHaveLength(2);
        expect(parsed[0]!.caseId).toBe("a");
        expect(parsed[1]!.caseId).toBe("b");
    });

    it("tolerates blank lines and trailing newlines", () => {
        const text = `\n\n${JSON.stringify(row({ caseId: "x" }))}\n\n\n`;
        const parsed = parsePatternsJsonl(text);
        expect(parsed).toHaveLength(1);
    });

    it("skips malformed lines silently", () => {
        const text =
            JSON.stringify(row({ caseId: "good" })) +
            "\n{not-json}\n" +
            JSON.stringify(row({ caseId: "also-good" }));
        const parsed = parsePatternsJsonl(text);
        expect(parsed).toHaveLength(2);
    });
});

describe("minePatterns — byMechanism", () => {
    it("aggregates across levers into a single mechanism grid", () => {
        const rows = [
            // 2 jsdoc widen-identity wins on similar-verb
            row({
                lever: "jsdoc",
                mechanism: "widen-identity",
                failurePattern: "similar-verb",
                score: 3,
                caseId: "c1",
            }),
            row({
                lever: "jsdoc",
                mechanism: "widen-identity",
                failurePattern: "similar-verb",
                score: 2,
                caseId: "c2",
            }),
            // 1 manifest widen-identity win on similar-verb
            row({
                lever: "manifest",
                mechanism: "widen-identity",
                failurePattern: "similar-verb",
                score: 1,
                caseId: "c3",
            }),
            // 1 manifest widen-identity loss on similar-verb
            row({
                lever: "manifest",
                mechanism: "widen-identity",
                failurePattern: "similar-verb",
                score: -1,
                regressions: 2,
                caseId: "c4",
            }),
        ];
        const report = minePatterns({ rows });
        const cell = report.byMechanism["similar-verb"]!["widen-identity"]!;
        expect(cell.attempts).toBe(4);
        expect(cell.wins).toBe(3);
        expect(cell.winRate).toBeCloseTo(0.75, 5);
        expect(cell.meanScore).toBeCloseTo((3 + 2 + 1 - 1) / 4, 5);
        expect(cell.regressionRate).toBeCloseTo(0.25, 5);
    });
});

describe("minePatterns — byLeverMechanism", () => {
    it("produces a separate grid per lever", () => {
        const rows = [
            row({
                lever: "jsdoc",
                mechanism: "widen-identity",
                failurePattern: "similar-verb",
                score: 2,
                caseId: "c1",
            }),
            row({
                lever: "prune",
                mechanism: "deprecate",
                failurePattern: "synonymous-actions",
                score: 1,
                caseId: "c2",
            }),
        ];
        const report = minePatterns({ rows });
        expect(Object.keys(report.byLeverMechanism).sort()).toEqual([
            "jsdoc",
            "prune",
        ]);
        expect(
            report.byLeverMechanism["jsdoc"]!["similar-verb"]![
                "widen-identity"
            ]!.attempts,
        ).toBe(1);
        expect(
            report.byLeverMechanism["prune"]!["synonymous-actions"]![
                "deprecate"
            ]!.attempts,
        ).toBe(1);
        // jsdoc should NOT have a deprecate column.
        expect(
            report.byLeverMechanism["jsdoc"]!["synonymous-actions"],
        ).toBeUndefined();
    });
});

describe("minePatterns — byLever", () => {
    it("aggregates across mechanisms into FailurePattern × Lever", () => {
        const rows = [
            // jsdoc tried two different mechanisms on similar-verb
            row({
                lever: "jsdoc",
                mechanism: "widen-identity",
                failurePattern: "similar-verb",
                score: 2,
                caseId: "c1",
            }),
            row({
                lever: "jsdoc",
                mechanism: "add-positive-example",
                failurePattern: "similar-verb",
                score: 0,
                caseId: "c2",
            }),
        ];
        const report = minePatterns({ rows });
        const cell = report.byLever["similar-verb"]!["jsdoc"]!;
        expect(cell.attempts).toBe(2);
        // Score 0 isn't a win (only score > 0).
        expect(cell.wins).toBe(1);
    });
});

describe("minePatterns — classifier agreement", () => {
    it("dedups by (runId, caseId) — counts cases not attempts", () => {
        // Same case appears 3 times (one per lever attempt) — should
        // count once toward classifier agreement.
        const rows = [
            row({
                runId: "r1",
                caseId: "c1",
                lever: "jsdoc",
                failurePattern: "similar-verb",
                failurePatternHeuristic: "similar-verb",
            }),
            row({
                runId: "r1",
                caseId: "c1",
                lever: "manifest",
                failurePattern: "similar-verb",
                failurePatternHeuristic: "similar-verb",
            }),
            row({
                runId: "r1",
                caseId: "c1",
                lever: "prune",
                failurePattern: "similar-verb",
                failurePatternHeuristic: "similar-verb",
            }),
        ];
        const report = minePatterns({ rows });
        expect(report.classifierAgreement.overall.attempts).toBe(1);
        expect(
            report.classifierAgreement.perPattern["similar-verb"]!.attempts,
        ).toBe(1);
    });

    it("computes disagreement rate", () => {
        const rows = [
            // Agreement case (refined === heuristic)
            row({
                runId: "r1",
                caseId: "c1",
                failurePattern: "similar-verb",
                failurePatternHeuristic: "similar-verb",
            }),
            // Disagreement case
            row({
                runId: "r1",
                caseId: "c2",
                failurePattern: "similar-verb",
                failurePatternHeuristic: "unclassified",
            }),
            // Another disagreement on a different refined pattern
            row({
                runId: "r1",
                caseId: "c3",
                failurePattern: "synonymous-actions",
                failurePatternHeuristic: "unclassified",
            }),
        ];
        const report = minePatterns({ rows });
        // Overall: 1 match out of 3 = 67% disagreement rate.
        expect(
            report.classifierAgreement.overall.disagreementRate,
        ).toBeCloseTo(2 / 3, 5);
        // similar-verb pattern: 1 match out of 2 cases.
        const similar =
            report.classifierAgreement.perPattern["similar-verb"]!;
        expect(similar.attempts).toBe(2);
        expect(similar.heuristicMatches).toBe(1);
        expect(similar.disagreementRate).toBeCloseTo(0.5, 5);
    });
});

describe("minePatterns — metadata", () => {
    it("counts unique runs and total attempts", () => {
        const rows = [
            row({ runId: "r1", caseId: "c1" }),
            row({ runId: "r1", caseId: "c2" }),
            row({ runId: "r2", caseId: "c1" }),
        ];
        const report = minePatterns({ rows });
        expect(report.totalAttempts).toBe(3);
        expect(report.totalRuns).toBe(2);
        expect(report.runs).toEqual(["r1", "r2"]);
    });

    it("defaults missing failurePattern to unclassified bucket", () => {
        const rows = [
            row({
                failurePattern: "" as any,
                failurePatternHeuristic: "" as any,
            }),
        ];
        const report = minePatterns({ rows });
        expect(
            report.byMechanism["unclassified"]?.["widen-identity"],
        ).toBeDefined();
    });

    it("returns empty grids when no rows", () => {
        const report = minePatterns({ rows: [] });
        expect(report.totalAttempts).toBe(0);
        expect(report.byMechanism).toEqual({});
        expect(report.byLeverMechanism).toEqual({});
        expect(report.byLever).toEqual({});
        expect(report.classifierAgreement.overall.attempts).toBe(0);
    });

    it("samples capped at 3 evaluationPaths per cell", () => {
        const rows = Array.from({ length: 10 }, (_, i) =>
            row({
                caseId: `c${i}`,
                evaluationPath: `/eval/${i}`,
            }),
        );
        const report = minePatterns({ rows });
        const cell = report.byMechanism["similar-verb"]!["widen-identity"]!;
        expect(cell.samples).toHaveLength(3);
    });
});
