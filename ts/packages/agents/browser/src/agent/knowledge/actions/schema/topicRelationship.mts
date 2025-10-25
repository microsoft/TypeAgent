// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Schema for LLM-based semantic topic relationship analysis
 * Used with TypeChat for structured topic hierarchy organization
 */

export interface TopicRelationshipAnalysis {
    relationships: TopicRelationship[];
}

export interface TopicRelationship {
    topic: string;
    action: RelationshipAction;
    targetTopic?: string;
    confidence: number;
    reasoning: string;
}

/**
 * Relationship actions for organizing topic hierarchies:
 *
 * - "keep_root": Topic should remain as a root-level topic with no parent
 *   Use when: The topic is broad, general, or has no clear parent relationship
 *   Example: "Machine Learning", "Deep Learning", "Web Development"
 *
 * - "make_child": Topic should become a child of another more general topic
 *   Use when: The topic is more specific than another topic and represents a subset or specialization
 *   Must specify targetTopic when using this action
 *
 * - "merge": Topic should be merged into another topic (synonyms or duplicates)
 *   Use when: Topics are synonyms, abbreviations, or represent the same concept
 *   Must specify targetTopic when using this action
 */
export type RelationshipAction = "keep_root" | "make_child" | "merge";
