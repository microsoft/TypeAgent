// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ContentExtractor, EnhancedContent, ExtractionMode } from './contentExtractor.js';
import { LLMContentAnalyzer, AnalysisInput } from './llmContentAnalyzer.js';
import { ContentAnalysis } from './contentAnalysisSchema.js';

export interface EnhancedProcessingOptions {
    extractionMode?: ExtractionMode;
    enableLLMAnalysis?: boolean;
    timeout?: number;
    maxConcurrent?: number;
}

export interface ProcessedContent extends EnhancedContent {
    intelligentAnalysis?: ContentAnalysis;
    llmAnalysisTime?: number;
}

/**
 * Enhanced content processor that combines traditional extraction with LLM-based analysis
 */
export class EnhancedContentProcessor {
    private contentExtractor: ContentExtractor;
    private llmAnalyzer: LLMContentAnalyzer;

    constructor(options?: {
        timeout?: number;
        userAgent?: string;
        maxContentLength?: number;
    }) {
        this.contentExtractor = new ContentExtractor(options);
        this.llmAnalyzer = new LLMContentAnalyzer();
    }

    /**
     * Process URL with both traditional extraction and LLM analysis
     */
    async processUrl(url: string, options: EnhancedProcessingOptions = {}): Promise<ProcessedContent> {
        const {
            extractionMode = 'content',
            enableLLMAnalysis = true
        } = options;

        // First, extract content using traditional methods
        const extractedContent = await this.contentExtractor.extractFromUrl(url, extractionMode);
        
        const result: ProcessedContent = { ...extractedContent };

        // If LLM analysis is enabled and extraction was successful, analyze with LLM
        if (enableLLMAnalysis && extractedContent.success) {
            const llmStartTime = Date.now();
            
            try {
                const analysisInput: AnalysisInput = {
                    url
                };
                
                if (extractedContent.pageContent?.title) {
                    analysisInput.title = extractedContent.pageContent.title;
                }
                if (extractedContent.pageContent) {
                    analysisInput.pageContent = extractedContent.pageContent;
                }
                if (extractedContent.metaTags) {
                    analysisInput.metaTags = extractedContent.metaTags;
                }
                if (extractedContent.actions) {
                    analysisInput.actions = extractedContent.actions;
                }

                const intelligentAnalysis = await this.llmAnalyzer.analyzeContent(analysisInput);
                
                if (intelligentAnalysis) {
                    result.intelligentAnalysis = intelligentAnalysis;
                }

                result.llmAnalysisTime = Date.now() - llmStartTime;
            } catch (error) {
                console.warn(`LLM analysis failed for ${url}:`, error);
                result.llmAnalysisTime = Date.now() - llmStartTime;
            }
        }

        return result;
    }

    /**
     * Process multiple URLs with rate limiting and LLM analysis
     */
    async processUrls(
        urls: string[], 
        options: EnhancedProcessingOptions = {}
    ): Promise<ProcessedContent[]> {
        const {
            maxConcurrent = 3,
            extractionMode = 'content',
            enableLLMAnalysis = true
        } = options;

        const results: ProcessedContent[] = [];
        
        // Process URLs in batches to respect rate limits
        for (let i = 0; i < urls.length; i += maxConcurrent) {
            const batch = urls.slice(i, i + maxConcurrent);
            
            const batchPromises = batch.map(url => 
                this.processUrl(url, { extractionMode, enableLLMAnalysis })
                    .catch(error => ({
                        success: false,
                        error: error.message,
                        extractionTime: 0
                    } as ProcessedContent))
            );

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            // Small delay between batches to be respectful
            if (i + maxConcurrent < urls.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        return results;
    }

    /**
     * Determine page type using LLM (enhanced version of hardcoded function)
     */
    async determinePageType(url: string, title?: string, description?: string): Promise<string> {
        return await this.llmAnalyzer.determinePageType(url, title, description);
    }
}
