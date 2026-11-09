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
export * from "./websiteMeta.js";

export {
    ContentExtractor,
    ExtractionConfig,
    ExtractionInput,
    ExtractionResult,
    ExtractionQualityMetrics,
    EXTRACTION_MODE_CONFIGS,
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
