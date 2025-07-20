// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Answer enhancement schema for LLM-based dynamic summaries and follow-ups.
 * The LLM should generate comprehensive answer enhancements that help users
 * understand and explore their search results more effectively.
 */

/**
 * Complete answer enhancement containing both summary and follow-up suggestions.
 */
export interface AnswerEnhancement {
    summary: DynamicSummary;

    /** 3-4 smart follow-up suggestions for further exploration */
    followups: SmartFollowup[];
    confidence: number;
    generationTime: number;
}

/**
 * Dynamic summary that contextualizes search results with insights and patterns.
 *
 * GENERATION GUIDELINES:
 * - Write conversationally, not like a search report
 * - Highlight what makes these results notable or useful
 * - Identify trends, dominant sources, timeframes
 * - Provide specific insights beyond just "found X results"
 *
 */
export interface DynamicSummary {
    /**
     * Main summary text explaining what was found and why it's relevant.
     * Should be conversational and insightful, not just "Found X results".
     */
    text: string;

    /**
     * 2-4 key insights or patterns discovered in the results.
     * Focus on what makes these results interesting or notable.
     */
    keyFindings: string[];

    statistics: {
        totalResults: number;

        /**
         * Time span covered by results (optional).
         * EXAMPLES: "last 2 weeks", "past month", "from 2020-2023"
         */
        timeSpan?: string;

        /**
         * Top domains/sources in the results.
         * EXAMPLES: ["github.com"], ["react.dev", "medium.com"]
         */
        dominantDomains: string[];
    };

    confidence: number;
}

/**
 * Smart follow-up suggestion that builds naturally from the search results.
 *
 * GENERATION GUIDELINES:
 * - Use natural language the user would actually type
 * - Build logically from current results (temporal, domain, content, comparative)
 * - Address logical next steps or refinements
 * - Provide clear reasoning for why this follow-up would be helpful
 *
 */
export interface SmartFollowup {
    /**
     * Natural language query the user would actually type.
     */
    query: string;

    /**
     * Clear explanation of why this follow-up would be helpful.
     * Should explain the logical connection to current results.
     */
    reasoning: string;

    /** Type of exploration this follow-up represents */
    type: "temporal" | "domain" | "content" | "comparative";

    /** Confidence in this follow-up's usefulness (0.0 to 1.0) */
    confidence: number;
}
