// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Simple LRU Cache implementation
class LRUCache<K, V> {
    private cache = new Map<K, V>();
    private maxSize: number;
    
    constructor(options: { max: number; ttl?: number }) {
        this.maxSize = options.max;
    }
    
    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }
    
    set(key: K, value: V): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Remove least recently used
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }
    
    clear(): void {
        this.cache.clear();
    }
}

export interface GraphNode {
    id: number;
    name: string;
    type: string;
    communityId?: number;
    centralityScore?: number;
    degreeCount?: number;
    metadata?: any;
}

export interface GraphEdge {
    fromId: number;
    toId: number;
    relationshipType: string;
    weight: number;
    confidence: number;
}

export interface Community {
    id: number;
    parentId?: number;
    level: number;
    name?: string;
    size: number;
    cohesionScore: number;
    memberIds: Set<number>;
    metadata?: any;
}

export interface GraphMetrics {
    betweennessCentrality?: number;
    closenessCentrality?: number;
    eigenvectorCentrality?: number;
    pagerank?: number;
    clusteringCoefficient?: number;
}

interface PathResult {
    path: number[];
    distance: number;
    confidence: number;
}

interface NeighborhoodResult {
    nodes: GraphNode[];
    edges: GraphEdge[];
    depth: number;
}

/**
 * In-memory graph index for fast traversal and queries
 */
export class GraphIndex {
    // Adjacency lists for efficient traversal
    private adjacencyList: Map<number, Map<number, GraphEdge[]>>;
    private reverseAdjacencyList: Map<number, Map<number, GraphEdge[]>>;
    
    // Node and edge storage
    private nodes: Map<number, GraphNode>;
    private nodeNameIndex: Map<string, number>;
    
    // Community structure
    private communities: Map<number, Community>;
    private nodeToCommunity: Map<number, number>;
    private communityLevels: Map<number, Set<number>>;
    
    // Caching for expensive operations
    private pathCache: LRUCache<string, PathResult>;
    private neighborhoodCache: LRUCache<string, NeighborhoodResult>;
    
    // Metrics storage
    private nodeMetrics: Map<number, GraphMetrics>;
    
    // Degree distribution for optimization
    private highDegreeNodes: Set<number>;
    private averageDegree: number;

    constructor() {
        this.adjacencyList = new Map();
        this.reverseAdjacencyList = new Map();
        this.nodes = new Map();
        this.nodeNameIndex = new Map();
        this.communities = new Map();
        this.nodeToCommunity = new Map();
        this.communityLevels = new Map();
        this.nodeMetrics = new Map();
        this.highDegreeNodes = new Set();
        this.averageDegree = 0;
        
        // Initialize caches with reasonable limits
        this.pathCache = new LRUCache<string, PathResult>({
            max: 1000,
            ttl: 1000 * 60 * 5 // 5 minutes
        });
        
        this.neighborhoodCache = new LRUCache<string, NeighborhoodResult>({
            max: 500,
            ttl: 1000 * 60 * 5 // 5 minutes
        });
    }

    /**
     * Add a node to the graph index
     */
    addNode(node: GraphNode): void {
        this.nodes.set(node.id, node);
        this.nodeNameIndex.set(node.name.toLowerCase(), node.id);
        
        if (!this.adjacencyList.has(node.id)) {
            this.adjacencyList.set(node.id, new Map());
        }
        if (!this.reverseAdjacencyList.has(node.id)) {
            this.reverseAdjacencyList.set(node.id, new Map());
        }
    }

    /**
     * Add an edge to the graph index
     */
    addEdge(edge: GraphEdge): void {
        // Forward adjacency
        if (!this.adjacencyList.has(edge.fromId)) {
            this.adjacencyList.set(edge.fromId, new Map());
        }
        const fromEdges = this.adjacencyList.get(edge.fromId)!;
        if (!fromEdges.has(edge.toId)) {
            fromEdges.set(edge.toId, []);
        }
        fromEdges.get(edge.toId)!.push(edge);
        
        // Reverse adjacency
        if (!this.reverseAdjacencyList.has(edge.toId)) {
            this.reverseAdjacencyList.set(edge.toId, new Map());
        }
        const toEdges = this.reverseAdjacencyList.get(edge.toId)!;
        if (!toEdges.has(edge.fromId)) {
            toEdges.set(edge.fromId, []);
        }
        toEdges.get(edge.fromId)!.push(edge);
    }

    /**
     * Get node by ID
     */
    getNode(nodeId: number): GraphNode | undefined {
        return this.nodes.get(nodeId);
    }

