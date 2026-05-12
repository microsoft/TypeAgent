// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pure merge logic: similarity clusters + corpus misroute edges → neighborhoods.
// This is the Phase 0 / Phase 1 shared engine. The preview command runs it
// in-memory; the build command runs it and persists the result.
//
// No I/O. No dispatcher state. Just data in, neighborhoods out.

import type { ActionCluster } from "../translation/actionSimilarity.js";
import type {
    MisrouteEdge,
    MisrouteEdgeEvidence,
    Neighborhood,
    NeighborhoodEvidence,
    NeighborhoodKind,
    NeighborhoodMember,
    NeighborhoodPreview,
    NeighborhoodPreviewSources,
    NeighborhoodSource,
    PhraseSample,
} from "./types.js";

/** Dedupe by phrase text (case-insensitive); keep first up to `cap`. */
function dedupeSamples(
    samples: PhraseSample[],
    cap: number,
): PhraseSample[] | undefined {
    if (samples.length === 0) return undefined;
    const seen = new Set<string>();
    const out: PhraseSample[] = [];
    for (const s of samples) {
        const k = s.phrase.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(s);
        if (out.length >= cap) break;
    }
    return out.length > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function memberKey(m: NeighborhoodMember): string {
    return `${m.schemaName}.${m.actionName}`;
}

function membersToSortedArray(set: Set<string>): NeighborhoodMember[] {
    return [...set]
        .sort()
        .map((key) => {
            const idx = key.indexOf(".");
            return {
                schemaName: key.slice(0, idx),
                actionName: key.slice(idx + 1),
            };
        });
}

function deriveKind(members: NeighborhoodMember[]): NeighborhoodKind {
    const schemas = new Set(members.map((m) => m.schemaName));
    return schemas.size === 1 ? "same-schema" : "cross-schema";
}

/** Canonical member-set key for equality (sorted full-names joined). */
function memberSetKey(members: NeighborhoodMember[]): string {
    return members.map(memberKey).sort().join("|");
}

/** Number of shared members between two neighborhood candidates. */
function sharedCount(a: NeighborhoodMember[], b: NeighborhoodMember[]): number {
    const aSet = new Set(a.map(memberKey));
    let n = 0;
    for (const m of b) {
        if (aSet.has(memberKey(m))) n++;
    }
    return n;
}

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

function sanitizeForSlug(s: string): string {
    return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Human-readable, stable, file-safe id. Collisions resolved by trailing hash. */
function neighborhoodSlug(members: NeighborhoodMember[]): string {
    const sorted = [...members].sort((a, b) =>
        memberKey(a).localeCompare(memberKey(b)),
    );
    const first = sorted[0];
    const second = sorted[1];
    let label: string;
    if (sorted.length === 1) {
        label = `${first.schemaName}.${first.actionName}`;
    } else if (sorted.length === 2) {
        if (first.schemaName === second.schemaName) {
            label = `${first.schemaName}.${first.actionName}--${second.actionName}`;
        } else {
            label = `${first.schemaName}--${second.schemaName}.${first.actionName}`;
        }
    } else {
        // 3+ members: anchor on the first two and append a count suffix.
        label = `${first.schemaName}.${first.actionName}--${second.schemaName}.${second.actionName}+${sorted.length - 2}`;
    }
    return sanitizeForSlug(label);
}

// ---------------------------------------------------------------------------
// Source: similarity clusters
// ---------------------------------------------------------------------------

interface Candidate {
    members: NeighborhoodMember[];
    evidence: NeighborhoodEvidence;
    sources: Set<NeighborhoodSource>;
}

function similarityClustersToCandidates(
    clusters: ActionCluster[],
    similarityStrategy: string,
): Candidate[] {
    return clusters.map((cluster) => {
        const members: NeighborhoodMember[] = cluster.members.map((m) => ({
            schemaName: m.schemaName,
            actionName: m.actionName,
        }));
        return {
            members,
            evidence: {
                similarityScore: cluster.topPair.aggregateScore,
                similarityStrategy,
            },
            sources: new Set<NeighborhoodSource>(["similarity"]),
        };
    });
}

// ---------------------------------------------------------------------------
// Source: corpus misroute edges → 2-member pseudo-clusters
// ---------------------------------------------------------------------------

/** Lookup function for raw pair similarity scores. Returns undefined when the
 *  pair is below the scan's `keepThreshold` (effectively no similarity
 *  signal) OR when the engine doesn't compute the pair at all (same-schema
 *  pairs, since the scan is cross-schema only). */
export type PairScoreLookup = (
    a: NeighborhoodMember,
    b: NeighborhoodMember,
) => number | undefined;

/**
 * Each corpus misroute edge → its own 2-member pseudo-cluster. Edges below
 * `minMisrouteCount` are dropped. Same-schema edges only included if
 * `includeSameSchema` is true.
 *
 * We deliberately do NOT union-find here. A naive union over all edges
 * collapses unrelated actions into giant components via "magnet" target
 * actions (e.g. `desktop.SetVolumeAction` absorbs many wrong routes from
 * unrelated source actions, dragging them all into one mega-cluster). The
 * downstream merge step (≥2 shared members) correctly fuses bidirectional
 * pairs (A→B and B→A both present → one {A, B} candidate after merge by
 * canonical member-set) and lets similarity clusters absorb related pairs
 * when they truly share ≥2 members. Cliques of mutually-confusable actions
 * are surfaced via the similarity scan rather than the corpus side.
 *
 * If `pairScoreLookup` is provided, each corpus candidate is also tagged
 * with `similarity` source whenever its two members have a raw pair score
 * at or above `confirmThreshold`. This catches the case where the corpus
 * surfaces a real ambiguity that the similarity scan also "saw" (its
 * pair score is above 0.5 keepThreshold) but didn't form a cluster around
 * (its score was below the cluster threshold of 0.78). Same-schema corpus
 * pairs never get the similarity tag because the engine doesn't score
 * same-schema pairs.
 */
function corpusEdgesToCandidates(
    edges: MisrouteEdge[],
    opts: {
        minMisrouteCount: number;
        includeSameSchema: boolean;
        pairScoreLookup?: PairScoreLookup | undefined;
        confirmThreshold: number;
        similarityStrategy: string;
    },
): Candidate[] {
    const filtered = edges.filter((e) => {
        if (e.count < opts.minMisrouteCount) return false;
        if (
            !opts.includeSameSchema &&
            e.expected.schemaName === e.actual.schemaName
        ) {
            return false;
        }
        // Self-edges (A→A) carry no signal; skip.
        if (memberKey(e.expected) === memberKey(e.actual)) return false;
        return true;
    });

    return filtered.map((e) => {
        const verdictRollup:
            | NonNullable<NeighborhoodEvidence["sourceVerdicts"]>
            | undefined = e.sourceVerdicts
            ? { ...e.sourceVerdicts }
            : undefined;

        // Look up the raw pair similarity score (cross-schema only). If the
        // engine has any score for the pair at or above `confirmThreshold`,
        // tag this candidate as similarity-supported AND record the score so
        // the viz can show it.
        const sources = new Set<NeighborhoodSource>(["corpus"]);
        let similarityScore: number | undefined;
        let similarityStrategy: string | undefined;
        if (opts.pairScoreLookup) {
            const score = opts.pairScoreLookup(e.expected, e.actual);
            if (score !== undefined && score >= opts.confirmThreshold) {
                sources.add("similarity");
                similarityScore = score;
                similarityStrategy = opts.similarityStrategy;
            }
        }

        return {
            members: membersToSortedArray(
                new Set([memberKey(e.expected), memberKey(e.actual)]),
            ),
            evidence: {
                misrouteCount: e.count,
                misrouteEdges: [
                    {
                        from: memberKey(e.expected),
                        to: memberKey(e.actual),
                        count: e.count,
                        samples: e.samples,
                        ...(e.countsByStyle && {
                            countsByStyle: e.countsByStyle,
                        }),
                    },
                ],
                sourceVerdicts: verdictRollup,
                similarityScore,
                similarityStrategy,
            },
            sources,
        };
    });
}

// ---------------------------------------------------------------------------
// Merge candidates by member-set equivalence (≥2 shared members)
// ---------------------------------------------------------------------------

/** Default sample cap (per category, when category data is present). */
// Effectively unlimited — every sample flows through. The viz uses
// progressive disclosure (initial N + "load more") to keep rendered DOM
// lean while making all samples reachable on demand. Keeping the cap
// configurable in case anyone wants to clamp it for a specific run.
const DEFAULT_SAMPLES_PER_CATEGORY_CAP = Number.MAX_SAFE_INTEGER;

function mergeCandidates(
    candidates: Candidate[],
    samplesCap: number,
): Candidate[] {
    // Stable iteration: process in deterministic order.
    const items = [...candidates].sort((a, b) =>
        memberSetKey(a.members).localeCompare(memberSetKey(b.members)),
    );
    const merged: Candidate[] = [];
    for (const cand of items) {
        const target = merged.find(
            (m) => sharedCount(m.members, cand.members) >= 2,
        );
        if (target) {
            // Union members.
            const memberSet = new Set(target.members.map(memberKey));
            for (const m of cand.members) memberSet.add(memberKey(m));
            target.members = membersToSortedArray(memberSet);
            // Merge evidence.
            target.evidence = mergeEvidence(
                target.evidence,
                cand.evidence,
                samplesCap,
            );
            // Merge sources.
            for (const s of cand.sources) target.sources.add(s);
        } else {
            merged.push({
                members: [...cand.members],
                evidence: { ...cand.evidence },
                sources: new Set(cand.sources),
            });
        }
    }
    return merged;
}

/**
 * Capped, category-aware sample merge. When samples carry `category` (set by
 * the translator-merge pass), each category gets its own up-to-`cap` slot so
 * one heavy category can't crowd out the others. When samples are uncategorized
 * (today's data), behaves like the original `dedupeSamples(..., cap)` call.
 */
function mergeSamples(
    samples: PhraseSample[],
    cap: number,
): PhraseSample[] | undefined {
    const hasCategory = samples.some((s) => s.category !== undefined);
    if (!hasCategory) {
        return dedupeSamples(samples, cap);
    }
    const buckets = new Map<string, PhraseSample[]>();
    for (const s of samples) {
        const k = s.category ?? "_uncategorized";
        const list = buckets.get(k) ?? [];
        list.push(s);
        buckets.set(k, list);
    }
    const out: PhraseSample[] = [];
    for (const list of buckets.values()) {
        const capped = dedupeSamples(list, cap);
        if (capped) out.push(...capped);
    }
    return out.length > 0 ? out : undefined;
}

function mergeEvidence(
    a: NeighborhoodEvidence,
    b: NeighborhoodEvidence,
    samplesCap: number,
): NeighborhoodEvidence {
    const out: NeighborhoodEvidence = { ...a };
    if (b.similarityScore !== undefined) {
        out.similarityScore = Math.max(
            a.similarityScore ?? 0,
            b.similarityScore,
        );
        out.similarityStrategy =
            a.similarityStrategy ?? b.similarityStrategy;
    }
    if (b.misrouteCount !== undefined) {
        out.misrouteCount = (a.misrouteCount ?? 0) + b.misrouteCount;
    }
    if (b.misrouteEdges) {
        out.misrouteEdges = mergeEdgeArrays(
            a.misrouteEdges,
            b.misrouteEdges,
            samplesCap,
        );
    }
    if (b.translatorMisrouteEdges) {
        out.translatorMisrouteEdges = mergeEdgeArrays(
            a.translatorMisrouteEdges,
            b.translatorMisrouteEdges,
            samplesCap,
        );
    }
    if (b.sourceVerdicts) {
        const v: NonNullable<NeighborhoodEvidence["sourceVerdicts"]> = {
            ...(a.sourceVerdicts ?? {}),
        };
        for (const k of ["CLEAN", "TIGHT", "MISROUTE", "ERROR"] as const) {
            const bv = b.sourceVerdicts[k];
            if (bv !== undefined) v[k] = (v[k] ?? 0) + bv;
        }
        out.sourceVerdicts = v;
    }
    if (b.crossVerdicts) {
        const v: NonNullable<NeighborhoodEvidence["crossVerdicts"]> = {
            ...(a.crossVerdicts ?? {}),
        };
        for (const k of [
            "CONFIRMED",
            "RESCUED",
            "NEW_FAILURE",
            "CLEAN",
        ] as const) {
            const bv = b.crossVerdicts[k];
            if (bv !== undefined) v[k] = (v[k] ?? 0) + bv;
        }
        out.crossVerdicts = v;
    }
    return out;
}

function mergeEdgeArrays(
    aEdges: MisrouteEdgeEvidence[] | undefined,
    bEdges: MisrouteEdgeEvidence[],
    samplesCap: number,
): MisrouteEdgeEvidence[] {
    const combined = [...(aEdges ?? []), ...bEdges];
    // Dedupe by (from, to); keep max count and union samples (capped).
    const byKey = new Map<string, MisrouteEdgeEvidence>();
    for (const e of combined) {
        const k = `${e.from}->${e.to}`;
        const existing = byKey.get(k);
        if (!existing) {
            byKey.set(k, e);
            continue;
        }
        const merged: MisrouteEdgeEvidence = {
            from: e.from,
            to: e.to,
            count: Math.max(existing.count, e.count),
            samples: mergeSamples(
                [...(existing.samples ?? []), ...(e.samples ?? [])],
                samplesCap,
            ),
        };
        const cc =
            (existing.translatorConfirmedCount ?? 0) +
            (e.translatorConfirmedCount ?? 0);
        if (cc > 0) merged.translatorConfirmedCount = cc;
        const rc =
            (existing.translatorRescuedCount ?? 0) +
            (e.translatorRescuedCount ?? 0);
        if (rc > 0) merged.translatorRescuedCount = rc;
        // Merge per-style breakdowns by summing each {count, translatorConfirmedCount,
        // translatorRescuedCount} for every style key seen on either side.
        const cs = mergeCountsByStyle(existing.countsByStyle, e.countsByStyle);
        if (cs) merged.countsByStyle = cs;
        byKey.set(k, merged);
    }
    return [...byKey.values()].sort((x, y) => y.count - x.count);
}

function mergeCountsByStyle(
    a: MisrouteEdgeEvidence["countsByStyle"],
    b: MisrouteEdgeEvidence["countsByStyle"],
): MisrouteEdgeEvidence["countsByStyle"] {
    if (!a && !b) return undefined;
    const out: NonNullable<MisrouteEdgeEvidence["countsByStyle"]> = {};
    const keys = new Set([
        ...Object.keys(a ?? {}),
        ...Object.keys(b ?? {}),
    ]);
    for (const k of keys) {
        const av = a?.[k];
        const bv = b?.[k];
        const count = (av?.count ?? 0) + (bv?.count ?? 0);
        const tcc =
            (av?.translatorConfirmedCount ?? 0) +
            (bv?.translatorConfirmedCount ?? 0);
        const trc =
            (av?.translatorRescuedCount ?? 0) +
            (bv?.translatorRescuedCount ?? 0);
        out[k] = {
            count,
            ...(tcc > 0 && { translatorConfirmedCount: tcc }),
            ...(trc > 0 && { translatorRescuedCount: trc }),
        };
    }
    return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildNeighborhoodPreviewOptions {
    /** Cross-schema clusters from `applyStrategy(scan, strategy, threshold)`. */
    similarityClusters: ActionCluster[];
    /** Strategy name for evidence stamping. */
    similarityStrategy: string;
    /** Threshold the similarity strategy ran at (used for cluster formation). */
    similarityThreshold: number;
    /**
     * Looks up the raw pair similarity score (under the same strategy) for
     * any cross-schema pair the scan computed. Used to tag corpus pairs that
     * have a similarity signal below the cluster threshold but above the
     * scan's keepThreshold. Same-schema pairs return undefined (the engine
     * doesn't compute them).
     */
    pairScoreLookup?: PairScoreLookup | undefined;
    /**
     * Minimum raw pair score for tagging a corpus pair as similarity-
     * supported. Should be ≤ `similarityThreshold`. Default 0.5 (matches
     * the scan's keepThreshold).
     */
    confirmThreshold?: number;
    /** Corpus misroute edges (cross- or same-schema). May be empty. */
    misrouteEdges: MisrouteEdge[];
    /** Path the corpus came from, for `sources.corpusFile` stamping. */
    corpusFile?: string | undefined;
    /** Drop edges with fewer occurrences than this. Default 2. */
    minMisrouteCount: number;
    /** If false, skip same-schema misroute edges entirely. */
    includeSameSchema: boolean;
    /**
     * Per-category cap on `edge.samples`. Defaults to 5. With translator data
     * present, samples are tagged by `category` and each category gets its
     * own up-to-`cap` slot (so the worst-case grows to ~4×cap per edge).
     */
    samplesPerCategoryCap?: number;
    /** Path the translator-probe corpus came from (for `sources` stamping). */
    translatorCorpusFile?: string | undefined;
}

export function buildNeighborhoodPreview(
    opts: BuildNeighborhoodPreviewOptions,
): NeighborhoodPreview {
    const simCandidates = similarityClustersToCandidates(
        opts.similarityClusters,
        opts.similarityStrategy,
    );
    const corpusCandidates = corpusEdgesToCandidates(opts.misrouteEdges, {
        minMisrouteCount: opts.minMisrouteCount,
        includeSameSchema: opts.includeSameSchema,
        pairScoreLookup: opts.pairScoreLookup,
        confirmThreshold: opts.confirmThreshold ?? 0.5,
        similarityStrategy: opts.similarityStrategy,
    });

    const samplesCap =
        opts.samplesPerCategoryCap ?? DEFAULT_SAMPLES_PER_CATEGORY_CAP;
    const merged = mergeCandidates(
        [...simCandidates, ...corpusCandidates],
        samplesCap,
    );

    // Convert merged candidates → Neighborhoods with slugs.
    const usedSlugs = new Set<string>();
    const neighborhoods: Neighborhood[] = merged.map((c) => {
        let slug = neighborhoodSlug(c.members);
        let suffix = 0;
        while (usedSlugs.has(slug)) {
            suffix++;
            slug = `${neighborhoodSlug(c.members)}_${suffix}`;
        }
        usedSlugs.add(slug);
        return {
            id: slug,
            kind: deriveKind(c.members),
            members: c.members,
            evidence: c.evidence,
            sources: [...c.sources].sort(),
        };
    });

    // Sort: bigger neighborhoods first; within same size, by similarity score
    // desc; then by id for stability.
    neighborhoods.sort((a, b) => {
        if (b.members.length !== a.members.length) {
            return b.members.length - a.members.length;
        }
        const sa = a.evidence.similarityScore ?? 0;
        const sb = b.evidence.similarityScore ?? 0;
        if (sb !== sa) return sb - sa;
        return a.id.localeCompare(b.id);
    });

    const sources: NeighborhoodPreviewSources = {
        similarityStrategy: opts.similarityStrategy,
        similarityThreshold: opts.similarityThreshold,
        corpusFile: opts.corpusFile,
        translatorCorpusFile: opts.translatorCorpusFile,
        minMisrouteCount: opts.minMisrouteCount,
        includeSameSchema: opts.includeSameSchema,
        samplesPerCategoryCap: samplesCap,
    };

    return {
        builtAt: new Date().toISOString(),
        sources,
        neighborhoods,
    };
}
