// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The scorer (§9): ranks colliding candidates by how much the recent
// conversation overlaps each one's keywords, counting most the tokens that
// uniquely point to one candidate (candidate-local IDF) and cancelling tokens
// the candidates share. Behind `CollisionScorer` so the v1 TF-IDF scorer can be
// swapped for a knowPro-entity or embedding scorer later (the scoring roadmap,
// §9) — the decision rule (§10) consumes `CandidateScore` regardless.

import { ContextVector } from "./conversationSignal.js";
import { KeywordVector } from "./keywordVector.js";

// One colliding candidate handed to the scorer — its identity plus its flattened
// (order-ignored) keyword vector.
export type ScorerCandidate = {
    schemaName: string;
    actionName: string;
    keywords: KeywordVector;
};

// A token that fired for a candidate, with the pieces of its contribution kept
// separate for explainable telemetry (§13.4).
export type MatchedToken = {
    token: string;
    // Decay-weighted conversational frequency C[token] (§8).
    contextWeight: number;
    // Candidate-local discriminativeness disc(token) ∈ [0,1] (§9).
    disc: number;
    // contextWeight × disc — what this token adds to the candidate's score.
    contribution: number;
};

export type CandidateScore = {
    schemaName: string;
    actionName: string;
    // Σ contribution over matched tokens.
    score: number;
    // Distinct matched tokens that actually distinguish this candidate
    // (disc > 0). The evidence gate's `minUniqueTokens` counts these (§10).
    uniqueTokenCount: number;
    // All firing tokens, sorted by token for stable output.
    matched: MatchedToken[];
};

export interface CollisionScorer {
    score(
        contextVector: ContextVector,
        candidates: ScorerCandidate[],
    ): CandidateScore[];
}

// V1 scorer (§9): score(a) = Σ_{t ∈ C ∩ K_a} C[t] · disc(t), with candidate-local
// IDF disc(t) = log(N/df(t)) / log(N) — 1 for a token unique to one candidate, 0
// for one shared by all N colliding candidates, graduated in between. Fully
// deterministic; the returned order mirrors the input candidate order (the
// decision rule imposes the total ordering, §10/§12).
export class TfIdfScorer implements CollisionScorer {
    public score(
        contextVector: ContextVector,
        candidates: ScorerCandidate[],
    ): CandidateScore[] {
        const n = candidates.length;
        // Document frequency: how many candidates' keyword sets contain a token.
        const df = new Map<string, number>();
        for (const candidate of candidates) {
            for (const token of candidate.keywords) {
                df.set(token, (df.get(token) ?? 0) + 1);
            }
        }
        const logN = n > 1 ? Math.log(n) : 0;
        const disc = (token: string): number => {
            if (logN <= 0) {
                return 1;
            }
            const d = df.get(token) ?? 1;
            return Math.log(n / d) / logN;
        };

        return candidates.map((candidate) => {
            const matched: MatchedToken[] = [];
            let score = 0;
            let uniqueTokenCount = 0;
            for (const token of candidate.keywords) {
                const contextWeight = contextVector.get(token);
                if (contextWeight === undefined || contextWeight === 0) {
                    continue;
                }
                const d = disc(token);
                const contribution = contextWeight * d;
                matched.push({ token, contextWeight, disc: d, contribution });
                if (d > 0) {
                    score += contribution;
                    uniqueTokenCount += 1;
                }
            }
            matched.sort((a, b) =>
                a.token < b.token ? -1 : a.token > b.token ? 1 : 0,
            );
            return {
                schemaName: candidate.schemaName,
                actionName: candidate.actionName,
                score,
                uniqueTokenCount,
                matched,
            };
        });
    }
}
