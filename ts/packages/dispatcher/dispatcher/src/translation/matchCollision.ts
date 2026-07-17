// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Action collision detection and resolution for the runtime grammar/cache match path.
//
// Note: MatchResult.conflictValues (in agent-cache) tracks parameter-value conflicts
// during cache matching — not action collisions. The two are unrelated; do not conflate.

import { MatchResult } from "agent-cache";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import {
    CollisionCandidate,
    CollisionStrategy,
    emitCollisionEvent,
} from "../context/collisionTelemetry.js";
import { getAppAgentName } from "./agentTranslators.js";
import { getPrimary } from "./matchResultUtils.js";
import { ClarifyMultipleAgentMatches } from "../context/dispatcher/schema/clarifyActionSchema.js";
import { buildClarifyMultipleAgentMatches } from "./clarifyHelpers.js";
import {
    detectRegistryAmbiguity,
    resolvePreferenceClarify,
    peekOneShotPick,
    consumeOneShotPick,
    getPreferenceContext,
} from "../context/collisionResolution.js";
import { PreferenceMember } from "../context/collisionPreferences.js";
import { resolveContextSelectorMembers } from "./matchContextSelector.js";

export type GrammarCollisionDecision =
    | { kind: "match"; match: MatchResult; note?: string }
    | { kind: "clarify"; clarify: ClarifyMultipleAgentMatches }
    /**
     * A one-shot pick or a topical route names a registry sibling the grammar
     * didn't match. Abort grammar matching; LLM translation pins the schema —
     * via `collisionOneShotPicks` for an explicit pick, or `pendingTopicalRoute`
     * for a contextSelector route (which also carries the note, shown there).
     */
    | { kind: "fallthrough" };

/**
 * Build a `CollisionCandidate` from a cache `MatchResult`, propagating
 * the heuristic counters (matchedCount / nonOptionalCount /
 * wildcardCharCount) and the agent priority rank.  Telemetry analysis
 * uses these fields to reconstruct alternative rankings (e.g.
 * counterfactual `score-rank` outcomes) without re-running the matcher.
 */
export function toCandidate(
    match: MatchResult,
    ctx?: CommandHandlerContext,
): CollisionCandidate {
    const { schemaName, actionName } = getPrimary(match);
    const candidate: CollisionCandidate = {
        schemaName,
        actionName,
        matchedCount: match.matchedCount,
        nonOptionalCount: match.nonOptionalCount,
        wildcardCharCount: match.wildcardCharCount,
    };
    if (ctx && schemaName) {
        candidate.priorityRank = getAgentPriority(
            getAppAgentName(schemaName),
            ctx,
        );
    }
    return candidate;
}

/**
 * Determine whether a validated set of matches represents a collision.
 *
 * - "distinctActions": collision iff >1 distinct (schemaName, actionName) tuples appear.
 * - "tiedHeuristics": collision iff the top two matches share matchedCount,
 *   nonOptionalCount, AND wildcardCharCount.
 */
export function isCollision(
    validated: MatchResult[],
    classifier: "distinctActions" | "tiedHeuristics",
): boolean {
    if (validated.length < 2) {
        return false;
    }
    if (classifier === "distinctActions") {
        const seen = new Set<string>();
        for (const m of validated) {
            const { schemaName, actionName } = getPrimary(m);
            seen.add(`${schemaName}.${actionName}`);
            if (seen.size > 1) {
                return true;
            }
        }
        return false;
    }
    // tiedHeuristics
    const a = validated[0];
    const b = validated[1];
    return (
        a.matchedCount === b.matchedCount &&
        a.nonOptionalCount === b.nonOptionalCount &&
        a.wildcardCharCount === b.wildcardCharCount
    );
}

// Find the validated cache match whose primary (schema, action) equals `member`,
// or undefined when `member` is a registry sibling the grammar didn't produce.
function findValidatedByMember(
    validated: MatchResult[],
    member: PreferenceMember,
): MatchResult | undefined {
    return validated.find((m) => {
        const p = getPrimary(m);
        return (
            p.schemaName === member.schemaName &&
            p.actionName === member.actionName
        );
    });
}

/**
 * Registry-first detection + resolution on the grammar/cache path. Independent
 * of `grammarMatch.detect`: even a single cache match can be registry-known-
 * ambiguous — the cache-masked collision `contextSelector` otherwise can't see
 * (§13.3). When the registry flags a match, re-expands to {member + siblings}
 * and walks a ladder: Tier 0 one-shot pick → Tier 1 preference → Tier 1.5
 * `contextSelector` (topical, no LLM) → Tier 2 clarify. Tiers 0/1 run ahead of
 * contextSelector so an explicit choice is never overridden. Returns undefined
 * when registry-first is off or no match is a registry member.
 */
