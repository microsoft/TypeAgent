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
import {
    ClarifyMultipleAgentMatches,
    buildClarifyMultipleAgentMatches,
} from "../context/dispatcher/schema/clarifyActionSchema.js";

export type GrammarCollisionDecision =
    | { kind: "match"; match: MatchResult }
    | { kind: "clarify"; clarify: ClarifyMultipleAgentMatches };

function getPrimary(match: MatchResult): {
    schemaName: string;
    actionName: string;
} {
    const first = match.match.actions[0]?.action;
    return {
        schemaName: first?.schemaName ?? "",
        actionName: first?.actionName ?? "",
    };
}

function toCandidate(match: MatchResult): CollisionCandidate {
    const { schemaName, actionName } = getPrimary(match);
    return { schemaName, actionName };
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
            const candidates = validated.map(toCandidate);
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
                    strategy,
                    elapsedMs: performance.now() - startedAt,
                    note: downgraded ? "downgraded-from-clarify" : undefined,
                },
                ctx,
            );
            return decision;
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
            candidates: validated.map(toCandidate),
            chosen: toCandidate(chosen),
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
