// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { GraphIndex, Community } from "./graphIndex.mjs";

export interface CommunityDetectionOptions {
    algorithm: 'louvain' | 'leiden' | 'label-propagation';
    resolution?: number;  // For modularity-based algorithms
    maxIterations?: number;
    minCommunitySize?: number;
    hierarchical?: boolean;
}

export interface CommunityDetectionResult {
    communities: Community[];
    modularity: number;
    hierarchyLevels?: number;
}

/**
 * Community detection algorithms for graph clustering
 */
export class CommunityDetector {
    private graphIndex: GraphIndex;
    
    constructor(graphIndex: GraphIndex) {
        this.graphIndex = graphIndex;
    }
    
    /**
     * Detect communities using specified algorithm
     */
    async detectCommunities(options: CommunityDetectionOptions): Promise<CommunityDetectionResult> {
        switch (options.algorithm) {
            case 'louvain':
                return this.louvainAlgorithm(options);
            case 'leiden':
                return this.leidenAlgorithm(options);
            case 'label-propagation':
                return this.labelPropagationAlgorithm(options);
            default:
                throw new Error(`Unknown algorithm: ${options.algorithm}`);
        }
    }
    
    /**
     * Louvain algorithm for community detection
     */
    private async louvainAlgorithm(options: CommunityDetectionOptions): Promise<CommunityDetectionResult> {
        const resolution = options.resolution ?? 1.0;
        const maxIterations = options.maxIterations ?? 100;
        const minCommunitySize = options.minCommunitySize ?? 1;
        
        // Initialize each node in its own community
        const nodeToCommunity = new Map<number, number>();
        const communityToNodes = new Map<number, Set<number>>();
        const stats = this.graphIndex.getStatistics();
        
        // Get all nodes from graph index
        const nodes = this.graphIndex.getTopNodesByCentrality(stats.nodeCount);
        for (const node of nodes) {
            nodeToCommunity.set(node.id, node.id);
            communityToNodes.set(node.id, new Set([node.id]));
        }
        
        let improved = true;
        let iteration = 0;
        let currentModularity = this.calculateModularity(nodeToCommunity);
        
        while (improved && iteration < maxIterations) {
            improved = false;
            iteration++;
            
            // First phase: local optimization
            for (const node of nodes) {
                const currentCommunity = nodeToCommunity.get(node.id)!;
                const bestCommunity = this.findBestCommunity(
                    node.id,
                    nodeToCommunity,
                    communityToNodes,
                    resolution
                );
                
                if (bestCommunity !== currentCommunity) {
                    // Move node to better community
                    communityToNodes.get(currentCommunity)?.delete(node.id);
                    if (communityToNodes.get(currentCommunity)?.size === 0) {
                        communityToNodes.delete(currentCommunity);
                    }
                    
                    nodeToCommunity.set(node.id, bestCommunity);
                    if (!communityToNodes.has(bestCommunity)) {
                        communityToNodes.set(bestCommunity, new Set());
                    }
                    communityToNodes.get(bestCommunity)!.add(node.id);
                    improved = true;
                }
            }
            
            // Calculate new modularity
            const newModularity = this.calculateModularity(nodeToCommunity);
            if (newModularity <= currentModularity + 0.0001) {
                improved = false;
            }
            currentModularity = newModularity;
        }
        
        // Build communities from results
        const communities = this.buildCommunities(
            nodeToCommunity,
            communityToNodes,
            minCommunitySize
        );
        
        // If hierarchical, perform second level clustering
        let hierarchyLevels = 1;
        if (options.hierarchical && communities.length > 10) {
            const superCommunities = await this.clusterCommunities(communities, resolution);
            communities.push(...superCommunities);
            hierarchyLevels = 2;
        }
        
        return {
            communities,
            modularity: currentModularity,
            hierarchyLevels
        };
    }
    
    /**
     * Leiden algorithm (improved version of Louvain)
     */
    private async leidenAlgorithm(options: CommunityDetectionOptions): Promise<CommunityDetectionResult> {
        // Leiden is similar to Louvain but with refinement phase
        // For now, using Louvain as base implementation
        const result = await this.louvainAlgorithm(options);
        
        // Refinement phase: ensure well-connected communities
        const refinedCommunities = this.refineCommunities(result.communities);
        
        return {
            ...result,
            communities: refinedCommunities
        };
    }
    
