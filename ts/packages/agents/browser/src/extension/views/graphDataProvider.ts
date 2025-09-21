// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// ===================================================================
// CORE DATA INTERFACES
// ===================================================================

interface EntityNode {
    id: string;
    name: string;
    type: string;
    confidence: number;
    properties: Record<string, any>;
}

interface RelationshipEdge {
    id: string;
    from: string;
    to: string;
    type: string;
    strength: number;
    properties: Record<string, any>;
}

interface GraphStatistics {
    totalEntities: number;
    totalRelationships: number;
    averageDegree: number;
    density: number;
    communities: number;
    lastUpdated: number;
}

// ===================================================================
// RESULT INTERFACES
// ===================================================================

interface GlobalGraphResult {
    entities: EntityNode[];
    relationships: RelationshipEdge[];
    communities: any[];
    statistics: GraphStatistics;
    metadata: {
        source: "hybrid_storage";
        timestamp: number;
    };
}

interface EntityNeighborhoodResult {
    centerEntity: EntityNode;
    neighbors: EntityNode[];
    relationships: RelationshipEdge[];
    depth: number;
    metadata: {
        source: "hybrid_storage";
        queryTime: number;
        totalNeighbors: number;
    };
}

// ===================================================================
// DATA PROVIDER INTERFACE
// ===================================================================

interface GraphDataProvider {
    // Global graph access
    getGlobalGraphData(): Promise<GlobalGraphResult>;

    // Entity neighborhood queries
    getEntityNeighborhood(
        entityId: string,
        depth: number,
        maxNodes: number,
    ): Promise<EntityNeighborhoodResult>;

    // Statistics and metadata
    getGraphStatistics(): Promise<GraphStatistics>;

    // Validation and health checks
    validateConnection(): Promise<boolean>;
}

// ===================================================================
// IMPLEMENTATION
// ===================================================================

class GraphDataProviderImpl implements GraphDataProvider {
    private baseService: any;

    constructor(baseService: any) {
        this.baseService = baseService;
    }

