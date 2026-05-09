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

export interface PhraseSample {
    phrase: string;
    model?: string | undefined;
    style?: string | undefined;
}

export interface MisrouteEdgeEvidence {
    from: string;
    to: string;
    count: number;
    /** Up to N example phrases that produced this edge. */
    samples?: PhraseSample[] | undefined;
}

export interface NeighborhoodEvidence {
    /** From cross-schema similarity clustering, if any. */
    similarityScore?: number | undefined;
    similarityStrategy?: string | undefined;
    /** From corpus probe MISROUTE edges, if any. */
    misrouteCount?: number | undefined;
    /** Per-edge counts (expected → actual, count) plus sample phrases. */
    misrouteEdges?: MisrouteEdgeEvidence[] | undefined;
    /** Per-verdict roll-up for actions in this neighborhood. */
    sourceVerdicts?:
        | { CLEAN?: number; TIGHT?: number; MISROUTE?: number; ERROR?: number }
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
    minMisrouteCount: number;
    includeSameSchema: boolean;
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
}
