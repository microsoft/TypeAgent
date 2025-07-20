// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { openai as ai } from "aiclient";
import { DynamicSummary } from "./schema/answerEnhancement.mjs";
import { QueryAnalysis } from "./schema/queryAnalysis.mjs";
import { SearchContext } from "./utils/contextBuilder.mjs";
import registerDebug from "debug";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const debug = registerDebug("typeagent:browser:summary-generator");

function getSchemaFileContents(fileName: string): string {
    const packageRoot = path.join("..", "..", "..");
    return fs.readFileSync(
        fileURLToPath(
            new URL(
                path.join(packageRoot, "./src/agent/search/schema", fileName),
                import.meta.url,
            ),
        ),
        "utf8",
    );
}

/**
 * SummaryGenerator creates dynamic, contextual summaries based on search results
 */
export class SummaryGenerator {
    private summaryTranslator: TypeChatJsonTranslator<DynamicSummary> | null = null;
    private isInitialized: boolean = false;
    private schemaText: string;

    constructor() {
        this.schemaText = getSchemaFileContents("answerEnhancement.mts");
    }

    /**
     * Generate dynamic summary based on query, analysis, and search context
     */
    async generateSummary(
        query: string,
        queryAnalysis: QueryAnalysis,
        searchContext: SearchContext
    ): Promise<DynamicSummary | undefined> {
        try {
            await this.ensureInitialized();

            if (!this.summaryTranslator) {
                debug("Summary translator not available, skipping generation");
                return undefined;
            }

            debug(`Generating summary for query: "${query}" with ${searchContext.totalResults} results`);

            const prompt = this.buildSummaryPrompt(query, queryAnalysis, searchContext);
            const response = await this.summaryTranslator.translate(prompt);

            if (!response.success) {
                debug(`Summary generation failed: ${response.message}`);
                return undefined;
            }

            const summary = response.data;
            debug(`Summary generated with confidence: ${summary.confidence}`);

            return summary;

        } catch (error) {
            debug(`Error generating summary: ${error}`);
            return undefined;
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            const model = ai.createJsonChatModel(
                ai.apiSettingsFromEnv(ai.ModelType.Chat),
                ["summaryGeneration"]
            );

            const validator = createTypeScriptJsonValidator<DynamicSummary>(
                this.schemaText,
                "DynamicSummary"
            );

            this.summaryTranslator = createJsonTranslator(model, validator);
            this.isInitialized = true;
            
            debug("SummaryGenerator initialized successfully");
        } catch (error) {
            debug(`Failed to initialize SummaryGenerator: ${error}`);
            throw error;
        }
    }

    private buildSummaryPrompt(
        query: string,
        queryAnalysis: QueryAnalysis,
        searchContext: SearchContext
    ): string {
        const basePrompt = `Analyze these search results and generate a helpful summary for the user.

Query: "${query}"
Query Intent: ${queryAnalysis.intent.type} - ${queryAnalysis.intent.description}

Search Results Context:
${JSON.stringify(searchContext, null, 2)}

Generate a dynamic summary that:
${this.getIntentSpecificGuidance(queryAnalysis.intent.type)}

Focus on providing insights that help the user understand their search results and what patterns emerge from their personal data.

The summary should be conversational and insightful, not just a count of results.`;

        return basePrompt;
    }

    private getIntentSpecificGuidance(intentType: string): string {
        switch (intentType) {
            case "find_latest":
                return `- Focuses on what's newest and most current in the results
- Highlights temporal patterns and recent developments
- Identifies what's trending or changed recently
- Explains the time distribution of results`;

            case "find_earliest":
                return `- Focuses on the oldest or earliest items found
- Explains the historical context and timeline
- Identifies long-term patterns or consistent interests
- Highlights how things have evolved over time`;

            case "find_most_frequent":
                return `- Explains why these items are accessed frequently
- Identifies usage patterns and user preferences
- Suggests what this reveals about user interests and habits
- Analyzes what makes these results popular or important`;

            case "summarize":
                return `- Synthesizes key themes across all results
- Provides comprehensive overview of the topic
- Highlights main insights and conclusions
- Identifies common patterns and important information`;

            case "find_specific":
                return `- Focuses on how well results match the specific request
- Highlights precision and relevance of matches
- Explains what specific criteria were satisfied
- Identifies the most relevant and exact matches`;

            default:
                return `- Provides a helpful overview of what was found
- Identifies key patterns and insights in the results
- Explains what these results reveal about the topic
- Offers context that helps understand the search results`;
        }
    }
}
