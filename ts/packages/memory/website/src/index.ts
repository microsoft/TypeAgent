// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export * from "./actionExtractor.js";
export * from "./chunkingUtils.js";

// Core types and interfaces (keep for external compatibility)
export { 
    ExtractionMode,
    EnhancedContent, 
    PageContent,
    MetaTagCollection,
    ImageInfo,
    LinkInfo,
    ActionInfo,
    StructuredDataCollection,
    EnhancedContentWithKnowledge,
} from "./contentExtractor.js";

export * from "./enhancedImport.js";
export * from "./importWebsites.js";
export * from "./indexingService.js";
export * from "./websiteCollection.js";
export * from "./websiteDocPart.js";
export * from "./websiteDocPartMeta.js";
export * from "./tables.js";
export * from "./websiteMeta.js";

// Unified extraction system - ContentExtractor is now the main extraction class
export {
    AIModelManager,
    BatchProcessor,
    ContentExtractor,
    // Types
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
} from "./extraction/index.js";
