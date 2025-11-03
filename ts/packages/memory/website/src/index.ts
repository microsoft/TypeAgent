// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Core types and interfaces (keep for external compatibility)
export {
    ExtractionMode,
    WebsiteContent,
    PageContent,
    MetaTagCollection,
    ImageInfo,
    LinkInfo,
    ActionInfo,
    StructuredDataCollection,
    WebsiteContentWithKnowledge,
    KnowledgeQualityMetrics,
} from "./extraction/types.js";

export * from "./importWebsites.js";
export * from "./indexingService.js";
export * from "./websiteCollection.js";
export * from "./websiteDocPart.js";
export * from "./websiteDocPartMeta.js";
export * from "./tables.js";
export * from "./websiteMeta.js";

export {
    BatchProcessor,
    ContentExtractor,
    ExtractionConfig,
    ExtractionInput,
    ExtractionResult,
    ExtractionQualityMetrics,
    EXTRACTION_MODE_CONFIGS,
    BatchProgress,
    BatchError,
    AIModelRequiredError,
    AIExtractionFailedError,
    getEffectiveConfig,
    ActionSummary,
    DetectedAction,
    EntityFacet,
    TopicCorrelation,
    TemporalContext,
    ExtractionOptions,
} from "./extraction/index.js";

export { HtmlFetcher, FetchResult } from "./htmlFetcher.js";

// JSON Storage and Migration System
export { GraphJsonStorageManager } from "./storage/graphJsonStorage.js";
export { SqliteToJsonConverter } from "./converters/sqliteToJson.js";
export { JsonToGraphologyConverter } from "./converters/jsonToGraphology.js";
export { SqliteToJsonMigrator } from "./migration/sqliteToJsonMigrator.js";
export { EntityGraphQueries } from "./queries/entityGraphQueries.js";
export { TopicGraphQueries } from "./queries/topicGraphQueries.js";

// Export types from JSON storage system
export type {
    EntityGraphJson,
    TopicGraphJson,
    GraphStorageMetadata
} from "./storage/graphJsonStorage.js";

export type {
    WebsiteCollection as SqliteWebsiteCollection
} from "./converters/sqliteToJson.js";

export type {
    MigrationResult,
    MigrationOptions
} from "./migration/sqliteToJsonMigrator.js";
