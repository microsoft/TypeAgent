// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

const debug = registerDebug("typeagent:website:queries:entity");

export interface EntityNode {
    id: string;
    name: string;
    type: string;
    confidence: number;
    metadata: {
        domain: string;
        urls: string[];
        extractionDate: string;
    };
}

export interface Relationship {
    source: string;
    target: string;
    type: string;
    confidence: number;
    metadata: {
        sources: string[];
        count: number;
        updated: string;
    };
}

export interface Community {
    id: string;
    entities: string[];
    topics: string[];
    size: number;
    density: number;
    updated: string;
}

export interface EntityGraphJson {
    metadata: {
        nodeCount: number;
        edgeCount: number;
        communityCount: number;
        lastUpdated: string;
        version: string;
    };
    nodes: EntityNode[];
    edges: Relationship[];
    communities: Community[];
}

/**
 * Provides query interface for entity graph data stored in JSON format
 * Mirrors the functionality of SQLite table queries
 */
export class EntityGraphQueries {
    private nodeMap: Map<string, EntityNode> = new Map();
    private domainIndex: Map<string, EntityNode[]> = new Map();
    private typeIndex: Map<string, EntityNode[]> = new Map();
    private relationshipMap: Map<string, Relationship[]> = new Map();
    private communityMap: Map<string, Community> = new Map();

    constructor(private jsonData: EntityGraphJson) {
        this.buildIndexes();
    }

    /**
     * Build internal indexes for fast queries
     */
    private buildIndexes(): void {
        debug(
            `Building indexes for ${this.jsonData.metadata.nodeCount} entities`,
        );

        // Node indexes
        this.nodeMap = new Map();
        this.domainIndex = new Map();
        this.typeIndex = new Map();

        for (const node of this.jsonData.nodes) {
            this.nodeMap.set(node.id, node);

            // Domain index
            if (!this.domainIndex.has(node.metadata.domain)) {
                this.domainIndex.set(node.metadata.domain, []);
            }
            this.domainIndex.get(node.metadata.domain)!.push(node);

            // Type index
            if (!this.typeIndex.has(node.type)) {
                this.typeIndex.set(node.type, []);
            }
            this.typeIndex.get(node.type)!.push(node);
        }

        // Relationship index
        this.relationshipMap = new Map();

        // Log sample edges from disk data
        const sampleEdges = this.jsonData.edges.slice(0, 10);
        debug(
            `[ENTITY GRAPH LOADING] Sample ${sampleEdges.length} edges from disk:`,
        );
        sampleEdges.forEach((edge, i) => {
            debug(
                `  ${i + 1}. ${edge.source} -[${edge.type}]-> ${edge.target} (confidence: ${edge.confidence})`,
            );
        });

        for (const edge of this.jsonData.edges) {
            // Index by source
            if (!this.relationshipMap.has(edge.source)) {
                this.relationshipMap.set(edge.source, []);
            }
            this.relationshipMap.get(edge.source)!.push(edge);

            // Index by target
            if (!this.relationshipMap.has(edge.target)) {
                this.relationshipMap.set(edge.target, []);
            }
            this.relationshipMap.get(edge.target)!.push(edge);
        }

        // Community index
        this.communityMap = new Map();
        for (const community of this.jsonData.communities) {
            this.communityMap.set(community.id, community);
        }

        debug(
            `Indexes built: ${this.nodeMap.size} nodes, ${this.relationshipMap.size} relationship entries, ${this.communityMap.size} communities`,
        );
    }

