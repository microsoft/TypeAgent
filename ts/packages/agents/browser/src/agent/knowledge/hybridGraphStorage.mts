// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { GraphIndex, GraphNode, GraphEdge, Community } from "./graphIndex.mjs";
import { CommunityDetector, CommunityDetectionOptions } from "./communityDetection.mjs";
import * as website from "website-memory";

export interface GraphBuildOptions {
    urlLimit?: number;
    enableCommunityDetection?: boolean;
    communityAlgorithm?: 'louvain' | 'leiden' | 'label-propagation';
    calculateMetrics?: boolean;
}

export interface GraphQueryOptions {
    maxDepth?: number;
    maxNodes?: number;
    includeMetrics?: boolean;
    aggregateEdges?: boolean;
}

/**
 * Hybrid graph storage combining SQLite persistence with in-memory index
 */
export class HybridGraphStorage {
    private graphIndex: GraphIndex;
    private communityDetector: CommunityDetector;
    private websiteCollection: website.WebsiteCollection;
    private isBuilt: boolean = false;
    private buildInProgress: boolean = false;

    constructor(websiteCollection: website.WebsiteCollection) {
        this.websiteCollection = websiteCollection;
        this.graphIndex = new GraphIndex();
        this.communityDetector = new CommunityDetector(this.graphIndex);
    }

    /**
     * Build the graph index from website collection
     */
    async buildGraph(options: GraphBuildOptions = {}): Promise<void> {
        if (this.buildInProgress) {
            console.log("Graph build already in progress");
            return;
        }

        console.log("Starting graph build with options:", options);
        this.buildInProgress = true;

        try {
            // Clear existing index
            this.graphIndex = new GraphIndex();
            this.communityDetector = new CommunityDetector(this.graphIndex);

            // Load data from website collection
            await this.loadNodesAndEdges(options.urlLimit);

            // Calculate degree-based metrics
            this.graphIndex.calculateDegreeMetrics();

            // Detect communities if enabled
            if (options.enableCommunityDetection !== false) {
                await this.detectAndStoreCommunities({
                    algorithm: options.communityAlgorithm ?? 'louvain',
                    resolution: 1.0,
                    hierarchical: true,
                    minCommunitySize: 3
                });
            }

            // Calculate advanced metrics if requested
            if (options.calculateMetrics) {
                await this.calculateGraphMetrics();
            }

            this.isBuilt = true;
            console.log("Graph build completed:", this.graphIndex.getStatistics());

        } catch (error) {
            console.error("Graph build failed:", error);
            throw error;
        } finally {
            this.buildInProgress = false;
        }
    }

    /**
     * Load nodes and edges from website collection
     */
    private async loadNodesAndEdges(urlLimit?: number): Promise<void> {
        const websites = this.websiteCollection.messages.getAll();
        const processedWebsites = urlLimit ? websites.slice(0, urlLimit) : websites;
        
        console.log(`Loading graph from ${processedWebsites.length} websites`);

        const entityMap = new Map<string, number>();
        let nodeIdCounter = 1;

        // First pass: collect all entities
        for (const site of processedWebsites) {
            const knowledge = site.getKnowledge();
            if (!knowledge?.entities) continue;

            for (const entity of knowledge.entities) {
                if (!entityMap.has(entity.name)) {
                    const nodeId = nodeIdCounter++;
                    entityMap.set(entity.name, nodeId);

                    const node: GraphNode = {
                        id: nodeId,
                        name: entity.name,
                        type: Array.isArray(entity.type) ? entity.type.join(", ") : entity.type,
                        metadata: {
                            sources: [(site.metadata as any)?.url || "unknown"],
                            firstSeen: (site.metadata as any)?.visitDate || new Date().toISOString()
                        }
                    };

                    this.graphIndex.addNode(node);
                }
            }
        }

        console.log(`Created ${entityMap.size} unique entities`);

        // Second pass: create relationships
        let edgeCount = 0;
        for (const site of processedWebsites) {
            const knowledge = site.getKnowledge();
            if (!knowledge) continue;

            // Add relationships from knowledge
            if (knowledge.actions) {
                for (const action of knowledge.actions) {
                    if (!action.subjectEntityName || !action.objectEntityName ||
                        action.subjectEntityName === "none" || action.objectEntityName === "none") {
                        continue;
                    }

                    const fromId = entityMap.get(action.subjectEntityName);
                    const toId = entityMap.get(action.objectEntityName);

                    if (fromId && toId && fromId !== toId) {
                        const edge: GraphEdge = {
                            fromId,
                            toId,
                            relationshipType: Array.isArray(action.verbs) ? action.verbs.join(" ") : "related",
                            weight: 1.0,
                            confidence: (action as any).confidence ?? 0.8
                        };

                        this.graphIndex.addEdge(edge);
                        edgeCount++;
                    }
                }
            }

            // Add co-occurrence relationships (entities mentioned on same page)
            if (knowledge.entities && knowledge.entities.length > 1) {
                const pageEntities = knowledge.entities
                    .map(e => entityMap.get(e.name))
                    .filter((id): id is number => id !== undefined);

                for (let i = 0; i < pageEntities.length; i++) {
                    for (let j = i + 1; j < pageEntities.length; j++) {
                        const edge: GraphEdge = {
                            fromId: pageEntities[i],
                            toId: pageEntities[j],
                            relationshipType: "co-occurs",
                            weight: 0.5, // Lower weight for co-occurrence
                            confidence: 0.6
                        };

                        this.graphIndex.addEdge(edge);
                        edgeCount++;
                    }
                }
            }
        }

        console.log(`Created ${edgeCount} relationships`);
    }

