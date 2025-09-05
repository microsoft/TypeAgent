// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SearchWebMemoriesRequest } from "../searchWebMemories.mjs";
import { Website } from "website-memory";
import { QueryAnalysis } from "./schema/queryAnalysis.mjs";
import { QueryAnalyzer } from "./queryAnalyzer.mjs";
import { MetadataRanker } from "./utils/metadataRanker.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:search-enhancement");

export interface EnhancedSearchContext {
    websiteCollection?: any;
    userContext?: any;
    searchHistory?: string[];
}

/**
 * QueryEnhancementAdapter enhances semantic search with comprehensive LLM-based query understanding.
 * Always performs full analysis for maximum accuracy.
 */
export class QueryEnhancementAdapter {
    private queryAnalyzer: QueryAnalyzer;
    private metadataRanker: MetadataRanker;
    private isInitialized: boolean = false;

    constructor() {
        this.queryAnalyzer = new QueryAnalyzer();
        this.metadataRanker = new MetadataRanker();
    }

    /**
     * Enhance search request with comprehensive LLM-based query understanding
     * Always analyzes every query for maximum accuracy
     */
    async enhanceSearchRequest(
        request: SearchWebMemoriesRequest,
        context: EnhancedSearchContext,
    ): Promise<SearchWebMemoriesRequest> {
        try {
            await this.ensureInitialized();

            debug(`Enhancing search request for query: "${request.query}"`);

            // Always analyze query with LLM for comprehensive understanding
            const analysis = await this.queryAnalyzer.analyzeQuery(
                request.query,
            );

            if (!analysis) {
                debug("No analysis available, returning original request");
                return request;
            }

            debug(`Query analysis: ${JSON.stringify(analysis)}`);

            // Apply analysis to enhance request
            const enhancedRequest = this.applyAnalysisToRequest(
                request,
                analysis,
            );

            // Store analysis for post-processing
            enhancedRequest.metadata = {
                ...enhancedRequest.metadata,
                analysis,
            };

            debug(`Enhanced request: filters applied based on analysis`);
            return enhancedRequest;
        } catch (error) {
            debug(`Error enhancing search request: ${error}`);
            // Graceful degradation: return original request
            return request;
        }
    }

    /**
     * Post-search processing: Apply comprehensive LLM-informed ranking
     */
    async enhanceSearchResults(
        results: Website[],
        originalRequest: SearchWebMemoriesRequest,
        analysis?: QueryAnalysis,
    ): Promise<Website[]> {
        try {
            if (!analysis) {
                // Try to extract analysis from request metadata
                analysis = (originalRequest as any).metadata?.analysis;
            }

            if (!analysis) {
                debug("No analysis available for result enhancement");
                return results;
            }

            debug(
                `Enhancing ${results.length} results with LLM-informed ranking`,
            );
            debug(
                `Analysis: intent=${analysis.intent.type}, ranking=${analysis.ranking?.primaryFactor}`,
            );

            // Always apply LLM-informed ranking when analysis is available
            const rankedResults = await this.metadataRanker.rankByAnalysis(
                results,
                analysis,
            );

            debug(
                `Ranking complete, returning ${rankedResults.length} results`,
            );
            return rankedResults;
        } catch (error) {
            debug(`Error enhancing search results: ${error}`);
            return results;
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            // QueryAnalyzer initializes itself when first used
            this.isInitialized = true;
            debug("QueryEnhancementAdapter initialized successfully");
        } catch (error) {
            debug(`Failed to initialize QueryEnhancementAdapter: ${error}`);
            throw error;
        }
    }

