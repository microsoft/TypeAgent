// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Per-action "gravity" scoring inside a neighborhood.
//
// Pure function over `Neighborhood.evidence`. No I/O, no dispatcher state.
//
// See docs/architecture/collision-analysis.md and the plan in
// ~/.claude/plans/for-each-collision-grouping-prancy-elephant.md for the
// design rationale. Summary:
//   - owedTraffic: outDegree on ranker-misroute edges (default primary score)
//   - stolenTraffic: inDegree on ranker-misroute edges
//   - entanglement: distinct partners + bidirectional pairs (structural)
//   - weightedConfusion: count × pair-similarity (corpus + similarity agree)
//   - endUserOwedTraffic: outDegree on CONFIRMED + NEW_FAILURE (translator)
//   - translatorRecoveryRate: RESCUED / (RESCUED + CONFIRMED)
//   - severityTier: blocker / leaky / clean (only with translator data)

import type {
    MisrouteEdgeEvidence,
    Neighborhood,
    NeighborhoodMember,
} from "./types.js";

export interface ActionGravity {
    member: NeighborhoodMember;

    // --- always populated when corpus data exists ---
    /** Σ count where member is `from` on ranker-misroute edges. */
    owedTraffic: number;
    /** Σ count where member is `to` on ranker-misroute edges. */
    stolenTraffic: number;
    /** Distinct other members this action shares any edge with. */
    partners: number;
    /** Partners with both A→B and B→A edges. */
    bidirectionalPartners: number;
    /** partners + bidirectionalPartners. Higher = more structurally confused. */
    entanglement: number;
    /** Σ count × similarity(A,B); similarity defaults to 1 when absent. */
    weightedConfusion: number;
    /** owedTraffic / Σ owedTraffic across the neighborhood; 0..1. */
    shareInNeighborhood: number;
    /** Mean pair similarity to other members; only set for similarity-only neighborhoods. */
    semanticGravity?: number;

    // --- populated only when translator-corpus data is merged in ---
    /** Σ CONFIRMED + NEW_FAILURE outflow. Ground-truth user-visible misroutes. */
    endUserOwedTraffic?: number;
    /** Σ outflow on `translatorMisrouteEdges` only (NEW_FAILURE class). */
    translatorOwedTraffic?: number;
    /** RESCUED / (RESCUED + CONFIRMED), 0..1. High = LLM bails the ranker out. */
    translatorRecoveryRate?: number;
    /** Triage label derived from the translator signal. */
    severityTier?: "blocker" | "leaky" | "clean";
}

export type PairScoreLookup = (
    a: NeighborhoodMember,
    b: NeighborhoodMember,
) => number | undefined;

/**
 * Threshold above which an action with non-trivial endUserOwedTraffic is
 * flagged a "blocker" (vs "leaky" when the LLM rescues most of its misroutes).
 */
const BLOCKER_THRESHOLD = 1;
/** Recovery rate below which a leaky action is upgraded to blocker. */
const LEAKY_RECOVERY_FLOOR = 0.5;

function memberKey(m: NeighborhoodMember): string {
    return `${m.schemaName}.${m.actionName}`;
}

function parseMemberKey(key: string): NeighborhoodMember {
    const idx = key.indexOf(".");
    return {
        schemaName: key.slice(0, idx),
        actionName: key.slice(idx + 1),
    };
}

/**
 * Compute per-member gravity scores for a neighborhood.
 *
 * Translator-derived fields stay undefined when the input has no translator
 * evidence (no `translatorMisrouteEdges`, no `translatorConfirmedCount`/
 * `translatorRescuedCount` on edges, no `crossVerdicts`).
 */
