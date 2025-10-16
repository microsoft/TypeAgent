// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Optimized graph algorithms for knowledge graph metrics calculation
 * Includes efficient PageRank, betweenness centrality, and community detection algorithms
 */

import { Relationship } from "../tables.js";

export interface GraphNode {
    id: string;
    neighbors: string[];
    inDegree: number;
    outDegree: number;
}

export interface GraphMetrics {
    pageRank: Map<string, number>;
    betweennessCentrality: Map<string, number>;
    degreeCentrality: Map<string, number>;
    communities: Array<{
        id: string;
        nodes: string[];
        density: number;
    }>;
}

export class OptimizedGraphAlgorithms {
    /**
     * Build an adjacency list representation of the graph for efficient algorithms
     */
    buildGraph(
        nodes: string[],
        relationships: Relationship[],
    ): Map<string, GraphNode> {
        const graph = new Map<string, GraphNode>();

        // Initialize nodes
        for (const nodeId of nodes) {
            graph.set(nodeId, {
                id: nodeId,
                neighbors: [],
                inDegree: 0,
                outDegree: 0,
            });
        }

        // Add edges
        for (const rel of relationships) {
            const fromNode = graph.get(rel.fromEntity);
            const toNode = graph.get(rel.toEntity);

            if (fromNode && toNode) {
                fromNode.neighbors.push(rel.toEntity);
                fromNode.outDegree++;
                toNode.inDegree++;
            }
        }

        return graph;
    }

    /**
     * Optimized PageRank algorithm with early convergence detection
     */
    calculatePageRank(
        graph: Map<string, GraphNode>,
        dampingFactor: number = 0.85,
        maxIterations: number = 20,
        tolerance: number = 1e-6,
    ): Map<string, number> {
        const nodeCount = graph.size;

        if (nodeCount === 0) {
            return new Map();
        }

        const pageRank = new Map<string, number>();
        const newPageRank = new Map<string, number>();
        const initialValue = 1.0 / nodeCount;

        // Initialize PageRank values
        for (const nodeId of graph.keys()) {
            pageRank.set(nodeId, initialValue);
            newPageRank.set(nodeId, 0);
        }

        let iteration = 0;
        let converged = false;

        while (iteration < maxIterations && !converged) {
            // Reset new values
            for (const nodeId of graph.keys()) {
                newPageRank.set(nodeId, (1 - dampingFactor) / nodeCount);
            }

            // Calculate new PageRank values
            for (const [nodeId, node] of graph) {
                if (node.outDegree > 0) {
                    const contribution =
                        (dampingFactor * pageRank.get(nodeId)!) /
                        node.outDegree;

                    for (const neighborId of node.neighbors) {
                        const currentValue = newPageRank.get(neighborId) || 0;
                        newPageRank.set(
                            neighborId,
                            currentValue + contribution,
                        );
                    }
                } else {
                    // Handle dangling nodes (distribute rank equally)
                    const contribution =
                        (dampingFactor * pageRank.get(nodeId)!) / nodeCount;
                    for (const neighborId of graph.keys()) {
                        const currentValue = newPageRank.get(neighborId) || 0;
                        newPageRank.set(
                            neighborId,
                            currentValue + contribution,
                        );
                    }
                }
            }

            // Check for convergence
            converged = true;
            for (const nodeId of graph.keys()) {
                const oldValue = pageRank.get(nodeId)!;
                const newValue = newPageRank.get(nodeId)!;
                if (Math.abs(oldValue - newValue) > tolerance) {
                    converged = false;
                    break;
                }
            }

            // Swap maps for next iteration
            for (const nodeId of graph.keys()) {
                pageRank.set(nodeId, newPageRank.get(nodeId)!);
            }

            iteration++;
        }

        if (converged) {
        }

        return pageRank;
    }

    /**
     * Optimized betweenness centrality calculation
     * Uses Brandes' algorithm for efficient computation
     */
    calculateBetweennessCentrality(
        graph: Map<string, GraphNode>,
    ): Map<string, number> {
        const betweenness = new Map<string, number>();
        const nodeList = Array.from(graph.keys());

        // Initialize betweenness scores
        for (const nodeId of nodeList) {
            betweenness.set(nodeId, 0);
        }

        // For large graphs, use sampling for approximation
        const useApproximation = nodeList.length > 1000;
        const sampleSize = useApproximation
            ? Math.min(200, Math.ceil(nodeList.length * 0.2))
            : nodeList.length;
        const samplesToProcess = useApproximation
            ? this.sampleNodes(nodeList, sampleSize)
            : nodeList;

        for (const source of samplesToProcess) {
            const { predecessors, distances, sigma } = this.bfs(graph, source);
            const delta = new Map<string, number>();

            // Initialize delta
            for (const nodeId of nodeList) {
                delta.set(nodeId, 0);
            }

            // Process nodes in order of decreasing distance
            const sortedNodes = nodeList
                .filter((node) => distances.has(node))
                .sort((a, b) => distances.get(b)! - distances.get(a)!);

            for (const node of sortedNodes) {
                if (node === source) continue;

                const preds = predecessors.get(node) || [];
                for (const pred of preds) {
                    const sigmaNode = sigma.get(node) || 0;
                    const sigmaPred = sigma.get(pred) || 0;
                    if (sigmaPred > 0) {
                        const deltaContrib =
                            (sigmaPred / sigmaNode) * (1 + delta.get(node)!);
                        delta.set(pred, delta.get(pred)! + deltaContrib);
                    }
                }

                if (node !== source) {
                    const currentBetween = betweenness.get(node) || 0;
                    betweenness.set(node, currentBetween + delta.get(node)!);
                }
            }
        }

        // Scale results if using approximation
        if (useApproximation) {
            const scaleFactor = nodeList.length / sampleSize;
            for (const [nodeId, value] of betweenness) {
                betweenness.set(nodeId, value * scaleFactor);
            }
        }

        return betweenness;
    }