    async getGlobalGraphData(): Promise<GlobalGraphResult> {
        const startTime = performance.now();
        console.log(
            "[GraphDataProvider] Fetching global graph data using existing backend APIs",
        );

        try {
            // Use proper service methods instead of direct sendMessage calls
            console.time("[GraphDataProvider] Get status");
            const status = await this.baseService.getKnowledgeGraphStatus();
            console.timeEnd("[GraphDataProvider] Get status");

            const relationships = await this.baseService.getAllRelationships();
            console.log(
                `[GraphDataProvider] Fetched ${Array.isArray(relationships) ? relationships.length : 0} relationships`,
            );

            console.time("[GraphDataProvider] Get communities");
            const communities = await this.baseService.getAllCommunities();
            console.timeEnd("[GraphDataProvider] Get communities");
            console.log(
                `[GraphDataProvider] Fetched ${Array.isArray(communities) ? communities.length : 0} communities`,
            );

            console.time("[GraphDataProvider] Get entities with metrics");
            const entitiesWithMetrics =
                await this.baseService.getAllEntitiesWithMetrics();
            console.timeEnd("[GraphDataProvider] Get entities with metrics");
            console.log(
                `[GraphDataProvider] Fetched ${Array.isArray(entitiesWithMetrics) ? entitiesWithMetrics.length : 0} entities`,
            );

            if (!entitiesWithMetrics || !relationships) {
                throw new Error(
                    "Invalid global graph data received from backend APIs",
                );
            }

            // Transform data to UI format using existing backend data structure
            const entities =
                this.transformEntitiesToUIFormat(entitiesWithMetrics);
            const transformedRelationships =
                this.transformRelationshipsToUIFormat(relationships);

            // Process communities
            const processedCommunities = Array.isArray(communities)
                ? communities.map((c: any) => ({
                      ...c,
                      entities:
                          typeof c.entities === "string"
                              ? JSON.parse(c.entities || "[]")
                              : c.entities || [],
                      topics:
                          typeof c.topics === "string"
                              ? JSON.parse(c.topics || "[]")
                              : c.topics || [],
                  }))
                : [];

            // Create statistics
            const statistics: GraphStatistics = {
                totalEntities: status?.entityCount || entities.length,
                totalRelationships:
                    status?.relationshipCount ||
                    transformedRelationships.length,
                averageDegree:
                    entities.length > 0
                        ? (transformedRelationships.length * 2) /
                          entities.length
                        : 0,
                density:
                    entities.length > 1
                        ? transformedRelationships.length /
                          ((entities.length * (entities.length - 1)) / 2)
                        : 0,
                communities:
                    status?.communityCount || processedCommunities.length,
                lastUpdated: Date.now(),
            };

            const queryTime = performance.now() - startTime;
            console.log(
                `[GraphDataProvider] Global graph loaded: ${entities.length} entities, ${transformedRelationships.length} relationships (${queryTime.toFixed(1)}ms)`,
            );

            return {
                entities,
                relationships: transformedRelationships,
                communities: processedCommunities,
                statistics,
                metadata: {
                    source: "hybrid_storage",
                    timestamp: Date.now(),
                },
            };
        } catch (error) {
            console.error(
                "[GraphDataProvider] Failed to fetch global graph data:",
                error,
            );
            throw new Error(
                `Global graph data fetch failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
        }
    }

    async getEntityNeighborhood(
        entityId: string,
        depth: number,
        maxNodes: number,
    ): Promise<EntityNeighborhoodResult> {
        const startTime = performance.now();
        console.log(
            `[GraphDataProvider] Fetching neighborhood for entity "${entityId}" (depth: ${depth}, maxNodes: ${maxNodes})`,
        );

        try {
            // Use the proper service method for efficient neighborhood retrieval
            console.time("[Perf] HybridGraph - Fetch neighborhood data");
            const neighborhoodData =
                await this.baseService.getEntityNeighborhood(
                    entityId,
                    depth,
                    maxNodes,
                );
            console.timeEnd("[Perf] HybridGraph - Fetch neighborhood data");

            if (!neighborhoodData || neighborhoodData.error) {
                console.warn(
                    `[GraphDataProvider] Neighborhood fetch failed: ${neighborhoodData?.error || "Unknown error"}`,
                );

                // Return minimal result with just the center entity
                const centerEntity = this.transformEntityToUIFormat({
                    id: entityId,
                    name: entityId,
                    type: "entity",
                    confidence: 1.0,
                });

                return {
                    centerEntity,
                    neighbors: [],
                    relationships: [],
                    depth,
                    metadata: {
                        source: "in_memory_cache",
                        queryTime: performance.now() - startTime,
                        totalNeighbors: 0,
                        errorMessage: neighborhoodData?.error,
                    } as any,
                };
            }

            console.log(
                `[GraphDataProvider] Retrieved neighborhood: ${neighborhoodData.neighbors?.length || 0} neighbors, ${neighborhoodData.relationships?.length || 0} relationships`,
            );

            // Transform data to UI format
            console.time("[Perf] HybridGraph - Transform to UI format");

            // Transform center entity
            const centerEntity = neighborhoodData.centerEntity
                ? this.transformEntityToUIFormat(neighborhoodData.centerEntity)
                : this.transformEntityToUIFormat({
                      id: entityId,
                      name: entityId,
                      type: "entity",
                      confidence: 1.0,
                  });

            // Transform neighbors
            const neighbors = (neighborhoodData.neighbors || []).map(
                (neighbor: any) => this.transformEntityToUIFormat(neighbor),
            );

            // Transform relationships
            const transformedRelationships =
                this.transformRelationshipsToUIFormat(
                    neighborhoodData.relationships || [],
                );

            console.timeEnd("[Perf] HybridGraph - Transform to UI format");

            const queryTime = performance.now() - startTime;
            console.log(
                `[GraphDataProvider] Neighborhood loaded efficiently: ${neighbors.length} neighbors, ${transformedRelationships.length} relationships (${queryTime.toFixed(1)}ms)`,
            );

            return {
                centerEntity,
                neighbors,
                relationships: transformedRelationships,
                depth,
                metadata: {
                    source: "hybrid_storage",
                    queryTime,
                    totalNeighbors: neighbors.length,
                    ...(neighborhoodData.metadata || {}),
                },
            };
        } catch (error) {
            console.error(
                "[GraphDataProvider] Failed to fetch neighborhood for entity: %s",
                entityId,
                error,
            );
            throw new Error(
                `Entity neighborhood fetch failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
        }
    }

    async getGraphStatistics(): Promise<GraphStatistics> {
        console.log(
            "[GraphDataProvider] Fetching graph statistics using existing backend APIs",
        );

        try {
            // Use proper service method for graph status
            const status = await this.baseService.getKnowledgeGraphStatus();

            if (!status) {
                throw new Error(
                    "No statistics received from backend status API",
                );
            }

            // Calculate derived statistics
            const totalEntities = status.entityCount || 0;
            const totalRelationships = status.relationshipCount || 0;
            const averageDegree =
                totalEntities > 0
                    ? (totalRelationships * 2) / totalEntities
                    : 0;
            const density =
                totalEntities > 1
                    ? totalRelationships /
                      ((totalEntities * (totalEntities - 1)) / 2)
                    : 0;

            return {
                totalEntities,
                totalRelationships,
                averageDegree,
                density,
                communities: status.communityCount || 0,
                lastUpdated: Date.now(),
            };
        } catch (error) {
            console.error(
                "[GraphDataProvider] Failed to fetch graph statistics:",
                error,
            );
            throw new Error(
                `Graph statistics fetch failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
        }
    }

    async validateConnection(): Promise<boolean> {
        try {
            // Use proper service method to validate connection
            const status = await this.baseService.getKnowledgeGraphStatus();
            return !!status; // Return true if we get any response
        } catch (error) {
            console.error(
                "[GraphDataProvider] Connection validation failed:",
                error,
            );
            return false;
        }
    }

    // ===================================================================
    // DATA TRANSFORMATION METHODS
    // ===================================================================

    private transformEntitiesToUIFormat(hybridEntities: any[]): EntityNode[] {
        return hybridEntities.map((entity) =>
            this.transformEntityToUIFormat(entity),
        );
    }

    private transformEntityToUIFormat(hybridEntity: any): EntityNode {
        const entityType = hybridEntity.type || "entity";
        const confidence = this.normalizeConfidence(
            hybridEntity.confidence || hybridEntity.metrics?.pagerank || 0.5,
        );

        // Set default visual properties to prevent Cytoscape warnings
        let color = "#6C7B7F"; // Default gray
        let size = Math.max(20, 30 + confidence * 20); // Size 20-50 based on confidence
        let borderColor = "#4A5568"; // Default border

        // Type-specific styling
        switch (entityType) {
            case "concept":
            case "entity":
                color = "#4299E1"; // Blue
                borderColor = "#2B6CB0";
                break;
            case "website":
                color = "#48BB78"; // Green
                borderColor = "#2F855A";
                break;
            case "topic":
                color = "#ED8936"; // Orange
                borderColor = "#C05621";
                break;
            case "unknown":
            default:
                color = "#A0AEC0"; // Light gray
                borderColor = "#718096";
                break;
        }

        return {
            id: hybridEntity.id || hybridEntity.name || this.generateEntityId(),
            name: hybridEntity.name || hybridEntity.id || "Unknown Entity",
            type: entityType,
            confidence: confidence,
            properties: {
                // Preserve all original data
                ...hybridEntity,

                // Ensure required UI properties exist
                metrics: hybridEntity.metrics || {},
                community: hybridEntity.community,
                description: hybridEntity.description,
                domains: hybridEntity.domains || [],
                facets: hybridEntity.facets || [],
                topics: hybridEntity.topics || [],

                // Add visual properties to prevent Cytoscape warnings
                color: color,
                size: size,
                borderColor: borderColor,

                // Add transformation metadata
                _source: "hybrid_graph",
                _transformed: Date.now(),
            },
        };
    }

    private transformRelationshipsToUIFormat(
        hybridRelationships: any[],
    ): RelationshipEdge[] {
        if (!Array.isArray(hybridRelationships)) {
            return [];
        }

        const transformed = hybridRelationships
            .map((rel) => {
                try {
                    return this.transformRelationshipToUIFormat(rel);
                } catch (error) {
                    console.error(
                        `[GraphDataProvider] Error transforming relationship:`,
                        error,
                    );
                    return null;
                }
            })
            .filter((rel) => rel !== null) as RelationshipEdge[];

        return transformed;
    }

    private transformRelationshipToUIFormat(hybridRel: any): RelationshipEdge {
        // Handle the actual backend relationship field structure
        const fromEntity =
            hybridRel.fromEntity || hybridRel.from || hybridRel.source || "";
        const toEntity =
            hybridRel.toEntity || hybridRel.to || hybridRel.target || "";
        const relType =
            hybridRel.relationshipType || hybridRel.type || "connected";

        return {
            id:
                hybridRel.id ||
                hybridRel.rowId ||
                this.generateRelationshipId(hybridRel),
            from: fromEntity,
            to: toEntity,
            type: relType,
            strength: this.normalizeStrength(
                hybridRel.confidence ||
                    hybridRel.strength ||
                    hybridRel.weight ||
                    0.5,
            ),
            properties: {
                // Preserve all original data
                ...hybridRel,

                // Ensure required UI properties
                weight:
                    hybridRel.confidence ||
                    hybridRel.weight ||
                    hybridRel.strength ||
                    0.5,
                confidence: hybridRel.confidence || 0.5,

                // Add transformation metadata
                _source: "hybrid_graph",
                _transformed: Date.now(),
            },
        };
    }

    // ===================================================================
    // UTILITY METHODS
    // ===================================================================

    private generateEntityId(): string {
        return `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private generateRelationshipId(rel: any): string {
        const from = rel.from || rel.source || "unknown";
        const to = rel.to || rel.target || "unknown";
        return `rel_${from}_${to}_${Date.now()}`;
    }

    private normalizeConfidence(value: any): number {
        const num = parseFloat(value);
        if (isNaN(num)) return 0.5;
        return Math.max(0.0, Math.min(1.0, num));
    }

    private normalizeStrength(value: any): number {
        const num = parseFloat(value);
        if (isNaN(num)) return 0.5;
        return Math.max(0.0, Math.min(1.0, num));
    }

    private calculateStatistics(
        entities: EntityNode[],
        relationships: RelationshipEdge[],
    ): GraphStatistics {
        const totalEntities = entities.length;
        const totalRelationships = relationships.length;

        // Calculate average degree (edges per node)
        const averageDegree =
            totalEntities > 0 ? (totalRelationships * 2) / totalEntities : 0;

        // Calculate graph density
        const maxPossibleEdges = (totalEntities * (totalEntities - 1)) / 2;
        const density =
            maxPossibleEdges > 0 ? totalRelationships / maxPossibleEdges : 0;

        // Count communities (from entity properties)
        const communitySet = new Set();
        entities.forEach((entity) => {
            if (entity.properties.community) {
                communitySet.add(entity.properties.community);
            }
        });

        return {
            totalEntities,
            totalRelationships,
            averageDegree,
            density,
            communities: communitySet.size,
            lastUpdated: Date.now(),
        };
    }
}

// ===================================================================
// EXPORT
// ===================================================================

export {
    GraphDataProvider as GraphDataProvider,
    GraphDataProviderImpl as GraphDataProviderImpl,
    GlobalGraphResult,
    EntityNeighborhoodResult,
    EntityNode,
    RelationshipEdge,
    GraphStatistics,
};
