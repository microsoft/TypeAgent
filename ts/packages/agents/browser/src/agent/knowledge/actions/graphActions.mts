// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";
import { searchByEntities } from "../../searchWebMemories.mjs";
import { GraphCache, TopicGraphCache } from "../types/knowledgeTypes.mjs";
import { calculateTopicImportance } from "../utils/topicMetricsCalculator.mjs";
import { getPerformanceTracker } from "../utils/performanceInstrumentation.mjs";
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

        // Invalidate caches after graph build
        setGraphCache(websiteCollection, {
            entities: [],
            relationships: [],
            communities: [],
            entityMetrics: [],
            lastUpdated: 0,
            isValid: false,
        });
        invalidateTopicCache(websiteCollection);

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

        // Invalidate caches after graph rebuild
        setGraphCache(websiteCollection, {
            entities: [],
            relationships: [],
            communities: [],
            entityMetrics: [],
            lastUpdated: 0,
            isValid: false,
        });
        invalidateTopicCache(websiteCollection);

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

// Entity graph cache storage attached to websiteCollection
function getGraphCache(websiteCollection: any): GraphCache | null {
    return (websiteCollection as any).__graphCache || null;
}

function setGraphCache(websiteCollection: any, cache: GraphCache): void {
    (websiteCollection as any).__graphCache = cache;
}

// Topic graph cache storage attached to websiteCollection
function getTopicGraphCache(websiteCollection: any): TopicGraphCache | null {
    return (websiteCollection as any).__topicGraphCache || null;
}

function setTopicGraphCache(
    websiteCollection: any,
    cache: TopicGraphCache,
): void {
    (websiteCollection as any).__topicGraphCache = cache;
}

// Invalidate topic cache (called on graph rebuild or knowledge import)
export function invalidateTopicCache(websiteCollection: any): void {
    setTopicGraphCache(websiteCollection, {
        topics: [],
        relationships: [],
        topicMetrics: [],
        lastUpdated: 0,
        isValid: false,
    });
}

