// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The contextSelector orchestrator (§11): adapts the grammar path's validated
// MatchResults into scorer candidates, runs the deterministic pipeline
// (signal -> strategy: score + decide), emits telemetry, and returns a 3-way
// outcome — resolve (with the winning match + a UX affordance note), abstain, or
// skip (not a topical collision). Pure engine logic lives under
// ../context/contextSelector/; this file is the thin MatchResult-aware seam plus
// telemetry.

import { MatchResult } from "agent-cache";
import type { CommandHandlerContext } from "../context/commandHandlerContext.js";
import {
    CollisionCandidate,
    emitCollisionEvent,
} from "../context/collisionTelemetry.js";
import { getAppAgentName } from "./agentTranslators.js";
import { getPrimary } from "./matchResultUtils.js";
import {
    CandidateScore,
    ScorerCandidate,
} from "../context/contextSelector/scorer.js";
import {
    ContextResolutionStrategy,
    TfIdfStrategy,
} from "../context/contextSelector/strategy.js";

// v1 strategy selection (§9): TF-IDF scoring + count-based decision, bundled so
// a future knowPro-entity / embedding strategy swaps as one unit. Stateless —
// a single instance is reused.
const strategy: ContextResolutionStrategy = new TfIdfStrategy();

export type ContextSelectorOutcome =
    // Confident topical pick — resolve to `match` (avoids the LLM); `note` is the
    // U-2 affordance (§11.2).
    | { kind: "resolve"; match: MatchResult; note: string }
    // Scored >= 2 distinct candidates but the signal was weak/ambiguous. The
    // caller applies the configured abstain fallback.
    | { kind: "abstain" }
    // Fewer than 2 distinct (schema, action) candidates — not a topical collision
    // (e.g. a tiedHeuristics tie between two constructions of the SAME action).
    // The caller must fall through to today's behavior, never escalate.
    | { kind: "skip" };

type Candidate = ScorerCandidate & { match: MatchResult };

// Prefer the heuristically-stronger MatchResult when the same (schema, action)
// appears twice (matchedCount desc, nonOptionalCount desc, wildcardCharCount
// asc) so a resolve returns the best representative, not just the first seen.
function isBetterMatch(next: MatchResult, current: MatchResult): boolean {
    if (next.matchedCount !== current.matchedCount) {
        return next.matchedCount > current.matchedCount;
    }
    if (next.nonOptionalCount !== current.nonOptionalCount) {
        return next.nonOptionalCount > current.nonOptionalCount;
    }
    return next.wildcardCharCount < current.wildcardCharCount;
}

function toTelemetryCandidates(scores: CandidateScore[]): CollisionCandidate[] {
    return scores.map((s) => ({
        schemaName: s.schemaName,
        actionName: s.actionName,
        score: s.score,
        matchedTokens: (s.matched ?? []).map((m) => ({
            token: m.token,
            weight: m.contribution,
        })),
    }));
}

// Resolve a grammar-path collision by topical proximity, abstain, or skip.
// Assumes the caller confirmed `isCollision` and that `contextSelector.detect`
// is on. `firstMatchCandidate` (what first-match would have picked, i.e.
// validated[0]) is supplied by the caller — it owns `toCandidate`, keeping this
// orchestrator off the command-context dependency cycle.
export function resolveContextSelector(
    validated: MatchResult[],
    ctx: CommandHandlerContext,
    request: string,
    firstMatchCandidate: CollisionCandidate,
): ContextSelectorOutcome {
    const cfg = ctx.session.getConfig().collision;
    const startedAt = performance.now();

    // Distinct (schema, action) candidates, keeping the best MatchResult per
    // action. Effective keywords = derived floor + sidecar overrides.
    const byId = new Map<string, Candidate>();
    for (const match of validated) {
        const { schemaName, actionName } = getPrimary(match);
        if (schemaName === "" || actionName === "") {
            continue;
        }
        const id = `${schemaName}.${actionName}`;
        const existing = byId.get(id);
        if (existing === undefined) {
            byId.set(id, {
                schemaName,
                actionName,
                keywords: ctx.contextSelectorKeywords.effective(
                    schemaName,
                    actionName,
                ),
                match,
            });
        } else if (isBetterMatch(match, existing.match)) {
            existing.match = match;
        }
    }
    const candidates = [...byId.values()];
    if (candidates.length < 2) {
        // Not a topical collision — nothing for contextSelector to weigh in on.
        return { kind: "skip" };
    }

    const contextVector = ctx.conversationSignal.getContextVector();
    const { decision, winnerNote } = strategy.evaluate(
        contextVector,
        candidates,
        {
            minUniqueTokens: cfg.contextSelector.minUniqueTokens,
            minMass: cfg.contextSelector.minMass,
            margin: cfg.contextSelector.margin,
        },
    );

    const telemetryCandidates = toTelemetryCandidates(decision.ranked);
    // `firstMatchCandidate` (what first-match would have picked) is passed in by
    // the caller — preserved so the rollout can compare treatment vs control even
    // when contextSelector short-circuits the strategy (§13).
    const elapsedMs = performance.now() - startedAt;

    if (decision.kind === "abstain") {
        emitCollisionEvent(
            {
                kind: "grammarMatch",
                request,
                candidates: telemetryCandidates,
                firstMatchCandidate,
                classifier: cfg.grammarMatch.classifier,
                strategy: "context-weight",
                elapsedMs,
                note: `abstain:${decision.reason}`,
            },
            ctx,
        );
        return { kind: "abstain" };
    }

    const winner = decision.winner;
    const winning = byId.get(`${winner.schemaName}.${winner.actionName}`);
    if (winning === undefined) {
        // Defensive: winner id must be present. Treat as abstain rather than
        // resolving to the wrong match.
        return { kind: "abstain" };
    }
    emitCollisionEvent(
        {
            kind: "grammarMatch",
            request,
            candidates: telemetryCandidates,
            chosen: telemetryCandidates.find(
                (c) =>
                    c.schemaName === winner.schemaName &&
                    c.actionName === winner.actionName,
            ),
            firstMatchCandidate,
            classifier: cfg.grammarMatch.classifier,
            strategy: "context-weight",
            elapsedMs,
            note: `resolve; ${winnerNote}`,
        },
        ctx,
    );

    const agentName = getAppAgentName(winner.schemaName);
    return {
        kind: "resolve",
        match: winning.match,
        note: `↪ routed to ${agentName} — recent topic`,
    };
}
