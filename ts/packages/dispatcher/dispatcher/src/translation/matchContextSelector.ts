// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The contextSelector orchestrator (§11): adapts colliding candidates into
// scorer candidates, runs the deterministic TF-IDF pipeline, emits telemetry,
// and returns resolve / abstain / skip. Engine logic lives under
// ../context/contextSelector/; this file is the MatchResult-aware seam.
//
// Two entry points funnel into `scoreAndDecide`: `resolveContextSelector` (a
// genuine ≥2-way cache collision) and `resolveContextSelectorMembers` (a
// registry-expanded neighborhood for a cache-masked collision, §13.3 — its
// siblings have no MatchResult).

import { MatchResult } from "agent-cache";
import type { CommandHandlerContext } from "../context/commandHandlerContext.js";
import {
    CollisionCandidate,
    emitCollisionEvent,
} from "../context/collisionTelemetry.js";
import { PreferenceMember } from "../context/collisionPreferences.js";
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

// v1 strategy (§9): TF-IDF scoring + count-based decision, swappable as one unit
// for a future embedding scorer. Stateless — a single instance is reused.
const strategy: ContextResolutionStrategy = new TfIdfStrategy();

export type ContextSelectorOutcome =
    // Confident topical pick. `match` is the winner's cache MatchResult (route
    // with no LLM), or undefined for a registry sibling the cache never matched
    // (caller routes it via translation). `note` is the U-2 affordance (§11.2).
    | {
          kind: "resolve";
          schemaName: string;
          actionName: string;
          match: MatchResult | undefined;
          note: string;
      }
    // Scored ≥2 candidates but the signal was weak/ambiguous — caller applies the
    // configured abstain fallback.
    | { kind: "abstain" }
    // Fewer than 2 distinct (schema, action) candidates — not a topical collision;
    // caller keeps today's behavior, never escalates.
    | { kind: "skip" };

// A scorer candidate that may carry the cache MatchResult it came from (undefined
// for a registry sibling with no cache construction, §13.3).
type Candidate = ScorerCandidate & { match: MatchResult | undefined };

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

// Merge two candidates with the same (schema, action) id into one representative.
// Prefer one that carries a MatchResult (so a resolve can route without the LLM);
// between two matches, keep the heuristically stronger one.
function preferRepresentative(existing: Candidate, next: Candidate): Candidate {
    if (next.match === undefined) {
        return existing;
    }
    if (existing.match === undefined) {
        return next;
    }
    return isBetterMatch(next.match, existing.match) ? next : existing;
}

// Build a scorer candidate. Effective keywords resolve for any action (§5–6),
// including a registry sibling with no cache match.
function makeCandidate(
    schemaName: string,
    actionName: string,
    ctx: CommandHandlerContext,
    match: MatchResult | undefined,
): Candidate {
    return {
        schemaName,
        actionName,
        keywords: ctx.contextSelectorKeywords.effective(schemaName, actionName),
        match,
    };
}

// Adapt a cache MatchResult (via its primary action) into a scorer candidate.
function candidateFromMatch(
    match: MatchResult,
    ctx: CommandHandlerContext,
): Candidate {
    const { schemaName, actionName } = getPrimary(match);
    return makeCandidate(schemaName, actionName, ctx, match);
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

// Shared scoring core: de-dup candidates, run the strategy, emit telemetry, and
// map to resolve/abstain/skip. `firstMatchCandidate` (validated[0], what
// first-match would pick) is passed in so this stays off the command-context
// cycle and telemetry can compare treatment vs control.
function scoreAndDecide(
    rawCandidates: Candidate[],
    ctx: CommandHandlerContext,
    request: string,
    firstMatchCandidate: CollisionCandidate,
): ContextSelectorOutcome {
    const cfg = ctx.session.getConfig().collision;
    const startedAt = performance.now();

    // Distinct (schema, action), keeping the best representative per action.
    const byId = new Map<string, Candidate>();
    for (const candidate of rawCandidates) {
        if (candidate.schemaName === "" || candidate.actionName === "") {
            continue;
        }
        const id = `${candidate.schemaName}.${candidate.actionName}`;
        const existing = byId.get(id);
        byId.set(
            id,
            existing === undefined
                ? candidate
                : preferRepresentative(existing, candidate),
        );
    }
    const candidates = [...byId.values()];
    if (candidates.length < 2) {
        // Not a topical collision.
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
        schemaName: winner.schemaName,
        actionName: winner.actionName,
        // undefined for a registry sibling (caller routes it via translation).
        match: winning.match,
        note: `↪ routed to ${agentName} — recent topic`,
    };
}

// Resolve a grammar/cache-path collision (≥2 validated matches) by topical
// proximity. Every validated match carries its MatchResult, so a resolve here
// always routes without the LLM.
export function resolveContextSelector(
    validated: MatchResult[],
    ctx: CommandHandlerContext,
    request: string,
    firstMatchCandidate: CollisionCandidate,
): ContextSelectorOutcome {
    const candidates = validated.map((match) => candidateFromMatch(match, ctx));
    return scoreAndDecide(candidates, ctx, request, firstMatchCandidate);
}

// Resolve a *cache-masked* collision (§13.3): the registry flagged a single
// cache match as known-ambiguous and re-expanded it into `members` (matched
// member + siblings). Scores the union of `members` and every `validated` match,
// so a genuine multi-match never drops a real cache candidate; dedup keeps the
// match-carrying representative, so a matched member still routes without the LLM.
export function resolveContextSelectorMembers(
    members: PreferenceMember[],
    validated: MatchResult[],
    ctx: CommandHandlerContext,
    request: string,
    firstMatchCandidate: CollisionCandidate,
): ContextSelectorOutcome {
    const candidates: Candidate[] = members.map((member) =>
        makeCandidate(member.schemaName, member.actionName, ctx, undefined),
    );
    for (const match of validated) {
        candidates.push(candidateFromMatch(match, ctx));
    }
    return scoreAndDecide(candidates, ctx, request, firstMatchCandidate);
}
