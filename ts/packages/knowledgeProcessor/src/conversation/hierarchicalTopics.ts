// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TypeChatLanguageModel } from "typechat";
import { TopicExtractor } from "./topics.js";
import {
    HierarchicalTopic,
    TopicHierarchy,
    HierarchicalTopicResponse,
    TopicExtractionContext,
    FragmentTopicExtraction,
    TopicRelationship,
} from "./hierarchicalTopicSchema.js";

export interface HierarchicalTopicExtractor {
    extractHierarchicalTopics(
        fragmentExtractions: FragmentTopicExtraction[],
        context: TopicExtractionContext,
    ): Promise<HierarchicalTopicResponse>;

    updateHierarchy(
        existingHierarchy: TopicHierarchy,
        newExtractions: FragmentTopicExtraction[],
        context: TopicExtractionContext,
    ): Promise<TopicHierarchy>;

    buildTopicRelationships(
        topics: HierarchicalTopic[],
    ): Promise<TopicRelationship[]>;
}

export function createHierarchicalTopicExtractor(
    model: TypeChatLanguageModel,
    topicExtractor?: TopicExtractor,
): HierarchicalTopicExtractor {
    return {
        extractHierarchicalTopics,
        updateHierarchy,
        buildTopicRelationships,
    };

    async function extractHierarchicalTopics(
        fragmentExtractions: FragmentTopicExtraction[],
        context: TopicExtractionContext,
    ): Promise<HierarchicalTopicResponse> {
        try {
            // Step 1: Collect all topics from fragments
            const allTopics = collectAllTopics(fragmentExtractions);

            if (allTopics.length === 0) {
                return {
                    status: "None",
                    hierarchy: createEmptyHierarchy(),
                    flatTopics: [],
                };
            }

            // Step 2: Use existing TopicExtractor to find higher-level themes
            let aggregatedTopics: string[] = [];
            if (topicExtractor) {
                const mergeResult = await topicExtractor.mergeTopics(
                    allTopics,
                    context.existingTopics?.map((t) => t.name),
                );
                if (mergeResult && mergeResult.status === "Success") {
                    aggregatedTopics.push(mergeResult.topic);
                }
            }

            // Step 3: Build hierarchy using AI-assisted categorization
            const hierarchy = await categorizeTopicsIntoHierarchy(
                allTopics,
                aggregatedTopics,
                context,
                model,
            );

            // Step 4: Enrich with metadata
            const enrichedHierarchy = enrichHierarchy(
                hierarchy,
                fragmentExtractions,
                context,
            );

            return {
                status: "Success",
                hierarchy: enrichedHierarchy,
                flatTopics: allTopics,
            };
        } catch (error) {
            console.error("Error extracting hierarchical topics:", error);
            return {
                status: "Error",
                hierarchy: createEmptyHierarchy(),
                flatTopics: [],
            };
        }
    }

    async function updateHierarchy(
        existingHierarchy: TopicHierarchy,
        newExtractions: FragmentTopicExtraction[],
        context: TopicExtractionContext,
    ): Promise<TopicHierarchy> {
        // Extract topics from new fragments with existing context
        const newTopicResponse = await extractHierarchicalTopics(
            newExtractions,
            {
                ...context,
                existingTopics: Array.from(existingHierarchy.topicMap.values()),
            },
        );

        if (newTopicResponse.status === "Success") {
            return mergeHierarchies(
                existingHierarchy,
                newTopicResponse.hierarchy,
            );
        }

        return existingHierarchy;
    }

    async function buildTopicRelationships(
        topics: HierarchicalTopic[],
    ): Promise<TopicRelationship[]> {
        const relationships: TopicRelationship[] = [];

        for (const topic of topics) {
            // Parent-child relationships
            for (const childId of topic.childIds) {
                relationships.push({
                    parentTopicId: topic.id,
                    childTopicId: childId,
                    relationshipType: "parent-child",
                    confidence: 0.9,
                });
            }

            // Find related topics based on keyword overlap
            for (const otherTopic of topics) {
                if (
                    otherTopic.id !== topic.id &&
                    !topic.childIds.includes(otherTopic.id)
                ) {
                    const keywordOverlap = calculateKeywordOverlap(
                        topic.keywords,
                        otherTopic.keywords,
                    );
                    if (keywordOverlap > 0.3) {
                        relationships.push({
                            parentTopicId: topic.id,
                            childTopicId: otherTopic.id,
                            relationshipType: "related-to",
                            confidence: keywordOverlap,
                        });
                    }
                }
            }
        }

        return relationships;
    }
}

function collectAllTopics(
    fragmentExtractions: FragmentTopicExtraction[],
): string[] {
    const allTopics = new Set<string>();

    for (const extraction of fragmentExtractions) {
        for (const topic of extraction.topics) {
            if (topic && topic.trim().length > 0) {
                allTopics.add(topic.trim());
            }
        }
    }

    return Array.from(allTopics);
}

