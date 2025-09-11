// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "crypto";
import { conversation as kpLib } from "knowledge-processor";
import {
    ExtractionMode,
    EXTRACTION_MODE_CONFIGS,
    AIModelRequiredError,
    AIExtractionFailedError,
    ChunkProgressInfo,
} from "./types.js";

/**
 * AI Model Manager for extraction operations
 * Handles AI model validation and knowledge extraction with strict requirements
 */
export class AIModelManager {
    private responseCache = new Map<string, CachedResponse>();
    private cacheMaxSize: number = 500;
    private cacheTTL: number = 3600000; // 1 hour

    constructor(private knowledgeExtractor?: kpLib.KnowledgeExtractor) {}

    public estimateChunkCount(content: string, maxChunkSize: number): number {
        if (content.length <= maxChunkSize) {
            return 1;
        }
        return Math.ceil(content.length / (maxChunkSize * 0.8));
    }

    /**
     * Validates AI availability for the given mode
     * Throws AIModelRequiredError if AI is required but not available
     */
    validateAvailability(mode: ExtractionMode): void {
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];
        if (modeConfig.usesAI && !this.knowledgeExtractor) {
            throw new AIModelRequiredError(mode);
        }
    }

    /**
     * Extracts knowledge using the appropriate strategy for the given mode
     * @param content Text content to extract knowledge from
     * @param mode Extraction mode determining the strategy
     * @returns Knowledge response
     */
    async extractKnowledge(
        content: string,
        mode: ExtractionMode,
        chunkProgressCallback?: (chunkInfo: ChunkProgressInfo) => Promise<void>,
        maxConcurrent?: number,
    ): Promise<kpLib.KnowledgeResponse> {
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];

        if (modeConfig.knowledgeStrategy === "basic") {
            if (chunkProgressCallback) {
                await chunkProgressCallback({
                    itemUrl: "",
                    itemIndex: 0,
                    chunkIndex: 0,
                    totalChunksInItem: 1,
                    globalChunkIndex: 0,
                    totalChunksGlobal: 1,
                });
            }
            return this.extractBasicKnowledge(content);
        } else {
            const cacheKey = this.getCacheKey(content, mode);
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                if (chunkProgressCallback) {
                    await chunkProgressCallback({
                        itemUrl: "",
                        itemIndex: 0,
                        chunkIndex: 0,
                        totalChunksInItem: 1,
                        globalChunkIndex: 0,
                        totalChunksGlobal: 1,
                    });
                }
                return cached;
            }

            const result = await this.extractHybridKnowledgeStrict(
                content,
                modeConfig,
                mode,
                chunkProgressCallback,
                maxConcurrent,
            );

            this.putInCache(cacheKey, result);
            return result;
        }
    }

    /**
     * Extract basic knowledge without AI (from titles, headings, meta tags)
     * Used for "basic" mode and as foundation for hybrid mode
     */
    private extractBasicKnowledge(content: string): kpLib.KnowledgeResponse {
        const knowledge: kpLib.KnowledgeResponse = {
            topics: [],
            entities: [],
            actions: [],
            inverseActions: [],
        };

        // Extract basic topics from obvious text patterns
        const lines = content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        let potentialTitles = lines
            .filter((line) => line.startsWith("Headings: "))
            .map((line) => line.substring("Headings: ".length));

        // Look for title-like content (short lines, likely headings)
        if (!potentialTitles || potentialTitles.length === 0) {
            potentialTitles = lines.filter(
                (line) =>
                    line.length > 5 &&
                    line.length < 100 &&
                    !line.includes(".") &&
                    line.charAt(0) === line.charAt(0).toUpperCase(),
            );
        }
        // Add potential titles as topics
        knowledge.topics.push(...potentialTitles.slice(0, 10));

        // Look for common entity patterns (capitalized words)
        const words = content.split(/\s+/);
        const capitalizedWords = words.filter(
            (word) =>
                word.length > 2 &&
                word.charAt(0) === word.charAt(0).toUpperCase() &&
                /^[A-Za-z]+$/.test(word),
        );

        // Create basic entities from capitalized words
        // TODO: Review this - it's very noisy, even as a fallback option
        const uniqueCapitalizedWords = [...new Set(capitalizedWords)].slice(
            0,
            10,
        );
        knowledge.entities = uniqueCapitalizedWords.map((word) => ({
            name: word,
            type: ["concept"],
            facets: [
                { name: "source", value: "basic_extraction" },
                { name: "confidence", value: 0.3 },
            ],
        }));

        return knowledge;
    }

    /**
     * Extract knowledge using hybrid strategy (basic + AI) with strict error handling
     */
    private async extractHybridKnowledgeStrict(
        content: string,
        modeConfig: any,
        mode: ExtractionMode,
        chunkProgressCallback?: (chunkInfo: ChunkProgressInfo) => Promise<void>,
        maxConcurrent?: number,
    ): Promise<kpLib.KnowledgeResponse> {
        try {
            // Get AI knowledge with chunking (required - no fallbacks)
            if (!this.knowledgeExtractor) {
                throw new Error("AI model not available for hybrid extraction");
            }

            const aiKnowledge = await this.extractChunkedAIKnowledge(
                content,
                modeConfig.defaultChunkSize,
                chunkProgressCallback,
                maxConcurrent,
            );

            if (!aiKnowledge) {
                throw new Error("AI knowledge extraction returned undefined");
            }

            return aiKnowledge;
        } catch (error) {
            // No fallbacks - throw clear error for AI-powered modes
            throw new AIExtractionFailedError(mode, error as Error);
        }
    }

    /**
     * Extract knowledge from content using AI with intelligent chunking
     */
    private async extractChunkedAIKnowledge(
        content: string,
        maxChunkSize: number,
        chunkProgressCallback?: (chunkInfo: ChunkProgressInfo) => Promise<void>,
        maxConcurrent: number = 3,
    ): Promise<kpLib.KnowledgeResponse> {
        if (!this.knowledgeExtractor) {
            throw new Error("Knowledge extractor not available");
        }

        if (content.length <= maxChunkSize) {
            if (chunkProgressCallback) {
                await chunkProgressCallback({
                    itemUrl: "",
                    itemIndex: 0,
                    chunkIndex: 0,
                    totalChunksInItem: 1,
                    globalChunkIndex: 0,
                    totalChunksGlobal: 1,
                    chunkContent: content.substring(0, 100),
                });
            }

            const result = await this.knowledgeExtractor.extract(content);
            if (!result) {
                throw new Error("Knowledge extractor returned undefined");
            }
            return result;
        }

        // Chunk the content intelligently
        const chunks = this.intelligentChunking(content, maxChunkSize);
        const chunkResults: kpLib.KnowledgeResponse[] = [];

        for (let i = 0; i < chunks.length; i += maxConcurrent) {
            const batch = chunks.slice(i, i + maxConcurrent);

            const batchPromises = batch.map((chunk, batchIndex) => {
                const chunkIndex = i + batchIndex;

                return this.knowledgeExtractor!.extract(chunk)
                    .then(async (result) => {
                        const outcome = {
                            success: true,
                            result,
                            chunk,
                            chunkIndex,
                        };

                        // Report progress immediately when this chunk completes
                        if (result) {
                            chunkResults.push(result);
                        }
                        if (chunkProgressCallback) {
                            await chunkProgressCallback({
                                itemUrl: "",
                                itemIndex: 0,
                                chunkIndex: outcome.chunkIndex,
                                totalChunksInItem: chunks.length,
                                globalChunkIndex: 0,
                                totalChunksGlobal: 1,
                                chunkContent: outcome.chunk.substring(0, 100),
                                chunkResult: outcome.result,
                            });
                        }

                        return outcome;
                    })
                    .catch(async (error) => {
                        const outcome = {
                            success: false,
                            error,
                            chunk,
                            chunkIndex,
                        };

                        console.warn(
                            `Chunk ${outcome.chunkIndex} extraction failed:`,
                            error,
                        );
                        if (chunkProgressCallback) {
                            await chunkProgressCallback({
                                itemUrl: "",
                                itemIndex: 0,
                                chunkIndex: outcome.chunkIndex,
                                totalChunksInItem: chunks.length,
                                globalChunkIndex: 0,
                                totalChunksGlobal: 1,
                                chunkContent: outcome.chunk.substring(0, 100),
                            });
                        }

                        return outcome;
                    });
            });

            // Wait for all promises to complete, but progress is already reported
            await Promise.allSettled(batchPromises);

            if (i + maxConcurrent < chunks.length) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }

        // Aggregate all chunk results
        return this.aggregateChunkResults(chunkResults);
    }

    /**
     * Intelligently chunk content preserving sentence/paragraph boundaries
     */
    private intelligentChunking(
        content: string,
        maxChunkSize: number,
    ): string[] {
        const chunks: string[] = [];

        // First try to split by paragraphs
        const paragraphs = content
            .split(/\n\s*\n/)
            .filter((p) => p.trim().length > 0);

        let currentChunk = "";

        for (const paragraph of paragraphs) {
            if (currentChunk.length + paragraph.length <= maxChunkSize) {
                currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
            } else {
                if (currentChunk) {
                    chunks.push(currentChunk);
                    currentChunk = "";
                }

                // If paragraph is too long, split by sentences
                if (paragraph.length > maxChunkSize) {
                    const sentences = paragraph
                        .split(/[.!?]+/)
                        .filter((s) => s.trim().length > 0);

                    for (const sentence of sentences) {
                        if (
                            currentChunk.length + sentence.length <=
                            maxChunkSize
                        ) {
                            currentChunk +=
                                (currentChunk ? ". " : "") + sentence.trim();
                        } else {
                            if (currentChunk) {
                                chunks.push(currentChunk + ".");
                                currentChunk = "";
                            }

                            // If even a single sentence is too long, truncate it
                            if (sentence.length > maxChunkSize) {
                                chunks.push(
                                    sentence.substring(0, maxChunkSize - 3) +
                                        "...",
                                );
                            } else {
                                currentChunk = sentence.trim();
                            }
                        }
                    }
                } else {
                    currentChunk = paragraph;
                }
            }
        }

        if (currentChunk) {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    /**
     * Aggregate knowledge results from multiple chunks
     */
    private aggregateChunkResults(
        chunkResults: kpLib.KnowledgeResponse[],
    ): kpLib.KnowledgeResponse {
        const aggregated: kpLib.KnowledgeResponse = {
            topics: [],
            entities: [],
            actions: [],
            inverseActions: [],
        };

        const topicCounts = new Map<string, number>();
        const entityMap = new Map<
            string,
            { entity: kpLib.ConcreteEntity; count: number }
        >();
        const allActions: kpLib.Action[] = [];

        // Aggregate topics with frequency counting
        chunkResults.forEach((result) => {
            result.topics.forEach((topic) => {
                const normalized = topic.toLowerCase();
                topicCounts.set(
                    normalized,
                    (topicCounts.get(normalized) || 0) + 1,
                );
            });

            // Aggregate entities
            result.entities.forEach((entity) => {
                const normalized = entity.name.toLowerCase();
                const existing = entityMap.get(normalized);
                if (existing) {
                    existing.count++;
                } else {
                    entityMap.set(normalized, { entity, count: 1 });
                }
            });

            // Collect all actions
            allActions.push(...(result.actions || []));
        });

        // Select top topics by frequency
        aggregated.topics = Array.from(topicCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([topic]) => topic);

        // Select top entities by frequency
        aggregated.entities = Array.from(entityMap.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 30)
            .map((item) => item.entity);

        // Deduplicate actions (simple approach - could be more sophisticated)
        aggregated.actions = allActions.slice(0, 15);
        aggregated.inverseActions = [];

        return aggregated;
    }

    /**
     * Generate cache key for content and mode
     */
    private getCacheKey(content: string, mode: ExtractionMode): string {
        const contentHash = createHash("sha256")
            .update(content)
            .digest("hex")
            .substring(0, 12);
        return `${contentHash}:${mode}`;
    }

    /**
     * Get response from cache if available and not expired
     */
    private getFromCache(key: string): kpLib.KnowledgeResponse | null {
        const cached = this.responseCache.get(key);
        if (!cached) {
            return null;
        }

        // Check if expired
        if (Date.now() > cached.expiresAt) {
            this.responseCache.delete(key);
            return null;
        }

        return cached.response;
    }

    /**
     * Store response in cache
     */
    private putInCache(key: string, response: kpLib.KnowledgeResponse): void {
        // Evict old entries if cache is full
        if (this.responseCache.size >= this.cacheMaxSize) {
            const oldestKey = this.responseCache.keys().next().value;
            if (oldestKey) {
                this.responseCache.delete(oldestKey);
            }
        }

        this.responseCache.set(key, {
            response,
            expiresAt: Date.now() + this.cacheTTL,
            cachedAt: Date.now(),
        });
    }

    /**
     * Clear AI response cache
     */
    clearCache(): void {
        this.responseCache.clear();
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { size: number; maxSize: number; hitRate: number } {
        return {
            size: this.responseCache.size,
            maxSize: this.cacheMaxSize,
            hitRate: 0, // Would need hit/miss tracking
        };
    }
}

/**
 * Cached AI response with metadata
 */
interface CachedResponse {
    response: kpLib.KnowledgeResponse;
    expiresAt: number;
    cachedAt: number;
}
