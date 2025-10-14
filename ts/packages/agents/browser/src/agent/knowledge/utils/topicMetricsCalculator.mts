// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface TopicImportanceMetrics {
    topicId: string;
    topicName: string;
    level: number;
    childCount: number;
    descendantCount: number;
    entityCount: number;
    pageRank: number;
    betweenness: number;
    importance: number; // Composite 0-1 score
}

/**
 * Calculate PageRank scores for topics
 */
function calculatePageRank(
    topics: any[],
    relationships: any[],
    iterations: number = 20,
    dampingFactor: number = 0.85,
): Map<string, number> {
    const scores = new Map<string, number>();
    const inLinks = new Map<string, string[]>();
    const outLinks = new Map<string, Set<string>>();

    // Initialize
    topics.forEach((topic) => {
        scores.set(topic.topicId, 1.0 / topics.length);
        inLinks.set(topic.topicId, []);
        outLinks.set(topic.topicId, new Set());
    });

    // Build link structure (parent-child + lateral)
    topics.forEach((topic) => {
        if (topic.parentTopicId) {
            inLinks.get(topic.topicId)?.push(topic.parentTopicId);
            outLinks.get(topic.parentTopicId)?.add(topic.topicId);
        }
    });

    relationships.forEach((rel) => {
        inLinks.get(rel.to)?.push(rel.from);
        outLinks.get(rel.from)?.add(rel.to);
    });

    // Iterative PageRank calculation
    for (let iter = 0; iter < iterations; iter++) {
        const newScores = new Map<string, number>();

        topics.forEach((topic) => {
            const topicId = topic.topicId;
            let score = (1 - dampingFactor) / topics.length;

            const incoming = inLinks.get(topicId) || [];
            incoming.forEach((fromId) => {
                const fromScore = scores.get(fromId) || 0;
                const fromOutCount = outLinks.get(fromId)?.size || 1;
                score += dampingFactor * (fromScore / fromOutCount);
            });

            newScores.set(topicId, score);
        });

        scores.clear();
        newScores.forEach((score, id) => scores.set(id, score));
    }

    return scores;
}

/**
 * Calculate betweenness centrality for topics
 */
function calculateBetweenness(
    topics: any[],
    relationships: any[],
): Map<string, number> {
    const betweenness = new Map<string, number>();
    const adjacency = new Map<string, Set<string>>();

    // Initialize
    topics.forEach((topic) => {
        betweenness.set(topic.topicId, 0);
        adjacency.set(topic.topicId, new Set());
    });

    // Build adjacency (bidirectional for betweenness)
    topics.forEach((topic) => {
        if (topic.parentTopicId) {
            adjacency.get(topic.topicId)?.add(topic.parentTopicId);
            adjacency.get(topic.parentTopicId)?.add(topic.topicId);
        }
    });

    relationships.forEach((rel) => {
        adjacency.get(rel.from)?.add(rel.to);
        adjacency.get(rel.to)?.add(rel.from);
    });

    // Simplified betweenness: count shortest paths through each node
    topics.forEach((source) => {
        const distances = new Map<string, number>();
        const pathCounts = new Map<string, number>();
        const queue: string[] = [source.topicId];

        distances.set(source.topicId, 0);
        pathCounts.set(source.topicId, 1);

        while (queue.length > 0) {
            const current = queue.shift()!;
            const currentDist = distances.get(current)!;

            const neighbors = adjacency.get(current) || new Set();
            neighbors.forEach((neighbor) => {
                if (!distances.has(neighbor)) {
                    distances.set(neighbor, currentDist + 1);
                    pathCounts.set(neighbor, 0);
                    queue.push(neighbor);
                }

                if (distances.get(neighbor) === currentDist + 1) {
                    const currentCount = pathCounts.get(neighbor) || 0;
                    const sourceCount = pathCounts.get(current) || 0;
                    pathCounts.set(neighbor, currentCount + sourceCount);
                }
            });
        }

        // Update betweenness scores
        pathCounts.forEach((count, nodeId) => {
            if (nodeId !== source.topicId && count > 1) {
                const current = betweenness.get(nodeId) || 0;
                betweenness.set(nodeId, current + count - 1);
            }
        });
    });

    return betweenness;
}

