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

    // Hierarchical partitioned loading methods
    getGlobalImportanceLayer(maxNodes?: number): Promise<any>;
    getViewportBasedNeighborhood(
        centerEntity: string,
        viewportNodeNames: string[],
        maxNodes?: number,
    ): Promise<any>;
    getImportanceStatistics(): Promise<any>;

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

        try {
            // Use the proper service method for efficient neighborhood retrieval
            const neighborhoodData =
                await this.baseService.getEntityNeighborhood(
                    entityId,
                    depth,
                    maxNodes,
                );

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

            // Transform data to UI format

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

            const queryTime = performance.now() - startTime;

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
    // HIERARCHICAL PARTITIONED LOADING METHODS
    // ===================================================================

    async getGlobalImportanceLayer(maxNodes: number = 5000): Promise<any> {
        try {
            const result = await this.baseService.getGlobalImportanceLayer(
                maxNodes,
                true,
            );

            const transformedEntities = this.transformEntitiesToUIFormat(
                result.entities || [],
            );

            const transformedRelationships =
                this.transformRelationshipsToUIFormat(
                    result.relationships || [],
                );

            const finalResult = {
                entities: transformedEntities,
                relationships: transformedRelationships,
                metadata: {
                    ...result.metadata,
                    source: "global_importance_layer",
                },
            };

            return finalResult;
        } catch (error) {
            console.error(
                "[GraphDataProvider] Error fetching global importance layer:",
                error,
            );
            throw error;
        }
    }

    async getViewportBasedNeighborhood(
        centerEntity: string,
        viewportNodeNames: string[],
        maxNodes: number = 5000,
    ): Promise<any> {
        try {
            const result = await this.baseService.getViewportBasedNeighborhood(
                centerEntity,
                viewportNodeNames,
                maxNodes,
                {
                    importanceWeighting: true,
                    includeGlobalContext: true,
                    exploreFromAllViewportNodes: true,
                    minDepthFromViewport: 1,
                },
            );

            if (!result) {
                console.warn(
                    "[GraphDataProvider] Received null result from getViewportBasedNeighborhood service",
                );
                throw new Error("Service returned null result");
            }

            return {
                entities: this.transformEntitiesToUIFormat(
                    result.entities || [],
                ),
                relationships: this.transformRelationshipsToUIFormat(
                    result.relationships || [],
                ),
                metadata: {
                    ...result.metadata,
                    source: "viewport_based_neighborhood",
                    viewportAnchorCount: viewportNodeNames.length,
                },
            };
        } catch (error) {
            console.error(
                "[GraphDataProvider] Error fetching viewport-based neighborhood:",
                error,
            );
            throw error;
        }
    }

    async getImportanceStatistics(): Promise<any> {
        try {
            const result = await this.baseService.getImportanceStatistics();

            return result;
        } catch (error) {
            console.error(
                "[GraphDataProvider] Error fetching importance statistics:",
                error,
            );
            throw error;
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

        // Calculate UI properties based on server data (move computation client-side)
        const importance = hybridEntity.importance || 0;
        const degree = hybridEntity.degree || 0;

        // Compute size based on importance/degree (remove server size field dependency)
        const computedSize = Math.max(20, 20 + Math.sqrt(importance * 1000)); // Dynamic sizing

        // Compute colors based on type (remove server color field dependency)
        let color = "#6C7B7F"; // Default gray
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
                // OPTIMIZATION: Only include essential data, no duplication
                // Core server data (essential for graph logic)
                count: hybridEntity.count,
                degree: degree,
                importance: importance,
                communityId: hybridEntity.communityId,

                // Optional fields (only if non-empty)
                ...(hybridEntity.community && {
                    community: hybridEntity.community,
                }),
                ...(hybridEntity.description && {
                    description: hybridEntity.description,
                }),

                // Computed UI properties
                color: color,
                size: computedSize,
                borderColor: borderColor,
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

        const strength = this.normalizeStrength(
            hybridRel.confidence ||
                hybridRel.strength ||
                hybridRel.weight ||
                0.5,
        );

        return {
            id:
                hybridRel.id ||
                hybridRel.rowId ||
                this.generateRelationshipId(hybridRel),
            from: fromEntity,
            to: toEntity,
            type: relType,
            strength: strength,
            properties: {
                // OPTIMIZATION: Only essential relationship data, no duplication
                // Core server data (minimal for graph logic)
                confidence: hybridRel.confidence || 0.5,
                count: hybridRel.count,

                // Optional fields (only if present and needed)
                ...(hybridRel.sources &&
                    hybridRel.sources.length > 0 && {
                        sources: hybridRel.sources,
                    }),
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

export {
    GraphDataProvider as GraphDataProvider,
    GraphDataProviderImpl as GraphDataProviderImpl,
    GlobalGraphResult,
    EntityNeighborhoodResult,
    EntityNode,
    RelationshipEdge,
    GraphStatistics,
};
