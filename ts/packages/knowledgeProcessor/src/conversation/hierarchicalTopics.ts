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
                fragmentExtractions,
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
    fragmentExtractions: FragmentTopicExtraction[],
    context: TopicExtractionContext,
    model: TypeChatLanguageModel,
): Promise<TopicHierarchy> {
    const topicMap = new Map<string, HierarchicalTopic>();
    const rootTopics: HierarchicalTopic[] = [];
    let maxDepth = 0;

    // Build context from fragment texts for LLM analysis
    const fragmentContext = fragmentExtractions
        .filter((f) => f.fragmentText)
        .map(
            (f) =>
                `Topics: ${f.topics.join(", ")}\nContext: ${f.fragmentText?.substring(0, 500)}`,
        )
        .join("\n\n");

    // Use LLM to categorize topics into hierarchy
    const prompt = `Analyze these topics extracted from a document and organize them into a hierarchical structure.

Document context:
${fragmentContext}

All extracted topics:
${topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

${aggregatedTopics.length > 0 ? `High-level theme: ${aggregatedTopics[0]}\n` : ""}

Create a topic hierarchy with:
1. 2-4 root topics that represent the main themes
2. Group related topics under each root as children (level 1)
3. If topics are very specific, create sub-children (level 2)

IMPORTANT: Output ONLY a valid JSON array. Do not include any text before or after the JSON.
Each JSON object must have:
- rootTopic: string (the root category name, properly escaped)
- children: array of child topic names (properly escaped strings)
- grandchildren: object mapping child names to arrays of grandchild names (optional)

Escape all special characters in strings. Use double quotes for all strings.

Example format:
[
  {
    "rootTopic": "Machine Learning",
    "children": ["Deep Learning", "Neural Networks"],
    "grandchildren": {
      "Deep Learning": ["CNNs", "RNNs", "Transformers"]
    }
  }
]

JSON OUTPUT:`;

    try {
        const response = await model.complete(prompt);

        if (!response.success) {
            throw new Error(response.message || "LLM request failed");
        }

        const jsonMatch = response.data.match(/\[[\s\S]*\]/);

        if (jsonMatch) {
            let hierarchyData;
            try {
                hierarchyData = JSON.parse(jsonMatch[0]);
            } catch (parseError) {
                console.warn(
                    "Initial JSON parse failed, attempting to clean and retry:",
                    parseError instanceof Error ? parseError.message : String(parseError),
                );
                console.debug("Raw JSON content:", jsonMatch[0]);
                
                // Attempt to fix common JSON issues
                let cleanedJson = jsonMatch[0]
                    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
                    .replace(/\\(?!["\\/bfnrt])/g, '\\\\') // Fix invalid escape sequences
                    .replace(/(?<!\\)"/g, '\\"') // Escape unescaped quotes in values
                    .replace(/\\"/g, '"') // Fix over-escaped quotes
                    .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
                    .replace(/([{,]\s*)(\w+):/g, '$1"$2":') // Quote unquoted property names
                    .trim();

                // Ensure the JSON is properly closed
                if (!cleanedJson.endsWith(']')) {
                    const openBrackets = (cleanedJson.match(/\[/g) || []).length;
                    const closeBrackets = (cleanedJson.match(/\]/g) || []).length;
                    const openBraces = (cleanedJson.match(/\{/g) || []).length;
                    const closeBraces = (cleanedJson.match(/\}/g) || []).length;
                    
                    // Add missing closing braces/brackets
                    for (let i = 0; i < openBraces - closeBraces; i++) {
                        cleanedJson += '}';
                    }
                    for (let i = 0; i < openBrackets - closeBrackets; i++) {
                        cleanedJson += ']';
                    }
                }

                try {
                    hierarchyData = JSON.parse(cleanedJson);
                    console.log("Successfully parsed cleaned JSON");
                } catch (secondParseError) {
                    console.warn(
                        "JSON cleaning failed, falling back to simple topic hierarchy:",
                        secondParseError instanceof Error ? secondParseError.message : String(secondParseError),
                    );
                    // Fallback to simple flat hierarchy
                    hierarchyData = createFallbackHierarchy(topics, aggregatedTopics);
                }
            }

            // Build hierarchy from LLM response
            for (const rootData of hierarchyData) {
                const rootTopic: HierarchicalTopic = {
                    id: generateTopicId(rootData.rootTopic, 0),
                    name: rootData.rootTopic,
                    level: 0,
                    childIds: [],
                    sourceFragments: [],
                    confidence: 0.8,
                    keywords: [rootData.rootTopic],
                    entityReferences: [],
                    timestamp: new Date().toISOString(),
                    domain: context.domain || undefined,
                };

                topicMap.set(rootTopic.id, rootTopic);
                rootTopics.push(rootTopic);

                // Add children
                for (const childName of rootData.children || []) {
                    const childTopic: HierarchicalTopic = {
                        id: generateTopicId(childName, 1),
                        name: childName,
                        level: 1,
                        parentId: rootTopic.id,
                        childIds: [],
                        sourceFragments: [],
                        confidence: 0.7,
                        keywords: [childName],
                        entityReferences: [],
                        timestamp: new Date().toISOString(),
                        domain: context.domain || undefined,
                    };

                    topicMap.set(childTopic.id, childTopic);
                    rootTopic.childIds.push(childTopic.id);
                    maxDepth = Math.max(maxDepth, 1);

                    // Add grandchildren if present
                    const grandchildrenForThisChild =
                        rootData.grandchildren?.[childName] || [];
                    for (const grandchildName of grandchildrenForThisChild) {
                        const grandchildTopic: HierarchicalTopic = {
                            id: generateTopicId(grandchildName, 2),
                            name: grandchildName,
                            level: 2,
                            parentId: childTopic.id,
                            childIds: [],
                            sourceFragments: [],
                            confidence: 0.6,
                            keywords: [grandchildName],
                            entityReferences: [],
                            timestamp: new Date().toISOString(),
                            domain: context.domain || undefined,
                        };

                        topicMap.set(grandchildTopic.id, grandchildTopic);
                        childTopic.childIds.push(grandchildTopic.id);
                        maxDepth = Math.max(maxDepth, 2);
                    }
                }
            }
        } else {
            console.warn("No JSON array found in LLM response, using fallback hierarchy");
            console.debug("LLM response:", response.data);
            
            // Use fallback hierarchy when no JSON is found
            const hierarchyData = createFallbackHierarchy(topics, aggregatedTopics);
            
            // Build hierarchy from fallback data
            for (const rootData of hierarchyData) {
                const rootTopic: HierarchicalTopic = {
                    id: generateTopicId(rootData.rootTopic, 0),
                    name: rootData.rootTopic,
                    level: 0,
                    childIds: [],
                    sourceFragments: [],
                    confidence: 0.6, // Lower confidence for fallback
                    keywords: [rootData.rootTopic],
                    entityReferences: [],
                    timestamp: new Date().toISOString(),
                    domain: context.domain || undefined,
                };

                topicMap.set(rootTopic.id, rootTopic);
                rootTopics.push(rootTopic);

                // Add children from fallback
                for (const childName of rootData.children || []) {
                    const childTopic: HierarchicalTopic = {
                        id: generateTopicId(childName, 1),
                        name: childName,
                        level: 1,
                        parentId: rootTopic.id,
                        childIds: [],
                        sourceFragments: [],
                        confidence: 0.5, // Lower confidence for fallback
                        keywords: [childName],
                        entityReferences: [],
                        timestamp: new Date().toISOString(),
                        domain: context.domain || undefined,
                    };

                    topicMap.set(childTopic.id, childTopic);
                    rootTopic.childIds.push(childTopic.id);
                    maxDepth = Math.max(maxDepth, 1);
                }
            }
        }
    } catch (error) {
        console.error("Error in LLM-based categorization:", error);
    }

    // Fallback: If LLM failed or produced no results, use simple rule-based approach
    if (rootTopics.length === 0 && aggregatedTopics.length > 0) {
        const rootTopic: HierarchicalTopic = {
            id: generateTopicId(aggregatedTopics[0], 0),
            name: aggregatedTopics[0],
            level: 0,
            childIds: [],
            sourceFragments: [],
            confidence: 0.8,
            keywords: [aggregatedTopics[0]],
            entityReferences: [],
            timestamp: new Date().toISOString(),
            domain: context.domain || undefined,
        };
        topicMap.set(rootTopic.id, rootTopic);
        rootTopics.push(rootTopic);

        // Add topics as children
        for (let i = 0; i < Math.min(topics.length, 15); i++) {
            const childTopic: HierarchicalTopic = {
                id: generateTopicId(topics[i], 1),
                name: topics[i],
                level: 1,
                parentId: rootTopic.id,
                childIds: [],
                sourceFragments: [],
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
    return `topic_${cleanName}_${level}`;
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

/**
 * Creates a fallback hierarchy when JSON parsing fails
 */
function createFallbackHierarchy(topics: string[], aggregatedTopics: string[]): any[] {
    console.log("Creating fallback hierarchy for", topics.length, "topics");
    
    // Group topics by similarity (simple keyword-based grouping)
    const groups = new Map<string, string[]>();
    
    // Use aggregated topics as root categories, or create generic ones
    const rootCategories = aggregatedTopics.length > 0 
        ? aggregatedTopics.slice(0, 4) // Limit to 4 root categories
        : ["General Topics", "Technical", "Concepts", "Other"];
    
    // Initialize groups
    rootCategories.forEach(category => {
        groups.set(category, []);
    });
    
    // Simple assignment: split topics evenly across root categories
    topics.forEach((topic, index) => {
        const categoryIndex = index % rootCategories.length;
        const category = rootCategories[categoryIndex];
        groups.get(category)?.push(topic);
    });
    
    // Convert to expected format
    return Array.from(groups.entries()).map(([rootTopic, children]) => ({
        rootTopic,
        children: children.slice(0, 10), // Limit children to avoid overwhelming
        grandchildren: {} // Keep simple for fallback
    }));
}
