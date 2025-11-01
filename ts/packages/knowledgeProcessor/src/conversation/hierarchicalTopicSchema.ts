// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface HierarchicalTopic {
    id: string; // Unique identifier
    name: string; // Topic name
    level: number; // Hierarchy level (0 = root, 1 = sub-topic, etc.)
    parentId?: string; // Reference to parent topic
    childIds: string[]; // References to child topics
    sourceRefOrdinals: number[]; // SemanticRef ordinals linking to knowledge topics
    sourceTopicNames: string[]; // Knowledge topic names that contributed to this hierarchical topic (for co-occurrence lookup)
    confidence: number; // Extraction confidence (0-1)
    keywords: string[]; // Associated keywords
    entityReferences: string[]; // Related entities
    timestamp: string; // When extracted
    aggregatedFrom?: string[]; // If merged from other topics
    domain?: string | undefined; // Website domain if applicable
}

export interface TopicHierarchy {
    rootTopics: HierarchicalTopic[];
    topicMap: Map<string, HierarchicalTopic>;
    maxDepth: number;
    totalTopics: number;
}

export interface HierarchicalTopicResponse {
    status: "Success" | "None" | "Error";
    hierarchy: TopicHierarchy;
    flatTopics: string[]; // Backward compatible flat list
}

export interface TopicExtractionContext {
    existingTopics?: HierarchicalTopic[];
    maxDepth?: number;
    fragmentId?: string;
    url?: string;
    domain?: string;
}

export interface FragmentTopicExtraction {
    fragmentId: string;
    topics: string[];
    fragmentText?: string; // The actual chunk text for LLM analysis
    suggestedParents?: string[]; // AI-suggested parent topics
    confidence: number;
    extractionDate: string;
}

export interface TopicAggregationRequest {
    fragmentExtractions: FragmentTopicExtraction[];
    existingHierarchy?: TopicHierarchy;
    context: TopicExtractionContext;
}

export interface TopicRelationship {
    parentTopicId: string;
    childTopicId: string;
    relationshipType: "parent-child" | "related-to" | "derived-from";
    confidence: number;
}

export interface TopicEntityRelation {
    topicId: string;
    entityName: string;
    relevance: number;
    extractionSource: string;
}
