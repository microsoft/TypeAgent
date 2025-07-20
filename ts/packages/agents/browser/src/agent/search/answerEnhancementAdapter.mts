// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Website } from "website-memory";
import { QueryAnalysis } from "./schema/queryAnalysis.mjs";
import { AnswerEnhancement } from "./schema/answerEnhancement.mjs";
import { AnswerGenerator } from "./answerGenerator.mjs";
import { ContextBuilder } from "./utils/contextBuilder.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:answer-enhancement");

/**
 * AnswerEnhancementAdapter generates dynamic AI summaries and smart follow-up suggestions
 * in a single efficient LLM call, replacing static/templated responses.
 */
export class AnswerEnhancementAdapter {
    private answerGenerator: AnswerGenerator;
    private contextBuilder: ContextBuilder;
    private isInitialized: boolean = false;

    constructor() {
        this.answerGenerator = new AnswerGenerator();
        this.contextBuilder = new ContextBuilder();
    }

    /**
     * Enhance search results with dynamic summary and smart follow-up suggestions
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

            // Generate enhanced summary and follow-ups
            const enhancement = await this.answerGenerator.generateEnhancement(
                originalQuery,
                queryAnalysis,
                searchContext
            );

            if (!enhancement) {
                debug("Enhancement generation failed, skipping enhancement");
                return undefined;
            }

            // Update generation time with actual elapsed time
            const actualGenerationTime = Date.now() - startTime;
            const finalEnhancement: AnswerEnhancement = {
                ...enhancement,
                generationTime: actualGenerationTime
            };

            debug(`Enhancement complete in ${actualGenerationTime}ms with confidence: ${finalEnhancement.confidence}`);
            debug(`Generated summary with ${finalEnhancement.summary.keyFindings.length} key findings`);
            debug(`Generated ${finalEnhancement.followups.length} follow-up suggestions`);

            return finalEnhancement;

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
            // Generator initializes itself when first used
            this.isInitialized = true;
            debug("AnswerEnhancementAdapter initialized successfully");
        } catch (error) {
            debug(`Failed to initialize AnswerEnhancementAdapter: ${error}`);
            throw error;
        }
    }
}
