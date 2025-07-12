// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ContentExtractor } from "./contentExtractor.js";
import { WebsiteDocPart } from "../websiteDocPart.js";
import { WebsiteMeta, WebsiteVisitInfo } from "../websiteMeta.js";
import {
    ExtractionInput,
    ExtractionResult,
    ExtractionConfig,
    ExtractionMode,
    EXTRACTION_MODE_CONFIGS,
    BatchProgress,
    BatchError,
    AIModelRequiredError
} from "./types.js";

/**
 * Batch processor for extraction operations
 * Handles concurrent processing with progress tracking and error handling
 */
export class BatchProcessor {
    private results: ExtractionResult[] = [];
    private errors: BatchError[] = [];

    constructor(private contentExtractor: ContentExtractor) {}

    /**
     * Process a batch of extraction inputs with progress tracking
     */
    async processBatch(
        items: ExtractionInput[],
        mode: ExtractionMode,
        progressCallback?: (progress: BatchProgress) => void
    ): Promise<ExtractionResult[]> {
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];
        const totalItems = items.length;
        let processedItems = 0;

        this.results = [];
        this.errors = [];

        // Validate AI availability upfront for AI modes
        if (modeConfig.usesAI && !this.contentExtractor.isConfiguredForMode(mode)) {
            throw new AIModelRequiredError(mode);
        }

