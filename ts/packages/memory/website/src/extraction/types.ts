// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";

// Page content types
export interface PageContent {
    title: string;
    mainContent: string;
    headings: string[];
    codeBlocks?: string[];
    images?: ImageInfo[];
    links?: LinkInfo[];
    wordCount: number;
    readingTime: number;
}

export interface ImageInfo {
    src: string;
    alt?: string;
    width?: number;
    height?: number;
    isExternal?: boolean;
}

export interface LinkInfo {
    href: string;
    text: string;
    isExternal: boolean;
}

export interface MetaTagCollection {
    description?: string;
    keywords?: string[];
    author?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogType?: string;
    twitterCard?: string;
    custom: { [key: string]: string };
}

export interface StructuredDataCollection {
    schemaType?: string;
    data?: any;
    jsonLd?: any[];
}

export interface ActionInfo {
    type: "form" | "button" | "link";
    action?: string;
    method?: string;
    text?: string;
}

export interface WebsiteContent {
    pageContent?: PageContent;
    metaTags?: MetaTagCollection;
    structuredData?: StructuredDataCollection;
    actions?: ActionInfo[];
    extractionTime: number;
    success: boolean;
    error?: string;
    detectedActions?: DetectedAction[];
    actionSummary?: ActionSummary;
}

export interface WebsiteContentWithKnowledge extends WebsiteContent {
    knowledge?: kpLib.KnowledgeResponse;
    knowledgeQuality?: KnowledgeQualityMetrics;
}

export interface KnowledgeQualityMetrics {
    entityCount: number;
    topicCount: number;
    actionCount: number;
    confidence: number;
    extractionMode: "basic" | "enhanced" | "hybrid";
}

/**
 * Extraction modes determine the level of content processing and AI usage
 
 */
export type ExtractionMode = "basic" | "summary" | "content" | "full";

/**
 * Configuration for content extraction operations
 *
 */
export interface ExtractionConfig {
    // Primary control - determines both content extraction and AI usage
    mode: ExtractionMode;

    // Content extraction settings
    timeout?: number;
    maxContentLength?: number;

    // Processing settings (auto-configured by mode)
    maxCharsPerChunk?: number;
    maxConcurrentExtractions?: number;
    qualityThreshold?: number;

    // Performance settings
    enableCrossChunkMerging?: boolean;
}

/**
 * Mode configuration with automatic AI and knowledge strategy assignment
 */
export interface ExtractionModeConfig {
    description: string;
    usesAI: boolean;
    extractsActions: boolean;
    extractsRelationships: boolean;
    knowledgeStrategy: "basic" | "hybrid";
    defaultChunkSize: number;
    defaultQualityThreshold: number;
    defaultConcurrentExtractions: number;
}

/**
 * Automatic mode configuration
 */
export const EXTRACTION_MODE_CONFIGS: Record<
    ExtractionMode,
    ExtractionModeConfig
> = {
    basic: {
        description: "URL/title extraction only, no AI processing",
        usesAI: false,
        extractsActions: false,
        extractsRelationships: false,
        knowledgeStrategy: "basic",
        defaultChunkSize: 8000,
        defaultQualityThreshold: 0.2,
        defaultConcurrentExtractions: 10,
    },
    summary: {
        description: "HTML download + text summary + AI knowledge extraction",
        usesAI: true,
        extractsActions: false,
        extractsRelationships: true,
        knowledgeStrategy: "hybrid",
        defaultChunkSize: 8000,
        defaultQualityThreshold: 0.25,
        defaultConcurrentExtractions: 5,
    },
    content: {
        description: "Full content extraction with AI knowledge processing",
        usesAI: true,
        extractsActions: false,
        extractsRelationships: false,
        knowledgeStrategy: "hybrid",
        defaultChunkSize: 8000,
        defaultQualityThreshold: 0.3,
        defaultConcurrentExtractions: 5,
    },
    full: {
        description:
            "Complete extraction with AI knowledge and relationship processing",
        usesAI: true,
        extractsActions: true,
        extractsRelationships: true,
        knowledgeStrategy: "hybrid",
        defaultChunkSize: 8000,
        defaultQualityThreshold: 0.4,
        defaultConcurrentExtractions: 4,
    },
};

