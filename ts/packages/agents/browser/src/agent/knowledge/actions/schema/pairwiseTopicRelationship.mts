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
 *
 * - "merge": The first topic should be merged into the second topic
 *   Use when: Topics are synonyms, abbreviations, or duplicates
 */
export type RelationshipAction = "keep_root" | "make_child" | "merge";

export interface PairwiseTopicRelationship {
    action: RelationshipAction;
    confidence: number;
    reasoning: string;
}
