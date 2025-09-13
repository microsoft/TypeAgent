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