    /**
     * Get entities by domain (mirrors KnowledgeEntityTable.getEntitiesByDomain)
     */
    getEntitiesByDomain(domain: string): EntityNode[] {
        const entities = this.domainIndex.get(domain) || [];
        return entities.sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Get top entities by frequency (mirrors KnowledgeEntityTable.getTopEntities)
     */
    getTopEntities(
        limit: number = 20,
    ): Array<{ entityName: string; count: number }> {
        const entityCounts = new Map<string, number>();

        // Count entity occurrences across domains/URLs
        for (const node of this.jsonData.nodes) {
            const count = node.metadata.urls.length; // Use URL count as proxy for frequency
            entityCounts.set(
                node.name,
                (entityCounts.get(node.name) || 0) + count,
            );
        }

        return Array.from(entityCounts.entries())
            .map(([entityName, count]) => ({ entityName, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }

    /**
     * Get entities by names (mirrors KnowledgeEntityTable.getEntitiesByNames)
     */
    getEntitiesByNames(entityNames: string[]): EntityNode[] {
        const validNames = entityNames.filter(
            (name) => name && name.trim() !== "",
        );
        const entities: EntityNode[] = [];

        for (const name of validNames) {
            const entity = this.nodeMap.get(name);
            if (entity) {
                entities.push(entity);
            }
        }

        return entities.sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Get entity counts with aggregated metrics (mirrors KnowledgeEntityTable.getEntityCounts)
     */
    getEntityCounts(entityNames: string[]): Array<{
        entityName: string;
        count: number;
        avgConfidence: number;
    }> {
        const validNames = entityNames.filter(
            (name) => name && name.trim() !== "",
        );
        const results: Array<{
            entityName: string;
            count: number;
            avgConfidence: number;
        }> = [];

        for (const name of validNames) {
            const entity = this.nodeMap.get(name);
            if (entity) {
                results.push({
                    entityName: entity.name,
                    count: entity.metadata.urls.length,
                    avgConfidence: entity.confidence,
                });
            }
        }

        return results.sort((a, b) => b.count - a.count);
    }

    /**
     * Get entities by type (mirrors KnowledgeEntityTable.getEntitiesByType)
     */
    getEntitiesByType(entityType: string): EntityNode[] {
        const entities = this.typeIndex.get(entityType) || [];
        return entities.sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Get total entity count (mirrors KnowledgeEntityTable.getTotalEntityCount)
     */
    getTotalEntityCount(): number {
        return this.jsonData.metadata.nodeCount;
    }

    /**
     * Get unique entity count (mirrors KnowledgeEntityTable.getUniqueEntityCount)
     */
    getUniqueEntityCount(): number {
        return new Set(this.jsonData.nodes.map((node) => node.name)).size;
    }

    /**
     * Get neighbors for an entity (mirrors RelationshipTable.getNeighbors)
     */
    getNeighbors(
        entityName: string,
        minConfidence: number = 0.3,
    ): Relationship[] {
        if (!entityName || entityName.trim() === "") return [];

        const relationships = this.relationshipMap.get(entityName) || [];
        return relationships
            .filter((rel) => rel.confidence >= minConfidence)
            .sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Get relationships for multiple entities (mirrors RelationshipTable.getRelationshipsForEntities)
     */
    getRelationshipsForEntities(entities: string[]): Relationship[] {
        const validEntities = entities.filter(
            (entity) => entity && entity.trim() !== "",
        );
        if (validEntities.length === 0) return [];

        const relationships = new Set<Relationship>();

        for (const entity of validEntities) {
            const entityRels = this.relationshipMap.get(entity) || [];
            entityRels.forEach((rel) => relationships.add(rel));
        }

        return Array.from(relationships).sort(
            (a, b) => b.confidence - a.confidence,
        );
    }

    /**
     * Get relationships between specific entities (mirrors RelationshipTable.getRelationshipsBetweenEntities)
     */
    getRelationshipsBetweenEntities(
        entities: string[],
        minConfidence: number = 0.3,
    ): Relationship[] {
        const validEntities = entities.filter(
            (entity) => entity && entity.trim() !== "",
        );
        if (validEntities.length === 0) return [];

        const entitySet = new Set(validEntities);
        const relationships: Relationship[] = [];

        for (const edge of this.jsonData.edges) {
            if (
                edge.confidence >= minConfidence &&
                entitySet.has(edge.source) &&
                entitySet.has(edge.target)
            ) {
                relationships.push(edge);
            }
        }

        return relationships.sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Get neighbors for multiple entities (mirrors RelationshipTable.getNeighborsForEntities)
     */
    getNeighborsForEntities(
        entityNames: string[],
        minConfidence: number = 0.3,
    ): Relationship[] {
        const validNames = entityNames.filter(
            (entity) => entity && entity.trim() !== "",
        );
        if (validNames.length === 0) return [];

        const relationships = new Set<Relationship>();

        for (const entity of validNames) {
            const neighbors = this.getNeighbors(entity, minConfidence);
            neighbors.forEach((rel) => relationships.add(rel));
        }

        return Array.from(relationships).sort(
            (a, b) => b.confidence - a.confidence,
        );
    }

    /**
     * Get all relationships (mirrors RelationshipTable.getAllRelationships)
     */
    getAllRelationships(): Relationship[] {
        return [...this.jsonData.edges].sort(
            (a, b) => b.confidence - a.confidence,
        );
    }

    /**
     * Get communities for entities (mirrors CommunityTable.getForEntities)
     */
    getCommunitiesForEntities(entityNames: string[]): Community[] {
        if (entityNames.length === 0) return [];

        const communities: Community[] = [];

        for (const community of this.jsonData.communities) {
            const hasAnyEntity = entityNames.some((name) =>
                community.entities.includes(name),
            );
            if (hasAnyEntity) {
                communities.push(community);
            }
        }

        return communities.sort((a, b) => b.size - a.size);
    }

    /**
     * Get all communities (mirrors CommunityTable.getAllCommunities)
     */
    getAllCommunities(): Community[] {
        return [...this.jsonData.communities].sort((a, b) => b.size - a.size);
    }

    /**
     * Find entity by exact name
     */
    getEntityByName(name: string): EntityNode | undefined {
        return this.nodeMap.get(name);
    }

    /**
     * Search entities by partial name match
     */
    searchEntitiesByName(searchTerm: string, limit: number = 10): EntityNode[] {
        const term = searchTerm.toLowerCase();
        const matches: EntityNode[] = [];

        for (const node of this.jsonData.nodes) {
            if (node.name.toLowerCase().includes(term)) {
                matches.push(node);
            }
        }

        return matches
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, limit);
    }

    /**
     * Get all entities (for compatibility with graphActions)
     */
    getAllEntities(): EntityNode[] {
        return [...this.jsonData.nodes].sort(
            (a, b) => b.confidence - a.confidence,
        );
    }

    /**
     * Get entity statistics
     */
    getEntityStatistics(): {
        totalEntities: number;
        uniqueEntities: number;
        totalRelationships: number;
        totalCommunities: number;
        topDomains: Array<{ domain: string; count: number }>;
        topTypes: Array<{ type: string; count: number }>;
    } {
        // Domain statistics
        const domainCounts = new Map<string, number>();
        for (const node of this.jsonData.nodes) {
            domainCounts.set(
                node.metadata.domain,
                (domainCounts.get(node.metadata.domain) || 0) + 1,
            );
        }

        // Type statistics
        const typeCounts = new Map<string, number>();
        for (const node of this.jsonData.nodes) {
            typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1);
        }

        return {
            totalEntities: this.getTotalEntityCount(),
            uniqueEntities: this.getUniqueEntityCount(),
            totalRelationships: this.jsonData.metadata.edgeCount,
            totalCommunities: this.jsonData.metadata.communityCount,
            topDomains: Array.from(domainCounts.entries())
                .map(([domain, count]) => ({ domain, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10),
            topTypes: Array.from(typeCounts.entries())
                .map(([type, count]) => ({ type, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10),
        };
    }
}