export function resolveGrammarRegistryFirst(
    validated: MatchResult[],
    ctx: CommandHandlerContext,
    request: string,
    activeSchemas?: ReadonlySet<string>,
): GrammarCollisionDecision | undefined {
    if (!ctx.session.getConfig().collision.preference.registryFirst) {
        return undefined;
    }
    const match = detectRegistryAmbiguity(
        validated.map((m) => getPrimary(m)),
        ctx,
    );
    if (match === undefined) {
        return undefined;
    }
    const { members, neighborhoodIds } = match;

    // Tier 0: honor a pending one-shot pick from a resolved clarify card, so the
    // re-run routes to the user's choice instead of re-showing the same card.
    const pick = peekOneShotPick(members, ctx);
    if (pick !== undefined) {
        const matched = findValidatedByMember(validated, pick);
        if (matched !== undefined) {
            consumeOneShotPick(pick, ctx);
            return { kind: "match", match: matched };
        }
        // Sibling the grammar didn't match — leave the pick for translation to pin.
        return { kind: "fallthrough" };
    }

    // Tier 1: honor a learned/explicit preference. If it's in the validated set,
    // resolve to it; if it names a sibling the grammar didn't produce, pin a
    // one-shot and fall through to translation.
    const prefCfg = ctx.session.getConfig().collision.preference;
    if (prefCfg.enabled) {
        const pref = ctx.collisionPreferences.find(
            members,
            getPreferenceContext(ctx),
        );
        if (pref !== undefined) {
            ctx.collisionPreferences.recordHit(pref.key);
            const matched = findValidatedByMember(validated, pref.chosen);
            if (matched !== undefined) {
                return { kind: "match", match: matched };
            }
            ctx.collisionOneShotPicks.add(
                `${pref.chosen.schemaName}.${pref.chosen.actionName}`,
            );
            return { kind: "fallthrough" };
        }
    }

    // Tier 1.5: contextSelector over the re-expanded neighborhood — resolves a
    // cache-masked collision `isCollision` never saw (§13.3). After Tiers 0/1 so
    // it never overrides an explicit choice; abstains to the Tier 2 clarify below.
    const decision = resolveRegistryContextSelector(
        members,
        validated,
        ctx,
        request,
        activeSchemas,
    );
    if (decision !== undefined) {
        return decision;
    }

    const clarify = buildClarifyMultipleAgentMatches(
        request,
        members,
        neighborhoodIds,
    );
    emitCollisionEvent(
        {
            kind: "grammarMatch",
            request,
            candidates: members.map((m) => ({
                schemaName: m.schemaName,
                actionName: m.actionName,
            })),
            firstMatchCandidate: toCandidate(validated[0], ctx),
            classifier:
                ctx.session.getConfig().collision.grammarMatch.classifier,
            strategy: "preference-clarify",
            note:
                neighborhoodIds.length > 0
                    ? `registry-first [${neighborhoodIds.join(",")}]`
                    : "registry-first",
        },
        ctx,
    );
    return { kind: "clarify", clarify };
}

/**
 * Tier 1.5 of {@link resolveGrammarRegistryFirst}: run `contextSelector` over the
 * registry-expanded neighborhood. Siblings are filtered to `activeSchemas` first
 * (an inactive sibling isn't executable and must not win a route; undefined = no
 * filter, e.g. tests). On a confident resolve returns a `match` (cache winner, no
 * LLM) or a `fallthrough` after recording a `pendingTopicalRoute` (sibling winner
 * — translation pins the schema). Undefined otherwise (off / abstain / skip), so
 * the caller falls to the Tier 2 clarify.
 */
function resolveRegistryContextSelector(
    members: PreferenceMember[],
    validated: MatchResult[],
    ctx: CommandHandlerContext,
    request: string,
    activeSchemas?: ReadonlySet<string>,
): GrammarCollisionDecision | undefined {
    if (!ctx.session.getConfig().collision.contextSelector?.detect) {
        return undefined;
    }
    // Only route to schemas active this turn — an inactive sibling would emit a
    // misleading note and be rejected downstream (this tier auto-routes, no card).
    const routable =
        activeSchemas === undefined
            ? members
            : members.filter((m) => activeSchemas.has(m.schemaName));
    const outcome = resolveContextSelectorMembers(
        routable,
        validated,
        ctx,
        request,
        toCandidate(validated[0], ctx),
    );
    if (outcome.kind !== "resolve") {
        return undefined;
    }
    if (outcome.match !== undefined) {
        // Cache winner — resolve directly (no LLM); the caller shows the note.
        return { kind: "match", match: outcome.match, note: outcome.note };
    }
    // Sibling winner: record a request-scoped route so this request's translation
    // pins the schema and shows the note at that (committed) point, not here where
    // the route isn't yet guaranteed. See `PendingTopicalRoute`.
    ctx.pendingTopicalRoute = {
        schemaName: outcome.schemaName,
        note: outcome.note,
    };
    return { kind: "fallthrough" };
}

