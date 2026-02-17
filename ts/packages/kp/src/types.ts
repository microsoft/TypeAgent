// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * kp — Lightweight Knowledge Processor
 *
 * Core types for keyword-based text indexing with dictionary enrichment.
 * Designed to be application-agnostic: works for email, podcasts, documents, etc.
 * Metadata columns (sender, speaker, location) are configurable per application.
 */

// =========================================================================
// Chunk Storage
// =========================================================================

/**
 * A chunk of text with configurable metadata.
 * The basic unit of indexing and retrieval.
 */
export interface TextChunk {
    /** Unique chunk identifier */
    chunkId: number;
    /** The text content */
    text: string;
    /**
     * Application-defined metadata columns.
     * Keys are column names (e.g. "sender", "speaker", "location").
     * Values can be multi-valued (e.g. multiple recipients).
     */
    metadata: Record<string, string[]>;
    /** Group this chunk belongs to (thread, section, episode) */
    groupId?: string;
    /** ISO timestamp for temporal queries */
    timestamp?: string;
}

/**
 * A labeled range of chunks (email thread, document section, podcast episode).
 * Group IDs and labels are also indexed as keywords in the inverted index.
 */
export interface ChunkGroup {
    groupId: string;
    /** Application-defined group type: "thread", "section", "episode", etc. */
    groupType: string;
    /** Human-readable label: "Re: Budget Discussion", "Chapter 3", etc. */
    label?: string;
    /** Ordered chunk IDs in this group */
    chunkIds: number[];
    /** Time span of this group (derived from chunk timestamps) */
    timeRange?: TimeRange;
    /** Group-level metadata (e.g. thread participants, section heading) */
    metadata: Record<string, string[]>;
}

export interface TimeRange {
    start?: string;
    end?: string;
}

// =========================================================================
// Application Schema
// =========================================================================

/**
 * Defines the metadata schema for an application.
 * The query planner LLM receives this so it knows which columns to filter on.
 */
export interface MetadataSchema {
    /** Column names and descriptions (e.g. { sender: "email sender address" }) */
    columns: MetadataColumnDef[];
    /** What groups are called in this application */
    groupType: string;
    /** Which metadata field contains the group ID */
    groupIdField: string;
}

export interface MetadataColumnDef {
    /** Column name used in metadata records */
    name: string;
    /** Human-readable description for the LLM query planner */
    description: string;
    /** Whether this column supports domain-style matching (e.g. *@amazon.com) */
    isDomain?: boolean;
}

// =========================================================================
// Inverted Index
// =========================================================================

export interface ScoredChunkRef {
    chunkId: number;
    score: number;
}

/**
 * Inverted index: keyword → chunk locations with scores.
 */
export interface IInvertedIndex {
    addTerm(term: string, chunkId: number, score?: number): void;
    lookupTerm(term: string): ScoredChunkRef[] | undefined;
    getTerms(): string[];
    getTermCount(): number;
    removeTerm(term: string, chunkId: number): void;
}

// =========================================================================
// Related Terms (Dictionary Enrichment)
// =========================================================================

export interface RelatedTerm {
    term: string;
    /** Relationship type: "synonym", "type", "inference", "domain", "alias" */
    relation: RelationType;
    /** Optional weight (default 1.0) */
    weight?: number;
}

export type RelationType =
    | "synonym"
    | "type"
    | "inference"
    | "domain"
    | "alias";

/**
 * Dictionary entry for an enriched term.
 * Built by processing the vocabulary with an LLM (once, not per chunk).
 *
 * Note: lemmatization is handled as a normalization step (like lowercasing),
 * applied at both index time and query time. The inverted index stores
 * lemmatized terms directly. The dictionary stores the lemma so we know
 * the canonical form, but there's no need for lemma→original mappings
 * in the related terms map.
 */
export interface DictionaryEntry {
    /** The original term as it appears in the corpus */
    term: string;
    /** Lemmatized form — used as the index key (e.g. "running" → "run") */
    lemma: string;
    /** Part of speech hint */
    pos?: "noun" | "verb" | "adjective" | "proper_noun" | "phrase";
    /** Related terms (synonyms, type hierarchy, inferences — NOT lemmas) */
    relatedTerms: RelatedTerm[];
    /** Entity type if this is a proper noun (e.g. "person", "company", "product") */
    entityType?: string;
    /** Parent types via IS-A inference (e.g. artist → ["person", "celebrity"]) */
    parentTypes?: string[];
}

/**
 * The enriched dictionary: vocabulary with lemmas, synonyms, entity types.
 */
export interface IDictionary {
    lookup(term: string): DictionaryEntry | undefined;
    getEntries(): DictionaryEntry[];
    addEntry(entry: DictionaryEntry): void;
    getEntryCount(): number;
}

/**
 * Related terms map: term → expanded terms for query expansion.
 */
export interface IRelatedTermsMap {
    lookup(term: string): RelatedTerm[] | undefined;
    add(term: string, related: RelatedTerm[]): void;
    getTermCount(): number;
}

// =========================================================================
// Metadata Index
// =========================================================================

