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
     * A pending one-shot pick (or a registry-first topical route) names a
     * registry sibling the grammar didn't match. Abort grammar matching and fall
     * through to LLM translation, where `pickInitialSchema` pins the schema to
     * the chosen candidate (via `collisionOneShotPicks` for an explicit pick, or
     * `pendingTopicalRoute` for a contextSelector topical route). The routing
     * note (when any) travels with `pendingTopicalRoute` and is shown at the
     * translation commit site, not on this decision.
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
 * Registry-first detection + resolution for the grammar/cache path. Independent
 * of `grammarMatch.detect` and the collision classifier: even a single confident
 * cache match can be "known to be ambiguous" via the neighborhood registry —
 * which is exactly the cache-masked collision the construction cache would
 * otherwise hide from `contextSelector` (§13.3).
 *
 * Scans the validated cache matches against the registry; when any is a
 * known-ambiguous member it re-expands the candidate set to that member plus its
 * registry siblings and walks a resolution ladder:
 *   Tier 0 — a pending one-shot pick from a resolved clarify card,
 *   Tier 1 — a learned/explicit preference,
 *   Tier 1.5 — `contextSelector`: a confident recent-topic pick over the
 *              re-expanded neighborhood (resolves with no LLM when the winner is
 *              a cache match, or pins + falls through when it is a sibling), and
 *   Tier 2 — clarify with the sibling-enriched options.
 * Tiers 0 and 1 run ahead of `contextSelector`, so an explicit user choice is
 * never overridden. Returns undefined when registry-first is off or no match is
 * a registry member.
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

    // Honor a pending one-shot pick from a previously-resolved clarify card so
    // that re-running the original request routes to the user's choice instead
    // of re-showing the same card. Without this, the grammar cache re-matches
    // the same action, registry-first re-detects the ambiguity, and the card
    // duplicates indefinitely.
    const pick = peekOneShotPick(members, ctx);
    if (pick !== undefined) {
        const matched = findValidatedByMember(validated, pick);
        if (matched !== undefined) {
            consumeOneShotPick(pick, ctx);
            return { kind: "match", match: matched };
        }
        // The pick is a registry sibling the grammar didn't match. Leave the
        // pick in place and fall through to translation, which pins the schema.
        return { kind: "fallthrough" };
    }

    // Tier 1: honor a learned/explicit preference so "remember this choice"
    // actually auto-resolves on the registry-first path. Without this the card
    // re-appears every time even after the user asked to remember, and
    // `@collision preferences clear` looks like a no-op (the preference was
    // never being consulted). When a preference matches and is in the grammar's
    // validated set, resolve to it; when it names a sibling the grammar didn't
    // produce, pin it via a one-shot and fall through to translation.
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

    // Tier 1.5: contextSelector. The registry re-expanded a (possibly single)
    // cache match into its neighborhood, so the topical scorer can now see ≥2
    // candidates and resolve a cache-masked collision that `isCollision` never
    // saw (§13.3). Runs after Tiers 0/1 so it never overrides an explicit choice;
    // on abstain it falls through to the Tier 2 clarify below.
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
 * registry-expanded neighborhood (`members` = matched cache action + siblings).
 *
 * Registry siblings are filtered to `activeSchemas` first — a sibling for a
 * disabled / out-of-activity agent is not executable, so it must not win a route
 * (the validated cache matches are always active). When `activeSchemas` is
 * undefined (no host filter, e.g. tests) all members are eligible.
 *
 * Returns a routing decision on a confident topical resolve — a `match` when the
 * winner is a cache construction (no LLM), or a `fallthrough` (after pinning a
 * one-shot pick) when the winner is a registry sibling the cache never produced,
 * so LLM translation pins the schema. Returns undefined when `contextSelector` is
 * off, abstains, or skips — the caller then falls to the Tier 2 clarify.
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
    // Only route to schemas active this turn. `contextSelector` resolves
    // automatically (no clarify card), so an inactive sibling winner would emit a
    // misleading note and then be rejected downstream — filter it out up front.
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
        // abstain / skip — let the caller fall through to Tier 2 clarify.
        return undefined;
    }
    if (outcome.match !== undefined) {
        // Winner is a cache construction — resolve directly (no LLM). The note
        // is displayed by the caller since the route is committed here.
        return { kind: "match", match: outcome.match, note: outcome.note };
    }
    // Winner is a registry sibling the grammar never matched. Record a
    // request-scoped topical route so this same request's LLM translation pins
    // the schema and shows the note at that (committed) point — not preemptively
    // here, where the route isn't yet guaranteed. See `PendingTopicalRoute`.
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
