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
 * Calculate PageRank scores for topics with performance optimizations
 */
function calculatePageRank(
    topics: any[],
    relationships: any[],
    iterations: number = 5, // OPTIMIZATION: Reduced from 20 to 5 iterations
    dampingFactor: number = 0.85,
): Map<string, number> {
    const nodeMap = new Map<string, number>();
    topics.forEach((topic, index) => {
        nodeMap.set(topic.topicId, index);
    });

    const n = topics.length;
    if (n === 0) return new Map();

    // OPTIMIZATION: Early return for small graphs - use simple degree centrality
    if (n < 10) {
        const result = new Map<string, number>();
        topics.forEach((topic) => {
            const degree = relationships.filter(
                (rel) => rel.from === topic.topicId || rel.to === topic.topicId,
            ).length;
            result.set(
                topic.topicId,
                degree / Math.max(1, relationships.length),
            );
        });
        return result;
    }

    // Build adjacency matrix (sparse representation)
    const adjacency = new Map<number, Set<number>>();
    const outDegree = new Array(n).fill(0);

    for (let i = 0; i < n; i++) {
        adjacency.set(i, new Set<number>());
    }

    // OPTIMIZATION: Only process strong relationships (>= 0.3 strength)
    const strongRelationships = relationships.filter(
        (rel) => (rel.strength || 0) >= 0.3,
    );

    for (const rel of strongRelationships) {
        const fromIndex = nodeMap.get(rel.from);
        const toIndex = nodeMap.get(rel.to);

        if (fromIndex !== undefined && toIndex !== undefined) {
            adjacency.get(fromIndex)!.add(toIndex);
            outDegree[fromIndex]++;
        }
    }

    // Initialize PageRank values
    let pageRank = new Array(n).fill(1.0 / n);
    let newPageRank = new Array(n).fill(0);

    // OPTIMIZATION: Early convergence detection
    const convergenceThreshold = 0.001;
    let converged = false;

    for (let iter = 0; iter < iterations && !converged; iter++) {
        // Reset new values
        newPageRank.fill((1.0 - dampingFactor) / n);

        // Calculate new PageRank values
        for (let i = 0; i < n; i++) {
            if (outDegree[i] > 0) {
                const contribution =
                    (dampingFactor * pageRank[i]) / outDegree[i];
                for (const neighbor of adjacency.get(i)!) {
                    newPageRank[neighbor] += contribution;
                }
            }
        }

        // OPTIMIZATION: Check for convergence
        let maxDiff = 0;
        for (let i = 0; i < n; i++) {
            maxDiff = Math.max(maxDiff, Math.abs(newPageRank[i] - pageRank[i]));
        }

        if (maxDiff < convergenceThreshold) {
            converged = true;
        }

        // Swap arrays
        [pageRank, newPageRank] = [newPageRank, pageRank];
    }

    // Convert back to topic ID mapping
    const result = new Map<string, number>();
    topics.forEach((topic, index) => {
        result.set(topic.topicId, pageRank[index]);
    });

    return result;
}

/**
 * Calculate betweenness centrality for topics with performance optimizations
 */
