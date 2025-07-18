// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import { openai as ai } from "aiclient";
import { 
    ContentExtractor,
    ExtractionMode,
    ExtractionInput,
    ExtractionResult
} from "website-memory";
import { ContentSummaryAdapter } from "./contentSummaryAdapter.mjs";

/**
 * Specialized knowledge extractor for indexing service
 * Runs without full session context but uses browser agent infrastructure
 */
export class IndexingKnowledgeExtractor {
    private contentSummaryAdapter: ContentSummaryAdapter;
    private knowledgeExtractor: any | undefined;
    private isInitialized: boolean = false;

    constructor() {
        this.contentSummaryAdapter = new ContentSummaryAdapter();
    }

    /**
     * Initialize AI models and adapters
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            console.log("Initializing indexing knowledge extractor...");
            
            // Initialize AI models (same pattern as BrowserKnowledgeExtractor)
            const apiSettings = ai.azureApiSettingsFromEnv(ai.ModelType.Chat);
            const languageModel = ai.createChatModel(apiSettings);
            this.knowledgeExtractor = kpLib.createKnowledgeExtractor(languageModel);
            
            // Initialize content summary adapter
            await this.contentSummaryAdapter.ensureInitialized();
            
            this.isInitialized = true;
            console.log("Indexing knowledge extractor initialized successfully");
            
        } catch (error) {
            console.warn("AI model initialization failed for indexing:", error);
            this.knowledgeExtractor = undefined;
            this.isInitialized = true; // Mark as attempted
        }
    }

    /**
     * Extract knowledge with optional summary enhancement
     */
    async extractKnowledge(
        content: ExtractionInput, 
        mode: ExtractionMode
    ): Promise<ExtractionResult> {
        const startTime = Date.now();
        
        try {
            console.log(`Extracting knowledge for ${content.url} using ${mode} mode`);
            
            // Create content extractor with our knowledge extractor
            const config: any = { mode };
            if (this.knowledgeExtractor) {
                config.knowledgeExtractor = this.knowledgeExtractor;
            }
            
            const extractor = new ContentExtractor(config);
            const result = await extractor.extract(content, mode);
            
            // Apply summary enhancement for summary mode when AI is available
            if (mode === ("summary" as ExtractionMode) && 
                this.contentSummaryAdapter.isAvailable() && 
                this.knowledgeExtractor) {
                await this.enhanceWithSummary(result, content);
            }
            
            // Update processing time
            result.processingTime = Date.now() - startTime;
            result.extractionTime = result.processingTime;
            
            console.log(`Knowledge extraction completed in ${result.processingTime}ms`);
            return result;
            
        } catch (error) {
            console.error("Knowledge extraction failed:", error);
            
            // Return basic result with error information
            return {
                success: false,
                knowledge: {} as any,
                extractionMode: mode,
                aiProcessingUsed: false,
                source: content.url || "unknown",
                timestamp: new Date().toISOString(),
                processingTime: Date.now() - startTime,
                extractionTime: Date.now() - startTime,
                error: error instanceof Error ? error.message : "Unknown error",
                qualityMetrics: {
                    confidence: 0,
                    entityCount: 0,
                    topicCount: 0,
                    actionCount: 0,
                    extractionTime: Date.now() - startTime,
                    knowledgeStrategy: "basic" as const,
                }
            };
        }
    }