function parsePriorityOrder(s: string): string[] {
    if (!s) return [];
    return s
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
}

/**
 * Resolve a priority rank for an agent name. Lower number = higher priority.
 * Uses explicit collision.priorityOrder if set (comma-separated agent names);
 * otherwise registration order from the AppAgentManager (agents whose name
 * appears earlier in registration win ties).
 */
export function getAgentPriority(
    agentName: string,
    ctx: CommandHandlerContext,
): number {
    const cfg = ctx.session.getConfig().collision;
    const order = parsePriorityOrder(cfg.priorityOrder);
    if (order.length > 0) {
        const idx = order.indexOf(agentName);
        if (idx !== -1) {
            return idx;
        }
        // unknown -> append after the explicit list, in registration order
        return order.length + ctx.agents.getAgentRank(agentName);
    }
    return ctx.agents.getAgentRank(agentName);
}

function priorityForMatch(
    match: MatchResult,
    ctx: CommandHandlerContext,
): number {
    const { schemaName } = getPrimary(match);
    if (!schemaName) {
        return Number.MAX_SAFE_INTEGER;
    }
    return getAgentPriority(getAppAgentName(schemaName), ctx);
}

/**
 * Pick a winner from a colliding set according to the configured strategy.
 *
 * Returns either a chosen MatchResult, or a clarify sentinel that the caller
 * should turn into a synthetic translation result (see clarify integration in
 * matchRequest.ts).
 */
