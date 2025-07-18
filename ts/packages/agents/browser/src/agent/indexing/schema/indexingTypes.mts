// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExtractionMode } from "website-memory";

/**
 * Enhanced website metadata for indexing
 */
export interface EnhancedWebsiteMetadata {
    url: string;
    title: string;
    folder?: string;
    description?: string;
    extractionMode?: ExtractionMode;
    qualityScore?: number;
    processingTime?: number;
    aiProcessingUsed?: boolean;
    enhancedWithSummary?: boolean;
    extractedAt?: Date;
}

/**
 * Summary data attached to websites
 */
export interface WebsiteSummaryData {
    summary: string;
    keyPoints: string[];
    entities: string[];
    topics: string[];
    contentType: string;
    intent: string;
}

/**
 * Extended Website interface with enhanced properties
 */
export interface EnhancedWebsite {
    metadata: EnhancedWebsiteMetadata;
    content?: string;
    knowledge?: any;
    summaryData?: WebsiteSummaryData;
}

/**
 * Enhanced indexing configuration
 */
export interface IndexingConfig {
    extractionMode: ExtractionMode;
    enableSummaryEnhancement: boolean;
    domainModeOverrides: Record<string, ExtractionMode>;
    performance: {
        maxConcurrentExtractions: number;
        timeoutMs: number;
        maxContentSize: number;
        enableCaching: boolean;
    };
    quality: {
        minimumQualityThreshold: number;
        enableFallbackMode: boolean;
        fallbackMode: ExtractionMode;
    };
}

/**
 * Enhanced website data with summary information
 */
export interface EnhancedWebsite {
    metadata: {
        url: string;
        title: string;
        folder?: string;
        description?: string;
        extractionMode?: ExtractionMode;
        qualityScore?: number;
        extractedAt?: Date;
        enhancedWithSummary?: boolean;
        processingTime?: number;
        aiProcessingUsed?: boolean;
    };
    knowledge?: any; // From knowledge-processor
    summaryData?: {
        summary: string;
        keyPoints: string[];
        entities: string[];
        topics: string[];
        contentType: string;
        intent: string;
    };
    processingMetrics?: {
        extractionTime: number;
        summaryTime?: number;
        totalTime: number;
    };
}

/**
 * Indexing performance metrics
 */
export interface IndexingPerformanceMetrics {
    totalProcessed: number;
    summaryEnhanced: number;
    averageProcessingTime: number;
    averageSummaryTime: number;
    errorCount: number;
    successRate: number;
    enhancementRate: number;
    modeDistribution: Record<ExtractionMode, number>;
    domainStatistics: Record<string, {
        count: number;
        averageQuality: number;
        preferredMode: ExtractionMode;
    }>;
}

/**
 * Indexing result for a single item
 */
export interface IndexingResult {
    url: string;
    success: boolean;
    extractionMode: ExtractionMode;
    processingTime: number;
    qualityScore?: number;
    summaryGenerated?: boolean;
    error?: string;
    knowledge?: any;
    summaryData?: any;
}

/**
 * Batch indexing progress
 */
export interface IndexingProgress {
    current: number;
    total: number;
    currentItem: string;
    phase: "importing" | "enhancing" | "building" | "saving";
    estimatedTimeRemaining?: number;
    performanceMetrics?: Partial<IndexingPerformanceMetrics>;
}

/**
 * Default indexing configuration
 */
export const DEFAULT_INDEXING_CONFIG: IndexingConfig = {
    extractionMode: "summary" as ExtractionMode,
    enableSummaryEnhancement: true,
    domainModeOverrides: {
        // Domain-specific overrides can be added here if needed
        // Currently using summary mode for all domains
    },
    performance: {
        maxConcurrentExtractions: 3,
        timeoutMs: 15000,
        maxContentSize: 500000,
        enableCaching: true,
    },
    quality: {
        minimumQualityThreshold: 0.2,
        enableFallbackMode: true,
        fallbackMode: "basic" as ExtractionMode,
    },
};
