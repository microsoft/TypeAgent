// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Comprehensive validation of the SCORING subsystem: the path from a
// ContextVector + colliding candidates to a resolve/abstain decision (design
// §9-10). Exercises TfIdfScorer + the evidence-gate decision together — mostly
// through TfIdfStrategy, the seam the orchestrator actually calls, which bundles
// scoring + coverage + decision. The per-module specs (contextSelectorScorer /
// contextSelectorDecision) pin the disc arithmetic and each gate in isolation;
// here we validate the integrated resolve/abstain behavior, the safety gates at
// their boundaries, order-independence, and the adversarial score patterns that
// the offline benchmark surfaced. Two adversarial patterns (globally-broad token,
// negated-word pile-up) are *documented limitations* pinned as a baseline.

import {
    TfIdfScorer,
    ScorerCandidate,
} from "../src/context/contextSelector/scorer.js";
import { TfIdfStrategy } from "../src/context/contextSelector/strategy.js";
import { DecisionConfig } from "../src/context/contextSelector/decision.js";
import { ContextVector } from "../src/context/contextSelector/conversationSignal.js";

const CONFIG: DecisionConfig = {
    minUniqueTokens: 2,
    minMass: 1.0,
    margin: 0.5,
};

function cand(
    schemaName: string,
    actionName: string,
    keywords: string[],
): ScorerCandidate {
    return { schemaName, actionName, keywords: new Set(keywords) };
}

function vector(entries: Record<string, number>): ContextVector {
    return new Map(Object.entries(entries));
}

function evaluate(c: ContextVector, candidates: ScorerCandidate[]) {
    return new TfIdfStrategy().evaluate(c, candidates, CONFIG);
}

describe("contextSelector/scoring — resolve/abstain integration", () => {
    it("resolves a clear topical winner and reports its evidence", () => {
        const { decision, winnerNote } = evaluate(
            vector({ spreadsheet: 1.8, formula: 0.9 }),
            [
                cand("excel", "addRow", ["spreadsheet", "formula", "cell"]),
                cand("list", "addItems", ["grocery", "shopping"]),
            ],
        );
        expect(decision.kind).toBe("resolve");
        if (decision.kind === "resolve") {
            expect(decision.winner.schemaName).toBe("excel");
            expect(decision.winner.uniqueTokenCount).toBe(2);
            expect(decision.winner.score).toBeCloseTo(2.7, 5);
        }
        expect(winnerNote).toContain("mass");
    });

    it("cancels a token both candidates share (candidate-local IDF, disc=0)", () => {
        // "report" is shared by both -> disc 0 -> contributes nothing; only the
        // token unique to a candidate scores.
        const [excel] = new TfIdfScorer().score(
            vector({ report: 5, spreadsheet: 1.8, grocery: 1.8 }),
            [
                cand("excel", "addRow", ["report", "spreadsheet"]),
                cand("list", "addItems", ["report", "grocery"]),
            ],
        );
        expect(excel.score).toBeCloseTo(1.8, 5);
        expect(excel.uniqueTokenCount).toBe(1);
        const report = excel.matched!.find((m) => m.token === "report")!;
        expect(report.disc).toBeCloseTo(0, 5);
        expect(report.contribution).toBeCloseTo(0, 5);
    });

    it("abstains (min-mass) on thin / stale evidence below the mass floor", () => {
        // Two matched tokens but their summed decayed mass (0.85) is under 1.0.
        const { decision } = evaluate(
            vector({ spreadsheet: 0.45, formula: 0.4 }),
            [
                cand("excel", "addRow", ["spreadsheet", "formula"]),
                cand("list", "addItems", ["grocery", "shopping"]),
            ],
        );
        expect(decision.kind).toBe("abstain");
        if (decision.kind === "abstain") {
            expect(decision.reason).toBe("min-mass");
        }
    });

    it("abstains (coverage) when any colliding candidate has no keywords", () => {
        const { decision } = evaluate(vector({ spreadsheet: 2, formula: 2 }), [
            cand("excel", "addRow", ["spreadsheet", "formula"]),
            cand("list", "addItems", []),
        ]);
        expect(decision.kind).toBe("abstain");
        if (decision.kind === "abstain") {
            expect(decision.reason).toBe("coverage");
        }
    });
});