/**
 * Generic metadata index: column + value → chunk IDs.
 * Works for any configurable column (sender, speaker, location, etc.).
 */
export interface IMetadataIndex {
    addEntry(column: string, value: string, chunkId: number): void;
    lookup(column: string, value: string): Set<number> | undefined;
    lookupContains(column: string, substring: string): Set<number>;
    lookupDomain(column: string, domain: string): Set<number>;
    getColumns(): string[];
    getValues(column: string): string[];
}

// =========================================================================
// Group & Temporal Index
// =========================================================================

export interface IGroupIndex {
    addGroup(group: ChunkGroup): void;
    getGroup(groupId: string): ChunkGroup | undefined;
    getGroupsByType(groupType: string): ChunkGroup[];
    /** Get all groups */
    getAllGroups(): ChunkGroup[];
    /** Get groups that overlap with a time range */
    getGroupsInTimeRange(range: TimeRange): ChunkGroup[];
    /** Get all chunk IDs for a set of groups */
    getChunkIdsForGroups(groupIds: string[]): Set<number>;
}

// =========================================================================
// Virtual Contacts
// =========================================================================

/**
 * A contact built from observed patterns (email senders, etc.).
 */
export interface VirtualContact {
    /** Display name (e.g. "Bob Smith") */
    name: string;
    /** Known aliases and name variants */
    aliases: string[];
    /** Associated identifiers (email addresses, domains) */
    identifiers: string[];
    /** Domains associated with this contact (e.g. "amazon.com") */
    domains: string[];
}

export interface IContactIndex {
    addContact(contact: VirtualContact): void;
    resolve(nameOrAlias: string): VirtualContact | undefined;
    getContacts(): VirtualContact[];
}

// =========================================================================
// Query Plan (LLM generates this via TypeChat)
// =========================================================================

/**
 * A structured query plan generated by an LLM from the user's natural language query.
 * The query engine executes this plan against the indexes.
 */
export interface QueryPlan {
    /** What kind of answer the user expects */
    intent: "factual" | "summary" | "list" | "recall";

    /**
     * Metadata filters — narrow the search space using structured fields.
     * Column names come from the application's MetadataSchema.
     */
    metadataFilters?: MetadataFilter[];

    /** Temporal scope */
    timeRange?: TimeRange;

    /** Group-level filters (e.g. find chunks within matching threads/sections) */
    groupFilters?: GroupFilter[];

    /**
     * Content search terms.
     * Each term will be expanded via the dictionary (lemmas, synonyms, related).
     */
    searchTerms: SearchTerm[];

    /** How to combine search terms */
    combineOp: "and" | "or";

    /** Maximum results to return */
    maxResults?: number;
}

export interface MetadataFilter {
    /** Column name from the application schema (e.g. "sender", "speaker") */
    column: string;
    /** Value to match */
    value: string;
    /** Match operation */
    op: "equals" | "contains" | "domain";
}

export interface GroupFilter {
    /** Filter by group type */
    groupType?: string;
    /** Substring match on group label */
    label?: string;
}

export interface SearchTerm {
    /** The term from the user's query */
    term: string;
    /** Whether to expand via dictionary enrichment (default true) */
    expandRelated?: boolean;
    /** Importance weight (default 1.0) */
    weight?: number;
}

// =========================================================================
// Search Results
// =========================================================================

export interface SearchResult {
    /** Chunks matching the query, scored and ranked */
    chunks: ScoredChunkResult[];
    /** Which terms matched (for highlighting/debugging) */
    matchedTerms: string[];
    /** The expanded terms used (for debugging) */
    expandedTerms?: Map<string, string[]>;
    /** Total chunks considered */
    totalConsidered: number;
}

export interface ScoredChunkResult {
    chunkId: number;
    score: number;
    /** The chunk text (fetched on demand from storage) */
    text?: string;
    /** Chunk metadata */
    metadata?: Record<string, string[]>;
    /** Group this chunk belongs to */
    groupId?: string;
}

// =========================================================================
// Index Store (top-level container)
// =========================================================================

/**
 * Configuration for creating or opening an index.
 */
export interface IndexConfig {
    /** Name of this index (used for storage directory naming) */
    name: string;
    /** Base storage path (default: ~/.typeagent/kp/) */
    storagePath?: string;
    /** Application metadata schema */
    schema: MetadataSchema;
}

/**
 * Serializable state for JSON persistence (the "hot" in-memory data).
 */
export interface IndexState {
    /** Inverted index data */
    invertedIndex: { term: string; refs: ScoredChunkRef[] }[];
    /** Dictionary entries */
    dictionary: DictionaryEntry[];
    /** Related terms map */
    relatedTerms: { term: string; related: RelatedTerm[] }[];
    /** Virtual contacts */
    contacts: VirtualContact[];
    /** Last indexed watermark (application-specific, e.g. Gmail historyId) */
    watermark?: string;
    /** Index metadata */
    meta: {
        name: string;
        schemaVersion: number;
        createdAt: string;
        updatedAt: string;
        chunkCount: number;
        termCount: number;
    };
}
