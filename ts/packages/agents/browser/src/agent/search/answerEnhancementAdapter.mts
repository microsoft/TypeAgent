// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Website } from "website-memory";
import { QueryAnalysis } from "./schema/queryAnalysis.mjs";
import { AnswerEnhancement } from "./schema/answerEnhancement.mjs";
import { SummaryGenerator } from "./summaryGenerator.mjs";
import { FollowupGenerator } from "./followupGenerator.mjs";
import { ContextBuilder } from "./utils/contextBuilder.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:answer-enhancement");

/**
 * AnswerEnhancementAdapter generates dynamic AI summaries and smart follow-up suggestions
 * based on actual search results and user queries, replacing static/templated responses.
 */
export class AnswerEnhancementAdapter {
    private summaryGenerator: SummaryGenerator;
    private followupGenerator: FollowupGenerator;
    private contextBuilder: ContextBuilder;
    private isInitialized: boolean = false;

    constructor() {
        this.summaryGenerator = new SummaryGenerator();
        this.followupGenerator = new FollowupGenerator();
        this.contextBuilder = new ContextBuilder();
    }

    /**
     * Enhance search results with dynamic summary and smart follow-up suggestions
     * Currently enhances ALL queries for testing and validation
     */
    async enhanceSearchResults(
        originalQuery: string,
        queryAnalysis: QueryAnalysis | undefined,
        searchResults: Website[]
    ): Promise<AnswerEnhancement | undefined> {
        try {
            const startTime = Date.now();
            await this.ensureInitialized();

            debug(`Enhancing search results for query: "${originalQuery}" with ${searchResults.length} results`);

            // Skip enhancement if no query analysis or insufficient results
            if (!queryAnalysis || searchResults.length === 0) {
                debug("Skipping enhancement: missing query analysis or no results");
                return undefined;
            }

            // Build context from search results
            const searchContext = this.contextBuilder.buildContext(originalQuery, searchResults);
            debug(`Built context with ${searchContext.patterns.dominantDomains.length} domains`);

            // Generate dynamic summary
            const summary = await this.summaryGenerator.generateSummary(
                originalQuery,
                queryAnalysis,
                searchContext
            );

            if (!summary) {
                debug("Summary generation failed, skipping enhancement");
                return undefined;
            }

            debug(`Generated summary with confidence: ${summary.confidence}`);

            // Generate smart follow-ups
            const followups = await this.followupGenerator.generateFollowups(
                originalQuery,
                queryAnalysis,
                searchContext,
                summary
            );

            debug(`Generated ${followups.length} follow-up suggestions`);

            const generationTime = Date.now() - startTime;
            
            // Calculate overall confidence (minimum of summary and followups)
            const followupConfidence = followups.length > 0 
                ? followups.reduce((sum, f) => sum + f.confidence, 0) / followups.length 
                : 0;
            
            const overallConfidence = Math.min(summary.confidence, followupConfidence || 1.0);

            const enhancement: AnswerEnhancement = {
                summary,
                followups,
                confidence: overallConfidence,
                generationTime
            };

            debug(`Enhancement complete in ${generationTime}ms with confidence: ${overallConfidence}`);
            return enhancement;

        } catch (error) {
            debug(`Error enhancing search results: ${error}`);
            return undefined; // Let UI fall back to static content
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            // Generators initialize themselves when first used
            this.isInitialized = true;
            debug("AnswerEnhancementAdapter initialized successfully");
        } catch (error) {
            debug(`Failed to initialize AnswerEnhancementAdapter: ${error}`);
            throw error;
        }
    }
}
