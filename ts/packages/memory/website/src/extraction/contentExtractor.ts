// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    conversation as kpLib,
    splitLargeTextIntoChunks,
} from "knowledge-processor";
import * as cheerio from "cheerio";
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { HtmlFetcher } from "../htmlFetcher.js";
import {
    ExtractionMode,
    ExtractionConfig,
    ExtractionInput,
    ExtractionResult,
    ExtractionOptions,
    ExtractionQualityMetrics,
    EXTRACTION_MODE_CONFIGS,
    AIModelRequiredError,
    AIExtractionFailedError,
    ChunkProgressInfo,
    EntityFacet,
    TopicCorrelation,
    TemporalContext,
} from "./types.js";
import registerDebug from "debug";
const debug = registerDebug("typeagent:browser:indexing");

/**
 * Enhanced ContentExtractor with extraction mode capabilities
 * Provides unified content extraction with automatic AI usage and knowledge extraction
 */
export class ContentExtractor {
    private knowledgeExtractor?: kpLib.KnowledgeExtractor;
    private extractionConfig?: ExtractionConfig;
    private htmlFetcher: HtmlFetcher;

    constructor(
        inputConfig?: ExtractionConfig & {
            knowledgeExtractor?: kpLib.KnowledgeExtractor;
        },
    ) {
        // Initialize HTML fetcher
        this.htmlFetcher = new HtmlFetcher();
        if (inputConfig?.knowledgeExtractor) {
            this.knowledgeExtractor = inputConfig.knowledgeExtractor;
        }

        if (inputConfig && inputConfig?.mode) {
            // Create a clean config object with only defined values
            const cleanConfig: ExtractionConfig = {
                mode: inputConfig.mode,
            };

            // Only add optional properties if they have values
            if (inputConfig.timeout !== undefined)
                cleanConfig.timeout = inputConfig.timeout;
            if (inputConfig.maxContentLength !== undefined)
                cleanConfig.maxContentLength = inputConfig.maxContentLength;
            if (inputConfig.maxCharsPerChunk !== undefined)
                cleanConfig.maxCharsPerChunk = inputConfig.maxCharsPerChunk;
            if (inputConfig.maxConcurrentExtractions !== undefined)
                cleanConfig.maxConcurrentExtractions =
                    inputConfig.maxConcurrentExtractions;
            if (inputConfig.qualityThreshold !== undefined)
                cleanConfig.qualityThreshold = inputConfig.qualityThreshold;
            if (inputConfig.enableCrossChunkMerging !== undefined)
                cleanConfig.enableCrossChunkMerging =
                    inputConfig.enableCrossChunkMerging;

            this.extractionConfig = cleanConfig;
        }
    }

    /**
     * Get the current extraction configuration
     */
    public getConfig(): ExtractionConfig | undefined {
        return this.extractionConfig;
    }

    /**
     * Estimate the number of chunks for given content
     */
    public estimateChunkCount(content: string, maxChunkSize: number): number {
        if (content.length <= maxChunkSize) {
            return 1;
        }
        return Math.ceil(content.length / (maxChunkSize * 0.8));
    }

    /**
     * Extract content using the specified extraction mode with unified processing
     * This is the main API that consolidates all extraction logic with rich metadata
     */
    async extract(
        content: ExtractionInput,
        mode: ExtractionMode = "content",
        options: ExtractionOptions = {},
    ): Promise<ExtractionResult> {
        const startTime = Date.now();
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];
        const { processingMode = "batch", chunkProgressCallback } = options;

