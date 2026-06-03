// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Cross-tabulated merge of translator-probe evidence onto an existing
// neighborhood set. Joins per-phrase ranker × translator outcomes to:
//
//   1. Decorate existing `misrouteEdges` (ranker-derived) with
//      `translatorConfirmedCount` and `translatorRescuedCount`.
//   2. Insert NEW_FAILURE edges (ranker-clean, translator-wrong) into
//      `translatorMisrouteEdges` so the existing `misrouteEdges` contract
//      stays stable for downstream consumers.
//   3. Tag each contributing `PhraseSample.category` with the joined
//      verdict so the viz can group/colour samples.
//   4. Roll up `crossVerdicts` per neighborhood.
//
// Cross-verdict definitions (see `types.ts:CrossVerdict`):
//   CONFIRMED   ranker MISROUTE + translator MISROUTE (any wrong pick)
//   RESCUED     ranker MISROUTE + translator CLEAN
//   NEW_FAILURE ranker CLEAN    + translator MISROUTE
//   CLEAN       ranker CLEAN    + translator CLEAN  (informational only)
//
// Translator outcomes other than CLEAN/MISROUTE (CLARIFY, INVALID, ERROR)
// are excluded from the cross-tab so they don't muddy the bookkeeping.
//
// **Pragmatic v1 scope.** NEW_FAILURE edges are attached only when *both*
// (expected) and (translator's chosen) are already members of an existing
// neighborhood (via similarity or corpus). Translator-only neighborhoods —
// pairs no other signal surfaced — are dropped with a count returned to
// the caller for transparency. Forming new neighborhoods from translator-
// only signal is a richer follow-up.

import type {
    Neighborhood,
    NeighborhoodEvidence,
    MisrouteEdgeEvidence,
    CrossVerdict,
} from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single phrase paired with both the ranker's top-1 pick and the
 *  translator's chosen action. The handler builds these by joining
 *  `probe-results-reclassified.json` with `translation-results.json` on
 *  `(expectedSchema, expectedAction, phraseText)`. */
export interface TranslatorProbeRecord {
    phrase: string;
    expectedSchema: string;
    expectedAction: string;
    rankerTop1Schema: string;
    rankerTop1Action: string;
    translatorSchema: string;
    translatorAction: string;
    /** Phrase provenance (model + style) — surfaced into samples for the viz. */
    sourceModel?: string | undefined;
    sourceStyle?: string | undefined;
}

export interface TranslatorMergeOptions {
    records?: TranslatorProbeRecord[] | undefined;
    /** Per-category cap on `evidence.translatorMisrouteEdges[].samples`.
     *  Mirrors the corpus-merge cap; default 5. */
    samplesPerCategoryCap?: number;
}

