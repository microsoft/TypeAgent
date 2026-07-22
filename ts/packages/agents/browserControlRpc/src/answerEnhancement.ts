// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// NOTE: These type definitions are the shared contract for answer enhancement
// data exchanged between the browser agent and the browser extension UI.
// The canonical schema file consumed as LLM prompt text lives at
// packages/agents/browser/src/agent/search/schema/answerEnhancement.mts and
// MUST be kept structurally in sync with the interfaces below.

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
 */
export interface DynamicSummary {
    /**
     * Main summary text explaining what was found and why it's relevant.
     */
    text: string;

    /**
     * 2-4 key insights or patterns discovered in the results.
     */
    keyFindings: string[];

    statistics: {
        totalResults: number;

        /**
         * Time span covered by results (optional).
         */
        timeSpan?: string;

        /**
         * Top domains/sources in the results.
         */
        dominantDomains: string[];
    };

    confidence: number;
}

/**
 * Smart follow-up suggestion that builds naturally from the search results.
 */
export interface SmartFollowup {
    /**
     * Natural language query the user would actually type.
     */
    query: string;

    /**
     * Clear explanation of why this follow-up would be helpful.
     */
    reasoning: string;

    /** Type of exploration this follow-up represents */
    type: "temporal" | "domain" | "content" | "comparative";

    /** Confidence in this follow-up's usefulness (0.0 to 1.0) */
    confidence: number;
}
