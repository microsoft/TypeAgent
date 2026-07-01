// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    decide,
    rankScores,
    quantize,
    DecisionConfig,
} from "../src/context/contextSelector/decision.js";
import {
    CandidateScore,
    TfIdfScorer,
    ScorerCandidate,
} from "../src/context/contextSelector/scorer.js";
import { ContextVector } from "../src/context/contextSelector/conversationSignal.js";

function scored(
    schemaName: string,
    actionName: string,
    score: number,
    uniqueTokenCount: number,
): CandidateScore {
    return { schemaName, actionName, score, uniqueTokenCount, matched: [] };
}

const CONFIG: DecisionConfig = {
    minUniqueTokens: 2,
    minMass: 1.0,
    margin: 1.0,
};

describe("contextSelector/decision", () => {
    it("abstains when coverage fails", () => {
        const d = decide([scored("a", "x", 9, 5)], false, CONFIG);
        expect(d.kind).toBe("abstain");
        if (d.kind === "abstain") expect(d.reason).toBe("coverage");
    });

    it("abstains with no signal (winner score 0)", () => {
        const d = decide(
            [scored("a", "x", 0, 0), scored("b", "y", 0, 0)],
            true,
            CONFIG,
        );
        expect(d.kind).toBe("abstain");
        if (d.kind === "abstain") expect(d.reason).toBe("no-signal");
    });

    it("abstains below minUniqueTokens", () => {
        const d = decide(
            [scored("a", "x", 5, 1), scored("b", "y", 0, 0)],
            true,
            CONFIG,
        );
        expect(d.kind).toBe("abstain");
        if (d.kind === "abstain") expect(d.reason).toBe("min-unique-tokens");
    });

    it("abstains below minMass", () => {
        const d = decide(
            [scored("a", "x", 0.4, 2), scored("b", "y", 0, 0)],
            true,
            CONFIG,
        );
        expect(d.kind).toBe("abstain");
        if (d.kind === "abstain") expect(d.reason).toBe("min-mass");
    });

    it("abstains on a genuine tie (margin)", () => {
        const d = decide(
            [scored("a", "x", 3.11, 4), scored("b", "y", 3.08, 4)],
            true,
            CONFIG,
        );
        expect(d.kind).toBe("abstain");
        if (d.kind === "abstain") expect(d.reason).toBe("margin");
    });

    it("resolves a clear topical winner", () => {
        const d = decide(
            [
                scored("excel", "addRow", 5.54, 5),
                scored("list", "addItems", 0, 0),
            ],
            true,
            CONFIG,
        );
        expect(d.kind).toBe("resolve");
        if (d.kind === "resolve") {
            expect(d.winner.schemaName).toBe("excel");
            expect(d.runnerUp?.schemaName).toBe("list");
        }
    });

    it("rankScores imposes a total order (score desc, then schema, then action)", () => {
        const ranked = rankScores([
            scored("b", "y", 1, 1),
            scored("a", "z", 1, 1),
            scored("a", "a", 1, 1),
            scored("c", "c", 2, 1),
        ]);
        expect(ranked.map((r) => `${r.schemaName}.${r.actionName}`)).toEqual([
            "c.c",
            "a.a",
            "a.z",
            "b.y",
        ]);
    });

    it("quantize collapses float noise", () => {
        expect(quantize(0.1 + 0.2)).toBe(0.3);
    });
});

// Boundary fixtures at the shipped defaults (minMass 0.75, margin 0.5) over the
// λ=0.9 decay scale — guards against pathological abstain/resolve tuning (§10).
describe("contextSelector/decision — default-threshold boundaries", () => {
    const DEFAULTS: DecisionConfig = {
        minUniqueTokens: 2,
        minMass: 0.75,
        margin: 0.5,
    };

    it("resolves two fresh winner tokens over one fresh runner-up token", () => {
        // winner 0.9+0.9=1.8 (2 tokens) vs runner 0.9 (1 token) → margin 0.9 ≥ 0.5
        const d = decide(
            [scored("a", "x", 1.8, 2), scored("b", "y", 0.9, 1)],
            true,
            DEFAULTS,
        );
        expect(d.kind).toBe("resolve");
    });

    it("resolves two fresh winner tokens over one older runner-up token", () => {
        const d = decide(
            [scored("a", "x", 1.8, 2), scored("b", "y", 0.81, 1)],
            true,
            DEFAULTS,
        );
        expect(d.kind).toBe("resolve");
    });

    it("still abstains when two strong candidates are close", () => {
        const d = decide(
            [scored("a", "x", 1.8, 2), scored("b", "y", 1.5, 2)],
            true,
            DEFAULTS,
        );
        expect(d.kind).toBe("abstain");
        if (d.kind === "abstain") expect(d.reason).toBe("margin");
    });
});

// End-to-end §14 worked examples: signal-free — scores are supplied directly to
// the scorer via a synthetic context vector, then decided.
describe("contextSelector §14 worked examples (scorer + decision)", () => {
    const scorer = new TfIdfScorer();
    const excel: ScorerCandidate = {
        schemaName: "excel",
        actionName: "addRow",
        keywords: new Set([
            "excel",
            "spreadsheet",
            "cell",
            "formula",
            "workbook",
            "row",
            "column",
        ]),
    };
    const list: ScorerCandidate = {
        schemaName: "list",
        actionName: "addItems",
        keywords: new Set([
            "list",
            "item",
            "todo",
            "grocery",
            "shopping",
            "checklist",
        ]),
    };

    it("Scenario 1 resolves to excel", () => {
        const c: ContextVector = new Map([
            ["formula", 1.71],
            ["spreadsheet", 1.63],
            ["cell", 0.81],
            ["excel", 0.73],
            ["row", 0.66],
        ]);
        const d = decide(scorer.score(c, [excel, list]), true, CONFIG);
        expect(d.kind).toBe("resolve");
        if (d.kind === "resolve") expect(d.winner.schemaName).toBe("excel");
    });

    it("Scenario 2 abstains on a genuine tie", () => {
        const c: ContextVector = new Map([
            ["spreadsheet", 0.9],
            ["formula", 0.9],
            ["grocery", 0.81],
            ["shopping", 0.81],
            ["todo", 0.73],
            ["checklist", 0.73],
            ["excel", 0.66],
            ["cell", 0.66],
        ]);
        const d = decide(scorer.score(c, [excel, list]), true, CONFIG);
        expect(d.kind).toBe("abstain");
        if (d.kind === "abstain") expect(d.reason).toBe("margin");
    });

    it("abstains when the conversation matches neither candidate", () => {
        const c: ContextVector = new Map([
            ["meeting", 6],
            ["calendar", 3],
        ]);
        const d = decide(scorer.score(c, [excel, list]), true, CONFIG);
        expect(d.kind).toBe("abstain");
        if (d.kind === "abstain") expect(d.reason).toBe("no-signal");
    });
});