    /**
     * Label propagation algorithm for community detection
     */
    private async labelPropagationAlgorithm(options: CommunityDetectionOptions): Promise<CommunityDetectionResult> {
        const maxIterations = options.maxIterations ?? 30;
        const minCommunitySize = options.minCommunitySize ?? 1;
        
        // Initialize each node with unique label
        const labels = new Map<number, number>();
        const stats = this.graphIndex.getStatistics();
        const nodes = this.graphIndex.getTopNodesByCentrality(stats.nodeCount);
        
        for (const node of nodes) {
            labels.set(node.id, node.id);
        }
        
        let changed = true;
        let iteration = 0;
        
        while (changed && iteration < maxIterations) {
            changed = false;
            iteration++;
            
            // Shuffle nodes for random order processing
            const shuffledNodes = [...nodes].sort(() => Math.random() - 0.5);
            
            for (const node of shuffledNodes) {
                // Get neighbor labels
                const neighborLabels = this.getNeighborLabels(node.id, labels);
                
                if (neighborLabels.size > 0) {
                    // Find most frequent label among neighbors
                    const bestLabel = this.getMostFrequentLabel(neighborLabels);
                    
                    if (bestLabel !== labels.get(node.id)) {
                        labels.set(node.id, bestLabel);
                        changed = true;
                    }
                }
            }
        }
        
        // Build communities from labels
        const communityToNodes = new Map<number, Set<number>>();
        for (const [nodeId, label] of labels) {
            if (!communityToNodes.has(label)) {
                communityToNodes.set(label, new Set());
            }
            communityToNodes.get(label)!.add(nodeId);
        }
        
        const communities = this.buildCommunities(labels, communityToNodes, minCommunitySize);
        const modularity = this.calculateModularity(labels);
        
        return {
            communities,
            modularity,
            hierarchyLevels: 1
        };
    }
    
    /**
     * Find best community for a node based on modularity gain
     */
    private findBestCommunity(
        nodeId: number,
        nodeToCommunity: Map<number, number>,
        communityToNodes: Map<number, Set<number>>,
        resolution: number
    ): number {
        const currentCommunity = nodeToCommunity.get(nodeId)!;
        let bestCommunity = currentCommunity;
        let bestGain = 0;
        
        // Get neighbors and their communities
        const neighborhood = this.graphIndex.getNeighborhood(nodeId, 1, 100);
        const neighborCommunities = new Set<number>();
        
        for (const node of neighborhood.nodes) {
            if (node.id !== nodeId) {
                const community = nodeToCommunity.get(node.id);
                if (community !== undefined) {
                    neighborCommunities.add(community);
                }
            }
        }
        
        // Test each neighboring community
        for (const targetCommunity of neighborCommunities) {
            if (targetCommunity === currentCommunity) continue;
            
            const gain = this.calculateModularityGain(
                nodeId,
                currentCommunity,
                targetCommunity,
                nodeToCommunity,
                resolution
            );
            
            if (gain > bestGain) {
                bestGain = gain;
                bestCommunity = targetCommunity;
            }
        }
        
        return bestCommunity;
    }
    
    /**
     * Calculate modularity gain from moving a node between communities
     */
    private calculateModularityGain(
        nodeId: number,
        fromCommunity: number,
        toCommunity: number,
        nodeToCommunity: Map<number, number>,
        resolution: number
    ): number {
        // Simplified modularity gain calculation
        const neighborhood = this.graphIndex.getNeighborhood(nodeId, 1, 50);
        
        let fromLinks = 0;
        let toLinks = 0;
        
        for (const node of neighborhood.nodes) {
            if (node.id === nodeId) continue;
            
            const community = nodeToCommunity.get(node.id);
            if (community === fromCommunity) {
                fromLinks++;
            } else if (community === toCommunity) {
                toLinks++;
            }
        }
        
        // Modularity gain is proportional to link difference
        return resolution * (toLinks - fromLinks);
    }
    
    /**
     * Calculate modularity of current partition
     */
    private calculateModularity(nodeToCommunity: Map<number, number>): number {
        const stats = this.graphIndex.getStatistics();
        if (stats.edgeCount === 0) return 0;
        
        let modularity = 0;
        const m = stats.edgeCount;
        
        // Group nodes by community
        const communities = new Map<number, Set<number>>();
        for (const [nodeId, communityId] of nodeToCommunity) {
            if (!communities.has(communityId)) {
                communities.set(communityId, new Set());
            }
            communities.get(communityId)!.add(nodeId);
        }
        
        // Calculate modularity for each community
        for (const [, nodeIds] of communities) {
            let internalEdges = 0;
            let totalDegree = 0;
            
            for (const nodeId of nodeIds) {
                const neighborhood = this.graphIndex.getNeighborhood(nodeId, 1, 100);
                
                for (const node of neighborhood.nodes) {
                    if (nodeIds.has(node.id)) {
                        internalEdges++;
                    }
                }
                
                totalDegree += neighborhood.edges.length;
            }
            
            // Modularity contribution from this community
            const eii = internalEdges / (2 * m);
            const ai = totalDegree / (2 * m);
            modularity += eii - (ai * ai);
        }
        
        return modularity;
    }
    
