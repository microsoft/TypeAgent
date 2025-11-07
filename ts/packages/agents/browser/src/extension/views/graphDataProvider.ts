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

interface GraphLayoutData {
    presetLayout: {
        elements: any[];
        layoutDuration?: number;
        communityCount?: number;
        avgSpacing?: number;
        metadata?: any;
    };
    centerEntity?: string;
}

// ===================================================================
// RESULT INTERFACES
// ===================================================================

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

// Phase 1: Layout-only data contracts for optimization
interface GraphLayoutResult {
    graphologyLayout: {
        elements: any[];
        layoutDuration: number;
        avgSpacing: number;
        communityCount: number;
    };
    metadata: {
        totalEntitiesInSystem: number;
        selectedEntityCount: number;
        coveragePercentage: number;
        importanceThreshold: number;
        layer: string;
        connectedComponents?: any;
    };
}

interface TopicGraphLayoutResult {
    graphologyLayout: {
        elements: any[];
        layoutDuration: number;
        avgSpacing: number;
        communityCount: number;
    };
    metadata: {
        totalTopicsInSystem: number;
        selectedTopicCount: number;
        layer: string;
    };
}

interface EntityNeighborhoodLayoutResult {
    graphologyLayout: {
        elements: any[];
        layoutDuration: number;
        avgSpacing: number;
        communityCount: number;
    };
    metadata: {
        entityId: string;
        queryDepth: number;
        maxNodes: number;
        actualNodes: number;
        actualEdges: number;
        layer: string;
        source: string;
    };
}

// ===================================================================
// DATA PROVIDER INTERFACE
// ===================================================================

interface GraphDataProvider {
    // Phase 3: Layout-only data contracts
    getGlobalGraphLayoutData(): Promise<GraphLayoutData>;

    // Entity neighborhood queries (legacy)
    getEntityNeighborhood(
        entityId: string,
        depth: number,
        maxNodes: number,
    ): Promise<EntityNeighborhoodResult>;

    // Phase 3: Layout-only neighborhood data (legacy)
    getEntityNeighborhoodLayoutData(
        entityId: string,
        depth: number,
        maxNodes: number,
    ): Promise<GraphLayoutData>;

    // Statistics and metadata
    getGraphStatistics(): Promise<GraphStatistics>;

    // Phase 1: Optimized layout-only methods
    getGlobalImportanceLayer(maxNodes?: number): Promise<GraphLayoutResult>;
    getGlobalImportanceLayoutData(
        maxNodes?: number,
    ): Promise<GraphLayoutResult>;
    getTopicImportanceLayoutData(
        maxNodes?: number,
    ): Promise<TopicGraphLayoutResult>;

    // Phase 2: Optimized entity neighborhood method
    getEntityNeighborhoodLayoutDataOptimized(
        entityId: string,
        depth: number,
        maxNodes: number,
    ): Promise<EntityNeighborhoodLayoutResult>;

    // Hierarchical partitioned loading methods (legacy)
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