    /**
     * Get node by name
     */
    getNodeByName(name: string): GraphNode | undefined {
        const nodeId = this.nodeNameIndex.get(name.toLowerCase());
        return nodeId !== undefined ? this.nodes.get(nodeId) : undefined;
    }

    /**
     * Get neighborhood of a node up to specified depth
     */
    getNeighborhood(
        nodeId: number, 
        maxDepth: number = 2,
        maxNodes: number = 100
    ): NeighborhoodResult {
        const cacheKey = `${nodeId}-${maxDepth}-${maxNodes}`;
        const cached = this.neighborhoodCache.get(cacheKey);
        if (cached) return cached;
        
        const visitedNodes = new Set<number>();
        const visitedEdges = new Set<string>();
        const resultNodes: GraphNode[] = [];
        const resultEdges: GraphEdge[] = [];
        
        // BFS traversal with depth limit
        const queue: Array<{id: number, depth: number}> = [{id: nodeId, depth: 0}];
        visitedNodes.add(nodeId);
        
        while (queue.length > 0 && resultNodes.length < maxNodes) {
            const {id: currentId, depth} = queue.shift()!;
            
            const node = this.nodes.get(currentId);
            if (node) {
                resultNodes.push(node);
            }
            
            if (depth < maxDepth) {
                // Get outgoing edges
                const outgoing = this.adjacencyList.get(currentId);
                if (outgoing) {
                    for (const [neighborId, edges] of outgoing) {
                        if (!visitedNodes.has(neighborId)) {
                            visitedNodes.add(neighborId);
                            queue.push({id: neighborId, depth: depth + 1});
                        }
                        
                        for (const edge of edges) {
                            const edgeKey = `${edge.fromId}-${edge.toId}-${edge.relationshipType}`;
                            if (!visitedEdges.has(edgeKey)) {
                                visitedEdges.add(edgeKey);
                                resultEdges.push(edge);
                            }
                        }
                    }
                }
                
                // Get incoming edges for bidirectional traversal
                const incoming = this.reverseAdjacencyList.get(currentId);
                if (incoming) {
                    for (const [neighborId, edges] of incoming) {
                        if (!visitedNodes.has(neighborId)) {
                            visitedNodes.add(neighborId);
                            queue.push({id: neighborId, depth: depth + 1});
                        }
                        
                        for (const edge of edges) {
                            const edgeKey = `${edge.fromId}-${edge.toId}-${edge.relationshipType}`;
                            if (!visitedEdges.has(edgeKey)) {
                                visitedEdges.add(edgeKey);
                                resultEdges.push(edge);
                            }
                        }
                    }
                }
            }
        }
        
        const result = { nodes: resultNodes, edges: resultEdges, depth: maxDepth };
        this.neighborhoodCache.set(cacheKey, result);
        return result;
    }

    /**
     * Find shortest path between two nodes using Dijkstra's algorithm
     */
    findShortestPath(fromId: number, toId: number, maxDepth: number = 5): PathResult | null {
        const cacheKey = `path-${fromId}-${toId}`;
        const cached = this.pathCache.get(cacheKey);
        if (cached) return cached;
        
        if (!this.nodes.has(fromId) || !this.nodes.has(toId)) {
            return null;
        }
        
        const distances = new Map<number, number>();
        const previous = new Map<number, number>();
        const unvisited = new Set<number>(this.nodes.keys());
        
        distances.set(fromId, 0);
        
        while (unvisited.size > 0) {
            // Find unvisited node with minimum distance
            let currentId: number | null = null;
            let minDistance = Infinity;
            
            for (const nodeId of unvisited) {
                const distance = distances.get(nodeId) ?? Infinity;
                if (distance < minDistance) {
                    minDistance = distance;
                    currentId = nodeId;
                }
            }
            
            if (currentId === null || minDistance === Infinity || minDistance > maxDepth) {
                break; // No path exists or exceeded max depth
            }
            
            unvisited.delete(currentId);
            
            if (currentId === toId) {
                // Reconstruct path
                const path: number[] = [];
                let current: number | undefined = toId;
                
                while (current !== undefined) {
                    path.unshift(current);
                    current = previous.get(current);
                }
                
                const result: PathResult = {
                    path,
                    distance: minDistance,
                    confidence: 1.0 / (1.0 + minDistance) // Simple confidence based on distance
                };
                
                this.pathCache.set(cacheKey, result);
                return result;
            }
            
            // Update distances to neighbors
            const neighbors = this.adjacencyList.get(currentId);
            if (neighbors) {
                for (const [neighborId, edges] of neighbors) {
                    if (unvisited.has(neighborId)) {
                        // Use minimum weight edge
                        const minWeight = Math.min(...edges.map(e => 1.0 / e.weight));
                        const altDistance = minDistance + minWeight;
                        
                        if (altDistance < (distances.get(neighborId) ?? Infinity)) {
                            distances.set(neighborId, altDistance);
                            previous.set(neighborId, currentId);
                        }
                    }
                }
            }
        }
        
        return null; // No path found
    }

