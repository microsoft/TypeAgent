// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import * as cheerio from "cheerio";
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { AIModelManager } from "./aiModelManager.js";
import { HtmlFetcher } from "../htmlFetcher.js";
import {
    ExtractionMode,
    ExtractionConfig,
    ExtractionInput,
    ExtractionResult,
    ExtractionQualityMetrics,
    EXTRACTION_MODE_CONFIGS,
    AIModelRequiredError,
    AIExtractionFailedError,
} from "./types.js";


/**
 * Enhanced ContentExtractor with extraction mode capabilities
 * Provides unified content extraction with automatic AI usage and knowledge extraction
 */
export class ContentExtractor {
    private aiModelManager?: AIModelManager;
    private extractionConfig?: ExtractionConfig;
    private htmlFetcher: HtmlFetcher;

    constructor(
        inputConfig?: ExtractionConfig & {
            knowledgeExtractor?: kpLib.KnowledgeExtractor;
        },
    ) {
        // Initialize HTML fetcher
        this.htmlFetcher = new HtmlFetcher();

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

            const modeConfig = EXTRACTION_MODE_CONFIGS[inputConfig.mode];

            // Create AI model manager if AI is needed for this mode
            if (modeConfig.usesAI && inputConfig.knowledgeExtractor) {
                this.aiModelManager = new AIModelManager(
                    inputConfig.knowledgeExtractor,
                );
            }
        }
    }

    /**
     * Get the current extraction configuration
     */
    public getConfig(): ExtractionConfig | undefined {
        return this.extractionConfig;
    }

    /**
     * Extract content using the specified extraction mode
     * This is the main new API that consolidates all extraction logic
     */
    async extract(
        content: ExtractionInput,
        mode: ExtractionMode = "content",
    ): Promise<ExtractionResult> {
        const startTime = Date.now();
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];

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
                    console.warn(
                        `Failed to fetch ${content.url}: ${fetchResult.error}`,
                    );
                }
            }

            // Validate AI availability for AI-powered modes
            if (modeConfig.usesAI) {
                if (!this.aiModelManager) {
                    throw new AIModelRequiredError(mode);
                }
                this.aiModelManager.validateAvailability(mode);
            }

            // Extract content based on mode
            const extractedContent = await this.extractContentByMode(
                content,
                mode,
            );

            // Extract knowledge using automatic strategy
            const knowledge = await this.extractKnowledgeByMode(
                content,
                extractedContent,
                mode,
            );

            // Calculate quality metrics
            const qualityMetrics = this.calculateQualityMetrics(
                knowledge,
                extractedContent,
                modeConfig,
                Date.now() - startTime,
            );

            const processingTime = Date.now() - startTime;

            // Convert DetectedAction[] to ActionInfo[] for legacy compatibility
            const actions = extractedContent.detectedActions?.map(
                (da: any) => ({
                    type: da.actionType as "form" | "button" | "link",
                    action: da.selector,
                    method: da.method,
                    text: da.description,
                }),
            );

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

            return {
                ...extractedContent,
                knowledge,
                qualityMetrics,
                extractionMode: mode,
                aiProcessingUsed: modeConfig.usesAI,
                source: content.source,
                timestamp: new Date().toISOString(),
                processingTime,
                // Compatibility properties
                success: true,
                extractionTime: processingTime,
                actions,
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
            content.textContent
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
    ): Promise<kpLib.KnowledgeResponse> {
        if (!this.aiModelManager) {
            // Basic knowledge extraction without AI
            return this.extractBasicKnowledgeLocal(content, extractedContent);
        }

        const textContent = this.prepareTextForKnowledge(
            content,
            extractedContent,
        );
        return await this.aiModelManager.extractKnowledge(textContent, mode);
    }

    /**
     * Extract basic knowledge without AI
     */
    private extractBasicKnowledgeLocal(
        content: ExtractionInput,
        extractedContent: any,
    ): kpLib.KnowledgeResponse {
        const title =
            content.title || extractedContent.pageContent?.title || "";
        const headings = extractedContent.pageContent?.headings || [];

        // Create basic entities from title and headings
        const entities: any[] = [];
        if (title) {
            entities.push({
                name: title,
                type: "title",
                description: `Title of the webpage: ${title}`,
            });
        }

        headings.forEach((heading: any, index: number) => {
            if (heading.text && heading.text.length > 3) {
                entities.push({
                    name: heading.text,
                    type: "heading",
                    description: `Section heading (level ${heading.level}): ${heading.text}`,
                });
            }
        });

        // Create basic topics from URL domain
        const topics: any[] = [];
        try {
            const domain = new URL(content.url).hostname.replace("www.", "");
            topics.push({
                name: domain,
                confidence: 0.5,
            });
        } catch {
            // Invalid URL, skip domain topic
        }

        return {
            entities: entities.slice(0, 10), // Limit to 10 entities
            topics: topics,
            actions: [],
            inverseActions: [],
        };
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
            return !!this.aiModelManager;
        }
        return true; // Basic mode always works
    }

    /**
     * Basic HTML content extraction using proper HTML parsing
     */
    private extractBasicPageContent(html: string, title: string, content: string | undefined): any {
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
            
            if(!mainContent){
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
            console.warn(
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
}