    async getEntityNeighborhood(
        entityId: string,
        depth: number,
        maxNodes: number,
    ): Promise<EntityNeighborhoodResult> {
        const startTime = performance.now();

        try {
            // Use the proper service method for efficient neighborhood retrieval
            const neighborhoodData =
                await this.baseService.getEntityNeighborhood({
                    entityId,
                    depth,
                    maxNodes,
                });

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
    // PHASE 3: LAYOUT-ONLY DATA CONTRACT METHODS
    // ===================================================================

    async getGlobalGraphLayoutData(): Promise<GraphLayoutData> {
        try {
            // Use the new optimized server method that returns only graphology layout
            const layoutResult =
                await this.baseService.getGlobalGraphLayoutData({
                    maxNodes: 1000,
                    includeConnectivity: true,
                });

            if (
                !layoutResult.graphologyLayout ||
                !layoutResult.graphologyLayout.elements
            ) {
                throw new Error(
                    "No graphology layout found in server response",
                );
            }

            console.log(
                `[GraphDataProvider] Using optimized global graph layout: ${layoutResult.graphologyLayout.elements.length} elements`,
            );

            return {
                presetLayout: {
                    elements: layoutResult.graphologyLayout.elements,
                    layoutDuration:
                        layoutResult.graphologyLayout.layoutDuration || 0,
                    communityCount:
                        layoutResult.graphologyLayout.communityCount || 0,
                    avgSpacing: layoutResult.graphologyLayout.avgSpacing || 100,
                    metadata: {
                        source: "server_graphology_optimized",
                        algorithm:
                            layoutResult.graphologyLayout.algorithm ||
                            "force-directed",
                        timestamp: Date.now(),
                        totalEntitiesInSystem:
                            layoutResult.metadata.totalEntitiesInSystem,
                        selectedEntityCount:
                            layoutResult.metadata.selectedEntityCount,
                        coveragePercentage:
                            layoutResult.metadata.coveragePercentage,
                    },
                },
            };
        } catch (error) {
            console.error(
                "[GraphDataProvider] Failed to fetch optimized global graph layout:",
                error,
            );
            throw new Error(
                `Global graph layout fetch failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
        }
    }

    async getEntityNeighborhoodLayoutData(
        entityId: string,
        depth: number,
        maxNodes: number,
    ): Promise<GraphLayoutData> {
        try {
            // Get the raw neighborhood data which should include graphologyLayout from server
            const rawData = await this.getEntityNeighborhood(
                entityId,
                depth,
                maxNodes,
            );

            // Extract the pre-computed graphology layout
            const graphologyLayout = (rawData as any).graphologyLayout;

            if (!graphologyLayout || !graphologyLayout.elements) {
                throw new Error(
                    "No graphology layout found in neighborhood response - server may need to be updated",
                );
            }

            console.log(
                `[GraphDataProvider] Using server-computed neighborhood layout: ${graphologyLayout.elements.length} elements`,
            );

            return {
                presetLayout: {
                    elements: graphologyLayout.elements,
                    layoutDuration: graphologyLayout.layoutDuration || 0,
                    communityCount: 0, // Neighborhoods typically don't have communities
                    avgSpacing: graphologyLayout.avgSpacing || 80,
                    metadata: {
                        source: "server_graphology",
                        algorithm:
                            graphologyLayout.algorithm || "force-directed",
                        timestamp: Date.now(),
                    },
                },
                centerEntity: entityId,
            };
        } catch (error) {
            console.error(
                "[GraphDataProvider] Failed to fetch neighborhood layout:",
                error,
            );
            throw new Error(
                `Neighborhood layout fetch failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
        }
    }

    // ===================================================================
    // HIERARCHICAL PARTITIONED LOADING METHODS
    // ===================================================================

    async getGlobalImportanceLayer(
        maxNodes: number = 5000,
    ): Promise<GraphLayoutResult> {
        try {
            const result = await this.baseService.getGlobalImportanceLayer(
                maxNodes,
                true,
            );

            // Server now returns layout-only contract: {graphologyLayout, metadata}
            // No need to transform entities/relationships as they're not included

            return result;
        } catch (error) {
            console.error(
                "[GraphDataProvider] Error fetching global importance layer:",
                error,
            );
            throw error;
        }
    }

    async getGlobalImportanceLayoutData(
        maxNodes: number = 5000,
    ): Promise<GraphLayoutResult> {
        // Alias for the optimized method - same implementation
        return this.getGlobalImportanceLayer(maxNodes);
    }

    async getTopicImportanceLayoutData(
        maxNodes: number = 500,
    ): Promise<TopicGraphLayoutResult> {
        try {
            const result =
                await this.baseService.getTopicImportanceLayer(maxNodes);

            // Server now returns layout-only contract: {graphologyLayout, metadata}
            return result;
        } catch (error) {
            console.error(
                "[GraphDataProvider] Error fetching topic importance layer:",
                error,
            );
            throw error;
        }
    }

    async getEntityNeighborhoodLayoutDataOptimized(
        entityId: string,
        depth: number,
        maxNodes: number,
    ): Promise<EntityNeighborhoodLayoutResult> {
        try {
            const result =
                await this.baseService.getEntityNeighborhoodLayoutData(
                    entityId,
                    depth,
                    maxNodes,
                );

            // Server returns optimized layout-only contract: {graphologyLayout, metadata}
            return result;
        } catch (error) {
            console.error(
                "[GraphDataProvider] Error fetching optimized entity neighborhood layout:",
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

        // Preserve graphology size if available, otherwise compute
        const computedSize =
            hybridEntity.size ||
            Math.max(20, 20 + Math.sqrt(importance * 1000));

        // Preserve graphology color if available, otherwise compute based on type
        let color = hybridEntity.color || "#6C7B7F"; // Use graphology color or default gray
        let borderColor = "#4A5568"; // Default border

        // Only compute type-specific colors if no color was provided
        if (!hybridEntity.color) {
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
                ...(hybridEntity.community !== undefined && {
                    community: hybridEntity.community,
                }),
                ...(hybridEntity.description && {
                    description: hybridEntity.description,
                }),

                // Computed or preserved UI properties
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
}

export {
    GraphDataProvider as GraphDataProvider,
    GraphDataProviderImpl as GraphDataProviderImpl,
    EntityNeighborhoodResult,
    EntityNode,
    RelationshipEdge,
    GraphStatistics,
    GraphLayoutResult,
    TopicGraphLayoutResult,
    EntityNeighborhoodLayoutResult,
    GraphLayoutData,
};
