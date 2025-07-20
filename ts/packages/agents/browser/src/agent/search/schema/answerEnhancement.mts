// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Answer enhancement schema for LLM-based dynamic summaries and follow-ups
 * Used with TypeChat for structured answer generation
 */

export interface AnswerEnhancement {
    summary: DynamicSummary;
    followups: SmartFollowup[];
    confidence: number;
    generationTime: number;
}

export interface DynamicSummary {
    text: string;
    keyFindings: string[];
    statistics: {
        totalResults: number;
        timeSpan?: string;
        dominantDomains: string[];
    };
    confidence: number;
}

export interface SmartFollowup {
    query: string;
    reasoning: string;
    type: "temporal" | "domain" | "content" | "comparative";
    confidence: number;
}

// Wrapper interface to handle LLM output that wraps followups in an object
export interface FollowupResponse {
    followups: SmartFollowup[];
}

/**
 * Example valid DynamicSummary object:
 * 
 * For query "recent github repositories":
 * {
 *   text: "Found 8 GitHub repositories from the last 2 weeks, primarily focusing on AI/ML projects. Most activity on TypeScript projects, with 3 repositories related to language models.",
 *   keyFindings: [
 *     "AI/ML projects dominate recent activity",
 *     "TypeScript is the primary language",
 *     "Language model repositories trending"
 *   ],
 *   statistics: {
 *     totalResults: 8,
 *     timeSpan: "last 2 weeks",
 *     dominantDomains: ["github.com"]
 *   },
 *   confidence: 0.92
 * }
 * 
 * Example valid SmartFollowup objects:
 * 
 * [
 *   {
 *     query: "Show me all AI/ML repositories from this year",
 *     reasoning: "User is interested in AI/ML projects, expand timeframe",
 *     type: "temporal",
 *     confidence: 0.88
 *   },
 *   {
 *     query: "Find documentation for these transformer projects",
 *     reasoning: "User has transformer repositories, likely needs docs",
 *     type: "content",
 *     confidence: 0.85
 *   },
 *   {
 *     query: "Show similar repositories on other platforms",
 *     reasoning: "Expand beyond GitHub to other code platforms",
 *     type: "domain",
 *     confidence: 0.80
 *   }
 * ]
 */