/**
 * Input content for extraction operations
 *
 */
export interface ExtractionInput {
    url: string;
    title: string;
    htmlContent?: string;
    htmlFragments?: any[];
    textContent?: string;
    source: "direct" | "index" | "bookmark" | "history" | "import";
    timestamp?: string;
}

/**
 * Extraction result interface with compatibility properties
 */
export interface ExtractionResult {
    // Content extraction results (varies by mode)
    pageContent?: PageContent;
    metaTags?: MetaTagCollection;
    detectedActions?: DetectedAction[]; // Only when mode supports actions

    // Knowledge extraction results (automatic based on mode)
    knowledge: kpLib.KnowledgeResponse; // Always present, method varies by mode
    qualityMetrics: ExtractionQualityMetrics;

    // Processing metadata
    extractionMode: ExtractionMode;
    aiProcessingUsed: boolean; // True for content/actions/full
    source: string;
    timestamp: string;
    processingTime: number;

    // Compatibility properties for migration from EnhancedContent
    success: boolean; // Always true for successful extractions
    error?: string; // Error message if extraction failed
    extractionTime: number; // Alias for processingTime
    actions?: ActionInfo[]; // Computed from detectedActions for legacy compatibility
    structuredData?: StructuredDataCollection; // Structured data extracted from page
    actionSummary?: ActionSummary; // Summary of detected actions
}

/**
 * Quality metrics for extraction results
 */
export interface ExtractionQualityMetrics {
    confidence: number;
    entityCount: number;
    topicCount: number;
    actionCount: number;
    extractionTime: number;
    aiProcessingTime?: number; // Only when AI was used
    knowledgeStrategy: "basic" | "hybrid"; // Which strategy was used
}

/**
 * Batch processing progress information
 */
export interface BatchProgress {
    total: number;
    processed: number;
    percentage: number;
    currentItem: string;
    errors: number;
    mode: ExtractionMode;
}

/**
 * Batch processing error information
 */
export interface BatchError {
    item: ExtractionInput;
    error: Error;
    timestamp: string;
}

/**
 * Error thrown when AI model is required but not available
 */
export class AIModelRequiredError extends Error {
    constructor(mode: ExtractionMode) {
        super(
            `AI model is required for '${mode}' mode but not available. ` +
                `Please configure an AI model or use 'basic' mode for non-AI extraction.`,
        );
        this.name = "AIModelRequiredError";
    }
}

/**
 * Error thrown when AI extraction fails
 */
export class AIExtractionFailedError extends Error {
    public readonly originalError: Error;

    constructor(mode: ExtractionMode, originalError: Error) {
        super(
            `AI extraction failed for '${mode}' mode: ${originalError.message}. ` +
                `Please check AI model configuration or use 'basic' mode.`,
        );
        this.name = "AIExtractionFailedError";
        this.originalError = originalError;
    }
}

/**
 * Utility function to get effective configuration with defaults
 */
export function getEffectiveConfig(
    config: ExtractionConfig,
): Required<ExtractionConfig> {
    const modeConfig = EXTRACTION_MODE_CONFIGS[config.mode];

    return {
        mode: config.mode,
        timeout: config.timeout ?? 10000,
        maxContentLength: config.maxContentLength ?? 1000000,
        maxCharsPerChunk:
            config.maxCharsPerChunk ?? modeConfig.defaultChunkSize,
        maxConcurrentExtractions:
            config.maxConcurrentExtractions ??
            modeConfig.defaultConcurrentExtractions,
        qualityThreshold:
            config.qualityThreshold ?? modeConfig.defaultQualityThreshold,
        enableCrossChunkMerging: config.enableCrossChunkMerging ?? true,
    };
}

/**
 * Action detection interfaces for browser agent integration
 */
export interface DetectedAction {
    type: string;
    element: string;
    text?: string;
    confidence: number;
}

export interface ActionSummary {
    totalActions: number;
    actionTypes: string[];
    highConfidenceActions: number;
    actionDistribution: { [key: string]: number };
}
