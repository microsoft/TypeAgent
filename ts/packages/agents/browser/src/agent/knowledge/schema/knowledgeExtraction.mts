// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { conversation as kpLib } from "knowledge-processor";

export interface KnowledgeExtractionResult {
    entities: Entity[];
    relationships: Relationship[];
    keyTopics: string[];
    suggestedQuestions: string[];
    summary: string;
}

export interface EnhancedKnowledgeExtractionResult
    extends KnowledgeExtractionResult {
    title: string;
    contentActions?: kpLib.Action[];
    detectedActions?: DetectedAction[];
    actionSummary?: ActionSummary;
    contentMetrics: {
        readingTime: number;
        wordCount: number;
    };
    topicHierarchy?: TopicHierarchy;
}

export interface HierarchicalTopic {
    id: string;
    name: string;
    level: number;
    parentId?: string;
    childIds: string[];
    sourceFragments: string[];
    confidence: number;
    keywords: string[];
    entityReferences: string[];
    timestamp: string;
    domain?: string | undefined;
}

export interface TopicHierarchy {
    rootTopics: HierarchicalTopic[];
    topicMap: Map<string, HierarchicalTopic>;
    maxDepth: number;
    totalTopics: number;
}

export interface DetectedAction {
    type: string;
    element: string;
    text?: string;
    confidence: number;
}

export interface ActionSummary {
    totalActions: number;
    actionTypes: string[];
    highConfidenceActions: number;
    actionDistribution: { [key: string]: number };
}

export interface Entity {
    name: string;
    type: string;
    description?: string;
    confidence: number;
    occurrenceCount?: number;
    sourceSites?: number;
}

export interface Relationship {
    from: string;
    relationship: string;
    to: string;
    confidence: number;
}

export interface KnowledgeQueryResponse {
    answer: string;
    sources: WebPageReference[];
    relatedEntities: Entity[];
}

export interface EnhancedQueryRequest {
    query: string;
    url?: string;
    searchScope: "current_page" | "all_indexed" | "domain" | "topic";
    filters?: {
        domain?: string;
        timeRange?: "week" | "month" | "quarter" | "year";
    };
    maxResults?: number;
}

export interface EnhancedQueryResponse extends KnowledgeQueryResponse {
    metadata: {
        totalFound: number;
        searchScope: string;
        filtersApplied: string[];
        suggestions: QuerySuggestion[];
        processingTime: number;
        temporalQuery?:
            | {
                  timeframe: string;
                  queryType: string;
                  extractedTimeTerms: string[];
              }
            | undefined;
    };
    relationships?: any[];
    temporalPatterns?: TemporalPattern[];
}

export interface TemporalPattern {
    type:
        | "learning_sequence"
        | "topic_progression"
        | "domain_exploration"
        | "content_evolution";
    timespan: string;
    items: TemporalPatternItem[];
    confidence: number;
    description: string;
}

export interface TemporalPatternItem {
    url: string;
    title: string;
    visitDate: string;
    contentType: string;
    topics: string[];
    domain: string;
}

export interface QuerySuggestion {
    type: "refinement" | "expansion" | "related" | "temporal";
    query: string;
    explanation: string;
    filters?: any;
}

export interface WebPageReference {
    url: string;
    title: string;
    relevanceScore: number;
    lastIndexed: string;
}
