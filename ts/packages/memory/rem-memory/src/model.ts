// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Core domain model for REM (Recall Engram Memory).
//
// These are pure data types with no storage dependency. The RDF store and the
// SQLite signal store are two projections of these concepts:
//   - RDF is authoritative for *existence* (entities, relations, provenance).
//   - SQLite is authoritative for *signal* (decaying weight per relation).

/**
 * Provenance trust tiers, ordered from most to least authoritative. A higher
 * tier may overwrite a lower one; a lower tier may not contradict a higher one.
 */
export enum TrustTier {
    /** Asserted directly by the user ("remember that X"). Highest authority. */
    UserAsserted = "user_asserted",
    /** Observed by a tool/agent action with concrete evidence. */
    ToolObserved = "tool_observed",
    /** Inferred by the knowledge-extraction feeder from text. */
    ExtractorInferred = "extractor_inferred",
    /** Inferred from an external source (e.g. enrichment). Lowest authority. */
    ExternalInferred = "external_inferred",
}

/** Numeric ranking of a trust tier; higher is more authoritative. */
export function trustTierRank(tier: TrustTier): number {
    switch (tier) {
        case TrustTier.UserAsserted:
            return 3;
        case TrustTier.ToolObserved:
            return 2;
        case TrustTier.ExtractorInferred:
            return 1;
        case TrustTier.ExternalInferred:
            return 0;
    }
}

/** A single named attribute attached to an entity (mirrors a kpLib Facet). */
export type Facet = {
    name: string;
    value: string | number | boolean;
};

/**
 * A canonical entity in the memory graph. The `id` is REM-minted and stable;
 * raw extractor entity names/types are noisy and are folded into `aliases` and
 * `types` by the resolver.
 */
export type Entity = {
    /** Stable REM-minted canonical id (e.g. "rem:entity/<uuid>"). */
    id: string;
    /** Canonical display name. */
    name: string;
    /** Other surface forms that resolve to this entity. */
    aliases: string[];
    /** Free-text, multi-valued types (from extractor + user). */
    types: string[];
    /** Attribute facets. */
    facets: Facet[];
};

/**
 * A directed, reified relation between two entities (subject -predicate-> object).
 * Reification lets each relation carry its own provenance and decay signal.
 */
export type Relation = {
    /** Stable REM-minted relation id (e.g. "rem:relation/<uuid>"). */
    id: string;
    /** Subject entity id. */
    subjectId: string;
    /** Predicate label (free text, e.g. "works_at", "located_in"). */
    predicate: string;
    /** Object entity id. */
    objectId: string;
};

/**
 * A single feeder output: the raw, pre-resolution claim that something is true.
 * Ingestion resolves the entity references, writes RDF, and seeds signal rows.
 */
export type Observation = {
    /** Feeder that produced this observation (e.g. "knowledge-extraction"). */
    feeder: string;
    /** Trust tier of the producing feeder. */
    tier: TrustTier;
    /** When the observation was made (epoch ms). */
    timestamp: number;
    /** Feeder confidence in [0, 1], if available. */
    confidence?: number | undefined;
    /** Source reference (message id, document blob id, url, etc.). */
    source?: string | undefined;
    /** Entities asserted by this observation (pre-resolution surface forms). */
    entities: ObservedEntity[];
    /** Relations asserted by this observation (by surface form). */
    relations: ObservedRelation[];
};

/** An entity as seen by a feeder, before identity resolution. */
export type ObservedEntity = {
    name: string;
    types: string[];
    facets?: Facet[] | undefined;
};

/** A relation as seen by a feeder, referencing entities by surface name. */
export type ObservedRelation = {
    subject: string;
    predicate: string;
    object: string;
};

/** Live decay signal for a relation, read from the SQLite signal store. */
export type RelationSignal = {
    relationId: string;
    /** Current decayed weight at read time. */
    weight: number;
    /** Last time the relation was reinforced or accessed (epoch ms). */
    lastSeen: number;
};

/** A single recall hit: a relation plus its entities, provenance, and weight. */
export type RecallResult = {
    relation: Relation;
    subject: Entity;
    object: Entity;
    /** Highest-tier provenance backing this relation. */
    tier: TrustTier;
    /** Current decayed weight. */
    weight: number;
};