    private optimizeQueryForSemanticSearch(
        query: string,
        analysis: QueryAnalysis,
    ): string {
        let optimizedQuery = query;

        debug(`Optimizing query for semantic search: "${query}"`);
        debug(
            `Analysis: intent=${analysis.intent.type}, content=${JSON.stringify(analysis.content)}`,
        );

        // Remove temporal ranking terms that hurt semantic search (now handled by date filters)
        if (analysis.intent.type === "find_latest") {
            optimizedQuery = optimizedQuery.replace(
                /\b(most recently|latest|most recent)\b/gi,
                "",
            );
        }

        if (analysis.intent.type === "find_earliest") {
            optimizedQuery = optimizedQuery.replace(
                /\b(earliest|first)\b/gi,
                "",
            );
        }

        if (analysis.intent.type === "find_most_frequent") {
            optimizedQuery = optimizedQuery.replace(
                /\b(most often|most visited|most frequently|frequently)\b/gi,
                "",
            );
        }

        // Remove temporal terms that are now handled by date filters
        if (analysis.temporal) {
            optimizedQuery = optimizedQuery.replace(
                /\b(last week|last month|last year|this year|recently|in \d{4}|since \d{4}|before \d{4})\b/gi,
                "",
            );
        }

        // Remove source-specific terms (handled by filters)
        optimizedQuery = optimizedQuery.replace(
            /\b(bookmarked|visited)\b/gi,
            "",
        );

        // Remove summarization requests
        if (analysis.intent.type === "summarize") {
            optimizedQuery = optimizedQuery.replace(
                /\b(summarize|summary of)\b/gi,
                "",
            );
        }

        // Enhance content type terms for better semantic matching
        if (analysis.content?.contentType) {
            switch (analysis.content.contentType) {
                case "repository":
                    optimizedQuery = optimizedQuery.replace(
                        /\brepo\b/gi,
                        "repository",
                    );
                    break;
                case "news":
                    optimizedQuery = optimizedQuery.replace(
                        /\b(news site|news)\b/gi,
                        "news article",
                    );
                    break;
                case "review":
                    // Keep "review" as is - good semantic term
                    break;
                case "article":
                    // Keep "article" as is - good semantic term
                    break;
                case "documentation":
                    optimizedQuery = optimizedQuery.replace(
                        /\bdocs?\b/gi,
                        "documentation",
                    );
                    break;
            }
        }

        // Clean up extra whitespace
        optimizedQuery = optimizedQuery.replace(/\s+/g, " ").trim();

        // Fallback to original if optimization resulted in empty or very short query
        if (optimizedQuery.length < 3) {
            debug(`Optimization resulted in too short query, using original`);
            return query;
        }

        debug(`Query optimization: "${query}" -> "${optimizedQuery}"`);
        return optimizedQuery;
    }

    private applyAnalysisToRequest(
        request: SearchWebMemoriesRequest,
        analysis: QueryAnalysis,
    ): SearchWebMemoriesRequest {
        const enhanced = { ...request };

        debug(`Applying analysis to request: ${JSON.stringify(analysis)}`);

        // NEW: Optimize query for better semantic search
        const optimizedQuery = this.optimizeQueryForSemanticSearch(
            request.query,
            analysis,
        );
        if (optimizedQuery !== request.query) {
            enhanced.query = optimizedQuery;
            debug(
                `Applied query optimization: "${request.query}" -> "${optimizedQuery}"`,
            );
        }

        // Apply temporal filters
        if (analysis.temporal) {
            const { startDate, endDate } = this.queryAnalyzer.getTemporalDates(
                analysis.temporal,
            );
            if (startDate) {
                enhanced.dateFrom = startDate.toISOString();
                if (endDate) {
                    enhanced.dateTo = endDate.toISOString();
                }
                debug(
                    `Applied temporal filter: ${enhanced.dateFrom}${endDate ? ` to ${enhanced.dateTo}` : ""}`,
                );
            }
        }

        // Add domain filtering directly to metadata
        if (analysis.content?.domain) {
            enhanced.metadata = {
                ...enhanced.metadata,
                domainFilter: analysis.content.domain,
            };
        }

        // Store original query and analysis for debugging/logging
        enhanced.metadata = {
            ...enhanced.metadata,
            analysis,
            originalQuery: request.query,
        };

        // Adjust search parameters based on intent for comprehensive results
        switch (analysis.intent.type) {
            case "find_latest":
            case "find_earliest":
                enhanced.limit = Math.max(enhanced.limit || 20, 50);
                debug(
                    `Increased limit to ${enhanced.limit} for temporal query`,
                );
                break;

            case "find_most_frequent":
                enhanced.limit = Math.max(enhanced.limit || 20, 100);
                debug(
                    `Increased limit to ${enhanced.limit} for frequency query`,
                );
                break;

            case "summarize":
                enhanced.limit = Math.max(enhanced.limit || 20, 30);
                enhanced.generateAnswer = true;
                debug(
                    `Configured for summarization: limit=${enhanced.limit}, generateAnswer=true`,
                );
                break;
        }

        return enhanced;
    }
}
