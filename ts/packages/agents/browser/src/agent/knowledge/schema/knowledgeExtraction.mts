// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface KnowledgeExtractionResult {
    entities: Entity[];
    relationships: Relationship[];
    keyTopics: string[];
    suggestedQuestions: string[];
    summary: string;
}

export interface EnhancedKnowledgeExtractionResult extends KnowledgeExtractionResult {
    detectedActions?: DetectedAction[];
    actionSummary?: ActionSummary;
    contentMetrics: {
        readingTime: number;
        wordCount: number;
        hasCode: boolean;
        interactivity: string;
        pageType: string;
    };
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

export interface WebPageReference {
    url: string;
    title: string;
    relevanceScore: number;
    lastIndexed: string;
}
