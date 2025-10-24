// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Schema for LLM-based pairwise topic relationship analysis
 * Used with TypeChat for analyzing semantic relationships between two topics
 */

/**
 * Relationship actions for organizing topic hierarchies:
 *
 * - "keep_root": Topic should remain independent (no relationship to the other topic)
 *   Use when: The two topics are unrelated or equally broad
 *   Example: "Machine Learning" and "Web Development" should both remain roots
 *
 * - "make_child": The first topic should become a child of the second topic
 *   Use when: The first topic is more specific than the second and represents a subset
 *   Examples:
 *   - "Deep Learning Models" is more specific than "Deep Learning"
 *   - "React Hooks" is more specific than "React"
 *   - Specificity indicators: "X in Y", "Types of X", "X frameworks"
 *
 * - "merge": The first topic should be merged into the second topic
 *   Use when: Topics are synonyms, abbreviations, or duplicates
 *   Examples:
 *   - "ML" is an abbreviation of "Machine Learning"
 *   - "React.js" and "React" are duplicates
 *   - "AI" and "Artificial Intelligence" are synonyms
 */
export type RelationshipAction = "keep_root" | "make_child" | "merge";

export interface PairwiseTopicRelationship {
    action: RelationshipAction;
    confidence: number;
    reasoning: string;
}

/**
 * Example valid PairwiseTopicRelationship objects:
 *
 * For comparing "Deep Learning Models" vs "Deep Learning":
 * {
 *   action: "make_child",
 *   confidence: 0.95,
 *   reasoning: "Deep Learning Models is a specific subset representing implementations and architectures within Deep Learning"
 * }
 *
 * For comparing "ML" vs "Machine Learning":
 * {
 *   action: "merge",
 *   confidence: 0.98,
 *   reasoning: "ML is a standard abbreviation for Machine Learning"
 * }
 *
 * For comparing "Machine Learning" vs "Web Development":
 * {
 *   action: "keep_root",
 *   confidence: 1.0,
 *   reasoning: "These are distinct, unrelated domains with no hierarchical relationship"
 * }
 */