    /**
     * Add community information to the index
     */
    addCommunity(community: Community): void {
        this.communities.set(community.id, community);
        
        // Update level index
        if (!this.communityLevels.has(community.level)) {
            this.communityLevels.set(community.level, new Set());
        }
        this.communityLevels.get(community.level)!.add(community.id);
        
        // Update node-to-community mapping
        for (const nodeId of community.memberIds) {
            this.nodeToCommunity.set(nodeId, community.id);
            
            // Update node's community ID
            const node = this.nodes.get(nodeId);
            if (node) {
                node.communityId = community.id;
            }
        }
    }

    /**
     * Get all communities at a specific level
     */
    getCommunitiesAtLevel(level: number): Community[] {
        const communityIds = this.communityLevels.get(level);
        if (!communityIds) return [];
        
        const communities: Community[] = [];
        for (const id of communityIds) {
            const community = this.communities.get(id);
            if (community) {
                communities.push(community);
            }
        }
        return communities;
    }

    /**
     * Get community for a node
     */
    getNodeCommunity(nodeId: number): Community | undefined {
        const communityId = this.nodeToCommunity.get(nodeId);
        return communityId !== undefined ? this.communities.get(communityId) : undefined;
    }

    /**
     * Calculate and store degree-based metrics
     */
    calculateDegreeMetrics(): void {
        const degrees: number[] = [];
        
        for (const [nodeId, neighbors] of this.adjacencyList) {
            const outDegree = neighbors.size;
            const inDegree = this.reverseAdjacencyList.get(nodeId)?.size ?? 0;
            const totalDegree = outDegree + inDegree;
            
            degrees.push(totalDegree);
            
            // Update node with degree count
            const node = this.nodes.get(nodeId);
            if (node) {
                node.degreeCount = totalDegree;
            }
        }
        
        // Calculate average degree
        this.averageDegree = degrees.reduce((a, b) => a + b, 0) / degrees.length;
        
        // Identify high-degree nodes (hubs) - top 5%
        const sortedDegrees = degrees.sort((a, b) => b - a);
        const threshold = sortedDegrees[Math.floor(degrees.length * 0.05)];
        
        this.highDegreeNodes.clear();
        for (const [nodeId, neighbors] of this.adjacencyList) {
            const degree = neighbors.size + (this.reverseAdjacencyList.get(nodeId)?.size ?? 0);
            if (degree >= threshold) {
                this.highDegreeNodes.add(nodeId);
            }
        }
    }

    /**
     * Get hub nodes (high-degree nodes)
     */
    getHubNodes(limit: number = 50): GraphNode[] {
        const hubs: GraphNode[] = [];
        for (const nodeId of this.highDegreeNodes) {
            const node = this.nodes.get(nodeId);
            if (node) {
                hubs.push(node);
                if (hubs.length >= limit) break;
            }
        }
        return hubs;
    }

    /**
     * Set node metrics (centrality scores, etc.)
     */
    setNodeMetrics(nodeId: number, metrics: GraphMetrics): void {
        this.nodeMetrics.set(nodeId, metrics);
        
        // Update node's centrality score if pagerank is available
        if (metrics.pagerank !== undefined) {
            const node = this.nodes.get(nodeId);
            if (node) {
                node.centralityScore = metrics.pagerank;
            }
        }
    }

    /**
     * Get nodes by centrality score
     */
    getTopNodesByCentrality(limit: number = 100): GraphNode[] {
        const nodesWithCentrality = Array.from(this.nodes.values())
            .filter(node => node.centralityScore !== undefined)
            .sort((a, b) => (b.centralityScore ?? 0) - (a.centralityScore ?? 0));
        
        return nodesWithCentrality.slice(0, limit);
    }

    /**
     * Clear all caches
     */
    clearCaches(): void {
        this.pathCache.clear();
        this.neighborhoodCache.clear();
    }

