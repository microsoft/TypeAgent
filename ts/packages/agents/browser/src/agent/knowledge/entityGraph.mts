// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Entity Graph Data Structures for Phase 1 Implementation
 *
 * This module defines the enhanced entity graph data structures
 * that support rich visualization and relationship discovery.
 */

export type EntityType =
    | "person"
    | "organization"
    | "product"
    | "concept"
    | "location"
    | "technology"
    | "event"
    | "document";

export interface EntityRelationship {
    relatedEntity: string;
    relationshipType: string;
    confidence: number;
    evidenceSources: string[];
    firstObserved: string;
    lastObserved: string;
    strength: number; // 0.0 to 1.0 relationship strength
}

export interface EntityCoOccurrence {
    entityName: string;
    coOccurrenceCount: number;
    contexts: string[]; // Where they co-occurred
    confidence: number;
}

export interface EnhancedEntity {
    name: string;
    type: EntityType;
    confidence: number;

    // Graph properties
    aliases: string[];
    mentionCount: number;
    firstSeen: string;
    lastSeen: string;
    dominantDomains: string[];

    // Relationship properties
    strongRelationships: EntityRelationship[];
    coOccurringEntities: EntityCoOccurrence[];

    // Content properties
    contextSnippets: string[];
    topicAffinity: string[];

    // Graph visualization properties
    centrality?: number;
    clusterGroup?: string;
    importance?: number;
}

export interface EntityKnowledgeGraph {
    entities: Map<string, EnhancedEntity>;
    relationships: Map<string, EntityRelationship[]>;
    entityIndex: Map<EntityType, string[]>;
    lastUpdated: string;
    version: string;

    // Graph metrics
    totalEntities: number;
    totalRelationships: number;
    averageConnectivity: number;
    strongestConnections: EntityRelationship[];
}

export interface EntitySearchOptions {
    entityTypes?: EntityType[];
    minConfidence?: number;
    maxResults?: number;
    includeRelationships?: boolean;
    sortBy?: "confidence" | "mentionCount" | "centrality" | "lastSeen";
}

export interface EntityGraphQuery {
    centerEntity: string;
    depth: number;
    maxNodes?: number;
    relationshipTypes?: string[];
    entityTypes?: EntityType[];
    minRelationshipStrength?: number;
}

export interface EntityGraphData {
    centerEntity: string;
    entities: EnhancedEntity[];
    relationships: EntityRelationship[];
    query: EntityGraphQuery;
    metadata: {
        totalNodes: number;
        totalEdges: number;
        queryTime: number;
        maxDepthReached: number;
    };
}

export interface EntityTimelineEntry {
    timestamp: string;
    entityName: string;
    eventType:
        | "first_seen"
        | "relationship_formed"
        | "topic_association"
        | "high_activity";
    description: string;
    confidence: number;
    sourceUrls: string[];
}

export interface EntityCluster {
    clusterId: string;
    entities: string[];
    clusterTopic: string;
    coherenceScore: number;
    dominantDomain: string;
}

export interface EntityMergeCandidate {
    entity1: string;
    entity2: string;
    similarityScore: number;
    mergeReason: string;
    confidence: number;
    suggestedName: string;
}

/**
 * Entity Graph Manager - Core functionality for managing the entity knowledge graph
 */
export class EntityGraphManager {
    private graph: EntityKnowledgeGraph;
    private initialized: boolean = false;

    constructor() {
        this.graph = this.createEmptyGraph();
    }

    /**
     * Initialize the entity graph
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        this.graph = this.createEmptyGraph();
        this.initialized = true;
    }

    /**
     * Get the current entity graph
     */
    getGraph(): EntityKnowledgeGraph {
        return this.graph;
    }

    /**
     * Add or update an entity in the graph
     */
    addEntity(entity: EnhancedEntity): void {
        this.graph.entities.set(entity.name, entity);

        // Update entity index
        if (!this.graph.entityIndex.has(entity.type)) {
            this.graph.entityIndex.set(entity.type, []);
        }

        const typeEntities = this.graph.entityIndex.get(entity.type)!;
        if (!typeEntities.includes(entity.name)) {
            typeEntities.push(entity.name);
        }

        // Update relationships map
        if (entity.strongRelationships.length > 0) {
            this.graph.relationships.set(
                entity.name,
                entity.strongRelationships,
            );
        }

        this.updateGraphMetrics();
    }

    /**
     * Get an entity by name
     */
    getEntity(entityName: string): EnhancedEntity | undefined {
        return this.graph.entities.get(entityName);
    }

    /**
     * Get entities by type
     */
    getEntitiesByType(type: EntityType): EnhancedEntity[] {
        const entityNames = this.graph.entityIndex.get(type) || [];
        return entityNames
            .map((name) => this.graph.entities.get(name))
            .filter((entity): entity is EnhancedEntity => entity !== undefined);
    }