        const batchSize = this.calculateOptimalBatchSize(mode, totalItems);

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);

            const batchPromises = batch.map(async (item) => {
                try {
                    const result = await this.contentExtractor.extract(item, mode);
                    this.results.push(result);
                    processedItems++;

                    if (progressCallback) {
                        progressCallback({
                            total: totalItems,
                            processed: processedItems,
                            percentage: Math.round((processedItems / totalItems) * 100),
                            currentItem: item.url,
                            errors: this.errors.length,
                            mode,
                        });
                    }

                    return result;
                } catch (error) {
                    const batchError: BatchError = {
                        item,
                        error: error instanceof Error ? error : new Error(String(error)),
                        timestamp: new Date().toISOString(),
                    };

                    this.errors.push(batchError);
                    processedItems++;

                    if (progressCallback) {
                        progressCallback({
                            total: totalItems,
                            processed: processedItems,
                            percentage: Math.round((processedItems / totalItems) * 100),
                            currentItem: item.url,
                            errors: this.errors.length,
                            mode,
                        });
                    }

                    return null;
                }
            });

            await Promise.allSettled(batchPromises);

            // Add delay between batches for AI modes to be respectful to AI services
            if (i + batchSize < items.length && modeConfig.usesAI) {
                await this.delay(500);
            }
        }

        return this.results.filter((result): result is ExtractionResult => result !== null);
    }

    /**
     * Process batch and convert results directly to WebsiteDocPart objects
     */
    async processBatchToWebsiteDocParts(
        items: ExtractionInput[],
        mode: ExtractionMode,
        progressCallback?: (progress: BatchProgress) => void
    ): Promise<WebsiteDocPart[]> {
        const results = await this.processBatch(items, mode, progressCallback);
        return results.map(result => this.convertToWebsiteDocPart(result));
    }

    /**
     * Convert ExtractionResult to WebsiteDocPart
     */
    private convertToWebsiteDocPart(result: ExtractionResult): WebsiteDocPart {
        // Create WebsiteVisitInfo from extraction result
        const visitInfo: WebsiteVisitInfo = {
            url: result.source, // This should be the URL from the original input
            title: result.pageContent?.title || "Untitled",
            source: result.source as any, // Cast to match WebsiteVisitInfo type
        };

        // Add optional properties if available
        if (result.pageContent) {
            visitInfo.pageContent = result.pageContent;
        }
        if (result.metaTags) {
            visitInfo.metaTags = result.metaTags;
        }
        if (result.detectedActions) {
            visitInfo.detectedActions = result.detectedActions;
        }

        const websiteMeta = new WebsiteMeta(visitInfo);

        // Create text chunks from main content
        const textChunks: string[] = [];
        if (result.pageContent?.mainContent) {
            // Simple chunking - could be enhanced with intelligent chunking
            const maxChunkSize = 2000;
            const content = result.pageContent.mainContent;
            
            for (let i = 0; i < content.length; i += maxChunkSize) {
                textChunks.push(content.substring(i, i + maxChunkSize));
            }
        }

        if (textChunks.length === 0) {
            textChunks.push(result.pageContent?.title || "");
        }

        return new WebsiteDocPart(
            websiteMeta,
            textChunks,
            [], // tags
            result.timestamp,
            result.knowledge
        );
    }

    /**
     * Get processing errors
     */
    getErrors(): BatchError[] {
        return this.errors;
    }

    /**
     * Get processing results
     */
    getResults(): ExtractionResult[] {
        return this.results;
    }

    /**
     * Get processing statistics
     */
    getStatistics(): {
        totalProcessed: number;
        successfulExtractions: number;
        failedExtractions: number;
        successRate: number;
        averageProcessingTime: number;
    } {
        const totalProcessed = this.results.length + this.errors.length;
        const successfulExtractions = this.results.length;
        const failedExtractions = this.errors.length;
        const successRate = totalProcessed > 0 ? (successfulExtractions / totalProcessed) * 100 : 0;
        
        const averageProcessingTime = this.results.length > 0 
            ? this.results.reduce((sum, result) => sum + result.processingTime, 0) / this.results.length
            : 0;

        return {
            totalProcessed,
            successfulExtractions,
            failedExtractions,
            successRate,
            averageProcessingTime,
        };
    }

    /**
     * Clear previous results and errors
     */
    reset(): void {
        this.results = [];
        this.errors = [];
    }

    /**
     * Utility method to add delay between batches
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Create a batch processor with a configured content extractor
     */
    static create(config: ExtractionConfig & { knowledgeExtractor?: any }): BatchProcessor {
        const contentExtractor = new ContentExtractor(config);
        return new BatchProcessor(contentExtractor);
    }

    /**
     * Calculate optimal batch size based on mode and total items
     */
    private calculateOptimalBatchSize(mode: ExtractionMode, totalItems: number): number {
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];
        let baseBatchSize = modeConfig.defaultConcurrentExtractions;

        // Adjust based on total items
        if (totalItems < 5) {
            // For small batches, process all at once
            return Math.min(totalItems, baseBatchSize);
        } else if (totalItems > 100) {
            // For large batches, reduce concurrency to avoid memory pressure
            baseBatchSize = Math.max(1, Math.floor(baseBatchSize * 0.7));
        }

        // Additional adjustments based on mode
        if (mode === 'basic') {
            // Basic mode can handle higher concurrency
            baseBatchSize = Math.min(baseBatchSize * 2, 20);
        } else if (mode === 'full') {
            // Full mode needs more resources per item
            baseBatchSize = Math.max(1, Math.floor(baseBatchSize * 0.5));
        }

        return Math.min(baseBatchSize, totalItems);
    }

    /**
     * Process a single item (convenience method)
     */
    async processSingle(
        item: ExtractionInput,
        mode: ExtractionMode
    ): Promise<ExtractionResult | null> {
        const results = await this.processBatch([item], mode);
        return results.length > 0 ? results[0] : null;
    }

    /**
     * Validate that all items in a batch can be processed with the given mode
     */
    validateBatch(items: ExtractionInput[], mode: ExtractionMode): void {
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];
        
        if (modeConfig.usesAI && !this.contentExtractor.isConfiguredForMode(mode)) {
            throw new AIModelRequiredError(mode);
        }

        // Additional validation could be added here
        // e.g., check for valid URLs, required fields, etc.
        for (const item of items) {
            if (!item.url || !item.title) {
                throw new Error(`Invalid extraction input: missing required fields (url, title) for item: ${JSON.stringify(item)}`);
            }
        }
    }
}