        try {
            // Fetch HTML if needed and not provided
            if (
                mode !== "basic" &&
                !content.htmlContent &&
                !content.htmlFragments &&
                content.url
            ) {
                const fetchResult = await this.htmlFetcher.fetchHtml(
                    content.url,
                );
                if (fetchResult.html) {
                    content.htmlContent = fetchResult.html;
                } else if (fetchResult.error) {
                    // Log the error but continue with title-only processing
                    debug(
                        `Failed to fetch ${content.url}: ${fetchResult.error}`,
                    );
                }
            }

            // Validate AI availability for AI-powered modes
            if (modeConfig.usesAI && !this.knowledgeExtractor) {
                throw new AIModelRequiredError(mode);
            }

            // Extract content based on mode
            const extractedContent = await this.extractContentByMode(
                content,
                mode,
            );

            const knowledge = await this.extractKnowledgeByMode(
                content,
                extractedContent,
                mode,
                chunkProgressCallback,
            );

            // Calculate quality metrics
            const qualityMetrics = this.calculateQualityMetrics(
                knowledge,
                extractedContent,
                modeConfig,
                Date.now() - startTime,
            );

            const processingTime = Date.now() - startTime;

            // Create action summary from detected actions
            let actionSummary;
            if (
                extractedContent.detectedActions &&
                extractedContent.detectedActions.length > 0
            ) {
                const actionTypes = [
                    ...new Set(
                        extractedContent.detectedActions.map(
                            (a: any) => a.actionType,
                        ),
                    ),
                ];
                const highConfidenceActions =
                    extractedContent.detectedActions.filter(
                        (a: any) => a.confidence > 0.8,
                    ).length;
                const actionDistribution =
                    extractedContent.detectedActions.reduce(
                        (acc: any, action: any) => {
                            acc[action.actionType] =
                                (acc[action.actionType] || 0) + 1;
                            return acc;
                        },
                        {},
                    );

                actionSummary = {
                    totalActions: extractedContent.detectedActions.length,
                    actionTypes,
                    highConfidenceActions,
                    actionDistribution,
                };
            }

            // Generate rich metadata for all extractions
            const extractionTimestamp = new Date();
            const entityFacets = await this.generateEntityFacets(
                knowledge,
                extractedContent,
            );
            const topicCorrelations = await this.generateTopicCorrelations(
                knowledge,
                extractedContent,
            );
            const temporalContext = await this.generateTemporalContext(
                extractedContent,
                extractionTimestamp,
            );

            return {
                ...extractedContent,
                knowledge,
                qualityMetrics,
                // Rich metadata fields (always included)
                entityFacets,
                topicCorrelations,
                temporalContext,
                // Processing metadata
                extractionMode: mode,
                aiProcessingUsed: modeConfig.usesAI,
                processingMode,
                extractionTimestamp,
                source: content.source,
                timestamp: new Date().toISOString(),
                processingTime,
                actionSummary,
            };
        } catch (error) {
            if (
                error instanceof AIModelRequiredError ||
                error instanceof AIExtractionFailedError
            ) {
                throw error; // Re-throw extraction-specific errors
            }

            // Wrap other errors with context
            throw new Error(
                `Extraction failed for mode '${mode}': ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * Extract content based on the specified mode
     */
    private async extractContentByMode(
        content: ExtractionInput,
        mode: ExtractionMode,
    ): Promise<any> {
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];

        if (mode === "basic") {
            // Basic mode: minimal extraction
            return {
                pageContent: {
                    title: content.title,
                    mainContent: "",
                    headings: [],
                    wordCount: 0,
                    readingTime: 0,
                },
            };
        }

        // For content/actions/full modes, extract from HTML content
        const htmlContent = this.prepareHtmlContent(content);

        if (!htmlContent) {
            return {
                pageContent: {
                    title: content.title,
                    mainContent: content.textContent || "",
                    headings: [],
                    wordCount: (content.textContent || "").split(/\s+/).length,
                    readingTime: Math.ceil(
                        (content.textContent || "").split(/\s+/).length / 200,
                    ),
                },
            };
        }

        // Basic HTML content extraction - implement essential features here
        const pageContent = this.extractBasicPageContent(
            htmlContent,
            content.title,
            content.textContent,
        );

        // Add detected actions if this mode supports them
        let detectedActions = undefined;
        if (modeConfig.extractsActions) {
            // TODO: Implement action detection using ActionExtractor
            detectedActions = [];
        }

        return {
            pageContent,
            detectedActions,
        };
    }

    /**
     * Extract knowledge using the appropriate strategy for the given mode
     */
    private async extractKnowledgeByMode(
        content: ExtractionInput,
        extractedContent: any,
        mode: ExtractionMode,
        chunkProgressCallback?: (chunkInfo: ChunkProgressInfo) => Promise<void>,
    ): Promise<kpLib.KnowledgeResponse> {
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];

        if (modeConfig.knowledgeStrategy === "basic") {
            if (chunkProgressCallback) {
                await chunkProgressCallback({
                    itemUrl: content.url,
                    itemIndex: 0,
                    chunkIndex: 0,
                    totalChunksInItem: 1,
                    globalChunkIndex: 0,
                    totalChunksGlobal: 1,
                });
            }
            return this.extractBasicKnowledge(content, extractedContent);
        }

        if (!this.knowledgeExtractor) {
            return this.extractBasicKnowledge(content, extractedContent);
        }

        const textContent = this.prepareTextForKnowledge(
            content,
            extractedContent,
        );

        try {
            const result = await this.extractChunkedAIKnowledge(
                textContent,
                modeConfig.defaultChunkSize,
                chunkProgressCallback,
                modeConfig.defaultConcurrentExtractions,
                content.url,
            );
            return result;
        } catch (error) {
            throw new AIExtractionFailedError(mode, error as Error);
        }
    }

    /**
     * Extract basic knowledge without AI
     */
    private extractBasicKnowledge(
        content: ExtractionInput,
        extractedContent: any,
    ): kpLib.KnowledgeResponse {
        const knowledge: kpLib.KnowledgeResponse = {
            topics: [],
            entities: [],
            actions: [],
            inverseActions: [],
        };

        const title =
            content.title || extractedContent.pageContent?.title || "";
        const headings = extractedContent.pageContent?.headings || [];
        const textContent =
            extractedContent.pageContent?.mainContent ||
            content.textContent ||
            "";

        // Create entities from title and headings
        if (title) {
            knowledge.entities.push({
                name: title,
                type: ["title"],
                facets: [
                    { name: "source", value: "title_extraction" },
                    { name: "confidence", value: 0.8 },
                ],
            });
        }

        headings.forEach((heading: any) => {
            if (heading.text && heading.text.length > 3) {
                knowledge.entities.push({
                    name: heading.text,
                    type: ["heading"],
                    facets: [
                        { name: "source", value: "heading_extraction" },
                        { name: "confidence", value: 0.7 },
                        { name: "level", value: heading.level || 1 },
                    ],
                });
            }
        });

        // Extract topics from text patterns
        if (textContent) {
            const lines = textContent
                .split("\n")
                .map((line: string) => line.trim())
                .filter((line: string) => line.length > 0);

            const potentialTitles = lines.filter(
                (line: string) =>
                    line.length > 5 &&
                    line.length < 100 &&
                    !line.includes(".") &&
                    line.charAt(0) === line.charAt(0).toUpperCase(),
            );

            knowledge.topics.push(...potentialTitles.slice(0, 10));

            // Extract entities from capitalized words
            const words = textContent.split(/\s+/);
            const capitalizedWords = words.filter(
                (word: string) =>
                    word.length > 2 &&
                    word.charAt(0) === word.charAt(0).toUpperCase() &&
                    /^[A-Za-z]+$/.test(word),
            );

            const uniqueCapitalizedWords = [...new Set(capitalizedWords)].slice(
                0,
                5,
            ) as string[];
            for (const word of uniqueCapitalizedWords) {
                knowledge.entities.push({
                    name: word,
                    type: ["concept"],
                    facets: [
                        { name: "source", value: "text_analysis" },
                        { name: "confidence", value: 0.3 },
                    ],
                });
            }
        }

        // Add domain-based topics
        if (content.url) {
            try {
                const domain = new URL(content.url).hostname.replace(
                    "www.",
                    "",
                );
                knowledge.topics.push(domain);
            } catch {
                // Invalid URL, skip domain topic
            }
        }

        // Limit entities to prevent overwhelming the response
        knowledge.entities = knowledge.entities.slice(0, 15);

        return knowledge;
    }

    /**
     * Prepare text content for knowledge extraction
     */
    private prepareTextForKnowledge(
        content: ExtractionInput,
        extractedContent: any,
    ): string {
        const parts: string[] = [];

        // Add title
        if (content.title) {
            parts.push(`Title: ${content.title}`);
        }

        // Add main content
        if (extractedContent.pageContent?.mainContent) {
            parts.push(extractedContent.pageContent.mainContent);
        } else if (content.textContent) {
            parts.push(content.textContent);
        }

        // Add headings
        if (extractedContent.pageContent?.headings) {
            const headingText = extractedContent.pageContent.headings
                .map((h: any) => h.text)
                .filter((text: string) => text && text.length > 0)
                .join(". ");
            if (headingText) {
                parts.push(`Headings: ${headingText}`);
            }
        }

        return parts.join("\n\n");
    }

    /**
     * Prepare HTML content for extraction
     */
    private prepareHtmlContent(content: ExtractionInput): string | null {
        if (content.htmlContent) {
            return content.htmlContent;
        }

        if (content.htmlFragments && content.htmlFragments.length > 0) {
            // Handle iframe fragments properly - each should maintain its context
            if (content.htmlFragments.length === 1) {
                // Single fragment (ideal case for iframe isolation)
                const frag = content.htmlFragments[0];
                return typeof frag === "string" ? frag : frag.content || "";
            } else {
                // Multiple fragments - preserve iframe boundaries with context markers
                return content.htmlFragments
                    .map((frag, index) => {
                        const fragmentContent =
                            typeof frag === "string"
                                ? frag
                                : frag.content || "";
                        const frameId = frag.frameId || index;
                        // Add iframe context markers to preserve boundaries
                        return `<!-- IFRAME_START:${frameId} -->\n${fragmentContent}\n<!-- IFRAME_END:${frameId} -->`;
                    })
                    .join("\n\n");
            }
        }

        return null;
    }

    /**
     * Calculate quality metrics for the extraction result
     */
    private calculateQualityMetrics(
        knowledge: kpLib.KnowledgeResponse,
        extractedContent: any,
        modeConfig: any,
        aiProcessingTime: number,
    ): ExtractionQualityMetrics {
        const entityCount = knowledge.entities?.length || 0;
        const topicCount = knowledge.topics?.length || 0;
        const actionCount = knowledge.actions?.length || 0;

        // Calculate confidence based on entity and topic counts
        let confidence = 0.1; // Base confidence
        if (entityCount > 0) confidence += Math.min(entityCount / 10, 0.4);
        if (topicCount > 0) confidence += Math.min(topicCount / 5, 0.3);
        if (actionCount > 0) confidence += Math.min(actionCount / 5, 0.2);

        return {
            confidence: Math.min(confidence, 1.0),
            entityCount,
            topicCount,
            actionCount,
            extractionTime: aiProcessingTime,
            knowledgeStrategy: modeConfig.knowledgeStrategy,
        };
    }

    /**
     * Get the capabilities of a specific extraction mode
     */
    public getModeCapabilities(mode: ExtractionMode): {
        usesAI: boolean;
        extractsActions: boolean;
        extractsRelationships: boolean;
        knowledgeStrategy: "basic" | "hybrid";
        requiresAI: boolean;
    } {
        const config = EXTRACTION_MODE_CONFIGS[mode];
        return {
            usesAI: config.usesAI,
            extractsActions: config.extractsActions,
            extractsRelationships: config.extractsRelationships,
            knowledgeStrategy: config.knowledgeStrategy,
            requiresAI: config.usesAI,
        };
    }

    /**
     * Check if the extractor is properly configured for a given mode
     */
    public isConfiguredForMode(mode: ExtractionMode): boolean {
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];
        if (modeConfig.usesAI) {
            return !!this.knowledgeExtractor;
        }
        return true; // Basic mode always works
    }

    /**
     * Basic HTML content extraction using proper HTML parsing
     */
    private extractBasicPageContent(
        html: string,
        title: string,
        content: string | undefined,
    ): any {
        try {
            // Use cheerio for proper HTML parsing
            const $ = cheerio.load(html);

            // Remove script and style elements
            $("script, style, noscript").remove();

            // Extract title if not provided
            const extractedTitle =
                title ||
                $("title").text().trim() ||
                $("h1").first().text().trim();

            let mainContent = content;

            if (!mainContent) {
                // Extract main content from body or fall back to entire document
                const bodyText = $("body").text() || $.text();
                mainContent = bodyText.replace(/\s+/g, " ").trim();
            }

            // Extract headings
            const headings: string[] = [];
            $("h1, h2, h3, h4, h5, h6").each((_, element) => {
                const heading = $(element).text().trim();
                if (heading) {
                    headings.push(heading);
                }
            });

            // Basic word count and reading time calculation
            const words = mainContent.split(/\s+/).length;
            const readingTime = Math.max(1, Math.round(words / 200)); // ~200 words per minute

            return {
                title: extractedTitle,
                mainContent,
                headings,
                wordCount: words,
                readingTime,
                images: [], // Basic extraction doesn't include images
                links: [], // Basic extraction doesn't include links
            };
        } catch (error) {
            debug(
                "Cheerio parsing failed, falling back to simple extraction:",
                error,
            );

            // Fallback to simple string manipulation if cheerio fails
            const window = new JSDOM("").window;
            const purify = DOMPurify(window);
            const sanitizedContent = purify.sanitize(html);
            const textContent = sanitizedContent.replace(/\s+/g, " ").trim();

            const words = textContent.split(/\s+/).length;

            return {
                title: title || "Untitled",
                mainContent: textContent,
                headings: [],
                wordCount: words,
                readingTime: Math.max(1, Math.round(words / 200)),
                images: [],
                links: [],
            };
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
        itemUrl: string = "",
    ): Promise<kpLib.KnowledgeResponse> {
        if (!this.knowledgeExtractor) {
            throw new Error("Knowledge extractor not available");
        }

        if (content.length <= maxChunkSize) {
            if (chunkProgressCallback) {
                await chunkProgressCallback({
                    itemUrl,
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

                        if (result) {
                            chunkResults.push(result);
                        }
                        if (chunkProgressCallback) {
                            await chunkProgressCallback({
                                itemUrl,
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
                                itemUrl,
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

            await Promise.allSettled(batchPromises);

            if (i + maxConcurrent < chunks.length) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }

        return this.aggregateChunkResults(chunkResults);
    }

    /**
     * Intelligently chunk content using knowledge-processor's semantic-aware chunking
     */
    private intelligentChunking(
        content: string,
        maxChunkSize: number,
        preserveStructure: boolean = true,
    ): string[] {
        return Array.from(
            splitLargeTextIntoChunks(content, maxChunkSize, preserveStructure),
        );
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

        chunkResults.forEach((result) => {
            result.topics.forEach((topic) => {
                const normalized = topic.toLowerCase();
                topicCounts.set(
                    normalized,
                    (topicCounts.get(normalized) || 0) + 1,
                );
            });

            result.entities.forEach((entity) => {
                const normalized = entity.name.toLowerCase();
                const existing = entityMap.get(normalized);
                if (existing) {
                    existing.count++;
                } else {
                    entityMap.set(normalized, { entity, count: 1 });
                }
            });

            allActions.push(...(result.actions || []));
        });

        aggregated.topics = Array.from(topicCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([topic]) => topic);

        aggregated.entities = Array.from(entityMap.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 30)
            .map((item) => item.entity);

        aggregated.actions = allActions.slice(0, 15);
        aggregated.inverseActions = [];

        return aggregated;
    }

    /**
     * Generate entity facets from knowledge and content
     */
    private async generateEntityFacets(
        knowledge: kpLib.KnowledgeResponse,
        extractedContent: any,
    ): Promise<Map<string, EntityFacet[]>> {
        const entityFacets = new Map<string, EntityFacet[]>();

        // Process entities from knowledge response
        if (knowledge.entities) {
            for (const entity of knowledge.entities) {
                const entityType =
                    typeof entity === "string" ? "generic" : "specific";
                const entityName =
                    typeof entity === "string" ? entity : String(entity);

                const facet: EntityFacet = {
                    entityName,
                    entityType,
                    attributes: {},
                    confidence: 0.8,
                };

                const existing = entityFacets.get(entityName) || [];
                existing.push(facet);
                entityFacets.set(entityName, existing);
            }
        }

        return entityFacets;
    }

    /**
     * Generate topic correlations from knowledge
     */
    private async generateTopicCorrelations(
        knowledge: kpLib.KnowledgeResponse,
        extractedContent: any,
    ): Promise<TopicCorrelation[]> {
        const correlations: TopicCorrelation[] = [];

        // Process topics from knowledge response
        if (knowledge.topics && knowledge.topics.length > 0) {
            for (let i = 0; i < knowledge.topics.length; i++) {
                const topic = knowledge.topics[i];
                const relatedTopics = knowledge.topics
                    .filter((_, index) => index !== i)
                    .slice(0, 3);

                correlations.push({
                    topic: typeof topic === "string" ? topic : String(topic),
                    relatedTopics: relatedTopics.map((t) =>
                        typeof t === "string" ? t : String(t),
                    ),
                    strength: 0.7,
                    context: extractedContent.pageContent?.title || "Unknown",
                });
            }
        }

        return correlations;
    }

    /**
     * Generate temporal context for extraction
     */
    private async generateTemporalContext(
        extractedContent: any,
        extractionTimestamp: Date,
    ): Promise<TemporalContext> {
        const timeReferences: string[] = [];

        // Extract potential time references from content
        if (extractedContent.pageContent?.mainContent) {
            const timeRegex =
                /\b(\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;
            const matches =
                extractedContent.pageContent.mainContent.match(timeRegex);
            if (matches) {
                timeReferences.push(...matches.slice(0, 5));
            }
        }

        return {
            extractionDate: extractionTimestamp,
            timeReferences,
        };
    }
}
