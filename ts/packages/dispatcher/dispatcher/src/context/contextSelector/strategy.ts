// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The resolution-strategy seam (§9 scoring roadmap). A strategy bundles a
// *scoring* method with the *decision policy* that interprets its scores, so the
// two swap together — the count-based TF-IDF scorer pairs with the count-based
// evidence gate (§10), while a future knowPro-entity or embedding scorer would
// pair with its own (e.g. cosine-threshold) policy. The orchestrator
// (matchContextSelector.ts) depends only on this seam and the generic
// `ContextSelectorDecision`, never on TF-IDF internals — which is what makes the
// user-requested "swap TF-IDF -> knowPro -> embeddings" a drop-in.

import { ContextVector } from "./conversationSignal.js";
import { ScorerCandidate, CollisionScorer, TfIdfScorer } from "./scorer.js";
import { decide, ContextSelectorDecision, DecisionConfig } from "./decision.js";

export interface ContextResolutionStrategy {
    // Score the candidates against the conversation and decide resolve/abstain.
    // Deterministic and synchronous — the collision hot path is LLM-free (§12);
    // a scorer needing a model call would precompute vectors, not call here.
    evaluate(
        contextVector: ContextVector,
        candidates: ScorerCandidate[],
        config: DecisionConfig,
    ): ContextSelectorEvaluation;
}

// A strategy's output: the generic decision plus a one-line, strategy-specific
// evidence phrase for the resolved winner (e.g. TF-IDF "matched 3 token(s), mass
// 5.54"; a future embedding strategy "cosine 0.82"). Empty when abstaining.
// Keeping the phrasing here — not in the orchestrator — is what stops TF-IDF
// vocabulary leaking into the caller (so a non-lexical strategy is a clean swap).
export type ContextSelectorEvaluation = {
    decision: ContextSelectorDecision;
    winnerNote: string;
};

// v1 strategy: candidate-local IDF TF-IDF scoring (§9) + the count-based
// coverage / evidence-gate / margin decision (§10). Coverage is a strategy
// concern (a non-lexical strategy defines its own notion), computed here from
// the candidates' keyword sets.
export class TfIdfStrategy implements ContextResolutionStrategy {
    private readonly scorer: CollisionScorer;

    constructor(scorer: CollisionScorer = new TfIdfScorer()) {
        this.scorer = scorer;
    }

    public evaluate(
        contextVector: ContextVector,
        candidates: ScorerCandidate[],
        config: DecisionConfig,
    ): ContextSelectorEvaluation {
        const covered = candidates.every((c) => c.keywords.size > 0);
        const scores = this.scorer.score(contextVector, candidates);
        const decision = decide(scores, covered, config);
        const winnerNote =
            decision.kind === "resolve"
                ? `matched ${decision.winner.uniqueTokenCount ?? 0} token(s), mass ${decision.winner.score.toFixed(3)}`
                : "";
        return { decision, winnerNote };
    }
}