export function resolveGrammarCollision(
    validated: MatchResult[],
    ctx: CommandHandlerContext,
    request: string,
): GrammarCollisionDecision {
    const cfg = ctx.session.getConfig().collision;
    const startedAt = performance.now();
    let strategy: CollisionStrategy = cfg.grammarMatch.strategy;
    let downgraded = false;

    if (strategy === "user-clarify" && ctx.executingMultipleAction) {
        switch (cfg.multipleActionBehavior) {
            case "downgrade-to-priority":
                strategy = "priority";
                downgraded = true;
                break;
            case "abort":
                // Surface the clarify; caller treats it as a hard stop for the batch.
                break;
            case "pause-and-prompt":
                // Real pause/resume requires batch-executor support that doesn't
                // exist yet. Fall back to priority and emit a note.
                strategy = "priority";
                downgraded = true;
                break;
        }
    }

    let chosen: MatchResult;
    let decision: GrammarCollisionDecision;

    switch (strategy) {
        case "first-match":
            chosen = validated[0];
            decision = { kind: "match", match: chosen };
            break;
        case "score-rank": {
            // The cache already returns matches sorted by its heuristic. Re-sort
            // explicitly so we don't rely on the producer; ties fall through to priority.
            const sorted = [...validated].sort((a, b) => {
                if (b.matchedCount !== a.matchedCount) {
                    return b.matchedCount - a.matchedCount;
                }
                if (b.nonOptionalCount !== a.nonOptionalCount) {
                    return b.nonOptionalCount - a.nonOptionalCount;
                }
                if (a.wildcardCharCount !== b.wildcardCharCount) {
                    return a.wildcardCharCount - b.wildcardCharCount;
                }
                return priorityForMatch(a, ctx) - priorityForMatch(b, ctx);
            });
            chosen = sorted[0];
            decision = { kind: "match", match: chosen };
            break;
        }
        case "priority": {
            const sorted = [...validated].sort(
                (a, b) => priorityForMatch(a, ctx) - priorityForMatch(b, ctx),
            );
            chosen = sorted[0];
            decision = { kind: "match", match: chosen };
            break;
        }
        case "user-clarify": {
            const candidates = validated.map((m) => toCandidate(m, ctx));
            const clarify = buildClarifyMultipleAgentMatches(
                request,
                candidates,
            );
            decision = { kind: "clarify", clarify };
            // No "chosen" yet — the user picks. Emit telemetry without it.
            emitCollisionEvent(
                {
                    kind: "grammarMatch",
                    request,
                    candidates,
                    // first-match would have picked validated[0] (cache's
                    // heuristic-sorted top); record it for divergence
                    // analysis even when the user is clarifying.
                    firstMatchCandidate: toCandidate(validated[0], ctx),
                    classifier: cfg.grammarMatch.classifier,
                    strategy,
                    elapsedMs: performance.now() - startedAt,
                    note: downgraded ? "downgraded-from-clarify" : undefined,
                },
                ctx,
            );
            return decision;
        }
        case "preference-clarify": {
            const executable: PreferenceMember[] = validated.map((m) =>
                getPrimary(m),
            );
            const dec = resolvePreferenceClarify(executable, ctx);
            if (dec.kind === "preferred") {
                // Tier 1 hit: resolve to the preferred match (guaranteed to be
                // in the validated set by resolvePreferenceClarify).
                chosen =
                    validated.find((m) => {
                        const p = getPrimary(m);
                        return (
                            p.schemaName === dec.chosen.schemaName &&
                            p.actionName === dec.chosen.actionName
                        );
                    }) ?? validated[0];
                emitCollisionEvent(
                    {
                        kind: "grammarMatch",
                        request,
                        candidates: validated.map((m) => toCandidate(m, ctx)),
                        chosen: toCandidate(chosen, ctx),
                        firstMatchCandidate: toCandidate(validated[0], ctx),
                        classifier: cfg.grammarMatch.classifier,
                        strategy,
                        elapsedMs: performance.now() - startedAt,
                        note: "preference-hit",
                    },
                    ctx,
                );
                return { kind: "match", match: chosen };
            }
            if (dec.kind === "first-match") {
                // Registry-only ambiguity source and the set isn't known-
                // ambiguous: preserve legacy behavior.
                chosen = validated[0];
                decision = { kind: "match", match: chosen };
                break;
            }
            // Tier 2: clarify. Inside a MultipleAction batch, honor
            // multipleActionBehavior just like user-clarify.
            if (
                ctx.executingMultipleAction &&
                cfg.multipleActionBehavior !== "abort"
            ) {
                const sorted = [...validated].sort(
                    (a, b) =>
                        priorityForMatch(a, ctx) - priorityForMatch(b, ctx),
                );
                chosen = sorted[0];
                emitCollisionEvent(
                    {
                        kind: "grammarMatch",
                        request,
                        candidates: validated.map((m) => toCandidate(m, ctx)),
                        chosen: toCandidate(chosen, ctx),
                        firstMatchCandidate: toCandidate(validated[0], ctx),
                        classifier: cfg.grammarMatch.classifier,
                        strategy: "downgraded",
                        elapsedMs: performance.now() - startedAt,
                        note: `preference-miss; downgraded clarify under multipleActionBehavior=${cfg.multipleActionBehavior}`,
                    },
                    ctx,
                );
                return { kind: "match", match: chosen };
            }
            const candidates = dec.members.map((m) => {
                const match = validated.find((v) => {
                    const p = getPrimary(v);
                    return (
                        p.schemaName === m.schemaName &&
                        p.actionName === m.actionName
                    );
                });
                return match
                    ? toCandidate(match, ctx)
                    : {
                          schemaName: m.schemaName,
                          actionName: m.actionName,
                      };
            });
            const clarify = buildClarifyMultipleAgentMatches(
                request,
                candidates,
            );
            emitCollisionEvent(
                {
                    kind: "grammarMatch",
                    request,
                    candidates,
                    firstMatchCandidate: toCandidate(validated[0], ctx),
                    classifier: cfg.grammarMatch.classifier,
                    strategy,
                    elapsedMs: performance.now() - startedAt,
                    note: "preference-miss-clarify",
                },
                ctx,
            );
            return { kind: "clarify", clarify };
        }
        default: {
            // Exhaustiveness: unknown strategy falls back to first-match.
            chosen = validated[0];
            decision = { kind: "match", match: chosen };
        }
    }

    emitCollisionEvent(
        {
            kind: "grammarMatch",
            request,
            candidates: validated.map((m) => toCandidate(m, ctx)),
            chosen: toCandidate(chosen, ctx),
            firstMatchCandidate: toCandidate(validated[0], ctx),
            classifier: cfg.grammarMatch.classifier,
            strategy: downgraded ? "downgraded" : strategy,
            elapsedMs: performance.now() - startedAt,
            note: downgraded
                ? `downgraded from user-clarify under multipleActionBehavior=${cfg.multipleActionBehavior}`
                : undefined,
        },
        ctx,
    );

    return decision;
}
