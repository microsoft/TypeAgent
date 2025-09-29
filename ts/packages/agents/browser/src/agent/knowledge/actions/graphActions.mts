// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";
import { searchByEntities } from "../../searchWebMemories.mjs";
import { GraphCache } from "../types/knowledgeTypes.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:knowledge:graph");

// ============================================================================
// Graph Status and Build Functions
// ============================================================================

export async function getKnowledgeGraphStatus(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    hasGraph: boolean;
    entityCount: number;
    relationshipCount: number;
    communityCount: number;
    isBuilding: boolean;
    error?: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            debug("website collection not found");
            return {
                hasGraph: false,
                entityCount: 0,
                relationshipCount: 0,
                communityCount: 0,
                isBuilding: false,
                error: "Website collection not available",
            };
        }

        // Check if relationships and communities tables exist
        if (
            !websiteCollection.relationships ||
            !websiteCollection.communities
        ) {
            // Tables not initialized, no graph exists
            return {
                hasGraph: false,
                entityCount: 0,
                relationshipCount: 0,
                communityCount: 0,
                isBuilding: false,
            };
        }

        // Get entity count from knowledge entities table
        let entityCount = 0;
        try {
            if (websiteCollection.knowledgeEntities) {
                entityCount = (
                    websiteCollection.knowledgeEntities as any
                ).getTotalEntityCount();
            }
        } catch (error) {
            console.warn("Failed to get entity count:", error);
        }

        // Get relationship count
        let relationshipCount = 0;
        try {
            const relationships =
                websiteCollection.relationships.getAllRelationships();
            relationshipCount = relationships.length;
        } catch (error) {
            console.warn("Failed to get relationship count:", error);
        }

        // Get community count
        let communityCount = 0;
        try {
            const communities =
                websiteCollection.communities.getAllCommunities();
            communityCount = communities.length;
        } catch (error) {
            console.warn("Failed to get community count:", error);
        }

        // Determine if graph exists based on actual data
        const hasGraph = relationshipCount > 0 || entityCount > 0;

        return {
            hasGraph: hasGraph,
            entityCount,
            relationshipCount,
            communityCount,
            isBuilding: false,
        };
    } catch (error) {
        console.error("Error getting knowledge graph status:", error);
        return {
            hasGraph: false,
            entityCount: 0,
            relationshipCount: 0,
            communityCount: 0,
            isBuilding: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function buildKnowledgeGraph(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    message?: string;
    error?: string;
    stats?: {
        entitiesFound: number;
        relationshipsCreated: number;
        communitiesDetected: number;
        timeElapsed: number;
    };
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                success: false,
                error: "Website collection not available",
            };
        }

        debug(
            "[Knowledge Graph] Starting knowledge graph build with parameters:",
            parameters,
        );

        const startTime = Date.now();
        await websiteCollection.buildGraph();
        const timeElapsed = Date.now() - startTime;

        // Get stats directly from websiteCollection using existing status method
        const status = await getKnowledgeGraphStatus({}, context);

        const stats = {
            entitiesFound: status.entityCount,
            relationshipsCreated: status.relationshipCount,
            communitiesDetected: status.communityCount,
            timeElapsed: timeElapsed,
        };

        debug("[Knowledge Graph] Build completed:", stats);

        return {
            success: true,
            message: `Knowledge graph build completed in ${timeElapsed}ms`,
            stats,
        };
    } catch (error) {
        console.error("[Knowledge Graph] Error building:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function rebuildKnowledgeGraph(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    message?: string;
    error?: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                success: false,
                error: "Website collection not available",
            };
        }

        // Clear existing graph data and rebuild
        try {
            // Clear existing graph tables if they exist
            if (websiteCollection.relationships) {
                websiteCollection.relationships.clear();
            }
            if (websiteCollection.communities) {
                websiteCollection.communities.clear();
            }
        } catch (clearError) {
            // Continue even if clearing fails, as the rebuild might overwrite
            console.warn("Failed to clear existing graph data:", clearError);
        }

        // Rebuild the knowledge graph
        await websiteCollection.buildGraph();

        return {
            success: true,
            message: "Knowledge graph rebuilt successfully",
        };
    } catch (error) {
        console.error("Error rebuilding knowledge graph:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

// ============================================================================
// Graph Data Retrieval Functions
// ============================================================================

export async function getAllRelationships(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    relationships: any[];
    error?: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                relationships: [],
                error: "Website collection not available",
            };
        }

        const relationships =
            websiteCollection.relationships?.getAllRelationships() || [];

        // Apply same optimization as getGlobalImportanceLayer for consistency
        const optimizedRelationships = relationships.map((rel: any) => ({
            rowId: rel.rowId,
            fromEntity: rel.fromEntity,
            toEntity: rel.toEntity,
            relationshipType: rel.relationshipType,
            confidence: rel.confidence,
            // Deduplicate sources using Set, then limit to first 3 entries
            sources: rel.sources
                ? typeof rel.sources === "string"
                    ? Array.from(new Set(JSON.parse(rel.sources))).slice(0, 3)
                    : Array.isArray(rel.sources)
                      ? Array.from(new Set(rel.sources)).slice(0, 3)
                      : rel.sources
                : undefined,
            count: rel.count,
        }));

        return {
            relationships: optimizedRelationships,
        };
    } catch (error) {
        console.error("Error getting all relationships:", error);
        return {
            relationships: [],
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function getAllCommunities(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    communities: any[];
    error?: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                communities: [],
                error: "Website collection not available",
            };
        }

        const communities =
            websiteCollection.communities?.getAllCommunities() || [];

        return {
            communities: communities,
        };
    } catch (error) {
        console.error("Error getting all communities:", error);
        return {
            communities: [],
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function getAllEntitiesWithMetrics(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    entities: any[];
    error?: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                entities: [],
                error: "Website collection not available",
            };
        }

        // Ensure cache is populated
        await ensureGraphCache(websiteCollection);

        // Get cached data
        const cache = getGraphCache(websiteCollection);
        if (cache && cache.isValid && cache.entityMetrics.length > 0) {
            debug(
                `[Knowledge Graph] Using cached entity data: ${cache.entityMetrics.length} entities`,
            );

            // Apply entity optimization similar to getGlobalImportanceLayer
            const optimizedEntities = cache.entityMetrics.map(
                (entity: any) => ({
                    id: entity.id || entity.name,
                    name: entity.name,
                    type: entity.type || "entity",
                    confidence: entity.confidence || 0.5,
                    count: entity.count,
                    degree: entity.degree,
                    importance: entity.importance,
                    communityId: entity.communityId,
                    size: entity.size,
                }),
            );

            return {
                entities: optimizedEntities,
            };
        }

        // Fallback to live computation if no cache
        debug(
            "[Knowledge Graph] Cache not available, computing entities with metrics",
        );
        const entities =
            (websiteCollection.knowledgeEntities as any)?.getTopEntities(
                5000,
            ) || [];
        const relationships =
            websiteCollection.relationships?.getAllRelationships() || [];
        const communities =
            websiteCollection.communities?.getAllCommunities() || [];

        const entityMetrics = calculateEntityMetrics(
            entities,
            relationships,
            communities,
        );

        const optimizedEntities = entityMetrics.map((entity: any) => ({
            id: entity.id || entity.name,
            name: entity.name,
            type: entity.type || "entity",
            confidence: entity.confidence || 0.5,
            count: entity.count,
            degree: entity.degree,
            importance: entity.importance,
            communityId: entity.communityId,
            size: entity.size,
        }));

        return {
            entities: optimizedEntities,
        };
    } catch (error) {
        console.error("Error getting all entities with metrics:", error);
        return {
            entities: [],
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

// ============================================================================
// Graph Exploration Functions
// ============================================================================

export async function getEntityNeighborhood(
    parameters: {
        entityId: string;
        depth?: number;
        maxNodes?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    centerEntity?: any;
    neighbors: any[];
    relationships: any[];
    searchData?: any;
    metadata?: any;
    error?: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                neighbors: [],
                relationships: [],
                error: "Website collection not available",
            };
        }

        const { entityId, depth = 2, maxNodes = 100 } = parameters;

        // Ensure cache is populated
        await ensureGraphCache(websiteCollection);

        // Get cached data
        const cache = getGraphCache(websiteCollection);
        if (!cache || !cache.isValid) {
            return {
                neighbors: [],
                relationships: [],
                error: "Graph cache not available",
            };
        }

        debug(
            `[Knowledge Graph] Performing BFS for entity "${entityId}" (depth: ${depth}, maxNodes: ${maxNodes})`,
        );

        // Perform BFS to find neighborhood
        const neighborhoodResult = performBFS(
            entityId,
            cache.entityMetrics,
            cache.relationships,
            depth,
            maxNodes,
        );

        if (!neighborhoodResult.centerEntity) {
            const searchNeibhbors = await searchByEntities(
                { entities: [entityId], maxResults: 20 },
                context,
            );

            if (searchNeibhbors) {
                return {
                    centerEntity: {
                        id: entityId,
                        name: entityId,
                        type: "entity",
                        confidence: 0.5,
                        count: 1,
                    },
                    neighbors: searchNeibhbors.relatedEntities || [],
                    relationships: [],
                    searchData: {
                        relatedEntities: searchNeibhbors?.relatedEntities || [],
                        topTopics: searchNeibhbors?.topTopics || [],
                        websites: searchNeibhbors?.websites || [],
                    },
                    metadata: {
                        source: "in_memory_cache",
                        queryDepth: depth,
                        maxNodes: maxNodes,
                        actualNodes:
                            (searchNeibhbors?.relatedEntities?.length || 0) + 1,
                        actualEdges: 0,
                        searchEnrichment: {
                            relatedEntities:
                                searchNeibhbors?.relatedEntities?.length || 0,
                            topTopics: searchNeibhbors?.topTopics?.length || 0,
                            websites: searchNeibhbors?.websites?.length || 0,
                        },
                    },
                };
            } else {
                return {
                    neighbors: [],
                    relationships: [],
                    error: `Entity "${entityId}" not found`,
                };
            }
        }

        // Get search enrichment for topics and related entities
        let searchData: any = null;
        try {
            const searchResults = await searchByEntities(
                { entities: [entityId], maxResults: 20 },
                context,
            );

            if (searchResults) {
                searchData = {
                    websites: searchResults.websites?.slice(0, 15) || [],
                    relatedEntities:
                        searchResults.relatedEntities?.slice(0, 15) || [],
                    topTopics: searchResults.topTopics?.slice(0, 10) || [],
                };

                debug(
                    `[Knowledge Graph] Search enrichment found: ${searchData.websites.length} websites, ${searchData.relatedEntities.length} related entities, ${searchData.topTopics.length} topics`,
                );
            }
        } catch (searchError) {
            console.warn(
                `[Knowledge Graph] Search enrichment failed:`,
                searchError,
            );
        }

        // Optimize relationships (same as other functions)
        const optimizedRelationships = neighborhoodResult.relationships.map(
            (rel: any) => ({
                rowId: rel.rowId,
                fromEntity: rel.fromEntity,
                toEntity: rel.toEntity,
                relationshipType: rel.relationshipType,
                confidence: rel.confidence,
                sources: rel.sources
                    ? typeof rel.sources === "string"
                        ? Array.from(new Set(JSON.parse(rel.sources))).slice(
                              0,
                              3,
                          )
                        : Array.isArray(rel.sources)
                          ? Array.from(new Set(rel.sources)).slice(0, 3)
                          : rel.sources
                    : undefined,
                count: rel.count,
            }),
        );

        // Optimize entities (centerEntity and neighbors)
        const optimizeEntity = (entity: any) =>
            entity
                ? {
                      id: entity.id || entity.name,
                      name: entity.name,
                      type: entity.type || "entity",
                      confidence: entity.confidence || 0.5,
                      count: entity.count,
                      degree: entity.degree,
                      importance: entity.importance,
                      communityId: entity.communityId,
                      size: entity.size,
                  }
                : null;

        const optimizedResult = {
            centerEntity: optimizeEntity(neighborhoodResult.centerEntity),
            neighbors: neighborhoodResult.neighbors.map(optimizeEntity),
            relationships: optimizedRelationships,
            searchData: {
                relatedEntities: searchData?.relatedEntities || [],
                topTopics: searchData?.topTopics || [],
                websites: searchData?.websites || [],
            },
            metadata: {
                source: "in_memory_cache",
                queryDepth: depth,
                maxNodes: maxNodes,
                actualNodes: neighborhoodResult.neighbors.length + 1,
                actualEdges: neighborhoodResult.relationships.length,
                searchEnrichment: {
                    relatedEntities: searchData?.relatedEntities?.length || 0,
                    topTopics: searchData?.topTopics?.length || 0,
                    websites: searchData?.websites?.length || 0,
                },
            },
        };

        return optimizedResult;
    } catch (error) {
        console.error("Error getting entity neighborhood:", error);
        return {
            neighbors: [],
            relationships: [],
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function getGlobalImportanceLayer(
    parameters: {
        maxNodes?: number;
        minImportanceThreshold?: number;
        includeConnectivity?: boolean;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    entities: any[];
    relationships: any[];
    metadata: any;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            console.log(`[ServerPerf] No website collection available`);
            return {
                entities: [],
                relationships: [],
                metadata: {
                    totalEntitiesInSystem: 0,
                    selectedEntityCount: 0,
                    coveragePercentage: 0,
                    importanceThreshold: 0,
                    layer: "global_importance",
                },
            };
        }

        // Ensure cache is populated
        await ensureGraphCache(websiteCollection);

        // Get cached data
        const cache = getGraphCache(websiteCollection);

        if (!cache || !cache.isValid) {
            console.log(
                `[ServerPerf] Cache validation failed: ${JSON.stringify({
                    hasCache: !!cache,
                    isValid: cache?.isValid,
                })}`,
            );
            return {
                entities: [],
                relationships: [],
                metadata: {
                    error: "Graph cache not available",
                    layer: "global_importance",
                },
            };
        }

        // Get all entities and calculate metrics
        const allEntities = cache.entityMetrics || [];
        const allRelationships = cache.relationships || [];
        const communities = cache.communities || [];

        if (allEntities.length === 0) {
            return {
                entities: [],
                relationships: [],
                metadata: {
                    totalEntitiesInSystem: 0,
                    selectedEntityCount: 0,
                    coveragePercentage: 0,
                    importanceThreshold: 0,
                    layer: "global_importance",
                },
            };
        }

        const entitiesWithMetrics = calculateEntityMetrics(
            allEntities,
            allRelationships,
            communities,
        );

        // Sort by importance and select top nodes
        const maxNodes = parameters.maxNodes || 500;
        const sortedEntities = entitiesWithMetrics.sort(
            (a, b) => (b.importance || 0) - (a.importance || 0),
        );

        let selectedEntities = sortedEntities.slice(0, maxNodes);
        // Ensure connectivity by adding bridge nodes if needed
        if (parameters.includeConnectivity !== false) {
            selectedEntities = ensureGlobalConnectivity(
                selectedEntities,
                allRelationships,
                maxNodes,
            );
        }

        // Get all relationships between selected entities
        const selectedEntityNames = new Set(
            selectedEntities.map((e) => e.name),
        );
        const selectedRelationships = allRelationships.filter(
            (rel: any) =>
                selectedEntityNames.has(rel.fromEntity) &&
                selectedEntityNames.has(rel.toEntity),
        );

        const metadata = {
            totalEntitiesInSystem: allEntities.length,
            selectedEntityCount: selectedEntities.length,
            coveragePercentage:
                (selectedEntities.length / allEntities.length) * 100,
            importanceThreshold:
                selectedEntities[selectedEntities.length - 1]?.importance || 0,
            connectedComponents: analyzeConnectivity(
                selectedEntities,
                selectedRelationships,
            ),
            layer: "global_importance",
        };

        const optimizedRelationships = selectedRelationships.map(
            (rel: any) => ({
                rowId: rel.rowId,
                fromEntity: rel.fromEntity,
                toEntity: rel.toEntity,
                relationshipType: rel.relationshipType,
                confidence: rel.confidence,
                // Deduplicate sources using Set, then limit to first 3 entries
                sources: rel.sources
                    ? typeof rel.sources === "string"
                        ? Array.from(new Set(JSON.parse(rel.sources))).slice(
                              0,
                              3,
                          )
                        : Array.isArray(rel.sources)
                          ? Array.from(new Set(rel.sources)).slice(0, 3)
                          : rel.sources
                    : undefined,
                count: rel.count,
            }),
        );

        const optimizedEntities = selectedEntities.map((entity: any) => ({
            id: entity.id || entity.name,
            name: entity.name,
            type: entity.type || "entity",
            confidence: entity.confidence || 0.5,
            count: entity.count,
            degree: entity.degree,
            importance: entity.importance,
            communityId: entity.communityId,
            size: entity.size,
        }));

        return {
            entities: optimizedEntities,
            relationships: optimizedRelationships,
            metadata: metadata,
        };
    } catch (error) {
        console.error("Error getting global importance layer:", error);
        return {
            entities: [],
            relationships: [],
            metadata: {
                error: error instanceof Error ? error.message : "Unknown error",
                layer: "global_importance",
            },
        };
    }
}

export async function getViewportBasedNeighborhood(
    parameters: {
        centerEntity: string;
        viewportNodeNames: string[];
        maxNodes?: number;
        importanceWeighting?: boolean;
        includeGlobalContext?: boolean;
        exploreFromAllViewportNodes?: boolean;
        minDepthFromViewport?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    entities: any[];
    relationships: any[];
    metadata: any;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                entities: [],
                relationships: [],
                metadata: {
                    error: "Website collection not available",
                    layer: "viewport_neighborhood",
                },
            };
        }

        // Ensure cache is populated
        await ensureGraphCache(websiteCollection);

        // Get cached data
        const cache = getGraphCache(websiteCollection);
        if (!cache || !cache.isValid) {
            return {
                entities: [],
                relationships: [],
                metadata: {
                    error: "Graph cache not available",
                    layer: "viewport_neighborhood",
                },
            };
        }

        const allEntities = cache.entityMetrics || [];
        const allRelationships = cache.relationships || [];
        const communities = cache.communities || [];

        const entitiesWithMetrics = calculateEntityMetrics(
            allEntities,
            allRelationships,
            communities,
        );
        const maxNodes = parameters.maxNodes || 500;
        const minDepthFromViewport = parameters.minDepthFromViewport || 1;
        const exploreFromAll = parameters.exploreFromAllViewportNodes !== false;

        // Find center entity
        const centerEntity = entitiesWithMetrics.find(
            (e) =>
                e.name?.toLowerCase() ===
                    parameters.centerEntity.toLowerCase() ||
                e.id?.toLowerCase() === parameters.centerEntity.toLowerCase(),
        );

        if (!centerEntity) {
            return {
                entities: [],
                relationships: [],
                metadata: {
                    error: "Center entity not found",
                    layer: "viewport_neighborhood",
                },
            };
        }

        // Find viewport entities
        const viewportEntities: any[] = [];
        const viewportNodeNamesLower = (parameters.viewportNodeNames || []).map(
            (name) => name.toLowerCase(),
        );

        for (const nodeName of viewportNodeNamesLower) {
            const entity = entitiesWithMetrics.find(
                (e) =>
                    e.name?.toLowerCase() === nodeName ||
                    e.id?.toLowerCase() === nodeName,
            );
            if (entity) {
                viewportEntities.push(entity);
            }
        }

        if (
            viewportEntities.length === 0 &&
            parameters.viewportNodeNames &&
            parameters.viewportNodeNames.length > 0
        ) {
            console.warn(
                `No viewport entities found from ${parameters.viewportNodeNames.length} names`,
            );
        }

        // Build adjacency map with importance weighting
        const adjacencyMap = buildImportanceWeightedAdjacency(
            entitiesWithMetrics,
            allRelationships,
        );

        // Start with center entity and viewport entities as initial set
        const initialEntities = [centerEntity, ...viewportEntities];
        const visited = new Set<string>();
        const result: any[] = [];

        // Add all initial entities to result and visited set
        initialEntities.forEach((entity) => {
            if (!visited.has(entity.name.toLowerCase())) {
                visited.add(entity.name.toLowerCase());
                result.push(entity);
            }
        });

        // BFS queue: [entity, depth from nearest viewport node, source]
        type QueueItem = {
            entity: any;
            depth: number;
            importance: number;
            source: string;
        };
        const queue: QueueItem[] = [];

        // Initialize queue with neighbors of all initial entities
        if (exploreFromAll) {
            // Explore from all viewport nodes simultaneously
            initialEntities.forEach((startEntity) => {
                const neighbors =
                    adjacencyMap.get(startEntity.name.toLowerCase()) || [];
                neighbors.forEach((neighbor) => {
                    if (!visited.has(neighbor.entity.name.toLowerCase())) {
                        queue.push({
                            entity: neighbor.entity,
                            depth: 1,
                            importance: neighbor.importance,
                            source: startEntity.name,
                        });
                    }
                });
            });
        } else {
            // Only explore from center entity
            const centerNeighbors =
                adjacencyMap.get(centerEntity.name.toLowerCase()) || [];
            centerNeighbors.forEach((neighbor) => {
                if (!visited.has(neighbor.entity.name.toLowerCase())) {
                    queue.push({
                        entity: neighbor.entity,
                        depth: 1,
                        importance: neighbor.importance,
                        source: centerEntity.name,
                    });
                }
            });
        }

        // Sort queue by importance if weighting is enabled
        if (parameters.importanceWeighting !== false) {
            queue.sort((a, b) => b.importance - a.importance);
        }

        // Expand neighborhood using BFS
        let actualMaxDepth = 0;
        while (queue.length > 0 && result.length < maxNodes) {
            const current = queue.shift()!;

            // Skip if already visited or depth exceeds minimum
            if (visited.has(current.entity.name.toLowerCase())) continue;
            if (current.depth < minDepthFromViewport) {
                // Still need to explore neighbors even if not adding this node yet
                const neighbors =
                    adjacencyMap.get(current.entity.name.toLowerCase()) || [];
                neighbors.forEach((neighbor) => {
                    if (!visited.has(neighbor.entity.name.toLowerCase())) {
                        queue.push({
                            entity: neighbor.entity,
                            depth: current.depth + 1,
                            importance: neighbor.importance,
                            source: current.source,
                        });
                    }
                });

                // Re-sort if importance weighting is enabled
                if (parameters.importanceWeighting !== false) {
                    queue.sort((a, b) => b.importance - a.importance);
                }
                continue;
            }

            // Add to result
            visited.add(current.entity.name.toLowerCase());
            result.push(current.entity);
            actualMaxDepth = Math.max(actualMaxDepth, current.depth);

            // Add neighbors to queue
            const neighbors =
                adjacencyMap.get(current.entity.name.toLowerCase()) || [];
            neighbors.forEach((neighbor) => {
                if (!visited.has(neighbor.entity.name.toLowerCase())) {
                    queue.push({
                        entity: neighbor.entity,
                        depth: current.depth + 1,
                        importance: neighbor.importance,
                        source: current.source,
                    });
                }
            });

            // Re-sort queue by importance after adding new neighbors
            if (parameters.importanceWeighting !== false) {
                queue.sort((a, b) => b.importance - a.importance);
            }
        }

        // Optionally include global context nodes
        if (parameters.includeGlobalContext) {
            const availableSlots = maxNodes - result.length;
            if (availableSlots > 0) {
                const resultNames = new Set(result.map((e) => e.name));
                const globalNodes = entitiesWithMetrics
                    .filter((e) => !resultNames.has(e.name))
                    .sort((a, b) => (b.importance || 0) - (a.importance || 0))
                    .slice(
                        0,
                        Math.min(
                            availableSlots,
                            Math.floor(availableSlots * 0.1),
                        ),
                    ); // Add up to 10% global context
                result.push(...globalNodes);
            }
        }

        // Get relationships between all included entities
        const entityNames = new Set(result.map((e) => e.name));
        const neighborhoodRelationships = allRelationships.filter(
            (rel: any) =>
                entityNames.has(rel.fromEntity) &&
                entityNames.has(rel.toEntity),
        );

        return {
            entities: result,
            relationships: neighborhoodRelationships,
            metadata: {
                centerEntity: centerEntity.name,
                viewportEntities: viewportEntities.map((e) => e.name),
                viewportNodesFound: viewportEntities.length,
                viewportNodesRequested:
                    parameters.viewportNodeNames?.length || 0,
                actualDepth: actualMaxDepth,
                entityCount: result.length,
                relationshipCount: neighborhoodRelationships.length,
                importanceRange:
                    result.length > 0
                        ? {
                              min: Math.min(
                                  ...result.map((e) => e.importance || 0),
                              ),
                              max: Math.max(
                                  ...result.map((e) => e.importance || 0),
                              ),
                          }
                        : { min: 0, max: 0 },
                exploreFromAllViewportNodes: exploreFromAll,
                minDepthFromViewport: minDepthFromViewport,
                layer: "viewport_neighborhood",
            },
        };
    } catch (error) {
        console.error("Error getting viewport-based neighborhood:", error);
        return {
            entities: [],
            relationships: [],
            metadata: {
                error: error instanceof Error ? error.message : "Unknown error",
                layer: "viewport_neighborhood",
            },
        };
    }
}