    /**
     * Apply summary enhancement to extraction result
     */
    private async enhanceWithSummary(result: any, content: ExtractionInput): Promise<void> {
        try {
            console.log("Applying summary enhancement...");
            
            // Get text content from extraction result or input
            const textContent = this.prepareTextFromResult(result, content);
            
            if (!textContent || textContent.length < 200) {
                console.log("Insufficient text content for summarization");
                return;
            }

            const startTime = Date.now();
            
            // Apply summary enhancement with context information
            const enhancementOptions: any = {
                url: content.url,
                title: content.title,
                includeContextInEnhancedText: true,
            };
            
            const bookmarkFolder = this.extractBookmarkFolder(content);
            if (bookmarkFolder) {
                enhancementOptions.bookmarkFolder = bookmarkFolder;
            }
            
            const { enhancedText, summaryData, processingTime } = 
                await this.contentSummaryAdapter.enhanceWithSummary(textContent, ("summary" as ExtractionMode), enhancementOptions);

            if (summaryData) {
                console.log(`Summary generated in ${processingTime}ms, enhancing extraction result...`);
                
                // Add summary data to result
                result.summaryData = summaryData;
                result.enhancedWithSummary = true;
                result.summaryProcessingTime = processingTime;
                
                // If we have knowledge extractor, re-process with enhanced text
                if (this.knowledgeExtractor && enhancedText !== textContent) {
                    try {
                        const enhancedKnowledge = await this.knowledgeExtractor.extractKnowledge(
                            enhancedText, 
                            ("summary" as ExtractionMode)
                        );

                        if (enhancedKnowledge) {
                            // Merge enhanced knowledge with existing
                            if (typeof result.knowledge === 'object' && typeof enhancedKnowledge === 'object') {
                                result.knowledge = { ...result.knowledge, ...enhancedKnowledge };
                            } else {
                                result.knowledge = enhancedKnowledge;
                            }
                            
                            console.log("Knowledge enhanced with summary data and context");
                        }
                    } catch (enhanceError) {
                        console.warn("Failed to enhance knowledge with summary:", enhanceError);
                    }
                }
                
                // Update quality metrics with summary bonus
                if (result.qualityMetrics) {
                    result.qualityMetrics.confidence = Math.min(1.0, result.qualityMetrics.confidence + 0.2);
                    if (summaryData.entities?.length > 0) {
                        result.qualityMetrics.entityCount += summaryData.entities.length;
                    }
                    if (summaryData.topics?.length > 0) {
                        result.qualityMetrics.topicCount += summaryData.topics.length;
                    }
                }
                
                console.log(`Enhanced extraction completed in ${Date.now() - startTime}ms total`);
            }

        } catch (error) {
            console.warn("Summary enhancement failed:", error);
            // Don't fail the entire extraction - graceful degradation
        }
    }

    /**
     * Extract bookmark folder information from content input
     */
    private extractBookmarkFolder(content: ExtractionInput): string | undefined {
        // Check if content has folder information
        // This might come from the website metadata or import process
        if ((content as any).folder) {
            return (content as any).folder;
        }
        
        // Could also extract from URL path for some cases
        if (content.url) {
            try {
                const url = new URL(content.url);
                // For some bookmark systems, folder info might be in URL parameters
                const folderParam = url.searchParams.get('folder') || url.searchParams.get('path');
                if (folderParam) {
                    return folderParam;
                }
            } catch {
                // Invalid URL, continue without folder info
            }
        }
        
        return undefined;
    }

    /**
     * Prepare text content from extraction result for summarization
     */
    private prepareTextFromResult(result: any, content: ExtractionInput): string {
        const parts: string[] = [];
        
        // Add title
        if (content.title) {
            parts.push(`Title: ${content.title}`);
        }
        
        // Add main content from extraction
        if (result.pageContent?.mainContent) {
            parts.push(result.pageContent.mainContent);
        } else if (result.pageContent?.textContent) {
            parts.push(result.pageContent.textContent);
        } else if (content.textContent) {
            parts.push(content.textContent);
        }
        
        // Add headings if available
        if (result.pageContent?.headings && Array.isArray(result.pageContent.headings)) {
            const headingText = result.pageContent.headings
                .map((h: any) => h.text || h.content || h)
                .filter((text: string) => text && text.length > 0)
                .join(". ");
            if (headingText) {
                parts.push(`Headings: ${headingText}`);
            }
        }
        
        // Add meta description if available
        if (result.pageContent?.metaTags?.description) {
            parts.push(`Description: ${result.pageContent.metaTags.description}`);
        }
        
        // Add any existing knowledge as context
        if (result.knowledge && typeof result.knowledge === 'string') {
            parts.push(`Existing Knowledge: ${result.knowledge}`);
        } else if (result.knowledge?.text) {
            parts.push(`Existing Knowledge: ${result.knowledge.text}`);
        }
        
        return parts.join('\n\n').trim();
    }

    /**
     * Get extraction mode based on URL domain
     */
    getExtractionModeForUrl(url: string): ExtractionMode {
        // Default to summary mode for balanced processing
        return "summary" as ExtractionMode;
    }

    /**
     * Check if the extractor is properly initialized
     */
    isReady(): boolean {
        return this.isInitialized;
    }

    /**
     * Check if AI processing is available
     */
    hasAICapabilities(): boolean {
        return this.knowledgeExtractor !== undefined;
    }

    /**
     * Get capabilities summary
     */
    getCapabilities() {
        return {
            initialized: this.isReady(),
            aiAvailable: this.hasAICapabilities(),
            summaryEnhancement: this.contentSummaryAdapter.isAvailable(),
            supportedModes: ["basic", "summary", "content", "actions", "full"],
            defaultMode: "summary",
            domainOptimization: false,
        };
    }
}
