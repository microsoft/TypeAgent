// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared types for the ambiguity-action-neighborhoods feature. Phase 0 (preview)
// only uses the in-memory shapes; Phases 1+ persist them to JSON via the same
// types. See `docs/architecture/collision-rollout.md` for the design.

export interface NeighborhoodMember {
    schemaName: string;
    actionName: string;
}

export type NeighborhoodKind = "cross-schema" | "same-schema";

/**
 * Cross-tabulated verdict from joining the embedding-ranker probe with the
 * (planned) translator probe. Populated when translator-corpus data is merged
 * in; undefined for ranker-only data.
 */
export type CrossVerdict = "CONFIRMED" | "RESCUED" | "NEW_FAILURE" | "CLEAN";

export interface PhraseSample {
    phrase: string;
    model?: string | undefined;
    style?: string | undefined;
    /** Populated when translator-corpus data is merged in. */
    category?: CrossVerdict | undefined;
}

export interface MisrouteEdgeEvidence {
    from: string;
    to: string;
    /** Ranker-misroute frequency (the unbounded true count). */
    count: number;
    /** Up to N example phrases per category that produced this edge. */
    samples?: PhraseSample[] | undefined;
    /** Subset of `count` where the translator ALSO picked the wrong action. */
    translatorConfirmedCount?: number | undefined;
    /** Subset of `count` where the translator rescued (picked the correct action). */
    translatorRescuedCount?: number | undefined;
    /**
     * Per-style breakdown of count + translator counts. Keys are phrase
     * style names (e.g. "imperative", "casual", "typos"). Sums across all
     * keys reproduce the top-level fields. Populated when style data flows
     * through the merge; undefined for older artifacts. The viz uses this
     * for per-style filter toggling — without it, filtering samples by
     * style alone would understate the underlying counts.
     */
    countsByStyle?:
        | Record<
              string,
              {
                  count: number;
                  translatorConfirmedCount?: number | undefined;
                  translatorRescuedCount?: number | undefined;
              }
          >
        | undefined;
}

export interface NeighborhoodEvidence {
    /** From cross-schema similarity clustering, if any. */
    similarityScore?: number | undefined;
    similarityStrategy?: string | undefined;
    /** From corpus probe MISROUTE edges, if any. */
    misrouteCount?: number | undefined;
    /** Per-edge counts (expected → actual, count) plus sample phrases. */
    misrouteEdges?: MisrouteEdgeEvidence[] | undefined;
    /**
     * Edges discovered ONLY by the translator probe (ranker top-1 was clean
     * but the translator picked the wrong action — a NEW_FAILURE class). Kept
     * separate from `misrouteEdges` so the ranker-misroute contract stays
     * stable for downstream consumers.
     */
    translatorMisrouteEdges?: MisrouteEdgeEvidence[] | undefined;
    /** Per-verdict roll-up for actions in this neighborhood. */
    sourceVerdicts?:
        | { CLEAN?: number; TIGHT?: number; MISROUTE?: number; ERROR?: number }
        | undefined;
    /** Cross-tabulated ranker × translator verdict roll-up. */
    crossVerdicts?:
        | {
              CONFIRMED?: number;
              RESCUED?: number;
              NEW_FAILURE?: number;
              CLEAN?: number;
          }
        | undefined;
}

export interface Neighborhood {
    /** Stable slug (no spaces, safe to use as a key in URLs / file names). */
    id: string;
    kind: NeighborhoodKind;
    /** Sorted by `${schemaName}.${actionName}` for stable equality. */
    members: NeighborhoodMember[];
    evidence: NeighborhoodEvidence;
    /** Which sources contributed to this neighborhood. */
    sources: NeighborhoodSource[];
}

export type NeighborhoodSource = "similarity" | "corpus";

export interface NeighborhoodPreviewSources {
    similarityStrategy: string;
    similarityThreshold: number;
    corpusFile?: string | undefined;
    /** Optional translator-probe corpus file (planned future signal source). */
    translatorCorpusFile?: string | undefined;
    minMisrouteCount: number;
    includeSameSchema: boolean;
    /**
     * Per-category cap on `edge.samples`. Default 5 for backward-compatibility
     * with pre-translator data; with translator categories tagged, the worst
     * case grows to 4 × cap samples per edge. Operators can dial up via
     * `--samples-per-category` when triaging a heavy edge.
     */
    samplesPerCategoryCap?: number | undefined;
}

export interface NeighborhoodPreview {
    builtAt: string;
    sources: NeighborhoodPreviewSources;
    neighborhoods: Neighborhood[];
}

/** Duck-typed input for merge: one (expected → actual) edge with its count. */
export interface MisrouteEdge {
    expected: NeighborhoodMember;
    actual: NeighborhoodMember;
    count: number;
    /** Optional verdict roll-up across phrases that produced this edge. */
    sourceVerdicts?: NeighborhoodEvidence["sourceVerdicts"];
    /** Up to N sample phrases that produced this edge (capped by the caller). */
    samples?: PhraseSample[] | undefined;
    /** Per-style breakdown of count (and any translator-derived counts that
     *  flow in from a later merge step). Optional; when omitted, viz
     *  filtering by style falls back to sample-level filtering only. */
    countsByStyle?: MisrouteEdgeEvidence["countsByStyle"];
}