async function categorizeTopicsIntoHierarchy(
    topics: string[],
    aggregatedTopics: string[],
    context: TopicExtractionContext,
    model: TypeChatLanguageModel,
): Promise<TopicHierarchy> {
    // Create a simple hierarchy where aggregated topics are parents
    const topicMap = new Map<string, HierarchicalTopic>();
    const rootTopics: HierarchicalTopic[] = [];
    let maxDepth = 0;

    // Create root topics from aggregated topics
    for (let i = 0; i < aggregatedTopics.length; i++) {
        const aggregatedTopic = aggregatedTopics[i];
        const rootTopic: HierarchicalTopic = {
            id: generateTopicId(aggregatedTopic, 0),
            name: aggregatedTopic,
            level: 0,
            childIds: [],
            sourceFragments: [],
            confidence: 0.8,
            keywords: [aggregatedTopic],
            entityReferences: [],
            timestamp: new Date().toISOString(),
            domain: context.domain || undefined,
        };

        topicMap.set(rootTopic.id, rootTopic);
        rootTopics.push(rootTopic);
    }

    // If no aggregated topics, create root topics from most common topics
    if (aggregatedTopics.length === 0 && topics.length > 0) {
        const rootTopicName = topics[0]; // Use first topic as root
        const rootTopic: HierarchicalTopic = {
            id: generateTopicId(rootTopicName, 0),
            name: rootTopicName,
            level: 0,
            childIds: [],
            sourceFragments: context.fragmentId ? [context.fragmentId] : [],
            confidence: 0.7,
            keywords: [rootTopicName],
            entityReferences: [],
            timestamp: new Date().toISOString(),
            domain: context.domain || undefined,
        };

        topicMap.set(rootTopic.id, rootTopic);
        rootTopics.push(rootTopic);

        // Add remaining topics as children
        for (let i = 1; i < Math.min(topics.length, 10); i++) {
            const childTopic: HierarchicalTopic = {
                id: generateTopicId(topics[i], 1),
                name: topics[i],
                level: 1,
                parentId: rootTopic.id,
                childIds: [],
                sourceFragments: context.fragmentId ? [context.fragmentId] : [],
                confidence: 0.6,
                keywords: [topics[i]],
                entityReferences: [],
                timestamp: new Date().toISOString(),
                domain: context.domain || undefined,
            };

            topicMap.set(childTopic.id, childTopic);
            rootTopic.childIds.push(childTopic.id);
            maxDepth = Math.max(maxDepth, 1);
        }
    }

    return {
        rootTopics,
        topicMap,
        maxDepth,
        totalTopics: topicMap.size,
    };
}

function enrichHierarchy(
    hierarchy: TopicHierarchy,
    fragmentExtractions: FragmentTopicExtraction[],
    context: TopicExtractionContext,
): TopicHierarchy {
    // Add fragment source information
    for (const extraction of fragmentExtractions) {
        for (const [, topic] of hierarchy.topicMap) {
            if (extraction.topics.includes(topic.name)) {
                topic.sourceFragments.push(extraction.fragmentId);
            }
        }
    }

    return hierarchy;
}

function mergeHierarchies(
    existing: TopicHierarchy,
    newHierarchy: TopicHierarchy,
): TopicHierarchy {
    const mergedTopicMap = new Map<string, HierarchicalTopic>(
        existing.topicMap,
    );
    const mergedRootTopics = [...existing.rootTopics];

    // Add new topics that don't already exist
    for (const [topicId, topic] of newHierarchy.topicMap) {
        if (!mergedTopicMap.has(topicId)) {
            mergedTopicMap.set(topicId, topic);

            if (topic.level === 0) {
                mergedRootTopics.push(topic);
            }
        } else {
            // Merge source fragments for existing topics
            const existingTopic = mergedTopicMap.get(topicId)!;
            existingTopic.sourceFragments = [
                ...new Set([
                    ...existingTopic.sourceFragments,
                    ...topic.sourceFragments,
                ]),
            ];
        }
    }

    return {
        rootTopics: mergedRootTopics,
        topicMap: mergedTopicMap,
        maxDepth: Math.max(existing.maxDepth, newHierarchy.maxDepth),
        totalTopics: mergedTopicMap.size,
    };
}

function createEmptyHierarchy(): TopicHierarchy {
    return {
        rootTopics: [],
        topicMap: new Map(),
        maxDepth: 0,
        totalTopics: 0,
    };
}

function generateTopicId(topicName: string, level: number): string {
    const cleanName = topicName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    return `topic_${cleanName}_${level}_${Date.now()}`;
}

function calculateKeywordOverlap(
    keywords1: string[],
    keywords2: string[],
): number {
    if (keywords1.length === 0 || keywords2.length === 0) return 0;

    const set1 = new Set(keywords1.map((k) => k.toLowerCase()));
    const set2 = new Set(keywords2.map((k) => k.toLowerCase()));

    const intersection = new Set([...set1].filter((k) => set2.has(k)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
}