    /**
     * Detect communities and store in graph index
     */
    private async detectAndStoreCommunities(options: CommunityDetectionOptions): Promise<void> {
        console.log("Detecting communities with algorithm:", options.algorithm);

        try {
            const result = await this.communityDetector.detectCommunities(options);
            
            console.log(`Detected ${result.communities.length} communities with modularity ${result.modularity.toFixed(3)}`);

            // Add communities to graph index
            for (const community of result.communities) {
                this.graphIndex.addCommunity(community);
            }

        } catch (error) {
            console.error("Community detection failed:", error);
            // Continue without communities rather than failing
        }
    }

    /**
     * Calculate advanced graph metrics
     */
    private async calculateGraphMetrics(): Promise<void> {
        console.log("Calculating graph metrics...");

        const stats = this.graphIndex.getStatistics();
        if (stats.nodeCount === 0) return;

        // For now, just use degree-based centrality as a proxy
        // In a full implementation, this would calculate betweenness, closeness, etc.
        const hubNodes = this.graphIndex.getHubNodes(Math.min(100, stats.nodeCount));
        
        for (const node of hubNodes) {
            const metrics = {
                pagerank: (node.degreeCount ?? 1) / stats.averageDegree,
                betweennessCentrality: 0.5, // Placeholder
                closenessCentrality: 0.5,   // Placeholder
                eigenvectorCentrality: 0.5, // Placeholder
                clusteringCoefficient: 0.3  // Placeholder
            };

            this.graphIndex.setNodeMetrics(node.id, metrics);
        }

        console.log("Graph metrics calculation completed");
    }

    /**
     * Get entity graph for visualization
     */
    async getEntityGraph(
        centerEntity?: string,
        options: GraphQueryOptions = {}
    ): Promise<{
        centerEntity?: string;
        nodes: any[];
        edges: any[];
        communities?: any[];
        metadata: any;
    }> {
        if (!this.isBuilt) {
            await this.buildGraph();
        }

        const maxDepth = options.maxDepth ?? 2;
        const maxNodes = options.maxNodes ?? 1000;

        let exportOptions: any = {
            maxNodes,
            aggregateEdges: options.aggregateEdges ?? true
        };

        if (centerEntity) {
            // Entity-specific view
            const centerNode = this.graphIndex.getNodeByName(centerEntity);
            if (!centerNode) {
                return {
                    centerEntity,
                    nodes: [],
                    edges: [],
                    metadata: {
                        error: `Entity '${centerEntity}' not found`,
                        searchDepth: maxDepth,
                        generatedAt: new Date().toISOString()
                    }
                };
            }

            // Get neighborhood
            const neighborhood = this.graphIndex.getNeighborhood(centerNode.id, maxDepth, maxNodes);
            const nodeIds = neighborhood.nodes.map(n => n.id);
            
            exportOptions.includeNodes = nodeIds;

        } else {
            // Global view - show communities and top nodes
            const communities = this.graphIndex.getCommunitiesAtLevel(0);
            if (communities.length > 0) {
                // Include top communities
                const topCommunities = communities
                    .sort((a, b) => b.size - a.size)
                    .slice(0, Math.min(10, communities.length));
                
                exportOptions.includeCommunities = topCommunities.map(c => c.id);
            } else {
                // Fallback to top centrality nodes
                const topNodes = this.graphIndex.getTopNodesByCentrality(maxNodes);
                exportOptions.includeNodes = topNodes.map(n => n.id);
            }
        }

        const graphData = this.graphIndex.exportForVisualization(exportOptions);

        // Add community information for global view
        let communities: any[] = [];
        if (!centerEntity) {
            const allCommunities = this.graphIndex.getCommunitiesAtLevel(0);
            communities = allCommunities.map(c => ({
                id: `community-${c.id}`,
                name: c.name || `Community ${c.id}`,
                size: c.size,
                cohesion: c.cohesionScore,
                level: c.level
            }));
        }

        const result: {
            centerEntity?: string;
            nodes: any[];
            edges: any[];
            communities?: any[];
            metadata: any;
        } = {
            nodes: graphData.nodes,
            edges: graphData.edges,
            metadata: {
                searchDepth: maxDepth,
                maxNodes,
                generatedAt: new Date().toISOString(),
                source: "hybrid_graph",
                stats: this.graphIndex.getStatistics()
            }
        };

        if (centerEntity) {
            result.centerEntity = centerEntity;
        }
        
        if (communities.length > 0) {
            result.communities = communities;
        }
        
        return result;
    }

