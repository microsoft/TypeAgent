// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import { ContentExtractor as BaseContentExtractor } from "../contentExtractor.js";
import { AIModelManager } from "./aiModelManager.js";
import {
    ExtractionMode,
    ExtractionConfig,
    ExtractionInput,
    ExtractionResult,
    ExtractionQualityMetrics,
    EXTRACTION_MODE_CONFIGS,
    AIModelRequiredError,
    AIExtractionFailedError
} from "./types.js";

/**
 * Enhanced ContentExtractor with extraction mode capabilities
 * Extends the base ContentExtractor with automatic AI usage and knowledge extraction
 */
export class ContentExtractor extends BaseContentExtractor {
    private aiModelManager?: AIModelManager;

    constructor(config?: ExtractionConfig & { knowledgeExtractor?: kpLib.KnowledgeExtractor }) {
        // Convert extraction config to base config format
        const baseConfig = config ? {
            timeout: config.timeout || 10000,
            maxContentLength: config.maxContentLength || 1000000,
            enableActionDetection: true, // Will be controlled by mode
            enableKnowledgeExtraction: false, // We handle this ourselves
        } : undefined;

        super(baseConfig);

        if (config) {
            const modeConfig = EXTRACTION_MODE_CONFIGS[config.mode];
            
            // Create AI model manager if AI is needed for this mode
            if (modeConfig.usesAI && config.knowledgeExtractor) {
                this.aiModelManager = new AIModelManager(config.knowledgeExtractor);
            }
        }
    }

    /**
     * Extract content using the specified extraction mode
     * This is the main new API that consolidates all extraction logic
     */
    async extract(
        content: ExtractionInput,
        mode: ExtractionMode = "content"
    ): Promise<ExtractionResult> {
        const startTime = Date.now();
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];

        try {
            // Validate AI availability for AI-powered modes
            if (modeConfig.usesAI) {
                if (!this.aiModelManager) {
                    throw new AIModelRequiredError(mode);
                }
                this.aiModelManager.validateAvailability(mode);
            }

            // Extract content based on mode
            const extractedContent = await this.extractContentByMode(content, mode);

            // Extract knowledge using automatic strategy
            const knowledge = await this.extractKnowledgeByMode(
                content,
                extractedContent,
                mode
            );

            // Calculate quality metrics
            const qualityMetrics = this.calculateQualityMetrics(
                knowledge,
                extractedContent,
                modeConfig,
                Date.now() - startTime
            );

            return {
                ...extractedContent,
                knowledge,
                qualityMetrics,
                extractionMode: mode,
                aiProcessingUsed: modeConfig.usesAI,
                source: content.source,
                timestamp: new Date().toISOString(),
                processingTime: Date.now() - startTime,
            };

        } catch (error) {
            if (error instanceof AIModelRequiredError || error instanceof AIExtractionFailedError) {
                throw error; // Re-throw extraction-specific errors
            }

            // Wrap other errors with context
            throw new Error(
                `Extraction failed for mode '${mode}': ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Extract content based on the specified mode
     */
    private async extractContentByMode(
        content: ExtractionInput,
        mode: ExtractionMode
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

        // For content/actions/full modes, use base ContentExtractor functionality
        const htmlContent = this.prepareHtmlContent(content);
        
        if (!htmlContent) {
            return {
                pageContent: {
                    title: content.title,
                    mainContent: content.textContent || "",
                    headings: [],
                    wordCount: (content.textContent || "").split(/\s+/).length,
                    readingTime: Math.ceil((content.textContent || "").split(/\s+/).length / 200),
                },
            };
        }

        // Use base class extraction with appropriate mode
        const baseResult = await this.extractFromHtml(htmlContent, "content");
        
        // Add detected actions if this mode supports them
        let detectedActions = undefined;
        if (modeConfig.extractsActions) {
            // TODO: Implement action detection
            detectedActions = [];
        }

        return {
            pageContent: baseResult,
            detectedActions,
        };
    }

    /**
     * Extract knowledge using the appropriate strategy for the given mode
     */
    private async extractKnowledgeByMode(
        content: ExtractionInput,
        extractedContent: any,
        mode: ExtractionMode
    ): Promise<kpLib.KnowledgeResponse> {
        if (!this.aiModelManager) {
            // Basic knowledge extraction without AI
            return this.extractBasicKnowledgeLocal(content, extractedContent);
        }

        const textContent = this.prepareTextForKnowledge(content, extractedContent);
        return await this.aiModelManager.extractKnowledge(textContent, mode);
    }

    /**
     * Extract basic knowledge without AI
     */
    private extractBasicKnowledgeLocal(
        content: ExtractionInput,
        extractedContent: any
    ): kpLib.KnowledgeResponse {
        const title = content.title || extractedContent.pageContent?.title || "";
        const headings = extractedContent.pageContent?.headings || [];
        
        // Create basic entities from title and headings
        const entities: any[] = [];
        if (title) {
            entities.push({
                name: title,
                type: "title",
                description: `Title of the webpage: ${title}`
            });
        }

        headings.forEach((heading: any, index: number) => {
            if (heading.text && heading.text.length > 3) {
                entities.push({
                    name: heading.text,
                    type: "heading",
                    description: `Section heading (level ${heading.level}): ${heading.text}`
                });
            }
        });

        // Create basic topics from URL domain
        const topics: any[] = [];
        try {
            const domain = new URL(content.url).hostname.replace('www.', '');
            topics.push({
                name: domain,
                confidence: 0.5
            });
        } catch {
            // Invalid URL, skip domain topic
        }

        return {
            entities: entities.slice(0, 10), // Limit to 10 entities
            topics: topics,
            actions: [],
            inverseActions: []
        };
    }

    /**
     * Prepare text content for knowledge extraction
     */
    private prepareTextForKnowledge(
        content: ExtractionInput,
        extractedContent: any
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
                .join('. ');
            if (headingText) {
                parts.push(`Headings: ${headingText}`);
            }
        }

        return parts.join('\n\n');
    }

    /**
     * Prepare HTML content for extraction
     */
    private prepareHtmlContent(content: ExtractionInput): string | null {
        if (content.htmlContent) {
            return content.htmlContent;
        }
        
        if (content.htmlFragments && content.htmlFragments.length > 0) {
            // Combine HTML fragments
            return content.htmlFragments
                .map(frag => typeof frag === 'string' ? frag : frag.html || '')
                .join('\n');
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
        aiProcessingTime: number
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
            requiresAI: config.usesAI, // Same as usesAI - no fallbacks
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
}