    /**
     * Build Community objects from detection results
     */
    private buildCommunities(
        nodeToCommunity: Map<number, number>,
        communityToNodes: Map<number, Set<number>>,
        minSize: number
    ): Community[] {
        const communities: Community[] = [];
        let communityIdCounter = 1;
        
        for (const [originalId, nodeIds] of communityToNodes) {
            if (nodeIds.size < minSize) continue;
            
            const community: Community = {
                id: communityIdCounter++,
                level: 0,
                size: nodeIds.size,
                cohesionScore: this.calculateCohesion(nodeIds),
                memberIds: new Set(nodeIds),
                name: `Community ${communityIdCounter}`,
                metadata: {
                    algorithm: 'louvain',
                    originalId
                }
            };
            
            communities.push(community);
        }
        
        return communities;
    }
    
    /**
     * Calculate cohesion score for a community
     */
    private calculateCohesion(nodeIds: Set<number>): number {
        if (nodeIds.size <= 1) return 1.0;
        
        let internalEdges = 0;
        let externalEdges = 0;
        
        for (const nodeId of nodeIds) {
            const neighborhood = this.graphIndex.getNeighborhood(nodeId, 1, 50);
            
            for (const edge of neighborhood.edges) {
                if (nodeIds.has(edge.toId)) {
                    internalEdges++;
                } else {
                    externalEdges++;
                }
            }
        }
        
        if (internalEdges + externalEdges === 0) return 0;
        
        return internalEdges / (internalEdges + externalEdges);
    }
    
    /**
     * Get labels of neighboring nodes
     */
    private getNeighborLabels(nodeId: number, labels: Map<number, number>): Map<number, number> {
        const neighborLabels = new Map<number, number>();
        const neighborhood = this.graphIndex.getNeighborhood(nodeId, 1, 50);
        
        for (const node of neighborhood.nodes) {
            if (node.id !== nodeId) {
                const label = labels.get(node.id);
                if (label !== undefined) {
                    neighborLabels.set(label, (neighborLabels.get(label) ?? 0) + 1);
                }
            }
        }
        
        return neighborLabels;
    }
    
    /**
     * Get most frequent label from neighbor labels
     */
    private getMostFrequentLabel(labelCounts: Map<number, number>): number {
        let maxCount = 0;
        let bestLabel = -1;
        
        for (const [label, count] of labelCounts) {
            if (count > maxCount || (count === maxCount && Math.random() > 0.5)) {
                maxCount = count;
                bestLabel = label;
            }
        }
        
        return bestLabel;
    }
    
    /**
     * Cluster existing communities into super-communities
     */
    private async clusterCommunities(
        communities: Community[],
        resolution: number
    ): Promise<Community[]> {
        const superCommunities: Community[] = [];
        
        // Group small communities together
        const communitySizes = communities.map(c => c.size).sort((a, b) => b - a);
        const medianSize = communitySizes[Math.floor(communitySizes.length / 2)];
        
        let superCommunityId = 1000; // Start from 1000 to distinguish from regular communities
        const assigned = new Set<number>();
        
        for (const community of communities) {
            if (assigned.has(community.id)) continue;
            
            if (community.size >= medianSize) {
                // Large community becomes its own super-community
                const superCommunity: Community = {
                    id: superCommunityId++,
                    level: 1,
                    size: community.size,
                    cohesionScore: community.cohesionScore,
                    memberIds: new Set([community.id]),
                    name: `Super-${community.name}`,
                    metadata: {
                        subCommunities: [community.id]
                    }
                };
                
                superCommunities.push(superCommunity);
                assigned.add(community.id);
                community.parentId = superCommunity.id;
            }
        }
        
        // Group remaining small communities
        const unassigned = communities.filter(c => !assigned.has(c.id));
        if (unassigned.length > 0) {
            const superCommunity: Community = {
                id: superCommunityId++,
                level: 1,
                size: unassigned.reduce((sum, c) => sum + c.size, 0),
                cohesionScore: 0.5, // Average cohesion for mixed group
                memberIds: new Set(unassigned.map(c => c.id)),
                name: `Mixed Communities`,
                metadata: {
                    subCommunities: unassigned.map(c => c.id)
                }
            };
            
            superCommunities.push(superCommunity);
            for (const community of unassigned) {
                community.parentId = superCommunity.id;
            }
        }
        
        return superCommunities;
    }
    
    /**
     * Refine communities to ensure connectivity (Leiden refinement)
     */
    private refineCommunities(communities: Community[]): Community[] {
        const refined: Community[] = [];
        
        for (const community of communities) {
            // Check if community is well-connected
            if (this.isWellConnected(community)) {
                refined.push(community);
            } else {
                // Split poorly connected community
                const subcommunities = this.splitCommunity(community);
                refined.push(...subcommunities);
            }
        }
        
        return refined;
    }
    
    /**
     * Check if a community is well-connected
     */
    private isWellConnected(community: Community): boolean {
        // Simple check: cohesion score above threshold
        return community.cohesionScore > 0.3;
    }
    
    /**
     * Split a poorly connected community
     */
    private splitCommunity(community: Community): Community[] {
        // For simplicity, just return the original community
        // In a full implementation, this would use graph connectivity analysis
        return [community];
    }
}