    /**
     * Search for entities in the graph
     */
    async searchEntities(
        query: string,
        options: {
            limit?: number;
            includeNeighborhood?: boolean;
            fuzzyMatch?: boolean;
        } = {}
    ): Promise<{
        entities: any[];
        suggestions?: string[];
    }> {
        if (!this.isBuilt) {
            await this.buildGraph();
        }

        const limit = options.limit ?? 20;
        const results: any[] = [];
        const queryLower = query.toLowerCase();

        // Get all top nodes and search through them
        const stats = this.graphIndex.getStatistics();
        const allNodes = this.graphIndex.getTopNodesByCentrality(stats.nodeCount);

        for (const node of allNodes) {
            if (results.length >= limit) break;

            const nameLower = node.name.toLowerCase();
            let score = 0;

            // Exact match
            if (nameLower === queryLower) {
                score = 1.0;
            }
            // Starts with query
            else if (nameLower.startsWith(queryLower)) {
                score = 0.8;
            }
            // Contains query
            else if (nameLower.includes(queryLower)) {
                score = 0.6;
            }
            // Fuzzy match (simple word overlap)
            else if (options.fuzzyMatch) {
                const queryWords = queryLower.split(/\s+/);
                const nameWords = nameLower.split(/\s+/);
                const overlap = queryWords.filter(w => nameWords.some(nw => nw.includes(w))).length;
                if (overlap > 0) {
                    score = 0.3 + (overlap / queryWords.length) * 0.3;
                }
            }

            if (score > 0) {
                let entityData: any = {
                    id: node.id,
                    name: node.name,
                    type: node.type,
                    score,
                    degreeCount: node.degreeCount,
                    centralityScore: node.centralityScore
                };

                // Include neighborhood if requested
                if (options.includeNeighborhood) {
                    const neighborhood = this.graphIndex.getNeighborhood(node.id, 1, 10);
                    entityData.neighbors = neighborhood.nodes
                        .filter(n => n.id !== node.id)
                        .map(n => ({ name: n.name, type: n.type }));
                }

                results.push(entityData);
            }
        }

        // Sort by score
        results.sort((a, b) => b.score - a.score);

        // Generate suggestions for partial matches
        const suggestions: string[] = [];
        if (results.length < 5) {
            const partialMatches = allNodes
                .filter(node => {
                    const name = node.name.toLowerCase();
                    return name.includes(queryLower) && !results.some(r => r.id === node.id);
                })
                .slice(0, 5)
                .map(node => node.name);
            
            suggestions.push(...partialMatches);
        }

        return {
            entities: results,
            ...(suggestions.length > 0 && { suggestions })
        };
    }

    /**
     * Get shortest path between two entities
     */
    async getShortestPath(
        fromEntity: string,
        toEntity: string,
        maxDepth: number = 5
    ): Promise<{
        path?: string[];
        distance?: number;
        confidence?: number;
        error?: string;
    }> {
        if (!this.isBuilt) {
            await this.buildGraph();
        }

        const fromNode = this.graphIndex.getNodeByName(fromEntity);
        const toNode = this.graphIndex.getNodeByName(toEntity);

        if (!fromNode) {
            return { error: `Entity '${fromEntity}' not found` };
        }
        if (!toNode) {
            return { error: `Entity '${toEntity}' not found` };
        }

        const pathResult = this.graphIndex.findShortestPath(fromNode.id, toNode.id, maxDepth);
        if (!pathResult) {
            return { error: `No path found between '${fromEntity}' and '${toEntity}'` };
        }

        // Convert node IDs back to names
        const pathNames: string[] = [];
        for (const nodeId of pathResult.path) {
            const node = this.graphIndex.getNode(nodeId);
            if (node) {
                pathNames.push(node.name);
            }
        }

        return {
            path: pathNames,
            distance: pathResult.distance,
            confidence: pathResult.confidence
        };
    }

    /**
     * Check if graph has been built
     */
    hasGraph(): boolean {
        return this.isBuilt;
    }

    /**
     * Get graph statistics
     */
    getGraphStats(): any {
        if (!this.isBuilt) {
            return {
                isBuilt: false,
                nodeCount: 0,
                edgeCount: 0,
                communityCount: 0
            };
        }

        return {
            isBuilt: true,
            ...this.graphIndex.getStatistics()
        };
    }

    /**
     * Clear the graph index
     */
    clearGraph(): void {
        this.graphIndex = new GraphIndex();
        this.communityDetector = new CommunityDetector(this.graphIndex);
        this.isBuilt = false;
        this.buildInProgress = false;
    }

    /**
     * Get communities at specific level
     */
    getCommunitiesAtLevel(level: number = 0): Community[] {
        if (!this.isBuilt) return [];
        return this.graphIndex.getCommunitiesAtLevel(level);
    }

    /**
     * Get inter-community connections for visualization
     */
    getInterCommunityConnections(): GraphEdge[] {
        if (!this.isBuilt) return [];
        return this.graphIndex.getInterCommunityEdges();
    }
}