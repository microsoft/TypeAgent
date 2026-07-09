// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ContextResolutionStrategy,
    ContextSelectorEvaluation,
    TfIdfStrategy,
} from "../src/context/contextSelector/strategy.js";
import { ScorerCandidate } from "../src/context/contextSelector/scorer.js";
import { rankScores } from "../src/context/contextSelector/decision.js";
import { ContextVector } from "../src/context/contextSelector/conversationSignal.js";

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

describe("contextSelector/strategy", () => {
    it("TfIdfStrategy bundles scoring + the count-based decision", () => {
        const strategy = new TfIdfStrategy();
        const c = vector({ spreadsheet: 2, formula: 1.5 });
        const { decision, winnerNote } = strategy.evaluate(
            c,
            [
                cand("excel", "addRow", ["spreadsheet", "formula", "cell"]),
                cand("list", "addItems", ["grocery", "shopping"]),
            ],
            { minUniqueTokens: 2, minMass: 1.0, margin: 0.5 },
        );
        expect(decision.kind).toBe("resolve");
        if (decision.kind === "resolve") {
            expect(decision.winner.schemaName).toBe("excel");
        }
        expect(winnerNote).toContain("mass");
    });

    it("TfIdfStrategy abstains via its own coverage guard", () => {
        const strategy = new TfIdfStrategy();
        const { decision } = strategy.evaluate(
            vector({ spreadsheet: 5 }),
            [
                cand("excel", "addRow", ["spreadsheet"]),
                cand("list", "addItems", []), // uncovered
            ],
            { minUniqueTokens: 2, minMass: 1.0, margin: 0.5 },
        );
        expect(decision.kind).toBe("abstain");
        if (decision.kind === "abstain")
            expect(decision.reason).toBe("coverage");
    });

    // Requirement B: a non-TF-IDF strategy (here a stand-in "similarity" scorer
    // with its own config, decision policy, evidence, and reason vocabulary)
    // satisfies the seam with no change to the engine, decision, or orchestrator.
    it("supports an alternate strategy with its own config and reasons", () => {
        type SimConfig = { floor: number };
        const scores = new Map<string, number>([
            ["excel.addRow", 0.82],
            ["list.addItems", 0.31],
        ]);
        const embeddingLike: ContextResolutionStrategy<SimConfig> = {
            evaluate(_ctx, candidates, config): ContextSelectorEvaluation {
                const ranked = rankScores(
                    candidates.map((cd) => ({
                        schemaName: cd.schemaName,
                        actionName: cd.actionName,
                        score:
                            scores.get(`${cd.schemaName}.${cd.actionName}`) ??
                            0,
                    })),
                );
                const winner = ranked[0];
                if (winner.score < config.floor) {
                    return {
                        decision: {
                            kind: "abstain",
                            reason: "similarity-floor",
                            ranked,
                        },
                        winnerNote: "",
                    };
                }
                return {
                    decision: {
                        kind: "resolve",
                        winner,
                        runnerUp: ranked[1],
                        ranked,
                    },
                    winnerNote: `cosine ${winner.score.toFixed(3)}`,
                };
            },
        };

        const { decision, winnerNote } = embeddingLike.evaluate(
            vector({}),
            [cand("excel", "addRow", []), cand("list", "addItems", [])],
            { floor: 0.7 },
        );
        expect(decision.kind).toBe("resolve");
        if (decision.kind === "resolve") {
            expect(decision.winner.schemaName).toBe("excel");
            // No lexical evidence fields required from a non-lexical scorer.
            expect(decision.winner.matched).toBeUndefined();
            expect(decision.winner.uniqueTokenCount).toBeUndefined();
        }
        expect(winnerNote).toBe("cosine 0.820");
    });
});
