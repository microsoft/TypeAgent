// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * kp — Lightweight Knowledge Processor
 *
 * Keyword-based text indexing with dictionary enrichment.
 * Build an inverted index from text chunks, then enrich the vocabulary
 * with an LLM (once, on the dictionary, not per chunk).
 */

// Core types
export {
    TextChunk,
    ChunkGroup,
    TimeRange,
    MetadataSchema,
    MetadataColumnDef,
    ScoredChunkRef,
    IInvertedIndex,
    RelatedTerm,
    RelationType,
    DictionaryEntry,
    IDictionary,
    IRelatedTermsMap,
    IMetadataIndex,
    IGroupIndex,
    VirtualContact,
    IContactIndex,
    QueryPlan,
    MetadataFilter,
    GroupFilter,
    SearchTerm,
    SearchResult,
    ScoredChunkResult,
    IndexConfig,
    IndexState,
} from "./types.js";

// Inverted index
export { InvertedIndex } from "./invertedIndex.js";

// Keyword extraction
export { extractKeywords, ExtractedKeyword } from "./keywordExtractor.js";

// Dictionary and related terms
export { Dictionary, RelatedTermsMap } from "./relatedTerms.js";

// Metadata index
export { MetadataIndex } from "./metadataIndex.js";

// Group index
export { GroupIndex } from "./groupIndex.js";

// Query engine
export { QueryEngine } from "./queryEngine.js";

// LLM enrichment
export { enrichVocabulary, EnrichmentConfig } from "./llmEnrichment.js";

// Index builder (orchestration)
export {
    buildIndex,
    indexChunksIncremental,
    BuildResult,
    BuildStats,
    IncrementalStats,
} from "./indexBuilder.js";

// Storage (SQLite + JSON persistence)
export {
    ChunkStore,
    saveIndexState,
    loadIndexState,
} from "./storage.js";

// Answer generation (RAG)
export {
    generateAnswer,
    AnswerGeneratorConfig,
    AnswerContext,
    ChunkContent,
    AnswerResult,
} from "./answerGenerator.js";