    /**
     * Search for entities with options
     */
    searchEntities(
        query: string,
        options: EntitySearchOptions = {},
    ): EnhancedEntity[] {
        const {
            entityTypes,
            minConfidence = 0,
            maxResults = 50,
            sortBy = "confidence",
        } = options;

        let results: EnhancedEntity[] = Array.from(
            this.graph.entities.values(),
        );

        // Filter by entity types
        if (entityTypes && entityTypes.length > 0) {
            results = results.filter((entity) =>
                entityTypes.includes(entity.type),
            );
        }

        // Filter by confidence
        results = results.filter(
            (entity) => entity.confidence >= minConfidence,
        );

        // Filter by query (name matching)
        if (query) {
            const queryLower = query.toLowerCase();
            results = results.filter(
                (entity) =>
                    entity.name.toLowerCase().includes(queryLower) ||
                    entity.aliases.some((alias) =>
                        alias.toLowerCase().includes(queryLower),
                    ),
            );
        }

        // Sort results
        results.sort((a, b) => {
            switch (sortBy) {
                case "confidence":
                    return b.confidence - a.confidence;
                case "mentionCount":
                    return b.mentionCount - a.mentionCount;
                case "centrality":
                    return (b.centrality || 0) - (a.centrality || 0);
                case "lastSeen":
                    return (
                        new Date(b.lastSeen).getTime() -
                        new Date(a.lastSeen).getTime()
                    );
                default:
                    return b.confidence - a.confidence;
            }
        });

        return results.slice(0, maxResults);
    }

    /**
     * Get entity graph data for visualization
     */
    getEntityGraphData(query: EntityGraphQuery): EntityGraphData {
        const startTime = Date.now();
        const entities: EnhancedEntity[] = [];
        const relationships: EntityRelationship[] = [];
        const visited = new Set<string>();
        const queue: Array<{ entity: string; depth: number }> = [
            { entity: query.centerEntity, depth: 0 },
        ];

        // Breadth-first search to build the graph
        while (queue.length > 0 && entities.length < (query.maxNodes || 100)) {
            const { entity: currentEntity, depth } = queue.shift()!;

            if (visited.has(currentEntity) || depth > query.depth) {
                continue;
            }

            visited.add(currentEntity);
            const entityData = this.getEntity(currentEntity);

            if (!entityData) continue;

            // Filter by entity type if specified
            if (query.entityTypes && query.entityTypes.length > 0) {
                if (!query.entityTypes.includes(entityData.type)) {
                    continue;
                }
            }

            entities.push(entityData);

            // Add relationships
            const entityRelationships = entityData.strongRelationships || [];
            for (const rel of entityRelationships) {
                // Filter by relationship type and strength
                if (
                    query.relationshipTypes &&
                    query.relationshipTypes.length > 0
                ) {
                    if (
                        !query.relationshipTypes.includes(rel.relationshipType)
                    ) {
                        continue;
                    }
                }

                if (
                    query.minRelationshipStrength &&
                    rel.strength < query.minRelationshipStrength
                ) {
                    continue;
                }

                relationships.push(rel);

                // Add related entity to queue for next depth level
                if (depth < query.depth) {
                    queue.push({ entity: rel.relatedEntity, depth: depth + 1 });
                }
            }
        }

        const queryTime = Date.now() - startTime;
        const maxDepthReached = Math.max(
            ...entities.map((e) => {
                // Calculate depth from center entity
                if (e.name === query.centerEntity) return 0;
                // This is a simplified depth calculation
                return 1;
            }),
        );

        return {
            centerEntity: query.centerEntity,
            entities,
            relationships,
            query,
            metadata: {
                totalNodes: entities.length,
                totalEdges: relationships.length,
                queryTime,
                maxDepthReached,
            },
        };
    }

    /**
     * Add a relationship between entities
     */
    addRelationship(
        fromEntity: string,
        toEntity: string,
        relationship: EntityRelationship,
    ): void {
        const entity = this.getEntity(fromEntity);
        if (entity) {
            entity.strongRelationships.push(relationship);
            this.graph.relationships.set(
                fromEntity,
                entity.strongRelationships,
            );
        }

        this.updateGraphMetrics();
    }

    /**
     * Get all relationships for an entity
     */
    getEntityRelationships(entityName: string): EntityRelationship[] {
        return this.graph.relationships.get(entityName) || [];
    }

    /**
     * Clear the graph
     */
    clear(): void {
        this.graph = this.createEmptyGraph();
    }

    /**
     * Get graph statistics
     */
    getStatistics() {
        return {
            totalEntities: this.graph.totalEntities,
            totalRelationships: this.graph.totalRelationships,
            averageConnectivity: this.graph.averageConnectivity,
            entitiesByType: Object.fromEntries(this.graph.entityIndex),
            lastUpdated: this.graph.lastUpdated,
        };
    }

    private createEmptyGraph(): EntityKnowledgeGraph {
        return {
            entities: new Map(),
            relationships: new Map(),
            entityIndex: new Map(),
            lastUpdated: new Date().toISOString(),
            version: "1.0",
            totalEntities: 0,
            totalRelationships: 0,
            averageConnectivity: 0,
            strongestConnections: [],
        };
    }

    private updateGraphMetrics(): void {
        this.graph.totalEntities = this.graph.entities.size;
        this.graph.totalRelationships = Array.from(
            this.graph.relationships.values(),
        ).reduce((sum, rels) => sum + rels.length, 0);

        if (this.graph.totalEntities > 0) {
            this.graph.averageConnectivity =
                this.graph.totalRelationships / this.graph.totalEntities;
        }

        // Update strongest connections
        const allRelationships: EntityRelationship[] = [];
        for (const relationships of this.graph.relationships.values()) {
            allRelationships.push(...relationships);
        }

        this.graph.strongestConnections = allRelationships
            .sort((a, b) => b.strength - a.strength)
            .slice(0, 10);

        this.graph.lastUpdated = new Date().toISOString();
    }
}