export interface TranslatorMergeStats {
    totalRecords: number;
    /** Records dropped because the (expected, ranker-top1) edge was not in
     *  any neighborhood (CONFIRMED/RESCUED case). */
    orphanedRankerEdges: number;
    /** Records dropped because the (expected, translator-chosen) pair was
     *  not in any neighborhood (NEW_FAILURE case). */
    orphanedTranslatorEdges: number;
    crossVerdicts: Record<CrossVerdict, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeAction(name: string): string {
    return name.replace(/Action$/i, "").toLowerCase();
}

function actionsMatch(s1: string, a1: string, s2: string, a2: string): boolean {
    return s1 === s2 && normalizeAction(a1) === normalizeAction(a2);
}

function classifyRecord(rec: TranslatorProbeRecord): CrossVerdict {
    const rankerClean = actionsMatch(
        rec.rankerTop1Schema,
        rec.rankerTop1Action,
        rec.expectedSchema,
        rec.expectedAction,
    );
    const translatorClean = actionsMatch(
        rec.translatorSchema,
        rec.translatorAction,
        rec.expectedSchema,
        rec.expectedAction,
    );
    if (rankerClean && translatorClean) return "CLEAN";
    if (!rankerClean && translatorClean) return "RESCUED";
    if (rankerClean && !translatorClean) return "NEW_FAILURE";
    return "CONFIRMED"; // both wrong (any pick); the misroute is real
}

function memberKey(schemaName: string, actionName: string): string {
    return `${schemaName}.${actionName}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Layer translator-probe-derived evidence onto an existing neighborhood set.
 * Returns the (mutated copy of) input; original neighborhoods are unchanged.
 *
 * Returns the input unchanged when `records` is undefined or empty.
 */
export function mergeTranslatorEvidence(
    neighborhoods: Neighborhood[],
    opts: TranslatorMergeOptions = {},
): Neighborhood[] {
    const records = opts.records ?? [];
    if (records.length === 0) return neighborhoods;

    const samplesCap = opts.samplesPerCategoryCap ?? 5;

    // Build a member-key → neighborhood index. A member can be in multiple
    // neighborhoods (e.g. a hub action that participates in several
    // similarity clusters). When that happens, all matching neighborhoods
    // get the evidence — the operator can disambiguate from the viz.
    const byMember = new Map<string, Set<Neighborhood>>();
    // Deep-clone evidence so we don't mutate the caller's neighborhoods.
    const out = neighborhoods.map((n): Neighborhood => {
        const cloned: Neighborhood = {
            ...n,
            evidence: {
                ...n.evidence,
                misrouteEdges: n.evidence.misrouteEdges?.map((e) => ({
                    ...e,
                    samples: e.samples?.map((s) => ({ ...s })),
                })),
                translatorMisrouteEdges:
                    n.evidence.translatorMisrouteEdges?.map((e) => ({
                        ...e,
                        samples: e.samples?.map((s) => ({ ...s })),
                    })),
                crossVerdicts: n.evidence.crossVerdicts
                    ? { ...n.evidence.crossVerdicts }
                    : undefined,
            },
        };
        for (const m of cloned.members) {
            const k = memberKey(m.schemaName, m.actionName);
            let set = byMember.get(k);
            if (!set) {
                set = new Set();
                byMember.set(k, set);
            }
            set.add(cloned);
        }
        return cloned;
    });

    const stats: TranslatorMergeStats = {
        totalRecords: records.length,
        orphanedRankerEdges: 0,
        orphanedTranslatorEdges: 0,
        crossVerdicts: {
            CONFIRMED: 0,
            RESCUED: 0,
            NEW_FAILURE: 0,
            CLEAN: 0,
        },
    };

    for (const rec of records) {
        const verdict = classifyRecord(rec);
        stats.crossVerdicts[verdict]++;

        // For CLEAN records there's nothing to attach to a specific edge —
        // the phrase neither produced a ranker-misroute nor a translator-
        // misroute. Skip; the global rollup is informational only.
        if (verdict === "CLEAN") continue;

        if (verdict === "CONFIRMED" || verdict === "RESCUED") {
            // Find the ranker-derived edge in any neighborhood whose members
            // include both (expected) and (rankerTop1).
            const expectedKey = memberKey(
                rec.expectedSchema,
                rec.expectedAction,
            );
            const rankerKey = memberKey(
                rec.rankerTop1Schema,
                rec.rankerTop1Action,
            );
            const hostNbhds = findNeighborhoodsWithBoth(
                byMember,
                expectedKey,
                rankerKey,
            );
            if (hostNbhds.size === 0) {
                stats.orphanedRankerEdges++;
                continue;
            }
            for (const nbhd of hostNbhds) {
                applyConfirmRescue(nbhd, rec, verdict, samplesCap);
            }
        } else {
            // NEW_FAILURE — translator picked wrong on a phrase the ranker
            // got right. Attach to neighborhoods that already contain both
            // (expected) and (translator-chosen). Pure translator-only pairs
            // are dropped with a stat for transparency.
            const expectedKey = memberKey(
                rec.expectedSchema,
                rec.expectedAction,
            );
            const translatorKey = memberKey(
                rec.translatorSchema,
                rec.translatorAction,
            );
            const hostNbhds = findNeighborhoodsWithBoth(
                byMember,
                expectedKey,
                translatorKey,
            );
            if (hostNbhds.size === 0) {
                stats.orphanedTranslatorEdges++;
                continue;
            }
            for (const nbhd of hostNbhds) {
                applyNewFailure(nbhd, rec, samplesCap);
            }
        }
    }

    return out;
}

function findNeighborhoodsWithBoth(
    byMember: Map<string, Set<Neighborhood>>,
    a: string,
    b: string,
): Set<Neighborhood> {
    const setA = byMember.get(a);
    const setB = byMember.get(b);
    const out = new Set<Neighborhood>();
    if (!setA || !setB) return out;
    for (const n of setA) {
        if (setB.has(n)) out.add(n);
    }
    return out;
}

function applyConfirmRescue(
    nbhd: Neighborhood,
    rec: TranslatorProbeRecord,
    verdict: "CONFIRMED" | "RESCUED",
    samplesCap: number,
) {
    const ev = nbhd.evidence;
    if (!ev.misrouteEdges) return; // similarity-only neighborhood, no ranker edges

    // Locate the matching ranker edge (expected → ranker-top1).
    const fromKey = memberKey(rec.expectedSchema, rec.expectedAction);
    const toKey = memberKey(rec.rankerTop1Schema, rec.rankerTop1Action);
    const edge = ev.misrouteEdges.find(
        (e) => e.from === fromKey && e.to === toKey,
    );
    if (!edge) return;

    if (verdict === "CONFIRMED") {
        edge.translatorConfirmedCount =
            (edge.translatorConfirmedCount ?? 0) + 1;
    } else {
        edge.translatorRescuedCount = (edge.translatorRescuedCount ?? 0) + 1;
    }
    bumpStyleCount(edge, rec.sourceStyle, verdict);

    bumpCrossVerdict(ev, verdict);
    tagSampleCategory(edge, rec, verdict, samplesCap);
}

function applyNewFailure(
    nbhd: Neighborhood,
    rec: TranslatorProbeRecord,
    samplesCap: number,
) {
    const ev = nbhd.evidence;
    if (!ev.translatorMisrouteEdges) ev.translatorMisrouteEdges = [];

    const fromKey = memberKey(rec.expectedSchema, rec.expectedAction);
    const toKey = memberKey(rec.translatorSchema, rec.translatorAction);
    let edge = ev.translatorMisrouteEdges.find(
        (e) => e.from === fromKey && e.to === toKey,
    );
    if (!edge) {
        edge = {
            from: fromKey,
            to: toKey,
            count: 0,
            samples: [],
        };
        ev.translatorMisrouteEdges.push(edge);
    }
    edge.count++;
    bumpStyleCount(edge, rec.sourceStyle, "NEW_FAILURE");
    bumpCrossVerdict(ev, "NEW_FAILURE");
    tagSampleCategory(edge, rec, "NEW_FAILURE", samplesCap);
}

/**
 * Increment the per-style counter on an edge for a given cross-verdict.
 * For NEW_FAILURE edges (translator-only), the per-style `count` itself
 * is bumped (the edge wouldn't exist otherwise). For CONFIRMED/RESCUED
 * (ranker edges that the translator confirmed or rescued), the per-style
 * translator count is bumped; the edge's per-style `count` was already
 * set by the corpus loader.
 */
function bumpStyleCount(
    edge: MisrouteEdgeEvidence,
    style: string | undefined,
    verdict: CrossVerdict,
) {
    if (!style) return;
    if (!edge.countsByStyle) edge.countsByStyle = {};
    let slot = edge.countsByStyle[style];
    if (!slot) {
        slot = { count: 0 };
        edge.countsByStyle[style] = slot;
    }
    if (verdict === "NEW_FAILURE") {
        slot.count = (slot.count ?? 0) + 1;
    } else if (verdict === "CONFIRMED") {
        slot.translatorConfirmedCount =
            (slot.translatorConfirmedCount ?? 0) + 1;
    } else if (verdict === "RESCUED") {
        slot.translatorRescuedCount = (slot.translatorRescuedCount ?? 0) + 1;
    }
}

function bumpCrossVerdict(ev: NeighborhoodEvidence, verdict: CrossVerdict) {
    if (!ev.crossVerdicts) ev.crossVerdicts = {};
    ev.crossVerdicts[verdict] = (ev.crossVerdicts[verdict] ?? 0) + 1;
}

function tagSampleCategory(
    edge: MisrouteEdgeEvidence,
    rec: TranslatorProbeRecord,
    category: CrossVerdict,
    samplesCap: number,
) {
    if (!edge.samples) edge.samples = [];

    // Try to tag an existing sample (matched by phrase text) without a
    // category yet. Otherwise append a new sample if there's room within
    // the per-category cap.
    const existing = edge.samples.find(
        (s) => s.phrase === rec.phrase && s.category === undefined,
    );
    if (existing) {
        existing.category = category;
        return;
    }

    const inCategory = edge.samples.filter(
        (s) => s.category === category,
    ).length;
    if (inCategory >= samplesCap) return;
    edge.samples.push({
        phrase: rec.phrase,
        model: rec.sourceModel,
        style: rec.sourceStyle,
        category,
    });
}