export async function getImportanceStatistics(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    distribution: number[];
    recommendedLevel: number;
    levelPreview: Array<{ level: number; nodeCount: number; coverage: number }>;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return { distribution: [], recommendedLevel: 1, levelPreview: [] };
        }

        // Ensure cache is populated
        await ensureGraphCache(websiteCollection);

        // Get cached data
        const cache = getGraphCache(websiteCollection);
        if (!cache || !cache.isValid) {
            return { distribution: [], recommendedLevel: 1, levelPreview: [] };
        }

        const entities = cache.entityMetrics || [];
        const relationships = cache.relationships || [];
        const communities = cache.communities || [];

        const entitiesWithMetrics = calculateEntityMetrics(
            entities,
            relationships,
            communities,
        );

        // Calculate importance distribution
        const importanceScores = entitiesWithMetrics
            .map((e) => e.importance || 0)
            .sort((a, b) => b - a);

        // Preview node counts at each level
        const levelPreviews = IMPORTANCE_LEVELS.map((level) => ({
            level: level.level,
            nodeCount: importanceScores.filter(
                (score) => score >= level.threshold,
            ).length,
            coverage:
                importanceScores.filter((score) => score >= level.threshold)
                    .length / importanceScores.length,
        }));

        // Recommend level based on graph size
        const totalNodes = entities.length;
        const recommendedLevel =
            totalNodes > 25000
                ? 1
                : totalNodes > 10000
                  ? 2
                  : totalNodes > 3000
                    ? 3
                    : 4;

        return {
            distribution: calculateDistributionPercentiles(importanceScores),
            recommendedLevel,
            levelPreview: levelPreviews,
        };
    } catch (error) {
        console.error("Error getting importance statistics:", error);
        return { distribution: [], recommendedLevel: 1, levelPreview: [] };
    }
}