// Ensure topic graph data is cached for fast access
async function ensureTopicGraphCache(websiteCollection: any): Promise<void> {
    const cache = getTopicGraphCache(websiteCollection);

    // Cache never expires - only invalidated on graph rebuild or knowledge import
    if (cache && cache.isValid) {
        return;
    }

    const tracker = getPerformanceTracker();
    tracker.startOperation("ensureTopicGraphCache");

    try {
        // Fetch all topics from database
        tracker.startOperation("ensureTopicGraphCache.getTopicHierarchy");
        const topics =
            websiteCollection.hierarchicalTopics?.getTopicHierarchy() || [];
        tracker.endOperation(
            "ensureTopicGraphCache.getTopicHierarchy",
            topics.length,
            topics.length,
        );

        // Enrich topics with entity references if available - OPTIMIZED
        if (websiteCollection.topicEntityRelations) {
            tracker.startOperation(
                "ensureTopicGraphCache.enrichTopicsWithEntities",
            );
            const topicIds = topics.map((t: any) => t.topicId);

            // Single batch query instead of N individual queries
            const allEntityRelations =
                websiteCollection.topicEntityRelations.getEntitiesForTopics(
                    topicIds,
                );

            // Group entity relations by topic ID for efficient lookup
            const entityRelationsByTopic = new Map<string, any[]>();
            for (const relation of allEntityRelations) {
                if (!entityRelationsByTopic.has(relation.topicId)) {
                    entityRelationsByTopic.set(relation.topicId, []);
                }
                entityRelationsByTopic.get(relation.topicId)!.push(relation);
            }

            // Assign top entities to each topic (limit to 10 for performance)
            for (const topic of topics) {
                const entityRelations =
                    entityRelationsByTopic.get(topic.topicId) || [];
                topic.entityReferences = entityRelations
                    .sort((a: any, b: any) => b.relevance - a.relevance)
                    .slice(0, 10)
                    .map((rel: any) => rel.entityName);
            }

            tracker.endOperation(
                "ensureTopicGraphCache.enrichTopicsWithEntities",
                allEntityRelations.length,
                topics.length,
            );
        }

        // Build relationships from parent-child structure
        tracker.startOperation("ensureTopicGraphCache.buildTopicRelationships");
        let relationships = buildTopicRelationships(topics);
        tracker.endOperation(
            "ensureTopicGraphCache.buildTopicRelationships",
            topics.length,
            relationships.length,
        );

        // Add lateral relationships from topic relationships table
        if (websiteCollection.topicRelationships) {
            tracker.startOperation(
                "ensureTopicGraphCache.getLateralRelationships",
            );
            const topicIds = new Set(topics.map((t: any) => t.topicId));
            const topicIdsArray = Array.from(topicIds);

            // Use optimized query that filters at database level
            const allRels =
                websiteCollection.topicRelationships.getRelationshipsForTopicsOptimized(
                    topicIdsArray,
                    0.3, // Only get relationships with strength >= 0.3 for better performance
                );

            // Convert to our format - no need to filter since DB already filtered
            const lateralRels: any[] = allRels.map((rel: any) => ({
                from: rel.fromTopic,
                to: rel.toTopic,
                type: rel.relationshipType,
                strength: rel.strength,
            }));

            // Deduplicate lateral relationships
            const relKeys = new Set<string>();
            for (const rel of lateralRels) {
                const key = `${rel.from}|${rel.to}|${rel.type}`;
                if (!relKeys.has(key)) {
                    relKeys.add(key);
                    relationships.push(rel);
                }
            }
            tracker.endOperation(
                "ensureTopicGraphCache.getLateralRelationships",
                allRels.length,
                lateralRels.length,
            );
        }

        // Get entity counts for topics from topic-entity relations
        const topicMetricsInput = topics.map((topic: any) => ({
            topicId: topic.topicId,
            entityCount: topic.entityReferences?.length || 0,
        }));

        // Calculate topic importance metrics
        tracker.startOperation(
            "ensureTopicGraphCache.calculateTopicImportance",
        );
        const topicMetrics = calculateTopicImportance(
            topics,
            relationships,
            topicMetricsInput,
        );
        tracker.endOperation(
            "ensureTopicGraphCache.calculateTopicImportance",
            topics.length,
            topicMetrics.length,
        );

        // Store in cache
        const newCache: TopicGraphCache = {
            topics: topics,
            relationships: relationships,
            topicMetrics: topicMetrics,
            lastUpdated: Date.now(),
            isValid: true,
        };

        setTopicGraphCache(websiteCollection, newCache);

        tracker.endOperation(
            "ensureTopicGraphCache",
            topics.length + relationships.length,
            topics.length,
        );
        tracker.printReport("ensureTopicGraphCache");
    } catch (error) {
        console.error("[Topic Graph] Failed to build cache:", error);
        tracker.endOperation("ensureTopicGraphCache", 0, 0);

        // Mark cache as invalid
        const existingCache = getTopicGraphCache(websiteCollection);
        if (existingCache) {
            existingCache.isValid = false;
        }
    }
}

