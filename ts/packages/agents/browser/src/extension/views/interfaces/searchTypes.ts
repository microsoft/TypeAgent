// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AnswerEnhancement } from "../../../agent/search/schema/answerEnhancement.mjs";

export interface SearchFilters {
    dateFrom?: string;
    dateTo?: string;
    sourceType?: "bookmarks" | "history";
    domain?: string;
}

export interface KnowledgeStatus {
    hasKnowledge: boolean;
    extractionDate?: string;
    entityCount?: number;
    topicCount?: number;
    suggestionCount?: number;
    status: "extracted" | "pending" | "error" | "none" | "extracting";
    confidence?: number;
}

export interface Website {
    url: string;
    title: string;
    domain: string;
    visitCount?: number;
    lastVisited?: string;
    source: "bookmarks" | "history";
    score?: number;
    snippet?: string;
    knowledge?: KnowledgeStatus;
}

export interface SearchResult {
    websites: Website[];
    summary: {
        text: string;
        totalFound: number;
        searchTime: number;
        sources: SourceReference[];
        entities: EntityMatch[];
    };
    query: string;
    filters: SearchFilters;
    topTopics?: string[];
    suggestedFollowups?: string[];
    relatedEntities?: Array<{
        name: string;
        type: string;
        confidence: number;
    }>;
    enhancement?: AnswerEnhancement; // NEW: Dynamic enhancement from LLM
}

export interface SourceReference {
    url: string;
    title: string;
    relevance: number;
}

export interface EntityMatch {
    name: string;
    type: string;
    confidence: number;
}

export interface SearchSuggestion {
    text: string;
    type: "recent" | "entity" | "topic" | "domain" | "auto";
    metadata?: {
        count?: number;
        lastUsed?: string;
        source?: string;
    };
}

export type ViewMode = "list" | "grid" | "timeline" | "domain";
