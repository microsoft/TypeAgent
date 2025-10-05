// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter } from "events";
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
    AIModelRequiredError,
    ChunkProgressInfo,
} from "./types.js";

export interface BatchProcessorOptions {
    processingMode?: "realtime" | "batch";
    progressCallback?: (progress: BatchProgress) => void;
}

export interface BatchProcessorEvents {
    progress: (progress: BatchProgress) => void;
    chunkProgress: (chunkInfo: ChunkProgressInfo) => void;
    itemComplete: (result: ExtractionResult, index: number) => void;
    itemError: (error: BatchError, index: number) => void;
    complete: (results: ExtractionResult[]) => void;
}

/**
 * Batch processor for extraction operations
 * Handles concurrent processing with progress tracking and error handling
 */
export class BatchProcessor extends EventEmitter {
    private results: ExtractionResult[] = [];
    private errors: BatchError[] = [];

    constructor(private contentExtractor: ContentExtractor) {
        super();
    }

    /**
     * Process a batch of extraction inputs with unified processing
     * Uses identical logic for all modes, only progress event publishing differs
     */
    async processBatch(
        items: ExtractionInput[],
        mode: ExtractionMode,
        options: BatchProcessorOptions = {},
    ): Promise<ExtractionResult[]> {
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];
        const totalItems = items.length;
        let processedItems = 0;
        const { processingMode = "batch", progressCallback } = options;

        this.results = [];
        this.errors = [];

        // Validate AI availability upfront for AI modes
        if (
            modeConfig.usesAI &&
            !this.contentExtractor.isConfiguredForMode(mode)
        ) {
            throw new AIModelRequiredError(mode);
        }

