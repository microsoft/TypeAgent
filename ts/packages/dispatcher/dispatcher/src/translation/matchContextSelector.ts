// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The contextSelector orchestrator (§11): adapts colliding candidates into
// scorer candidates, runs the deterministic pipeline (signal -> strategy: score
// + decide), emits telemetry, and returns a 3-way outcome — resolve (with the
// winning candidate + a UX affordance note), abstain, or skip (not a topical
// collision). Pure engine logic lives under ../context/contextSelector/; this
// file is the thin candidate-aware seam plus telemetry.
//
// Two entry points feed the same scoring core:
//   - `resolveContextSelector` — the grammar/cache path's validated MatchResults
//     (a genuine ≥2-way cache collision); every candidate carries a MatchResult.
//   - `resolveContextSelectorMembers` — a registry-expanded neighborhood, used
//     when the cache masked a collision behind a *single* committed construction
//     (§13.3). The matched member carries its cache MatchResult; the registry
//     siblings do not (they route via pin + `fallthrough` to LLM translation).

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

// v1 strategy selection (§9): TF-IDF scoring + count-based decision, bundled so
// a future knowPro-entity / embedding strategy swaps as one unit. Stateless —
// a single instance is reused.
const strategy: ContextResolutionStrategy = new TfIdfStrategy();

export type ContextSelectorOutcome =
    // Confident topical pick. `match` is the winning candidate's cache
    // MatchResult when it has one (grammar/cache winner — resolve with no LLM);
    // it is undefined when the winner is a registry sibling the cache never
    // matched, which the caller routes by pinning a one-shot and falling through
    // to LLM translation. `note` is the U-2 affordance (§11.2).
    | {
          kind: "resolve";
          schemaName: string;
          actionName: string;
          match: MatchResult | undefined;
          note: string;
      }
    // Scored >= 2 distinct candidates but the signal was weak/ambiguous. The
    // caller applies the configured abstain fallback.
    | { kind: "abstain" }
    // Fewer than 2 distinct (schema, action) candidates — not a topical collision
    // (e.g. a tiedHeuristics tie between two constructions of the SAME action).
    // The caller must fall through to today's behavior, never escalate.
    | { kind: "skip" };

// A scorer candidate that may carry the cache MatchResult it came from. The
// match is absent for a registry sibling re-expanded from the neighborhood
// registry (there is no cache construction for it — the whole point of §13.3).
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

// Build a scorer candidate for one (schema, action). Effective keywords = the
// derived lexical floor layered with sidecar overrides (§5–6), resolved for any
// action — including a registry sibling that has no cache match.
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

// Shared scoring core (both entry points funnel here): de-dup the candidates,
// run the TF-IDF strategy over the live context vector, emit telemetry, and map
// the decision to a resolve/abstain/skip outcome. `firstMatchCandidate` (what
// first-match would have picked, i.e. validated[0]) is supplied by the caller —
// it owns `toCandidate`, keeping this orchestrator off the command-context
// dependency cycle.
function scoreAndDecide(
    rawCandidates: Candidate[],
    ctx: CommandHandlerContext,
    request: string,
    firstMatchCandidate: CollisionCandidate,
): ContextSelectorOutcome {
    const cfg = ctx.session.getConfig().collision;
    const startedAt = performance.now();

    // Distinct (schema, action) candidates, keeping the best representative per
    // action (one that carries a MatchResult wins; the stronger match breaks a
    // tie). Effective keywords are resolved by the caller (derived floor +
    // sidecar overrides) so a registry sibling with no cache match still scores.
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
        schemaName: winner.schemaName,
        actionName: winner.actionName,
        // undefined when the winner is a registry sibling the cache never matched
        // — the caller pins it and falls through to LLM translation.
        match: winning.match,
        note: `↪ routed to ${agentName} — recent topic`,
    };
}

// Resolve a grammar/cache-path collision (≥2 validated matches) by topical
// proximity, abstain, or skip. Assumes the caller confirmed `isCollision` and
// that `contextSelector.detect` is on. Every validated match carries its
// MatchResult, so a resolve here always routes without the LLM.
export function resolveContextSelector(
    validated: MatchResult[],
    ctx: CommandHandlerContext,
    request: string,
    firstMatchCandidate: CollisionCandidate,
): ContextSelectorOutcome {
    const candidates = validated.map((match) => candidateFromMatch(match, ctx));
    return scoreAndDecide(candidates, ctx, request, firstMatchCandidate);
}

// Resolve a *cache-masked* collision (§13.3): the cache committed a single
// construction, so the grammar path saw no collision, but the neighborhood
// registry flagged that action as known-ambiguous and re-expanded it into
// `members` (the matched member + its registry siblings). Score the union of the
// neighborhood `members` and every `validated` cache match — the cache matches
// carry their MatchResult (route with no LLM), the registry-only siblings do not
// (a sibling winner returns `match: undefined` for the caller to pin + fall
// through to LLM translation). Unioning in `validated` means a genuine
// multi-match collision (validated has ≥2 tuples, one of them registry-flagged)
// never drops a real cache candidate that isn't in the flagged neighborhood.
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
    // Every validated cache match is a real, executable candidate; add it so a
    // multi-match collision scores its full set (dedup in `scoreAndDecide` keeps
    // the match-carrying representative when a member and a validated match share
    // an id, so the matched neighborhood member still routes without the LLM).
    for (const match of validated) {
        candidates.push(candidateFromMatch(match, ctx));
    }
    return scoreAndDecide(candidates, ctx, request, firstMatchCandidate);
}