export function computeActionGravity(
    n: Neighborhood,
    pairScoreLookup?: PairScoreLookup,
): ActionGravity[] {
    const rankerEdges = n.evidence.misrouteEdges ?? [];
    const translatorEdges = n.evidence.translatorMisrouteEdges ?? [];
    const hasCorpus = rankerEdges.length > 0 || translatorEdges.length > 0;
    const hasTranslator =
        translatorEdges.length > 0 ||
        rankerEdges.some(
            (e) =>
                e.translatorConfirmedCount !== undefined ||
                e.translatorRescuedCount !== undefined,
        ) ||
        n.evidence.crossVerdicts !== undefined;

    const members = n.members;
    const memberKeys = new Set(members.map(memberKey));

    // --- Outgoing / incoming counts on ranker edges ---
    const outRanker = new Map<string, number>();
    const inRanker = new Map<string, number>();
    // Set of keys that have any edge (in either direction).
    const partnersOf = new Map<string, Set<string>>();
    // Pairs where both A→B and B→A exist (canonicalized as sorted pair string).
    const bidirectionalPairs = new Set<string>();
    const directedPairs = new Set<string>();
    // Weighted-confusion accumulator (per member).
    const weighted = new Map<string, number>();
    // Translator-class accumulators (per member, all `from`-direction).
    const confirmedOut = new Map<string, number>();
    const rescuedOut = new Map<string, number>();
    const newFailureOut = new Map<string, number>();

    function addPartner(a: string, b: string) {
        if (a === b) return;
        let pa = partnersOf.get(a);
        if (!pa) {
            pa = new Set();
            partnersOf.set(a, pa);
        }
        pa.add(b);
    }

    function recordEdge(e: MisrouteEdgeEvidence, isTranslatorOnly: boolean) {
        if (!memberKeys.has(e.from) || !memberKeys.has(e.to)) return;
        if (e.from === e.to) return;
        if (!isTranslatorOnly) {
            outRanker.set(e.from, (outRanker.get(e.from) ?? 0) + e.count);
            inRanker.set(e.to, (inRanker.get(e.to) ?? 0) + e.count);
        }
        addPartner(e.from, e.to);
        addPartner(e.to, e.from);
        const dirKey = `${e.from}->${e.to}`;
        const reverseKey = `${e.to}->${e.from}`;
        if (directedPairs.has(reverseKey)) {
            const pair = [e.from, e.to].sort().join("|");
            bidirectionalPairs.add(pair);
        }
        directedPairs.add(dirKey);

        // Weighted confusion: count × similarity, attributed to the `from` member.
        const sim =
            pairScoreLookup?.(parseMemberKey(e.from), parseMemberKey(e.to)) ??
            1;
        weighted.set(e.from, (weighted.get(e.from) ?? 0) + e.count * sim);

        // Translator-class accumulation. Ranker edges may carry confirmed/
        // rescued counts directly; translator-only edges (NEW_FAILURE) live in
        // the separate translatorMisrouteEdges array.
        if (isTranslatorOnly) {
            newFailureOut.set(
                e.from,
                (newFailureOut.get(e.from) ?? 0) + e.count,
            );
        } else {
            if (e.translatorConfirmedCount !== undefined) {
                confirmedOut.set(
                    e.from,
                    (confirmedOut.get(e.from) ?? 0) +
                        e.translatorConfirmedCount,
                );
            }
            if (e.translatorRescuedCount !== undefined) {
                rescuedOut.set(
                    e.from,
                    (rescuedOut.get(e.from) ?? 0) + e.translatorRescuedCount,
                );
            }
        }
    }

    for (const e of rankerEdges) recordEdge(e, false);
    for (const e of translatorEdges) recordEdge(e, true);

    // --- Sum of owedTraffic (for shareInNeighborhood). ---
    const totalOwed = [...outRanker.values()].reduce((a, b) => a + b, 0);

    // --- Compute per-member gravity. ---
    const result: ActionGravity[] = members.map((m) => {
        const key = memberKey(m);
        const owedTraffic = outRanker.get(key) ?? 0;
        const stolenTraffic = inRanker.get(key) ?? 0;
        const partnerSet = partnersOf.get(key) ?? new Set<string>();
        const partners = partnerSet.size;
        let bidirectionalPartners = 0;
        for (const p of partnerSet) {
            const pair = [key, p].sort().join("|");
            if (bidirectionalPairs.has(pair)) bidirectionalPartners++;
        }
        const entanglement = partners + bidirectionalPartners;
        const weightedConfusion = weighted.get(key) ?? 0;
        const shareInNeighborhood = totalOwed > 0 ? owedTraffic / totalOwed : 0;

        const ag: ActionGravity = {
            member: m,
            owedTraffic,
            stolenTraffic,
            partners,
            bidirectionalPartners,
            entanglement,
            weightedConfusion,
            shareInNeighborhood,
        };

        // Similarity-only fallback: no corpus data at all.
        if (!hasCorpus && pairScoreLookup) {
            let sum = 0;
            let count = 0;
            for (const other of members) {
                if (memberKey(other) === key) continue;
                const score = pairScoreLookup(m, other);
                if (score !== undefined) {
                    sum += score;
                    count++;
                }
            }
            if (count > 0) ag.semanticGravity = sum / count;
        }

        // Translator fields populated only when translator evidence exists.
        if (hasTranslator) {
            const confirmed = confirmedOut.get(key) ?? 0;
            const rescued = rescuedOut.get(key) ?? 0;
            const newFailure = newFailureOut.get(key) ?? 0;
            ag.endUserOwedTraffic = confirmed + newFailure;
            ag.translatorOwedTraffic = newFailure;
            const denom = rescued + confirmed;
            ag.translatorRecoveryRate = denom > 0 ? rescued / denom : 0;
            // Severity tier:
            //   - clean: barely any user-visible misroutes.
            //   - leaky: ranker leaks but LLM mostly rescues (low blocker risk).
            //   - blocker: real user-visible misroutes (CONFIRMED + NEW_FAILURE > threshold)
            //     OR low recovery rate on a non-trivial owedTraffic.
            const isBlocker =
                ag.endUserOwedTraffic >= BLOCKER_THRESHOLD ||
                (owedTraffic >= BLOCKER_THRESHOLD &&
                    ag.translatorRecoveryRate < LEAKY_RECOVERY_FLOOR);
            if (isBlocker) {
                ag.severityTier = "blocker";
            } else if (
                owedTraffic > 0 &&
                ag.translatorRecoveryRate >= LEAKY_RECOVERY_FLOOR
            ) {
                ag.severityTier = "leaky";
            } else {
                ag.severityTier = "clean";
            }
        }

        return ag;
    });

    return result;
}

