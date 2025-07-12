// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export * from "./actionExtractor.js";
export * from "./chunkingUtils.js";
export * from "./contentExtractor.js";
export * from "./enhancedImport.js";
export * from "./importWebsites.js";
export * from "./indexingService.js";
export * from "./websiteCollection.js";
export * from "./websiteDocPart.js";
export * from "./websiteDocPartMeta.js";
export * from "./tables.js";
export * from "./websiteMeta.js";

// New extraction functionality (selective exports to avoid conflicts)
export {
    AIModelManager,
    BatchProcessor,
    ExtractionContentExtractor,
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
    getEffectiveConfig
} from "./extraction/index.js";
