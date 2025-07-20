// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { openai as ai } from "aiclient";
import { SmartFollowup, FollowupResponse } from "./schema/answerEnhancement.mjs";
import { DynamicSummary } from "./schema/answerEnhancement.mjs";
import { QueryAnalysis } from "./schema/queryAnalysis.mjs";
import { SearchContext } from "./utils/contextBuilder.mjs";
import registerDebug from "debug";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const debug = registerDebug("typeagent:browser:followup-generator");

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
 * FollowupGenerator creates smart, contextual follow-up suggestions based on search results and summary
 */
export class FollowupGenerator {
    private followupTranslator: TypeChatJsonTranslator<FollowupResponse> | null = null;
    private isInitialized: boolean = false;
    private schemaText: string;

    constructor() {
        this.schemaText = getSchemaFileContents("answerEnhancement.mts");
    }

    /**
     * Generate smart follow-up queries based on query, analysis, context, and summary
     */
    async generateFollowups(
        query: string,
        queryAnalysis: QueryAnalysis,
        searchContext: SearchContext,
        summary: DynamicSummary
    ): Promise<SmartFollowup[]> {
        try {
            await this.ensureInitialized();

            if (!this.followupTranslator) {
                debug("Followup translator not available, returning empty array");
                return [];
            }

            debug(`Generating followups for query: "${query}"`);

            const prompt = this.buildFollowupPrompt(query, queryAnalysis, searchContext, summary);
            const response = await this.followupTranslator.translate(prompt);

            if (!response.success) {
                debug(`Followup generation failed: ${response.message}`);
                return [];
            }

            const followups = response.data.followups;
            debug(`Generated ${followups.length} followup suggestions`);
            debug("followups: ", followups)

            return followups;

        } catch (error) {
            debug(`Error generating followups: ${error}`);
            return [];
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            const model = ai.createJsonChatModel(
                ai.apiSettingsFromEnv(ai.ModelType.Chat),
                ["followupGeneration"]
            );

            const validator = createTypeScriptJsonValidator<FollowupResponse>(
                this.schemaText,
                "FollowupResponse"
            );

            this.followupTranslator = createJsonTranslator(model, validator);
            this.isInitialized = true;
            
            debug("FollowupGenerator initialized successfully");
        } catch (error) {
            debug(`Failed to initialize FollowupGenerator: ${error}`);
            throw error;
        }
    }

    private buildFollowupPrompt(
        query: string,
        queryAnalysis: QueryAnalysis,
        searchContext: SearchContext,
        summary: DynamicSummary
    ): string {
        const prompt = `Based on the user's search query and results, suggest 3-4 smart follow-up searches that would naturally help the user explore further.

Original Query: "${query}"
Query Intent: ${queryAnalysis.intent.type}

Current Results Summary: "${summary.text}"

Key Findings: ${summary.keyFindings.join(", ")}

Search Context:
- Total Results: ${searchContext.totalResults}
- Dominant Domains: ${searchContext.patterns.dominantDomains.map(d => d.domain).join(", ")}
- Time Range: ${searchContext.patterns.timeRange?.earliest} to ${searchContext.patterns.timeRange?.latest || "present"}

Generate follow-up queries that are:
1. **Specific and actionable** - Use natural language the user would actually type
2. **Build naturally from current results** - Address logical next steps or refinements
3. **Diverse in approach** - Cover different types of exploration (temporal, domain, content, comparative)
4. **Personally relevant** - Based on patterns in the user's own data

Follow-up Types to Consider:
- **Temporal**: Expand or shift time ranges, track changes over time
- **Domain**: Explore the topic on other platforms or sources  
- **Content**: Dive deeper into specific aspects, find related materials
- **Comparative**: Compare options, analyze differences, find alternatives

Examples of good follow-ups:
- "Show me [topic] from [different time period]"
- "Find [content type] about [specific aspect mentioned]"
- "Compare [identified options/tools/approaches]"
- "Explore [topic] beyond [dominant domain]"

Generate exactly 3-4 follow-up suggestions in the FollowupResponse format with a followups array.

Expected JSON format:
{
  "followups": [
    {
      "query": "Show me all AI/ML repositories from this year",
      "reasoning": "User is interested in AI/ML projects, expand timeframe",
      "type": "temporal",
      "confidence": 0.88
    }
  ]
}`;

        return prompt;
    }
}