    /**
     * Breadth-first search for betweenness centrality calculation
     */
    private bfs(
        graph: Map<string, GraphNode>,
        source: string,
    ): {
        predecessors: Map<string, string[]>;
        distances: Map<string, number>;
        sigma: Map<string, number>;
    } {
        const predecessors = new Map<string, string[]>();
        const distances = new Map<string, number>();
        const sigma = new Map<string, number>();
        const queue: string[] = [];

        // Initialize
        for (const nodeId of graph.keys()) {
            predecessors.set(nodeId, []);
            distances.set(nodeId, -1);
            sigma.set(nodeId, 0);
        }

        distances.set(source, 0);
        sigma.set(source, 1);
        queue.push(source);

        while (queue.length > 0) {
            const current = queue.shift()!;
            const currentNode = graph.get(current);
            if (!currentNode) continue;

            for (const neighbor of currentNode.neighbors) {
                // First time visiting this neighbor
                if (distances.get(neighbor) === -1) {
                    distances.set(neighbor, distances.get(current)! + 1);
                    queue.push(neighbor);
                }

                // Shortest path to neighbor via current
                if (distances.get(neighbor) === distances.get(current)! + 1) {
                    sigma.set(
                        neighbor,
                        sigma.get(neighbor)! + sigma.get(current)!,
                    );
                    predecessors.get(neighbor)!.push(current);
                }
            }
        }

        return { predecessors, distances, sigma };
    }

    /**
     * Sample nodes for approximation algorithms
     */
    private sampleNodes(nodes: string[], sampleSize: number): string[] {
        const shuffled = [...nodes].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, sampleSize);
    }

    /**
     * Optimized community detection using Label Propagation Algorithm
     */
    detectCommunities(graph: Map<string, GraphNode>): Array<{
        id: string;
        nodes: string[];
        density: number;
    }> {
        const labels = new Map<string, string>();
        const nodeList = Array.from(graph.keys());

        // Initialize each node with its own label
        for (const nodeId of nodeList) {
            labels.set(nodeId, nodeId);
        }

        const maxIterations = 10;
        let changed = true;
        let iteration = 0;

        while (changed && iteration < maxIterations) {
            changed = false;

            // Shuffle nodes for better convergence
            const shuffledNodes = [...nodeList].sort(() => Math.random() - 0.5);

            for (const nodeId of shuffledNodes) {
                const node = graph.get(nodeId);
                if (!node || node.neighbors.length === 0) continue;

                // Count label frequencies among neighbors
                const labelCounts = new Map<string, number>();
                for (const neighborId of node.neighbors) {
                    const neighborLabel = labels.get(neighborId);
                    if (neighborLabel) {
                        labelCounts.set(
                            neighborLabel,
                            (labelCounts.get(neighborLabel) || 0) + 1,
                        );
                    }
                }

                // Find most frequent label
                let maxCount = 0;
                let bestLabel = labels.get(nodeId)!;
                for (const [labelVal, count] of labelCounts) {
                    if (count > maxCount) {
                        maxCount = count;
                        bestLabel = labelVal;
                    }
                }

                // Update label if changed
                if (bestLabel !== labels.get(nodeId)) {
                    labels.set(nodeId, bestLabel);
                    changed = true;
                }
            }

            iteration++;
        }

        // Group nodes by label to form communities
        const communityMap = new Map<string, string[]>();
        for (const [nodeId, labelVal] of labels) {
            if (!communityMap.has(labelVal)) {
                communityMap.set(labelVal, []);
            }
            communityMap.get(labelVal)!.push(nodeId);
        }

        // Convert to community objects and calculate density
        const communities: Array<{
            id: string;
            nodes: string[];
            density: number;
        }> = [];

        let communityId = 0;
        for (const [, nodes] of communityMap) {
            if (nodes.length > 1) {
                // Only include communities with multiple nodes
                const density = this.calculateCommunityDensity(nodes, graph);
                communities.push({
                    id: `community_${communityId++}`,
                    nodes,
                    density,
                });
            }
        }

        return communities;
    }

    /**
     * Calculate community density
     */
    private calculateCommunityDensity(
        nodes: string[],
        graph: Map<string, GraphNode>,
    ): number {
        if (nodes.length < 2) return 0;

        const nodeSet = new Set(nodes);
        let internalEdges = 0;
        const maxPossibleEdges = (nodes.length * (nodes.length - 1)) / 2;

        for (const nodeId of nodes) {
            const node = graph.get(nodeId);
            if (node) {
                for (const neighborId of node.neighbors) {
                    if (nodeSet.has(neighborId) && nodeId < neighborId) {
                        // Count each edge only once
                        internalEdges++;
                    }
                }
            }
        }

        return internalEdges / maxPossibleEdges;
    }

    /**
     * Calculate all graph metrics efficiently
     */
    calculateAllMetrics(
        nodes: string[],
        relationships: Relationship[],
    ): GraphMetrics {
        // Build graph representation
        const graph = this.buildGraph(nodes, relationships);

        // Calculate degree centrality (simple and fast)
        const degreeCentrality = new Map<string, number>();
        for (const [nodeId, node] of graph) {
            degreeCentrality.set(nodeId, node.neighbors.length);
        }

        // Calculate PageRank
        const pageRank = this.calculatePageRank(graph);

        // Calculate betweenness centrality (most expensive)
        const betweennessCentrality =
            this.calculateBetweennessCentrality(graph);

        // Detect communities
        const communities = this.detectCommunities(graph);

        return {
            pageRank,
            betweennessCentrality,
            degreeCentrality,
            communities,
        };
    }
}