/**
 * Calculate descendant count for each topic
 */
function calculateDescendantCounts(topics: any[]): Map<string, number> {
    const counts = new Map<string, number>();
    const childMap = new Map<string, string[]>();

    // Build child map
    topics.forEach((topic) => {
        counts.set(topic.topicId, 0);
        childMap.set(topic.topicId, []);
    });

    topics.forEach((topic) => {
        if (topic.parentTopicId) {
            const children = childMap.get(topic.parentTopicId) || [];
            children.push(topic.topicId);
            childMap.set(topic.parentTopicId, children);
        }
    });

    // Recursive count
    function countDescendants(topicId: string): number {
        if (counts.get(topicId) !== 0) {
            return counts.get(topicId)!;
        }

        const children = childMap.get(topicId) || [];
        let total = children.length;

        children.forEach((childId) => {
            total += countDescendants(childId);
        });

        counts.set(topicId, total);
        return total;
    }

    topics.forEach((topic) => countDescendants(topic.topicId));

    return counts;
}

/**
 * Calculate composite importance score for topics
 */
export function calculateTopicImportance(
    topics: any[],
    relationships: any[],
    topicMetrics?: any[],
): TopicImportanceMetrics[] {
    if (topics.length === 0) {
        return [];
    }

    // Calculate metrics
    const pageRanks = calculatePageRank(topics, relationships);
    const betweenness = calculateBetweenness(topics, relationships);
    const descendantCounts = calculateDescendantCounts(topics);

    // Get entity counts from topic metrics or data
    const entityCounts = new Map<string, number>();
    if (topicMetrics) {
        topicMetrics.forEach((metric: any) => {
            entityCounts.set(metric.topicId, metric.entityCount || 0);
        });
    }

    // Normalize metrics
    const maxPageRank = Math.max(...Array.from(pageRanks.values()));
    const maxBetweenness = Math.max(...Array.from(betweenness.values()));
    const maxDescendants = Math.max(...Array.from(descendantCounts.values()));
    const maxEntityCount = Math.max(
        ...topics.map((t) => entityCounts.get(t.topicId) || 0),
    );

    // Calculate composite importance
    return topics.map((topic) => {
        const pageRank = pageRanks.get(topic.topicId) || 0;
        const betweennessScore = betweenness.get(topic.topicId) || 0;
        const descendantCount = descendantCounts.get(topic.topicId) || 0;
        const entityCount = entityCounts.get(topic.topicId) || 0;

        const normalizedPageRank = maxPageRank > 0 ? pageRank / maxPageRank : 0;
        const normalizedBetweenness =
            maxBetweenness > 0 ? betweennessScore / maxBetweenness : 0;
        const normalizedDescendants =
            maxDescendants > 0 ? descendantCount / maxDescendants : 0;
        const normalizedEntityCount =
            maxEntityCount > 0 ? entityCount / maxEntityCount : 0;

        // Composite importance score (weighted average)
        const importance =
            normalizedPageRank * 0.3 + // PageRank weight
            normalizedEntityCount * 0.25 + // Entity links
            normalizedDescendants * 0.2 + // Subtree size
            normalizedBetweenness * 0.15 + // Bridge topics
            (topic.level === 0 ? 0.1 : 0); // Root level boost

        return {
            topicId: topic.topicId,
            topicName: topic.topicName,
            level: topic.level,
            childCount: topic.childCount || 0,
            descendantCount,
            entityCount,
            pageRank,
            betweenness: betweennessScore,
            importance: Math.min(importance, 1.0), // Cap at 1.0
        };
    });
}
