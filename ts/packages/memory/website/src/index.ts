// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export * from "./chunkingUtils.js";

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
} from "./contentExtractor.js";

export {
    WebsiteImportOptions,
    defaultWebsiteImportOptions,
    importWebsite,
    importWebsitesWithProcessing,
    ImportQualityMetrics,
    analyzeImportQuality,
} from "./enhancedImport.js";
export * from "./importWebsites.js";
export * from "./indexingService.js";
export * from "./websiteCollection.js";
export * from "./websiteDocPart.js";
export * from "./websiteDocPartMeta.js";
export * from "./tables.js";
export * from "./websiteMeta.js";

export {
    AIModelManager,
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
} from "./extraction/index.js";