// Ensure graph data is cached for fast access
async function ensureGraphCache(websiteCollection: any): Promise<void> {
    const cache = getGraphCache(websiteCollection);

    // Check if cache is valid (no TTL - only invalidated on rebuild)
    if (cache && cache.isValid) {
        debug("[Knowledge Graph] Using valid cached graph data");
        return;
    }

    debug("[Knowledge Graph] Building in-memory cache for graph data");

    const tracker = getPerformanceTracker();
    tracker.startOperation("ensureGraphCache");

    try {
        // Fetch raw data with instrumentation and batch optimization
        tracker.startOperation("ensureGraphCache.getTopEntities");
        const rawEntities =
            (websiteCollection.knowledgeEntities as any)?.getTopEntities(
                5000,
            ) || [];
        // Validate and clean entity data
        const entities = rawEntities;

        tracker.endOperation(
            "ensureGraphCache.getTopEntities",
            entities.length,
            entities.length,
        );

        tracker.startOperation("ensureGraphCache.getAllRelationships");
        const rawRelationships =
            websiteCollection.relationships?.getAllRelationships() || [];

        // Validate and clean relationship data
        const relationships = rawRelationships;

        tracker.endOperation(
            "ensureGraphCache.getAllRelationships",
            relationships.length,
            relationships.length,
        );

        tracker.startOperation("ensureGraphCache.getAllCommunities");
        const communities =
            websiteCollection.communities?.getAllCommunities() || [];
        tracker.endOperation(
            "ensureGraphCache.getAllCommunities",
            communities.length,
            communities.length,
        );

        // Calculate metrics with instrumentation
        tracker.startOperation("ensureGraphCache.calculateEntityMetrics");
        const entityMetrics = calculateEntityMetrics(
            entities,
            relationships,
            communities,
        );
        tracker.endOperation(
            "ensureGraphCache.calculateEntityMetrics",
            entities.length,
            entityMetrics.length,
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

        tracker.endOperation(
            "ensureGraphCache",
            entities.length + relationships.length + communities.length,
            entityMetrics.length,
        );
        tracker.printReport("ensureGraphCache");
    } catch (error) {
        console.error("[Knowledge Graph] Failed to build cache:", error);
        tracker.endOperation("ensureGraphCache", 0, 0);

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
    const tracker = getPerformanceTracker();
    tracker.startOperation("calculateEntityMetrics");

    const entityMap = new Map<string, any>();
    const degreeMap = new Map<string, number>();
    const communityMap = new Map<string, string>();

    tracker.startOperation("calculateEntityMetrics.buildEntityMap");
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
    tracker.endOperation(
        "calculateEntityMetrics.buildEntityMap",
        entities.length,
        entities.length,
    );

    tracker.startOperation("calculateEntityMetrics.buildCommunityMap");
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
    tracker.endOperation(
        "calculateEntityMetrics.buildCommunityMap",
        communities.length,
        communityMap.size,
    );

    tracker.startOperation("calculateEntityMetrics.calculateDegrees");
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
    tracker.endOperation(
        "calculateEntityMetrics.calculateDegrees",
        relationships.length,
        relationships.length,
    );

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

    tracker.startOperation("calculateEntityMetrics.buildResults");
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
    tracker.endOperation(
        "calculateEntityMetrics.buildResults",
        entities.length,
        results.length,
    );

    tracker.endOperation(
        "calculateEntityMetrics",
        entities.length + relationships.length + communities.length,
        results.length,
    );

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

// ============================================================================
// Hierarchical Topics Functions
// ============================================================================

/**
 * Get hierarchical topics from the website collection
 */
export async function getTopicImportanceLayer(
    parameters: {
        maxNodes?: number;
        minImportanceThreshold?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    topics: any[];
    relationships: any[];
    metadata: any;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                topics: [],
                relationships: [],
                metadata: {
                    totalTopicsInSystem: 0,
                    selectedTopicCount: 0,
                    coveragePercentage: 0,
                    importanceThreshold: 0,
                    layer: "topic_importance",
                },
            };
        }

        if (!websiteCollection.hierarchicalTopics) {
            return {
                topics: [],
                relationships: [],
                metadata: {
                    error: "Hierarchical topics not available",
                    layer: "topic_importance",
                },
            };
        }

        await ensureTopicGraphCache(websiteCollection);

        const cache = getTopicGraphCache(websiteCollection);
        if (!cache || !cache.isValid) {
            return {
                topics: [],
                relationships: [],
                metadata: {
                    error: "Topic cache not available",
                    layer: "topic_importance",
                },
            };
        }

        const allTopics = cache.topics || [];
        const allRelationships = cache.relationships || [];
        const topicMetrics = cache.topicMetrics || [];

        if (allTopics.length === 0) {
            return {
                topics: [],
                relationships: [],
                metadata: {
                    totalTopicsInSystem: 0,
                    selectedTopicCount: 0,
                    coveragePercentage: 0,
                    importanceThreshold: 0,
                    layer: "topic_importance",
                },
            };
        }

        const maxNodes = parameters.maxNodes || 500;

        // Build adjacency maps for BFS
        const childrenMap = new Map<string, string[]>();
        const parentMap = new Map<string, string>();
        const topicMap = new Map<string, any>();
        const metricsMap = new Map<string, any>();

        allTopics.forEach((topic: any) => {
            topicMap.set(topic.topicId, topic);
            if (!childrenMap.has(topic.topicId)) {
                childrenMap.set(topic.topicId, []);
            }
            if (topic.parentTopicId) {
                parentMap.set(topic.topicId, topic.parentTopicId);
                if (!childrenMap.has(topic.parentTopicId)) {
                    childrenMap.set(topic.parentTopicId, []);
                }
                childrenMap.get(topic.parentTopicId)!.push(topic.topicId);
            }
        });

        topicMetrics.forEach((metric: any) => {
            metricsMap.set(metric.topicId, metric);
        });

        // BFS-based balanced selection
        const selectedTopicIds = new Set<string>();
        const rootTopics = allTopics.filter((t: any) => !t.parentTopicId);

        // Sort root topics by importance
        const sortedRoots = rootTopics.sort((a: any, b: any) => {
            const importanceA = metricsMap.get(a.topicId)?.importance || 0;
            const importanceB = metricsMap.get(b.topicId)?.importance || 0;
            return importanceB - importanceA;
        });

        // Start with all roots
        const queue: Array<{ id: string; depth: number }> = [];
        sortedRoots.forEach((root: any) => {
            if (selectedTopicIds.size < maxNodes) {
                selectedTopicIds.add(root.topicId);
                queue.push({ id: root.topicId, depth: 0 });
            }
        });

        // First pass: ensure each root gets at least one child
        const rootsWithChildren = new Set<string>();
        sortedRoots.forEach((root: any) => {
            if (selectedTopicIds.size >= maxNodes) return;
            const children = childrenMap.get(root.topicId) || [];
            if (children.length > 0) {
                const sortedChildren = children
                    .map((id) => ({
                        id,
                        importance: metricsMap.get(id)?.importance || 0,
                    }))
                    .sort((a, b) => b.importance - a.importance);

                // Add at least one child for this root
                const firstChild = sortedChildren[0];
                if (firstChild && !selectedTopicIds.has(firstChild.id)) {
                    selectedTopicIds.add(firstChild.id);
                    queue.push({ id: firstChild.id, depth: 1 });
                }
                rootsWithChildren.add(root.topicId);
            }
        });

        // BFS to expand around roots, level by level
        while (queue.length > 0 && selectedTopicIds.size < maxNodes) {
            const { id: currentId, depth } = queue.shift()!;
            const children = childrenMap.get(currentId) || [];

            // Sort children by importance
            const sortedChildren = children
                .map((id) => ({
                    id,
                    importance: metricsMap.get(id)?.importance || 0,
                }))
                .sort((a, b) => b.importance - a.importance);

            for (const { id } of sortedChildren) {
                if (selectedTopicIds.size >= maxNodes) break;
                if (!selectedTopicIds.has(id)) {
                    selectedTopicIds.add(id);
                    queue.push({ id, depth: depth + 1 });
                }
            }
        }

        // If still under maxNodes, add remaining high-importance topics
        // and connect orphaned nodes to the graph
        if (selectedTopicIds.size < maxNodes) {
            const sortedMetrics = topicMetrics
                .filter((m: any) => !selectedTopicIds.has(m.topicId))
                .sort((a, b) => (b.importance || 0) - (a.importance || 0));

            const remaining = maxNodes - selectedTopicIds.size;

            for (
                let i = 0;
                i < Math.min(remaining, sortedMetrics.length);
                i++
            ) {
                const topicId = sortedMetrics[i].topicId;

                // Check if this topic has any neighbors in the selected set
                const hasNeighbors = (() => {
                    // Check if parent is in set
                    const parent = parentMap.get(topicId);
                    if (parent && selectedTopicIds.has(parent)) return true;

                    // Check if any children are in set
                    const children = childrenMap.get(topicId) || [];
                    return children.some((childId) =>
                        selectedTopicIds.has(childId),
                    );
                })();

                if (!hasNeighbors) {
                    // Find path to existing node by traversing up to root
                    const pathToRoot: string[] = [];
                    let currentId = topicId;

                    while (
                        currentId &&
                        !selectedTopicIds.has(currentId) &&
                        pathToRoot.length < 10
                    ) {
                        pathToRoot.push(currentId);
                        const parent = parentMap.get(currentId);
                        if (!parent) break; // Reached root
                        currentId = parent;
                    }

                    // If we found a connection, add the path
                    if (selectedTopicIds.has(currentId)) {
                        // Add nodes in reverse order (from existing node down to new node)
                        for (
                            let j = pathToRoot.length - 1;
                            j >= 0 && selectedTopicIds.size < maxNodes;
                            j--
                        ) {
                            selectedTopicIds.add(pathToRoot[j]);
                        }
                    } else {
                        // Just add the node even if orphaned
                        selectedTopicIds.add(topicId);
                    }
                } else {
                    // Already connected, just add it
                    selectedTopicIds.add(topicId);
                }
            }
        }

        const selectedMetrics = topicMetrics.filter((m: any) =>
            selectedTopicIds.has(m.topicId),
        );

        const selectedTopics = allTopics.filter((t: any) =>
            selectedTopicIds.has(t.topicId),
        );

        const selectedRelationships = allRelationships.filter(
            (rel: any) =>
                selectedTopicIds.has(rel.from) && selectedTopicIds.has(rel.to),
        );

        const topicsWithMetrics = selectedTopics.map((topic: any) => {
            const metrics = selectedMetrics.find(
                (m: any) => m.topicId === topic.topicId,
            );
            return {
                ...topic,
                importance: metrics?.importance || 0,
                pageRank: metrics?.pageRank || 0,
                betweenness: metrics?.betweenness || 0,
                descendantCount: metrics?.descendantCount || 0,
            };
        });

        const metadata = {
            totalTopicsInSystem: allTopics.length,
            selectedTopicCount: selectedTopics.length,
            coveragePercentage:
                (selectedTopics.length / allTopics.length) * 100,
            importanceThreshold:
                selectedMetrics[selectedMetrics.length - 1]?.importance || 0,
            layer: "topic_importance",
        };

        return {
            topics: topicsWithMetrics,
            relationships: selectedRelationships,
            metadata,
        };
    } catch (error) {
        console.error("Error getting topic importance layer:", error);
        return {
            topics: [],
            relationships: [],
            metadata: {
                error: error instanceof Error ? error.message : "Unknown error",
                layer: "topic_importance",
            },
        };
    }
}

/**
 * Get viewport-based topic neighborhood expansion
 * Similar to entity graph neighborhood, but for topics
 */
export async function getTopicViewportNeighborhood(
    parameters: {
        centerTopic: string;
        viewportTopicIds: string[];
        maxNodes?: number;
        maxDepth?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    topics: any[];
    relationships: any[];
    metadata: any;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                topics: [],
                relationships: [],
                metadata: {
                    error: "Website collection not available",
                    layer: "viewport_neighborhood",
                },
            };
        }

        // Ensure cache is populated
        await ensureTopicGraphCache(websiteCollection);

        // Get cached data
        const cache = getTopicGraphCache(websiteCollection);
        if (!cache || !cache.isValid) {
            return {
                topics: [],
                relationships: [],
                metadata: {
                    error: "Topic cache not available",
                    layer: "viewport_neighborhood",
                },
            };
        }

        const allTopics = cache.topics || [];
        const topicMetrics = cache.topicMetrics || [];
        const maxNodes = parameters.maxNodes || 200;
        const maxDepth = parameters.maxDepth || 3;

        // Find center topic
        const centerTopicData = allTopics.find(
            (t: any) =>
                t.topicId?.toLowerCase() ===
                    parameters.centerTopic.toLowerCase() ||
                t.topicName?.toLowerCase() ===
                    parameters.centerTopic.toLowerCase(),
        );

        if (!centerTopicData) {
            return {
                topics: [],
                relationships: [],
                metadata: {
                    error: "Center topic not found",
                    layer: "viewport_neighborhood",
                },
            };
        }

        // Find viewport topics
        const viewportTopics: any[] = [];
        const viewportIdsLower = (parameters.viewportTopicIds || []).map((id) =>
            id.toLowerCase(),
        );

        for (const topicId of viewportIdsLower) {
            const topic = allTopics.find(
                (t: any) =>
                    t.topicId?.toLowerCase() === topicId ||
                    t.topicName?.toLowerCase() === topicId,
            );
            if (topic) {
                viewportTopics.push(topic);
            }
        }

        // Build adjacency map (parent-child relationships)
        const childrenMap = new Map<string, any[]>();
        const parentMap = new Map<string, any>();

        allTopics.forEach((topic: any) => {
            if (topic.parentTopicId) {
                if (!childrenMap.has(topic.parentTopicId)) {
                    childrenMap.set(topic.parentTopicId, []);
                }
                childrenMap.get(topic.parentTopicId)!.push(topic);
                parentMap.set(topic.topicId, topic.parentTopicId);
            }
        });

        // Get topic importance
        const topicImportanceMap = new Map<string, number>();
        topicMetrics.forEach((metric: any) => {
            topicImportanceMap.set(metric.topicId, metric.importance || 0.5);
        });

        // Start with center and viewport topics
        const initialTopics = [centerTopicData, ...viewportTopics];
        const visited = new Set<string>();
        const result: any[] = [];

        // Add all initial topics
        initialTopics.forEach((topic) => {
            if (!visited.has(topic.topicId)) {
                visited.add(topic.topicId);
                result.push(topic);
            }
        });

        // BFS to expand neighborhood
        type QueueItem = {
            topic: any;
            depth: number;
        };
        const queue: QueueItem[] = [];

        // Add children and parents of initial topics
        initialTopics.forEach((topic) => {
            // Add children
            const children = childrenMap.get(topic.topicId) || [];
            children.forEach((child) => {
                if (!visited.has(child.topicId)) {
                    queue.push({ topic: child, depth: 1 });
                }
            });

            // Add parent
            const parentId = parentMap.get(topic.topicId);
            if (parentId) {
                const parent = allTopics.find(
                    (t: any) => t.topicId === parentId,
                );
                if (parent && !visited.has(parent.topicId)) {
                    queue.push({ topic: parent, depth: 1 });
                }
            }
        });

        // Sort by importance
        queue.sort((a, b) => {
            const impA = topicImportanceMap.get(a.topic.topicId) || 0;
            const impB = topicImportanceMap.get(b.topic.topicId) || 0;
            return impB - impA;
        });

        // Expand neighborhood
        while (queue.length > 0 && result.length < maxNodes) {
            const current = queue.shift()!;

            if (visited.has(current.topic.topicId)) continue;
            if (current.depth > maxDepth) continue;

            visited.add(current.topic.topicId);
            result.push(current.topic);

            // Add children of this topic
            const children = childrenMap.get(current.topic.topicId) || [];
            children.forEach((child) => {
                if (!visited.has(child.topicId)) {
                    queue.push({ topic: child, depth: current.depth + 1 });
                }
            });

            // Add parent
            const parentId = parentMap.get(current.topic.topicId);
            if (parentId) {
                const parent = allTopics.find(
                    (t: any) => t.topicId === parentId,
                );
                if (parent && !visited.has(parent.topicId)) {
                    queue.push({ topic: parent, depth: current.depth + 1 });
                }
            }

            // Re-sort by importance
            queue.sort((a, b) => {
                const impA = topicImportanceMap.get(a.topic.topicId) || 0;
                const impB = topicImportanceMap.get(b.topic.topicId) || 0;
                return impB - impA;
            });
        }

        // Build relationships for returned topics
        const relationships = buildTopicRelationships(result);

        return {
            topics: result,
            relationships: relationships,
            metadata: {
                layer: "viewport_neighborhood",
                centerTopic: centerTopicData.topicName,
                viewportTopicCount: viewportTopics.length,
                totalTopicsReturned: result.length,
                maxDepth: maxDepth,
            },
        };
    } catch (error) {
        debug("[Topic Viewport Neighborhood] Error:", error);
        return {
            topics: [],
            relationships: [],
            metadata: {
                error: String(error),
                layer: "viewport_neighborhood",
            },
        };
    }
}