function calculateBetweenness(
    topics: any[],
    relationships: any[],
): Map<string, number> {
    const nodeCount = topics.length;

    // OPTIMIZATION: Skip expensive betweenness calculation for large graphs
    // Use degree centrality as approximation instead
    if (nodeCount > 500) {
        const result = new Map<string, number>();
        const degreeCount = new Map<string, number>();

        // Calculate degree centrality as approximation
        topics.forEach((topic) => degreeCount.set(topic.topicId, 0));

        relationships.forEach((rel) => {
            const fromCount = degreeCount.get(rel.from) || 0;
            const toCount = degreeCount.get(rel.to) || 0;
            degreeCount.set(rel.from, fromCount + 1);
            degreeCount.set(rel.to, toCount + 1);
        });

        // Normalize degree centrality to approximate betweenness
        const maxDegree = Math.max(...Array.from(degreeCount.values()), 1);
        topics.forEach((topic) => {
            const degree = degreeCount.get(topic.topicId) || 0;
            // Use square root to approximate betweenness characteristics
            result.set(topic.topicId, Math.sqrt(degree / maxDegree));
        });

        return result;
    }

    // For smaller graphs, use optimized betweenness calculation
    const nodeMap = new Map<string, number>();
    topics.forEach((topic, index) => {
        nodeMap.set(topic.topicId, index);
    });

    const n = topics.length;
    if (n === 0) return new Map();

    // Build adjacency list with only strong relationships for performance
    const strongRelationships = relationships.filter(
        (rel) => (rel.strength || 0) >= 0.4,
    );

    const adjacency = new Map<number, Set<number>>();
    for (let i = 0; i < n; i++) {
        adjacency.set(i, new Set<number>());
    }

    for (const rel of strongRelationships) {
        const fromIndex = nodeMap.get(rel.from);
        const toIndex = nodeMap.get(rel.to);

        if (fromIndex !== undefined && toIndex !== undefined) {
            adjacency.get(fromIndex)!.add(toIndex);
            adjacency.get(toIndex)!.add(fromIndex); // Undirected
        }
    }

    const betweenness = new Array(n).fill(0);

    // OPTIMIZATION: Sample subset of nodes for large-ish graphs (100-500 nodes)
    const sampleSize =
        nodeCount > 100
            ? Math.min(100, Math.floor(nodeCount * 0.3))
            : nodeCount;
    const sampleIndices =
        nodeCount > 100
            ? Array.from({ length: sampleSize }, () =>
                  Math.floor(Math.random() * nodeCount),
              )
            : Array.from({ length: nodeCount }, (_, i) => i);

    for (const source of sampleIndices) {
        // BFS from source
        const stack: number[] = [];
        const paths = new Map<number, number[]>();
        const distances = new Map<number, number>();
        const pathCounts = new Map<string, number>();
        const queue: string[] = [source.toString()];

        distances.set(source, 0);
        pathCounts.set(source.toString(), 1);

        while (queue.length > 0) {
            const current = parseInt(queue.shift()!);
            const currentDist = distances.get(current)!;

            const neighbors = adjacency.get(current) || new Set();
            neighbors.forEach((neighbor) => {
                if (!distances.has(neighbor)) {
                    distances.set(neighbor, currentDist + 1);
                    pathCounts.set(neighbor.toString(), 0);
                    queue.push(neighbor.toString());
                }

                if (distances.get(neighbor) === currentDist + 1) {
                    const currentCount =
                        pathCounts.get(neighbor.toString()) || 0;
                    const sourceCount = pathCounts.get(current.toString()) || 0;
                    pathCounts.set(
                        neighbor.toString(),
                        currentCount + sourceCount,
                    );

                    if (!paths.has(neighbor)) {
                        paths.set(neighbor, []);
                    }
                    paths.get(neighbor)!.push(current);
                }
            });

            stack.push(current);
        }

        // Calculate dependencies and update betweenness
        const dependencies = new Map<number, number>();
        while (stack.length > 0) {
            const w = stack.pop()!;
            const predecessors = paths.get(w) || [];

            for (const v of predecessors) {
                const pathCountV = pathCounts.get(v.toString()) || 0;
                const pathCountW = pathCounts.get(w.toString()) || 0;
                const depW = dependencies.get(w) || 0;

                if (pathCountW > 0) {
                    const dependency = (pathCountV / pathCountW) * (1 + depW);
                    dependencies.set(
                        v,
                        (dependencies.get(v) || 0) + dependency,
                    );
                }
            }

            if (w !== source) {
                betweenness[w] += dependencies.get(w) || 0;
            }
        }
    }

    // Scale results if we sampled
    const scaleFactor = nodeCount > 100 ? nodeCount / sampleSize : 1;

    // Convert back to topic ID mapping
    const result = new Map<string, number>();
    topics.forEach((topic, index) => {
        result.set(topic.topicId, betweenness[index] * scaleFactor);
    });

    return result;
}

/**
 * Optimize graph structure through intelligent sparsification
 * Removes low-importance edges while preserving graph connectivity and centrality properties
 */
