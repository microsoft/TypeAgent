// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TrustTier } from "./trust.js";

/** Stable identifier type for memory objects. */
export type Id = string;

/**
 * A pointer back to the exact source turn/segment an observation came from.
 * Provenance is what lets recall quote the original instead of hallucinating.
 */
export interface Provenance {
    sourceId: Id; // e.g. conversation id
    turnIndex?: number; // index of the turn within the source
    speaker?: string; // who produced the source content
    quote?: string; // verbatim text snippet, when available
}

/**
 * Append-only record of something the system was told or inferred.
 * Canonical state (episodes, beliefs) is a fold over observations,
 * so the log can always be replayed or repaired.
 */
export interface Observation {
    id: Id;
    feeder: string; // which feeder produced it
    payload: unknown; // feeder-specific normalized content
    confidence: number; // 0..1
    trustTier: TrustTier;
    provenance: Provenance;
    timestamp: number; // epoch ms
}

/** A single salient claim captured within an episode. */
export interface Claim {
    speaker: string;
    text: string;
    provenance: Provenance;
}

/**
 * A compressed conversation segment, indexed on four cue axes so fuzzy
 * "remember when we were doing X" queries can resolve by any axis.
 */
export interface Episode {
    id: Id;
    topic: string; // cue axis: topic
    participants: string[]; // cue axis: participant/role
    timestamp: number; // cue axis: time
    actionIntent?: string; // cue axis: action-intent
    claims: Claim[];
    decisions: string[];
    observationIds: Id[]; // provenance back to the log
}

/**
 * A versioned belief. Corrections never delete prior versions; they add a
 * new version and link the old one via `supersededById`.
 */
export interface Belief {
    id: Id;
    subject: string;
    predicate: string;
    value: string;
    version: number;
    trustTier: TrustTier;
    confidence: number;
    reason?: string; // why this version exists (e.g. "user correction")
    supersededById?: Id; // set on the older version when replaced
    observationId: Id; // provenance
    timestamp: number;
}

/** A single ranked recall hit, always carrying confidence + provenance. */
export interface RecallItem {
    kind: "episode" | "belief";
    id: Id;
    score: number;
    confidence: number;
    provenance: Provenance[];
    summary: string;
}

export interface RecallResult {
    query: string;
    items: RecallItem[];
    /** Conflicting beliefs surfaced rather than silently collapsed. */
    conflicts: ConflictNote[];
}

export interface ConflictNote {
    subject: string;
    predicate: string;
    candidates: { value: string; confidence: number; beliefId: Id }[];
}