        const batchSize = this.calculateOptimalBatchSize(mode, totalItems);

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);

            const batchPromises = batch.map(async (item) => {
                try {
                    // IDENTICAL processing for all modes - unified logic
                    const extractionOptions: any = { processingMode };
                    if (processingMode === "realtime") {
                        extractionOptions.chunkProgressCallback = async (
                            chunkInfo: ChunkProgressInfo,
                        ) => {
                            // Real-time streaming events for WebSocket
                            this.emit("chunkProgress", chunkInfo);
                        };
                    }

                    const result = await this.contentExtractor.extract(
                        item,
                        mode,
                        extractionOptions,
                    );
                    this.results.push(result);
                    processedItems++;

                    // ONLY difference: how progress events are published
                    if (processingMode === "realtime") {
                        // Real-time: WebSocket streaming events already sent during extraction
                        this.emit("itemComplete", result, processedItems - 1);
                    } else {
                        // Batch: Traditional batch progress events
                        this.emit("itemComplete", result, processedItems - 1);
                    }

                    if (progressCallback) {
                        progressCallback({
                            total: totalItems,
                            processed: processedItems,
                            percentage: Math.round(
                                (processedItems / totalItems) * 100,
                            ),
                            currentItem: item.url,
                            errors: this.errors.length,
                            mode,
                            intermediateResults: [...this.results],
                        });
                    }

                    return result;
                } catch (error) {
                    const batchError: BatchError = {
                        item,
                        error:
                            error instanceof Error
                                ? error
                                : new Error(String(error)),
                        timestamp: new Date().toISOString(),
                    };

                    this.errors.push(batchError);
                    processedItems++;

                    if (progressCallback) {
                        progressCallback({
                            total: totalItems,
                            processed: processedItems,
                            percentage: Math.round(
                                (processedItems / totalItems) * 100,
                            ),
                            currentItem: item.url,
                            errors: this.errors.length,
                            mode,
                            intermediateResults: [...this.results],
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

        return this.results.filter(
            (result): result is ExtractionResult => result !== null,
        );
    }

    async processBatchWithEvents(
        items: ExtractionInput[],
        mode: ExtractionMode,
    ): Promise<ExtractionResult[]> {
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];
        let globalProcessedChunks = 0;
        let globalTotalChunks = 0;
        let itemsCompleted = 0;

        this.results = [];
        this.errors = [];

        const partialResults = new Map<number, any[]>();

        if (
            modeConfig.usesAI &&
            !this.contentExtractor.isConfiguredForMode(mode)
        ) {
            throw new AIModelRequiredError(mode);
        }

        const itemChunkCounts: number[] = [];
        if (
            modeConfig.usesAI &&
            this.contentExtractor.isConfiguredForMode(mode)
        ) {
            for (const item of items) {
                const textContent = this.prepareTextContentForEstimation(item);
                const chunkCount = this.contentExtractor.estimateChunkCount(
                    textContent,
                    modeConfig.defaultChunkSize,
                );
                itemChunkCounts.push(chunkCount);
                globalTotalChunks += chunkCount;
            }
        } else {
            itemChunkCounts.fill(1, 0, items.length);
            globalTotalChunks = items.length;
        }

        const batchSize = this.calculateOptimalBatchSize(mode, items.length);

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);

            const batchPromises = batch.map((item, batchIndex) => {
                const itemIndex = i + batchIndex;
                const itemChunkCount = itemChunkCounts[itemIndex];
                let itemProcessedChunks = 0;

                return this.contentExtractor
                    .extract(item, mode, {
                        processingMode: "realtime", // Always use realtime for streaming events
                        chunkProgressCallback: async (
                            chunkInfo: ChunkProgressInfo,
                        ) => {
                            itemProcessedChunks++;
                            globalProcessedChunks++;

                            if (chunkInfo.chunkResult) {
                                if (!partialResults.has(itemIndex)) {
                                    partialResults.set(itemIndex, []);
                                }
                                partialResults
                                    .get(itemIndex)!
                                    .push(chunkInfo.chunkResult);
                            }

                            const enrichedChunkInfo = {
                                ...chunkInfo,
                                itemUrl: item.url,
                                itemIndex,
                                globalChunkIndex: globalProcessedChunks - 1,
                                totalChunksGlobal: globalTotalChunks,
                            };

                            const currentPartialResults: any[] = [];
                            for (const [
                                idx,
                                chunks,
                            ] of partialResults.entries()) {
                                if (chunks.length > 0) {
                                    const aggregatedKnowledge =
                                        this.aggregateChunkKnowledge(chunks);
                                    currentPartialResults.push({
                                        itemIndex: idx,
                                        partialKnowledge: aggregatedKnowledge,
                                        chunksProcessed: chunks.length,
                                        url: items[idx]?.url || "",
                                        title: items[idx]?.title || "",
                                    });
                                }
                            }

                            const progress: BatchProgress = {
                                total: globalTotalChunks,
                                processed: globalProcessedChunks,
                                percentage: Math.round(
                                    (globalProcessedChunks /
                                        globalTotalChunks) *
                                        100,
                                ),
                                currentItem: item.url,
                                errors: this.errors.length,
                                mode,
                                intermediateResults: [
                                    ...this.results,
                                    ...currentPartialResults,
                                ],
                                currentItemChunk: chunkInfo.chunkIndex + 1,
                                currentItemTotalChunks:
                                    chunkInfo.totalChunksInItem,
                                itemsCompleted,
                                totalItems: items.length,
                            };

                            this.emit("progress", progress);
                            this.emit("chunkProgress", enrichedChunkInfo);
                        },
                    })
                    .then((result) => ({
                        success: true,
                        result,
                        item,
                        itemIndex,
                        itemProcessedChunks,
                        itemChunkCount,
                    }))
                    .catch((error) => ({
                        success: false,
                        error,
                        item,
                        itemIndex,
                        itemProcessedChunks,
                        itemChunkCount,
                    }));
            });

            for (const promise of batchPromises) {
                const outcome = await promise;

                if (outcome.success && "result" in outcome) {
                    this.results.push(outcome.result);
                    itemsCompleted++;
                    this.emit(
                        "itemComplete",
                        outcome.result,
                        outcome.itemIndex,
                    );
                } else if (!outcome.success && "error" in outcome) {
                    const batchError: BatchError = {
                        item: outcome.item,
                        error:
                            outcome.error instanceof Error
                                ? outcome.error
                                : new Error(String(outcome.error)),
                        timestamp: new Date().toISOString(),
                    };

                    this.errors.push(batchError);

                    const remainingChunks =
                        outcome.itemChunkCount - outcome.itemProcessedChunks;
                    globalProcessedChunks += remainingChunks;

                    const progress: BatchProgress = {
                        total: globalTotalChunks,
                        processed: globalProcessedChunks,
                        percentage: Math.round(
                            (globalProcessedChunks / globalTotalChunks) * 100,
                        ),
                        currentItem: outcome.item.url,
                        errors: this.errors.length,
                        mode,
                        intermediateResults: [...this.results],
                        itemsCompleted,
                        totalItems: items.length,
                    };

                    this.emit("progress", progress);
                    this.emit("itemError", batchError, outcome.itemIndex);
                }
            }

            if (i + batchSize < items.length && modeConfig.usesAI) {
                await this.delay(500);
            }
        }

        const finalResults = this.results.filter(
            (result): result is ExtractionResult => result !== null,
        );
        this.emit("complete", finalResults);
        return finalResults;
    }

    private prepareTextContentForEstimation(item: ExtractionInput): string {
        const parts: string[] = [];

        if (item.title) {
            parts.push(`Title: ${item.title}`);
        }

        if (item.textContent) {
            parts.push(item.textContent);
        } else if (item.htmlFragments) {
            parts.push(item.htmlFragments.map((f) => f.text || "").join("\n"));
        } else if (item.htmlContent) {
            parts.push(item.htmlContent.replace(/\s+/g, " ").trim());
        }

        return parts.join("\n\n");
    }

    /**
     * Process batch and convert results directly to WebsiteDocPart objects
     */
    async processBatchToWebsiteDocParts(
        items: ExtractionInput[],
        mode: ExtractionMode,
        progressCallback?: (progress: BatchProgress) => void,
    ): Promise<WebsiteDocPart[]> {
        const options: BatchProcessorOptions = {};
        if (progressCallback) {
            options.progressCallback = progressCallback;
        }
        const results = await this.processBatch(items, mode, options);
        return results.map((result) => this.convertToWebsiteDocPart(result));
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
            result.knowledge,
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
        const successRate =
            totalProcessed > 0
                ? (successfulExtractions / totalProcessed) * 100
                : 0;

        const averageProcessingTime =
            this.results.length > 0
                ? this.results.reduce(
                      (sum, result) => sum + result.processingTime,
                      0,
                  ) / this.results.length
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
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Create a batch processor with a configured content extractor
     */
    static create(
        config: ExtractionConfig & { knowledgeExtractor?: any },
    ): BatchProcessor {
        const contentExtractor = new ContentExtractor(config);
        return new BatchProcessor(contentExtractor);
    }

    /**
     * Calculate optimal batch size based on mode and total items
     */
    private calculateOptimalBatchSize(
        mode: ExtractionMode,
        totalItems: number,
    ): number {
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
        if (mode === "basic") {
            // Basic mode can handle higher concurrency
            baseBatchSize = Math.min(baseBatchSize * 2, 20);
        } else if (mode === "full") {
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
        mode: ExtractionMode,
    ): Promise<ExtractionResult | null> {
        const results = await this.processBatch([item], mode);
        return results.length > 0 ? results[0] : null;
    }

    /**
     * Aggregate knowledge results from multiple chunks into a single knowledge response
     */
    private aggregateChunkKnowledge(chunkResults: any[]): any {
        if (chunkResults.length === 0) return null;
        if (chunkResults.length === 1) return chunkResults[0];

        const aggregated: any = {
            topics: [],
            entities: [],
            actions: [],
            inverseActions: [],
        };

        const topicCounts = new Map<string, number>();
        const entityMap = new Map<string, { entity: any; count: number }>();
        const allActions: any[] = [];

        chunkResults.forEach((result) => {
            if (result?.topics) {
                result.topics.forEach((topic: any) => {
                    const normalized =
                        typeof topic === "string"
                            ? topic.toLowerCase()
                            : topic.name?.toLowerCase() || "";
                    if (normalized) {
                        topicCounts.set(
                            normalized,
                            (topicCounts.get(normalized) || 0) + 1,
                        );
                    }
                });
            }

            if (result?.entities) {
                result.entities.forEach((entity: any) => {
                    const normalized = entity.name?.toLowerCase() || "";
                    if (normalized) {
                        const existing = entityMap.get(normalized);
                        if (existing) {
                            existing.count++;
                        } else {
                            entityMap.set(normalized, { entity, count: 1 });
                        }
                    }
                });
            }

            // Use detectedActions instead of legacy actions property
            if (result?.detectedActions) {
                allActions.push(...result.detectedActions);
            }
        });

        aggregated.topics = Array.from(topicCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([topic]) => topic);

        aggregated.entities = Array.from(entityMap.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 15)
            .map((item) => item.entity);

        aggregated.actions = allActions.slice(0, 10);

        return aggregated;
    }

    /**
     * Validate that all items in a batch can be processed with the given mode
     */
    validateBatch(items: ExtractionInput[], mode: ExtractionMode): void {
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];

        if (
            modeConfig.usesAI &&
            !this.contentExtractor.isConfiguredForMode(mode)
        ) {
            throw new AIModelRequiredError(mode);
        }

        // Additional validation could be added here
        // e.g., check for valid URLs, required fields, etc.
        for (const item of items) {
            if (!item.url || !item.title) {
                throw new Error(
                    `Invalid extraction input: missing required fields (url, title) for item: ${JSON.stringify(item)}`,
                );
            }
        }
    }
}