function sparsifyGraph(
    topics: any[],
    relationships: any[],
): {
    sparsifiedTopics: any[];
    sparsifiedRelationships: any[];
    compressionRatio: number;
} {
    if (topics.length <= 50 || relationships.length <= 100) {
        // No sparsification needed for small graphs
        return {
            sparsifiedTopics: topics,
            sparsifiedRelationships: relationships,
            compressionRatio: 1.0,
        };
    }

    // OPTIMIZATION: Remove isolated or weakly connected nodes
    const topicDegree = new Map<string, number>();
    topics.forEach((topic) => topicDegree.set(topic.topicId, 0));

    // Count degrees from parent-child relationships
    topics.forEach((topic) => {
        if (topic.parentTopicId) {
            topicDegree.set(
                topic.topicId,
                (topicDegree.get(topic.topicId) || 0) + 1,
            );
            topicDegree.set(
                topic.parentTopicId,
                (topicDegree.get(topic.parentTopicId) || 0) + 1,
            );
        }
    });

    // Count degrees from lateral relationships
    relationships.forEach((rel) => {
        if (topicDegree.has(rel.from) && topicDegree.has(rel.to)) {
            topicDegree.set(rel.from, (topicDegree.get(rel.from) || 0) + 1);
            topicDegree.set(rel.to, (topicDegree.get(rel.to) || 0) + 1);
        }
    });

    // Filter out isolated nodes (degree 0) and very weakly connected nodes
    const minDegreeThreshold = Math.max(1, Math.ceil(Math.log2(topics.length)));
    const connectedTopics = topics.filter((topic) => {
        const degree = topicDegree.get(topic.topicId) || 0;
        // Keep root-level topics even if low degree, and topics with sufficient connectivity
        return (
            topic.level === 0 ||
            degree >= minDegreeThreshold ||
            (topic.childCount || 0) > 0
        ); // Keep topics with children
    });

    // OPTIMIZATION: Adaptive relationship filtering based on graph size
    let strengthThreshold: number;
    if (relationships.length > 10000) {
        strengthThreshold = 0.8; // Very strict for large graphs
    } else if (relationships.length > 1000) {
        strengthThreshold = 0.7;
    } else if (relationships.length > 500) {
        strengthThreshold = 0.6;
    } else {
        strengthThreshold = 0.5;
    }

    // Filter relationships by strength and ensure both endpoints exist
    const connectedTopicIds = new Set(connectedTopics.map((t) => t.topicId));
    const filteredRelationships = relationships.filter((rel) => {
        return (
            (rel.strength || 0) >= strengthThreshold &&
            connectedTopicIds.has(rel.from) &&
            connectedTopicIds.has(rel.to)
        );
    });

    // OPTIMIZATION: Ensure graph connectivity by preserving spanning tree
    // Build minimum spanning tree of high-importance edges to maintain connectivity
    const preserveConnectivity = (topics: any[], relationships: any[]) => {
        const clusters = new Map<string, Set<string>>();
        const bridgeRelationships: any[] = [];

        // Initialize each topic as its own cluster
        topics.forEach((topic) => {
            clusters.set(topic.topicId, new Set([topic.topicId]));
        });

        // Sort relationships by strength (descending) to prioritize strong connections
        const sortedRels = [...relationships].sort(
            (a, b) => (b.strength || 0) - (a.strength || 0),
        );

        // Add edges that connect different clusters (Union-Find approach)
        sortedRels.forEach((rel) => {
            const fromCluster = clusters.get(rel.from);
            const toCluster = clusters.get(rel.to);

            if (fromCluster && toCluster && fromCluster !== toCluster) {
                // Merge clusters
                const mergedCluster = new Set([...fromCluster, ...toCluster]);

                // Update all nodes in merged cluster
                mergedCluster.forEach((nodeId) => {
                    clusters.set(nodeId, mergedCluster);
                });

                bridgeRelationships.push(rel);
            }
        });

        return bridgeRelationships;
    };

    // Preserve essential connectivity edges
    const essentialEdges = preserveConnectivity(
        connectedTopics,
        filteredRelationships,
    );

    // Combine filtered relationships with essential connectivity edges
    const finalRelationships = [
        ...new Set([...filteredRelationships, ...essentialEdges]),
    ];

    const compressionRatio =
        (connectedTopics.length * finalRelationships.length) /
        (topics.length * relationships.length);

    return {
        sparsifiedTopics: connectedTopics,
        sparsifiedRelationships: finalRelationships,
        compressionRatio,
    };
}

/**
 * Calculate descendant count for each topic with optimizations
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
 * Calculate composite importance score for topics with advanced optimizations
 */
export function calculateTopicImportance(
    topics: any[],
    relationships: any[],
    topicMetrics?: any[],
): TopicImportanceMetrics[] {
    if (topics.length === 0) {
        return [];
    }

    // OPTIMIZATION: Apply graph sparsification for large graphs
    const { sparsifiedTopics, sparsifiedRelationships } = sparsifyGraph(
        topics,
        relationships,
    );

    // Calculate metrics on sparsified graph for better performance
    const pageRanks = calculatePageRank(
        sparsifiedTopics,
        sparsifiedRelationships,
    );
    const betweenness = calculateBetweenness(
        sparsifiedTopics,
        sparsifiedRelationships,
    );
    const descendantCounts = calculateDescendantCounts(sparsifiedTopics);

    // Get entity counts from topic metrics or data
    const entityCounts = new Map<string, number>();
    if (topicMetrics) {
        topicMetrics.forEach((metric: any) => {
            entityCounts.set(metric.topicId, metric.entityCount || 0);
        });
    }

    // Normalize metrics (using original topics for proper scaling)
    const maxPageRank = Math.max(...Array.from(pageRanks.values()));
    const maxBetweenness = Math.max(...Array.from(betweenness.values()));
    const maxDescendants = Math.max(...Array.from(descendantCounts.values()));
    const maxEntityCount = Math.max(
        ...topics.map((t) => entityCounts.get(t.topicId) || 0),
    );

    // Calculate composite importance for ALL original topics
    const results = topics.map((topic) => {
        // Use calculated metrics if available, otherwise use defaults
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

        // OPTIMIZATION: Enhanced composite importance with level-based weighting
        let levelWeight = 0;
        if (topic.level === 0)
            levelWeight = 0.15; // Root topics get highest boost
        else if (topic.level === 1)
            levelWeight = 0.1; // Second level gets moderate boost
        else if (topic.level === 2) levelWeight = 0.05; // Third level gets small boost

        // Enhanced weighted importance calculation
        const importance =
            normalizedPageRank * 0.25 + // Reduced PageRank weight
            normalizedEntityCount * 0.25 + // Entity links remain important
            normalizedDescendants * 0.2 + // Subtree size
            normalizedBetweenness * 0.15 + // Bridge topics
            levelWeight; // Level-based importance

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

    return results;
}