/**
 * Picks the worst offender in a neighborhood. Prefers `endUserOwedTraffic`
 * when translator data is available; falls back to `owedTraffic`; falls back
 * to `entanglement` for similarity-only neighborhoods. Returns undefined for
 * empty neighborhoods.
 */
export function topOffender(
    n: Neighborhood,
    pairScoreLookup?: PairScoreLookup,
): ActionGravity | undefined {
    const all = computeActionGravity(n, pairScoreLookup);
    if (all.length === 0) return undefined;
    const hasTranslator = all.some((a) => a.endUserOwedTraffic !== undefined);
    const hasCorpus = all.some((a) => a.owedTraffic > 0 || a.stolenTraffic > 0);
    const sorted = [...all].sort((a, b) => {
        if (hasTranslator) {
            const ae = a.endUserOwedTraffic ?? 0;
            const be = b.endUserOwedTraffic ?? 0;
            if (be !== ae) return be - ae;
        }
        if (hasCorpus) {
            if (b.owedTraffic !== a.owedTraffic) {
                return b.owedTraffic - a.owedTraffic;
            }
        }
        if (b.entanglement !== a.entanglement) {
            return b.entanglement - a.entanglement;
        }
        return memberKey(a.member).localeCompare(memberKey(b.member));
    });
    return sorted[0];
}