    /**
     * Get graph statistics
     */
    getStatistics(): {
        nodeCount: number;
        edgeCount: number;
        communityCount: number;
        averageDegree: number;
        hubCount: number;
    } {
        let edgeCount = 0;
        for (const neighbors of this.adjacencyList.values()) {
            for (const edges of neighbors.values()) {
                edgeCount += edges.length;
            }
        }
        
        return {
            nodeCount: this.nodes.size,
            edgeCount,
            communityCount: this.communities.size,
            averageDegree: this.averageDegree,
            hubCount: this.highDegreeNodes.size
        };
    }

    /**
     * Get inter-community edges for visualization
     */
    getInterCommunityEdges(): GraphEdge[] {
        const interCommunityEdges: GraphEdge[] = [];
        
        for (const [fromId, neighbors] of this.adjacencyList) {
            const fromCommunity = this.nodeToCommunity.get(fromId);
            if (fromCommunity === undefined) continue;
            
            for (const [toId, edges] of neighbors) {
                const toCommunity = this.nodeToCommunity.get(toId);
                if (toCommunity !== undefined && fromCommunity !== toCommunity) {
                    // This is an inter-community edge
                    interCommunityEdges.push(...edges);
                }
            }
        }
        
        return interCommunityEdges;
    }

    /**
     * Export graph data for visualization
     */
    exportForVisualization(options: {
        includeNodes?: number[];
        includeCommunities?: number[];
        maxNodes?: number;
        aggregateEdges?: boolean;
    } = {}): {
        nodes: any[];
        edges: any[];
    } {
        const exportNodes: any[] = [];
        const exportEdges: any[] = [];
        const includedNodeIds = new Set<number>();
        
        // Determine which nodes to include
        if (options.includeNodes) {
            for (const nodeId of options.includeNodes) {
                includedNodeIds.add(nodeId);
            }
        } else if (options.includeCommunities) {
            for (const communityId of options.includeCommunities) {
                const community = this.communities.get(communityId);
                if (community) {
                    for (const nodeId of community.memberIds) {
                        includedNodeIds.add(nodeId);
                    }
                }
            }
        } else {
            // Include top nodes by centrality
            const topNodes = this.getTopNodesByCentrality(options.maxNodes ?? 1000);
            for (const node of topNodes) {
                includedNodeIds.add(node.id);
            }
        }
        
        // Export nodes in Cytoscape format
        for (const nodeId of includedNodeIds) {
            const node = this.nodes.get(nodeId);
            if (node) {
                const community = this.getNodeCommunity(nodeId);
                exportNodes.push({
                    data: {
                        id: `node-${nodeId}`,
                        label: node.name,
                        type: node.type,
                        communityId: community?.id,
                        communityName: community?.name,
                        size: Math.log(1 + (node.degreeCount ?? 1)) * 10,
                        centralityScore: node.centralityScore ?? 0
                    }
                });
            }
        }
        
        // Export edges
        const edgeMap = new Map<string, {count: number, weight: number, confidence: number}>();
        
        for (const fromId of includedNodeIds) {
            const neighbors = this.adjacencyList.get(fromId);
            if (!neighbors) continue;
            
            for (const [toId, edges] of neighbors) {
                if (includedNodeIds.has(toId)) {
                    if (options.aggregateEdges) {
                        // Aggregate multiple edges between same nodes
                        const key = `${fromId}-${toId}`;
                        const existing = edgeMap.get(key) ?? {count: 0, weight: 0, confidence: 0};
                        existing.count += edges.length;
                        existing.weight += edges.reduce((sum, e) => sum + e.weight, 0);
                        existing.confidence = Math.max(existing.confidence, ...edges.map(e => e.confidence));
                        edgeMap.set(key, existing);
                    } else {
                        // Include all edges
                        for (const edge of edges) {
                            exportEdges.push({
                                data: {
                                    id: `edge-${fromId}-${toId}-${edge.relationshipType}`,
                                    source: `node-${fromId}`,
                                    target: `node-${toId}`,
                                    relationshipType: edge.relationshipType,
                                    weight: edge.weight,
                                    confidence: edge.confidence
                                }
                            });
                        }
                    }
                }
            }
        }
        
        // Add aggregated edges if needed
        if (options.aggregateEdges) {
            for (const [key, data] of edgeMap) {
                const [fromId, toId] = key.split('-').map(Number);
                exportEdges.push({
                    data: {
                        id: `edge-${key}`,
                        source: `node-${fromId}`,
                        target: `node-${toId}`,
                        weight: data.weight / data.count,
                        confidence: data.confidence,
                        edgeCount: data.count
                    }
                });
            }
        }
        
        return { nodes: exportNodes, edges: exportEdges };
    }
}