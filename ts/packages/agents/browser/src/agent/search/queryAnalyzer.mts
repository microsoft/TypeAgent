// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { openai as ai } from "aiclient";
import { QueryAnalysis, TemporalExpression } from "./schema/queryAnalysis.mjs";
import registerDebug from "debug";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const debug = registerDebug("typeagent:browser:query-analyzer");

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
 * QueryAnalyzer uses LLM-based analysis for robust query understanding.
 * Always analyzes queries for maximum accuracy - no optimizations.
 */
export class QueryAnalyzer {
    private queryTranslator: TypeChatJsonTranslator<QueryAnalysis> | null = null;
    private isInitialized: boolean = false;
    private schemaText: string;

    constructor() {
        this.schemaText = getSchemaFileContents("queryAnalysis.mts");
    }

    /**
     * Analyze search query for intent, temporal expressions, and content classification
     * Always performs full analysis for maximum accuracy
     */
    async analyzeQuery(query: string): Promise<QueryAnalysis | null> {
        try {
            await this.ensureInitialized();

            if (!this.queryTranslator) {
                debug("Query translator not available, skipping analysis");
                return null;
            }

            debug(`Analyzing query: "${query}"`);

            const prompt = this.buildAnalysisPrompt(query);
            const response = await this.queryTranslator.translate(prompt);

            if (!response.success) {
                debug(`Query analysis failed: ${response.message}`);
                return null;
            }

            const analysis = response.data;
            debug(`Analysis result: ${JSON.stringify(analysis)}`);

            // Post-process temporal dates if provided as strings
            this.processTemporalDates(analysis);

            return analysis;

        } catch (error) {
            debug(`Error analyzing query: ${error}`);
            return null;
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            // Use the same model configuration as other adapters
            const model = ai.createJsonChatModel(
                ai.apiSettingsFromEnv(ai.ModelType.Chat),
                ["queryAnalysis"]
            );

            const validator = createTypeScriptJsonValidator<QueryAnalysis>(
                this.schemaText,
                "QueryAnalysis"
            );

            this.queryTranslator = createJsonTranslator(model, validator);
            this.isInitialized = true;
            
            debug("QueryAnalyzer initialized successfully");
        } catch (error) {
            debug(`Failed to initialize QueryAnalyzer: ${error}`);
            throw error;
        }
    }

    private buildAnalysisPrompt(query: string): string {
        return `Analyze this search query to understand user intent, temporal requirements, content preferences, and ranking needs.

Query: "${query}"

Determine:
1. What type of search intent this represents
2. Any temporal expressions (time periods, recency preferences)  
3. Content type being sought (repositories, news, reviews, etc.)
4. How results should be ranked (by date, frequency, relevance)
5. Your confidence in this analysis

For temporal expressions that need specific date ranges (like "last week", "last month"), include startDate and endDate as ISO date strings (YYYY-MM-DDTHH:mm:ss.sssZ format).

Focus on practical search needs - what would help find the most relevant results for this query.`;
    }

    private processTemporalDates(analysis: QueryAnalysis): void {
        // If LLM provided date strings, they're already in the correct format
        // No additional processing needed since we'll parse them when needed
    }
    
    /**
     * Utility method to get Date objects from temporal expression
     */
    getTemporalDates(temporal: TemporalExpression | null): { startDate?: Date; endDate?: Date } {
        if (!temporal || temporal.period === "none") {
            return {};
        }
        
        const result: { startDate?: Date; endDate?: Date } = {};
        
        // If LLM provided date strings, parse them
        if (temporal.startDate) {
            result.startDate = new Date(temporal.startDate);
        }
        if (temporal.endDate) {
            result.endDate = new Date(temporal.endDate);
        }
        
        // If no date strings provided, compute them based on period
        if (!result.startDate && !result.endDate) {
            const now = new Date();
            
            switch (temporal.period) {
                case "last_week":
                    result.startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    result.endDate = now;
                    break;
                    
                case "last_month":
                    result.startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                    result.endDate = now;
                    break;
                    
                case "last_year":
                    result.startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
                    result.endDate = now;
                    break;
                    
                case "latest":
                case "earliest":
                    // These don't need specific date ranges
                    break;
            }
        }
        
        return result;
    }
}
