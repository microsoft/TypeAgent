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
 *   Examples:
 *   - "Deep Learning Models" is a child of "Deep Learning"
 *   - "React Hooks" is a child of "React"
 *   - "Neural Networks" is a child of "Deep Learning"
 *   Must specify targetTopic when using this action
 *
 * - "merge": Topic should be merged into another topic (synonyms or duplicates)
 *   Use when: Topics are synonyms, abbreviations, or represent the same concept
 *   Examples:
 *   - "ML" merges into "Machine Learning" (abbreviation)
 *   - "AI" merges into "Artificial Intelligence" (abbreviation)
 *   - "React.js" merges into "React" (duplicate)
 *   Must specify targetTopic when using this action
 */
export type RelationshipAction = "keep_root" | "make_child" | "merge";

/**
 * Example valid TopicRelationshipAnalysis objects:
 *
 * For analyzing ["Machine Learning", "ML", "Deep Learning", "Deep Learning Models"]:
 * {
 *   relationships: [
 *     {
 *       topic: "Machine Learning",
 *       action: "keep_root",
 *       confidence: 1.0,
 *       reasoning: "Broad foundational topic with no clear parent"
 *     },
 *     {
 *       topic: "ML",
 *       action: "merge",
 *       targetTopic: "Machine Learning",
 *       confidence: 0.98,
 *       reasoning: "Common abbreviation for Machine Learning"
 *     },
 *     {
 *       topic: "Deep Learning",
 *       action: "make_child",
 *       targetTopic: "Machine Learning",
 *       confidence: 0.95,
 *       reasoning: "Deep Learning is a specialized subset of Machine Learning"
 *     },
 *     {
 *       topic: "Deep Learning Models",
 *       action: "make_child",
 *       targetTopic: "Deep Learning",
 *       confidence: 0.92,
 *       reasoning: "Specific implementations and architectures within Deep Learning"
 *     }
 *   ]
 * }
 */