/**
 * Build relationships from hierarchical topic parent-child structure
 */
function buildTopicRelationships(topics: any[]): any[] {
    const relationships: any[] = [];

    for (const topic of topics) {
        if (topic.parentTopicId) {
            relationships.push({
                from: topic.parentTopicId,
                to: topic.topicId,
                type: "parent-child",
                strength: topic.confidence || 0.8,
            });
        }
    }

    return relationships;
}

/**
 * Get topic metrics for a specific topic
 */
export async function getTopicMetrics(
    parameters: {
        topicId: string;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    metrics?: any;
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

        if (!websiteCollection.topicMetrics) {
            return {
                success: false,
                error: "Topic metrics not available",
            };
        }

        const metrics = websiteCollection.topicMetrics.getMetrics(
            parameters.topicId,
        );

        if (!metrics) {
            return {
                success: false,
                error: "Topic metrics not found for this topic",
            };
        }

        return {
            success: true,
            metrics,
        };
    } catch (error) {
        console.error("Error getting topic metrics:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

/**
 * Get per-URL breakdown of knowledge graph content
 * Shows how many topics, entities, semanticrefs, and relationships are associated with each URL
 */
export async function getUrlContentBreakdown(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    breakdown?: Array<{
        url: string;
        topicCount: number;
        entityCount: number;
        semanticRefCount: number;
        relationshipCount: number;
        totalItems: number;
    }>;
    summary?: {
        totalUrls: number;
        totalTopics: number;
        totalEntities: number;
        totalSemanticRefs: number;
        totalRelationships: number;
        avgTopicsPerUrl: number;
        avgEntitiesPerUrl: number;
        avgSemanticRefsPerUrl: number;
        avgRelationshipsPerUrl: number;
    };
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

        const tracker = getPerformanceTracker();
        tracker.startOperation("getUrlContentBreakdown");

        const urlStats = new Map<
            string,
            {
                topicCount: number;
                entityCount: number;
                semanticRefCount: number;
                relationshipCount: number;
            }
        >();

        // Count topics per URL
        tracker.startOperation("getUrlContentBreakdown.countTopics");
        if (websiteCollection.hierarchicalTopics) {
            try {
                const topics =
                    websiteCollection.hierarchicalTopics.getTopicHierarchy() ||
                    [];
                for (const topic of topics) {
                    const url = topic.url;
                    if (!urlStats.has(url)) {
                        urlStats.set(url, {
                            topicCount: 0,
                            entityCount: 0,
                            semanticRefCount: 0,
                            relationshipCount: 0,
                        });
                    }
                    urlStats.get(url)!.topicCount++;
                }
                tracker.endOperation(
                    "getUrlContentBreakdown.countTopics",
                    topics.length,
                    urlStats.size,
                );
            } catch (error) {
                console.warn("Failed to count topics per URL:", error);
                tracker.endOperation(
                    "getUrlContentBreakdown.countTopics",
                    0,
                    0,
                );
            }
        }

        // Count entities per URL
        tracker.startOperation("getUrlContentBreakdown.countEntities");
        if (websiteCollection.knowledgeEntities) {
            try {
                const entities =
                    (websiteCollection.knowledgeEntities as any).getTopEntities(
                        10000,
                    ) || [];
                for (const entity of entities) {
                    const sources = entity.sources || [];
                    const sourceUrls =
                        typeof sources === "string"
                            ? JSON.parse(sources)
                            : sources;
                    for (const url of sourceUrls) {
                        if (!urlStats.has(url)) {
                            urlStats.set(url, {
                                topicCount: 0,
                                entityCount: 0,
                                semanticRefCount: 0,
                                relationshipCount: 0,
                            });
                        }
                        urlStats.get(url)!.entityCount++;
                    }
                }
                tracker.endOperation(
                    "getUrlContentBreakdown.countEntities",
                    entities.length,
                    urlStats.size,
                );
            } catch (error) {
                console.warn("Failed to count entities per URL:", error);
                tracker.endOperation(
                    "getUrlContentBreakdown.countEntities",
                    0,
                    0,
                );
            }
        }

        // Count semantic refs per URL - TODO: implement when URL association is available
        tracker.startOperation("getUrlContentBreakdown.countSemanticRefs");
        // SemanticRef interface doesn't directly contain URL info - skip for now
        const semanticRefCount = websiteCollection.semanticRefs
            ? websiteCollection.semanticRefs.getAll().length
            : 0;
        tracker.endOperation(
            "getUrlContentBreakdown.countSemanticRefs",
            semanticRefCount,
            0,
        );

        // Count relationships per URL
        tracker.startOperation("getUrlContentBreakdown.countRelationships");
        if (websiteCollection.relationships) {
            try {
                const relationships =
                    websiteCollection.relationships.getAllRelationships() || [];
                for (const rel of relationships) {
                    const sources = rel.sources || [];
                    const sourceUrls =
                        typeof sources === "string"
                            ? JSON.parse(sources)
                            : Array.isArray(sources)
                              ? sources
                              : [];
                    for (const url of sourceUrls) {
                        if (!urlStats.has(url)) {
                            urlStats.set(url, {
                                topicCount: 0,
                                entityCount: 0,
                                semanticRefCount: 0,
                                relationshipCount: 0,
                            });
                        }
                        urlStats.get(url)!.relationshipCount++;
                    }
                }
                tracker.endOperation(
                    "getUrlContentBreakdown.countRelationships",
                    relationships.length,
                    urlStats.size,
                );
            } catch (error) {
                console.warn("Failed to count relationships per URL:", error);
                tracker.endOperation(
                    "getUrlContentBreakdown.countRelationships",
                    0,
                    0,
                );
            }
        }

        // Build breakdown array
        const breakdown = Array.from(urlStats.entries())
            .map(([url, stats]: [string, any]) => ({
                url,
                topicCount: stats.topicCount,
                entityCount: stats.entityCount,
                semanticRefCount: stats.semanticRefCount,
                relationshipCount: stats.relationshipCount,
                totalItems:
                    stats.topicCount +
                    stats.entityCount +
                    stats.semanticRefCount +
                    stats.relationshipCount,
            }))
            .sort((a: any, b: any) => b.totalItems - a.totalItems);

        // Calculate summary statistics
        const summary = {
            totalUrls: breakdown.length,
            totalTopics: breakdown.reduce((sum, b) => sum + b.topicCount, 0),
            totalEntities: breakdown.reduce((sum, b) => sum + b.entityCount, 0),
            totalSemanticRefs: breakdown.reduce(
                (sum, b) => sum + b.semanticRefCount,
                0,
            ),
            totalRelationships: breakdown.reduce(
                (sum, b) => sum + b.relationshipCount,
                0,
            ),
            avgTopicsPerUrl:
                breakdown.length > 0
                    ? breakdown.reduce((sum, b) => sum + b.topicCount, 0) /
                      breakdown.length
                    : 0,
            avgEntitiesPerUrl:
                breakdown.length > 0
                    ? breakdown.reduce((sum, b) => sum + b.entityCount, 0) /
                      breakdown.length
                    : 0,
            avgSemanticRefsPerUrl:
                breakdown.length > 0
                    ? breakdown.reduce(
                          (sum, b) => sum + b.semanticRefCount,
                          0,
                      ) / breakdown.length
                    : 0,
            avgRelationshipsPerUrl:
                breakdown.length > 0
                    ? breakdown.reduce(
                          (sum, b) => sum + b.relationshipCount,
                          0,
                      ) / breakdown.length
                    : 0,
        };

        tracker.endOperation(
            "getUrlContentBreakdown",
            urlStats.size,
            breakdown.length,
        );
        tracker.printReport("getUrlContentBreakdown");

        debug(`[URL Content Breakdown] Analyzed ${summary.totalUrls} URLs`);
        debug(
            `[URL Content Breakdown] Total items - Topics: ${summary.totalTopics}, Entities: ${summary.totalEntities}, SemanticRefs: ${summary.totalSemanticRefs}, Relationships: ${summary.totalRelationships}`,
        );

        return {
            success: true,
            breakdown,
            summary,
        };
    } catch (error) {
        console.error("Error getting URL content breakdown:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
