// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Query analysis schema for LLM-based intent detection
 * Used with TypeChat for structured query understanding
 */

export interface QueryAnalysis {
    intent: QueryIntent;
    temporal: TemporalExpression | null;
    content: ContentClassification | null;
    ranking: RankingRequirement | null;
    confidence: number; // 0.0 to 1.0
}

export interface QueryIntent {
    type: "find_latest" | "find_earliest" | "find_most_frequent" | "summarize" | "find_specific";
    description: string; // Brief explanation of detected intent
}

export interface TemporalExpression {
    period: "last_week" | "last_month" | "last_year" | "earliest" | "latest" | "specific_date" | "none";
    direction: "recent" | "historical" | "any";
    // Date strings in ISO format (YYYY-MM-DDTHH:mm:ss.sssZ) - will be parsed to Date objects
    startDate?: string;
    endDate?: string;
}

export interface ContentClassification {
    contentType: "repository" | "news" | "review" | "article" | "documentation" | "tutorial" | "forum" | "blog" | "reference" | "other";
    domain?: "github.com" | "stackoverflow.com" | "reddit.com" | "medium.com" | "news_domain" | "other";
    subject?: string; // e.g., "machine learning", "car reviews", "transformers"
}

export interface RankingRequirement {
    primaryFactor: "date" | "frequency" | "relevance" | "composite";
    direction: "ascending" | "descending";
    sourcePreference?: "bookmark" | "history" | "any";
}

/**
 * Example valid QueryAnalysis objects:
 * 
 * For "most recently bookmarked github repo":
 * {
 *   intent: { type: "find_latest", description: "Find the most recent item" },
 *   temporal: { period: "latest", direction: "recent" },
 *   content: { contentType: "repository", domain: "github.com" },
 *   ranking: { primaryFactor: "date", direction: "descending", sourcePreference: "bookmark" },
 *   confidence: 0.95
 * }
 * 
 * For "summarize car reviews last week":
 * {
 *   intent: { type: "summarize", description: "Provide a summary of multiple items" },
 *   temporal: { 
 *     period: "last_week", 
 *     direction: "recent",
 *     startDate: "2025-07-12T00:00:00.000Z",
 *     endDate: "2025-07-19T23:59:59.999Z"
 *   },
 *   content: { contentType: "review", subject: "car reviews" },
 *   ranking: { primaryFactor: "date", direction: "descending" },
 *   confidence: 0.90
 * }
 * 
 * For "most often visited news site":
 * {
 *   intent: { type: "find_most_frequent", description: "Find the most frequently accessed item" },
 *   temporal: { period: "none", direction: "any" },
 *   content: { contentType: "news" },
 *   ranking: { primaryFactor: "frequency", direction: "descending" },
 *   confidence: 0.92
 * }
 */
