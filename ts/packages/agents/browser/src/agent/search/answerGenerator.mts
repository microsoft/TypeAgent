// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { openai as ai } from "aiclient";
import { AnswerEnhancement } from "./schema/answerEnhancement.mjs";
import { QueryAnalysis } from "./schema/queryAnalysis.mjs";
import { SearchContext } from "./utils/contextBuilder.mjs";
import registerDebug from "debug";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const debug = registerDebug("typeagent:browser:answer-generator");

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
 * AnswerGenerator creates both dynamic summary and smart follow-ups
 * in a single LLM call for maximum efficiency and consistency
 */
export class AnswerGenerator {
    private enhancementTranslator: TypeChatJsonTranslator<AnswerEnhancement> | null =
        null;
    private isInitialized: boolean = false;
    private schemaText: string;

    constructor() {
        this.schemaText = getSchemaFileContents("answerEnhancement.mts");
    }

    /**
     * Generate complete answer enhancement (summary + followups) in a single LLM call
     */
    async generateEnhancement(
        query: string,
        queryAnalysis: QueryAnalysis,
        searchContext: SearchContext,
    ): Promise<AnswerEnhancement | undefined> {
        try {
            await this.ensureInitialized();

            if (!this.enhancementTranslator) {
                debug(
                    "Enhancement translator not available, skipping generation",
                );
                return undefined;
            }

            debug(`Generating unified enhancement for query: "${query}"`);

            const prompt = this.buildEnhancementPrompt(
                query,
                queryAnalysis,
                searchContext,
            );
            const response = await this.enhancementTranslator.translate(prompt);

            if (!response.success) {
                debug(`Enhancement generation failed: ${response.message}`);
                return undefined;
            }

            const enhancement = response.data;
            debug(
                `Generated enhancement with ${enhancement.followups.length} followups and confidence: ${enhancement.confidence}`,
            );

            return enhancement;
        } catch (error) {
            debug(`Error generating enhancement: ${error}`);
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
                ["unifiedEnhancementGeneration"],
            );

            const validator = createTypeScriptJsonValidator<AnswerEnhancement>(
                this.schemaText,
                "AnswerEnhancement",
            );

            this.enhancementTranslator = createJsonTranslator(model, validator);
            this.isInitialized = true;

            debug("AnswerGenerator initialized successfully");
        } catch (error) {
            debug(`Failed to initialize AnswerGenerator: ${error}`);
            throw error;
        }
    }

    private buildEnhancementPrompt(
        query: string,
        queryAnalysis: QueryAnalysis,
        searchContext: SearchContext,
    ): string {
        const basePrompt = `Generate a comprehensive answer enhancement for this user's search, including both a dynamic summary and smart follow-up suggestions.

Original Query: "${query}"
Query Intent: ${queryAnalysis.intent.type} - ${queryAnalysis.intent.description}

Search Context:
- Total Results: ${searchContext.totalResults}
- Dominant Domains: ${searchContext.patterns.dominantDomains.map((d) => d.domain).join(", ")}
- Time Range: ${searchContext.patterns.timeRange?.earliest} to ${searchContext.patterns.timeRange?.latest || "present"}

Available Content:
${searchContext.results.map((result, i) => `${i + 1}. ${result.title} (${result.domain}): ${result.snippet}`).join("\n")}

Generate a SINGLE complete "${this.enhancementTranslator?.validator.getTypeName()}" response using the typescript schema below.
                
'''
${this.enhancementTranslator?.validator.getSchemaText()}
'''

## INTENT-SPECIFIC GUIDANCE:
${this.getIntentSpecificGuidance(queryAnalysis.intent.type)}

Provide a complete AnswerEnhancement response that helps the user understand and explore their search results more effectively.`;

        return basePrompt;
    }

    private getIntentSpecificGuidance(intentType: string): string {
        const guidanceMap: Record<string, string> = {
            find_latest: `
- **Summary Focus**: Emphasize recency, trends, and what's newest
- **Key Findings**: Highlight temporal patterns and recent developments  
- **Follow-ups**: Suggest broader timeframes, trend tracking, comparisons with older content`,

            find_earliest: `
- **Summary Focus**: Provide historical context and evolution over time
- **Key Findings**: Identify patterns in early adoption, foundational content
- **Follow-ups**: Suggest progression tracking, modern comparisons, related historical content`,

            find_most_frequent: `
- **Summary Focus**: Analyze usage patterns, popularity, and user behavior
- **Key Findings**: Explain why certain content is frequently accessed
- **Follow-ups**: Suggest related popular content, alternatives, deeper exploration of top items`,

            summarize: `
- **Summary Focus**: Comprehensive content synthesis, main themes, key insights
- **Key Findings**: Important information, common threads, notable patterns
- **Follow-ups**: Suggest deeper dives, related topics, different perspectives`,

            find_specific: `
- **Summary Focus**: Precision and relevance to the specific request
- **Key Findings**: How results match the specific criteria, quality of matches
- **Follow-ups**: Suggest refinements, related searches, broader context`,
        };

        return (
            guidanceMap[intentType] ||
            `
- **Summary Focus**: Analyze results contextually based on user's apparent information need
- **Key Findings**: Identify the most relevant patterns and insights from the search results
- **Follow-ups**: Suggest logical next steps based on the content and user intent`
        );
    }
}