describe("contextSelector/scoring — the margin gate (the tie guard)", () => {
    it("abstains when the two candidates are within the margin", () => {
        // excel 1.8 vs list 1.5 -> gap 0.3 < margin 0.5.
        const { decision } = evaluate(
            vector({ spreadsheet: 0.9, formula: 0.9, grocery: 0.9, shop: 0.6 }),
            [
                cand("excel", "addRow", ["spreadsheet", "formula"]),
                cand("list", "addItems", ["grocery", "shop"]),
            ],
        );
        expect(decision.kind).toBe("abstain");
        if (decision.kind === "abstain") {
            expect(decision.reason).toBe("margin");
        }
    });

    it("resolves when the winner clears the runner-up by the margin", () => {
        // excel 1.8 vs list 0.9 -> gap 0.9 >= margin 0.5.
        const { decision } = evaluate(
            vector({ spreadsheet: 0.9, formula: 0.9, grocery: 0.9 }),
            [
                cand("excel", "addRow", ["spreadsheet", "formula"]),
                cand("list", "addItems", ["grocery", "shopping"]),
            ],
        );
        expect(decision.kind).toBe("resolve");
        if (decision.kind === "resolve") {
            expect(decision.winner.schemaName).toBe("excel");
        }
    });
});

describe("contextSelector/scoring — determinism (Gate B)", () => {
    it("reaches the same decision regardless of candidate order", () => {
        const c = vector({ spreadsheet: 1.8, formula: 0.9 });
        const excel = cand("excel", "addRow", ["spreadsheet", "formula"]);
        const list = cand("list", "addItems", ["grocery", "shopping"]);

        const a = evaluate(c, [excel, list]).decision;
        const b = evaluate(c, [list, excel]).decision;
        expect(a.kind).toBe("resolve");
        expect(b.kind).toBe("resolve");
        if (a.kind === "resolve" && b.kind === "resolve") {
            expect(a.winner.schemaName).toBe(b.winner.schemaName);
            expect(a.winner.score).toBeCloseTo(b.winner.score, 9);
        }
    });
});

// ---------------------------------------------------------------------------
// Documented adversarial score patterns. These pin CURRENT scorer behavior so
// the improvement increments can move it visibly. They are NOT desired outcomes.
// ---------------------------------------------------------------------------
describe("contextSelector/scoring — adversarial (documented v1 limitations)", () => {
    it("LIMITATION: a globally-broad token unique to one candidate drives the win", () => {
        // "file" is a broad, non-discriminating word, but among THESE two
        // candidates only excel lists it, so candidate-local IDF gives it full
        // disc and it dominates the score. A global (roster-wide) IDF scorer
        // would discount "file" and abstain here. This is the third-agent /
        // broad-token leak.
        const [excel] = new TfIdfScorer().score(
            vector({ file: 3.0, spreadsheet: 0.5 }),
            [
                cand("excel", "addRow", ["spreadsheet", "file"]),
                cand("list", "addItems", ["grocery", "shopping"]),
            ],
        );
        const fileTok = excel.matched!.find((m) => m.token === "file")!;
        expect(fileTok.disc).toBeCloseTo(1, 5); // full disc despite being broad
        expect(fileTok.contribution).toBeGreaterThan(
            excel.matched!.find((m) => m.token === "spreadsheet")!.contribution,
        );

        const { decision } = evaluate(vector({ file: 3.0, spreadsheet: 0.5 }), [
            cand("excel", "addRow", ["spreadsheet", "file"]),
            cand("list", "addItems", ["grocery", "shopping"]),
        ]);
        expect(decision.kind).toBe("resolve"); // driven mostly by "file"
    });

    it("LIMITATION: negated-word mass piles up and confidently resolves", () => {
        // A conversation that negated every excel word ("not the spreadsheet,
        // not the formula, not the cell") still produces an excel-heavy vector,
        // because negation is dropped at extraction (tokenize.ts). The scorer,
        // given that vector, correctly resolves to excel — so the fix belongs at
        // extraction (the negation-scope guard), not here.
        const { decision } = evaluate(
            vector({ spreadsheet: 0.9, formula: 0.9, cell: 0.9 }),
            [
                cand("excel", "addRow", [
                    "spreadsheet",
                    "formula",
                    "cell",
                    "pivot",
                ]),
                cand("list", "addItems", ["grocery", "shopping"]),
            ],
        );
        expect(decision.kind).toBe("resolve");
        if (decision.kind === "resolve") {
            expect(decision.winner.schemaName).toBe("excel");
            expect(decision.winner.uniqueTokenCount).toBe(3);
        }
    });
});