// ============================================================================
// Cache Management Functions
// ============================================================================

// Cache storage attached to websiteCollection
function getGraphCache(websiteCollection: any): GraphCache | null {
    return (websiteCollection as any).__graphCache || null;
}

function setGraphCache(websiteCollection: any, cache: GraphCache): void {
    (websiteCollection as any).__graphCache = cache;
}

// Ensure graph data is cached for fast access
async function ensureGraphCache(websiteCollection: any): Promise<void> {
    const cache = getGraphCache(websiteCollection);
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    // Check if cache is valid
    if (cache && cache.isValid && Date.now() - cache.lastUpdated < CACHE_TTL) {
        debug("[Knowledge Graph] Using valid cached graph data");
        return;
    }

    debug("[Knowledge Graph] Building in-memory cache for graph data");

    try {
        // Fetch raw data
        const entities =
            (websiteCollection.knowledgeEntities as any)?.getTopEntities(
                5000,
            ) || [];
        const relationships =
            websiteCollection.relationships?.getAllRelationships() || [];
        const communities =
            websiteCollection.communities?.getAllCommunities() || [];

        // Calculate metrics
        const entityMetrics = calculateEntityMetrics(
            entities,
            relationships,
            communities,
        );

        // Store in cache
        const newCache: GraphCache = {
            entities: entities,
            relationships: relationships,
            communities: communities,
            entityMetrics: entityMetrics,
            lastUpdated: Date.now(),
            isValid: true,
        };

        setGraphCache(websiteCollection, newCache);

        debug(
            `[Knowledge Graph] Cached ${entities.length} entities, ${relationships.length} relationships, ${communities.length} communities`,
        );
    } catch (error) {
        console.error("[Knowledge Graph] Failed to build cache:", error);

        // Mark cache as invalid but keep existing data if available
        const existingCache = getGraphCache(websiteCollection);
        if (existingCache) {
            existingCache.isValid = false;
        }
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

// BFS implementation for finding entity neighborhood
function performBFS(
    entityId: string,
    entities: any[],
    relationships: any[],
    maxDepth: number,
    maxNodes: number,
): {
    centerEntity?: any;
    neighbors: any[];
    relationships: any[];
} {
    // Find center entity (case insensitive)
    const centerEntity = entities.find(
        (e) =>
            e.name?.toLowerCase() === entityId.toLowerCase() ||
            e.id?.toLowerCase() === entityId.toLowerCase(),
    );

    if (!centerEntity) {
        return { neighbors: [], relationships: [] };
    }

    // Build adjacency map for fast lookups
    const adjacencyMap = new Map<string, any[]>();
    const relationshipMap = new Map<string, any>();

    relationships.forEach((rel) => {
        const fromName = rel.fromEntity || rel.from;
        const toName = rel.toEntity || rel.to;

        if (fromName && toName) {
            // Normalize entity names for lookup
            const fromKey = fromName.toLowerCase();
            const toKey = toName.toLowerCase();

            if (!adjacencyMap.has(fromKey)) adjacencyMap.set(fromKey, []);
            if (!adjacencyMap.has(toKey)) adjacencyMap.set(toKey, []);

            adjacencyMap.get(fromKey)!.push(toKey);
            adjacencyMap.get(toKey)!.push(fromKey);

            const relKey = `${fromKey}-${toKey}`;
            const relKey2 = `${toKey}-${fromKey}`;
            relationshipMap.set(relKey, rel);
            relationshipMap.set(relKey2, rel);
        }
    });

    // BFS traversal
    const visited = new Set<string>();
    const queue: Array<{ entityName: string; depth: number }> = [];
    const result = {
        neighbors: [] as any[],
        relationships: [] as any[],
    };

    const centerKey =
        centerEntity.name?.toLowerCase() || centerEntity.id?.toLowerCase();
    queue.push({ entityName: centerKey, depth: 0 });
    visited.add(centerKey);

    while (queue.length > 0 && result.neighbors.length < maxNodes) {
        const current = queue.shift()!;

        if (current.depth > 0) {
            // Find the actual entity object
            const entity = entities.find(
                (e) =>
                    e.name?.toLowerCase() === current.entityName ||
                    e.id?.toLowerCase() === current.entityName,
            );

            if (entity) {
                result.neighbors.push(entity);
            }
        }

        if (current.depth < maxDepth) {
            const neighbors = adjacencyMap.get(current.entityName) || [];

            for (const neighborKey of neighbors) {
                if (
                    !visited.has(neighborKey) &&
                    result.neighbors.length < maxNodes
                ) {
                    visited.add(neighborKey);
                    queue.push({
                        entityName: neighborKey,
                        depth: current.depth + 1,
                    });

                    // Add relationship
                    const relKey = `${current.entityName}-${neighborKey}`;
                    const relationship = relationshipMap.get(relKey);
                    if (
                        relationship &&
                        !result.relationships.find(
                            (r) => r.rowId === relationship.rowId,
                        )
                    ) {
                        result.relationships.push(relationship);
                    }
                }
            }
        }
    }

    // add relationships between neighbors
    for (let i = 0; i < result.neighbors.length; i++) {
        for (let j = i + 1; j < result.neighbors.length; j++) {
            const neighborA = result.neighbors[i];
            const neighborB = result.neighbors[j];
            const relKey = `${neighborA.name?.toLowerCase() || neighborA.id?.toLowerCase()}-${neighborB.name?.toLowerCase() || neighborB.id?.toLowerCase()}`;
            const relationship = relationshipMap.get(relKey);
            if (
                relationship &&
                !result.relationships.find(
                    (r) => r.rowId === relationship.rowId,
                )
            ) {
                result.relationships.push(relationship);
            }
        }
    }

    return {
        centerEntity,
        neighbors: result.neighbors,
        relationships: result.relationships,
    };
}

function calculateEntityMetrics(
    entities: any[],
    relationships: any[],
    communities: any[],
): any[] {
    const entityMap = new Map<string, any>();
    const degreeMap = new Map<string, number>();
    const communityMap = new Map<string, string>();

    entities.forEach((entity) => {
        const entityName = entity.entityName || entity.name;
        entityMap.set(entityName, {
            id: entityName,
            name: entityName,
            type: entity.entityType || entity.type || "entity",
            confidence: entity.confidence || 0.5,
            count: entity.count || 1,
        });
        degreeMap.set(entityName, 0);
    });

    communities.forEach((community, index) => {
        let communityEntities: string[] = [];
        try {
            communityEntities =
                typeof community.entities === "string"
                    ? JSON.parse(community.entities)
                    : Array.isArray(community.entities)
                      ? community.entities
                      : [];
        } catch (e) {
            communityEntities = [];
        }

        communityEntities.forEach((entityName) => {
            communityMap.set(entityName, community.id || `community_${index}`);
        });
    });

    relationships.forEach((rel) => {
        const from = rel.fromEntity;
        const to = rel.toEntity;

        if (degreeMap.has(from)) {
            degreeMap.set(from, degreeMap.get(from)! + 1);
        } else {
            debug(
                `[DEBUG-Backend] Warning: fromEntity '${from}' not found in degreeMap`,
            );
        }
        if (degreeMap.has(to)) {
            degreeMap.set(to, degreeMap.get(to)! + 1);
        } else {
            debug(
                `[DEBUG-Backend] Warning: toEntity '${to}' not found in degreeMap`,
            );
        }
    });

    // Debug: Show degree map statistics
    const degreeValues = Array.from(degreeMap.values());
    const nonZeroDegrees = degreeValues.filter((d) => d > 0);
    debug(
        `[DEBUG-Backend] Degree map stats: total entities=${degreeValues.length}, nonZero=${nonZeroDegrees.length}, max=${Math.max(...degreeValues)}`,
    );
    if (nonZeroDegrees.length > 0 && nonZeroDegrees.length <= 10) {
        debug(
            `[DEBUG-Backend] Non-zero degrees:`,
            Array.from(degreeMap.entries()).filter(([, v]) => v > 0),
        );
    }

    const maxDegree = Math.max(...Array.from(degreeMap.values())) || 1;

    debug(
        `[DEBUG-Backend] calculateEntityMetrics: entityCount=${entities.length}, relationshipCount=${relationships.length}, maxDegree=${maxDegree}`,
    );

    const results = Array.from(entityMap.values()).map((entity) => {
        const degree = degreeMap.get(entity.name) || 0;
        const importance = degree / maxDegree;
        return {
            ...entity,
            degree: degree,
            importance: importance,
            communityId: communityMap.get(entity.name) || "default",
            size: Math.max(8, Math.min(40, 8 + Math.sqrt(degree * 3))),
        };
    });

    return results;
}

// Importance levels for hierarchical loading
interface ImportanceLevelConfig {
    level: 1 | 2 | 3 | 4;
    threshold: number;
    maxNodes: number;
    description: string;
}

const IMPORTANCE_LEVELS: ImportanceLevelConfig[] = [
    {
        level: 1,
        threshold: 0.8,
        maxNodes: 1000,
        description: "Critical Nodes Only",
    },
    {
        level: 2,
        threshold: 0.5,
        maxNodes: 5000,
        description: "Important Nodes",
    },
    { level: 3, threshold: 0.2, maxNodes: 15000, description: "Most Nodes" },
    { level: 4, threshold: 0.0, maxNodes: 50000, description: "All Nodes" },
];

function ensureGlobalConnectivity(
    importantEntities: any[],
    allRelationships: any[],
    maxNodes: number,
): any[] {
    const components = findConnectedComponents(
        importantEntities,
        allRelationships,
    );

    // If multiple components, add bridge nodes to connect them
    if (components.length > 1) {
        const bridgeNodes = findBridgeNodes(
            components,
            allRelationships,
            maxNodes - importantEntities.length,
        );
        return [...importantEntities, ...bridgeNodes];
    }

    return importantEntities;
}

function findConnectedComponents(
    entities: any[],
    relationships: any[],
): any[][] {
    const entityNames = new Set(entities.map((e) => e.name));
    const adjacencyList = new Map<string, string[]>();

    // Build adjacency list
    entities.forEach((entity) => adjacencyList.set(entity.name, []));
    relationships.forEach((rel) => {
        if (entityNames.has(rel.fromEntity) && entityNames.has(rel.toEntity)) {
            adjacencyList.get(rel.fromEntity)?.push(rel.toEntity);
            adjacencyList.get(rel.toEntity)?.push(rel.fromEntity);
        }
    });

    const visited = new Set<string>();
    const components: any[][] = [];

    entities.forEach((entity) => {
        if (!visited.has(entity.name)) {
            const component: any[] = [];
            const stack = [entity.name];

            while (stack.length > 0) {
                const current = stack.pop()!;
                if (visited.has(current)) continue;

                visited.add(current);
                const currentEntity = entities.find((e) => e.name === current);
                if (currentEntity) component.push(currentEntity);

                const neighbors = adjacencyList.get(current) || [];
                neighbors.forEach((neighbor) => {
                    if (!visited.has(neighbor)) {
                        stack.push(neighbor);
                    }
                });
            }

            if (component.length > 0) {
                components.push(component);
            }
        }
    });

    return components;
}

function findBridgeNodes(
    components: any[][],
    allRelationships: any[],
    maxBridgeNodes: number,
): any[] {
    // Find nodes that connect different components
    const bridgeNodes: any[] = [];
    // Note: Bridge detection algorithm can be implemented here in the future

    // For now, return empty array - can be enhanced with actual bridge detection
    return bridgeNodes;
}

function analyzeConnectivity(entities: any[], relationships: any[]): any {
    const components = findConnectedComponents(entities, relationships);
    return {
        componentCount: components.length,
        largestComponentSize: Math.max(...components.map((c) => c.length)),
        averageComponentSize:
            components.reduce((sum, c) => sum + c.length, 0) /
            components.length,
    };
}

function buildImportanceWeightedAdjacency(
    entities: any[],
    relationships: any[],
): Map<string, Array<{ entity: any; importance: number }>> {
    const adjacencyMap = new Map<
        string,
        Array<{ entity: any; importance: number }>
    >();
    const entityMap = new Map<string, any>();

    entities.forEach((entity) => {
        entityMap.set(entity.name.toLowerCase(), entity);
        adjacencyMap.set(entity.name.toLowerCase(), []);
    });

    relationships.forEach((rel) => {
        const fromKey = rel.fromEntity.toLowerCase();
        const toKey = rel.toEntity.toLowerCase();

        const fromEntity = entityMap.get(fromKey);
        const toEntity = entityMap.get(toKey);

        if (fromEntity && toEntity) {
            adjacencyMap.get(fromKey)?.push({
                entity: toEntity,
                importance: toEntity.importance || 0,
            });
            adjacencyMap.get(toKey)?.push({
                entity: fromEntity,
                importance: fromEntity.importance || 0,
            });
        }
    });

    return adjacencyMap;
}

function calculateDistributionPercentiles(
    importanceScores: number[],
): number[] {
    if (importanceScores.length === 0) return [];

    const percentiles = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1.0];
    return percentiles.map((p) => {
        const index = Math.floor(p * (importanceScores.length - 1));
        return importanceScores[index] || 0;
    });
}
