// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";
import { GraphCache } from "../types/knowledgeTypes.mjs";
import type {
    MemoryKnowledgeGraph,
    MemorySource,
} from "@typeagent/memory-service";
import type { BrowserMemoryService } from "../../browserMemoryService.mjs";
import { getPerformanceTracker } from "../utils/performanceInstrumentation.mjs";
import {
    buildGraphologyGraph,
    convertToCytoscapeElements,
    calculateLayoutQualityMetrics,
    type GraphNode,
    type GraphEdge,
} from "../utils/graphologyLayoutEngine.mjs";
import {
    getGraphologyCache,
    setGraphologyCache,
    createGraphologyCache,
    invalidateAllGraphologyCaches,
} from "../utils/graphologyCache.mjs";
import registerDebug from "debug";

// ============================================================================
// Topic Timeline Types
// ============================================================================

export interface TopicActivity {
    timestamp: string;
    activityType: "bookmark" | "visit" | "extraction";
    url: string;
    title: string;
    domain: string;
    relevance: number;
    snippet?: string | undefined;
    knowledgeChunk?: string | undefined;
    metadata?: {
        visitCount?: number;
        confidence?: number;
        extractionDate?: string;
    };
}

export interface TopicTimeline {
    topicName: string;
    topicId?: string;
    totalActivity: number;
    activities: TopicActivity[];
    relatedTopics: string[];
    activityDistribution: {
        bookmarks: number;
        visits: number;
        extractions: number;
    };
}

export interface TopicTimelineResponse {
    success: boolean;
    timelines: TopicTimeline[];
    metadata: {
        totalEntries: number;
        timeRange: { earliest: string; latest: string };
        topicsWithActivity: number;
    };
    error?: string;
}

const debug = registerDebug("typeagent:browser:knowledge:graph");

// ============================================================================
// Cache Management Functions (moved up to avoid "Cannot find name" errors)
// ============================================================================

// Graphology Integration Helper Functions
async function cacheGraphologyGraphs(
    entityGraph: any,
    topicGraph: any,
    metadata: any,
): Promise<void> {
    // Convert Graphology graphs to Cytoscape elements for caching
    const entityElements = convertToCytoscapeElements(entityGraph);
    const topicElements = convertToCytoscapeElements(topicGraph);

    // Create cache entries with proper parameters
    const entityCache = createGraphologyCache(
        entityGraph,
        entityElements,
        metadata.buildTime || 0,
        100,
    );
    const topicCache = createGraphologyCache(
        topicGraph,
        topicElements,
        metadata.buildTime || 0,
        100,
    );

    // Store in cache with appropriate keys
    setGraphologyCache("entity_default", entityCache);
    setGraphologyCache("topic_default", topicCache);

    debug(
        "[Graphology Cache] Cached entity graph with",
        entityGraph.order,
        "nodes",
        entityGraph.size,
        "edges",
    );
    debug(
        "[Graphology Cache] Cached topic graph with",
        topicGraph.order,
        "nodes",
        topicGraph.size,
        "edges",
    );
}

function getGraphCache(agentContext: BrowserActionContext): GraphCache | null {
    return agentContext.graphCache ?? null;
}

function setGraphCache(
    agentContext: BrowserActionContext,
    cache: GraphCache,
): void {
    agentContext.graphCache = cache;
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
        const from = rel.source || rel.fromEntity;
        const to = rel.target || rel.toEntity;

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

// Ensure graph data is cached for fast access - now loads from JSON storage
async function ensureGraphCache(
    context: SessionContext<BrowserActionContext>,
): Promise<void> {
    const memoryService = context.agentContext.browserMemoryService;
    if (memoryService === undefined) {
        throw new Error("Durable browser memory is not available");
    }

    const cache = getGraphCache(context.agentContext);
    const sourceVersion = memoryService.getGraphVersion();

    if (cache?.isValid && cache.sourceVersion === sourceVersion) {
        debug("[Knowledge Graph] Using valid cached graph data");
        return;
    }

    debug("[Knowledge Graph] Building in-memory cache from Graphology data");

    const tracker = getPerformanceTracker();
    tracker.startOperation("ensureGraphCache");

    try {
        tracker.startOperation("ensureGraphCache.loadDurableGraph");
        const durableGraph = await memoryService.getKnowledgeGraph();
        tracker.endOperation(
            "ensureGraphCache.loadDurableGraph",
            1,
            durableGraph.entities.length,
        );

        const rawEntities: any[] = durableGraph.entities.map((entity) => ({
            name: entity.name,
            id: entity.name,
            type: entity.types[0] ?? "entity",
            entityType: entity.types,
            confidence: 1,
            count: entity.mentionCount,
            websites: entity.sourceIds,
        }));
        const relationships: any[] = durableGraph.relationships.map(
            (relationship) => ({
                fromEntity: relationship.fromEntity,
                toEntity: relationship.toEntity,
                source: relationship.fromEntity,
                target: relationship.toEntity,
                relationshipType: relationship.relationshipType,
                type: relationship.relationshipType,
                confidence: 1,
                count: relationship.count,
                sourceIds: relationship.sourceIds,
            }),
        );
        const communities: any[] = [];

        debug("[ensureGraphCache] Loaded from durable memory:", {
            entities: rawEntities.length,
            relationships: relationships.length,
        });

        // Calculate metrics with instrumentation
        tracker.startOperation("ensureGraphCache.calculateEntityMetrics");
        const entityMetrics = calculateEntityMetrics(
            rawEntities,
            relationships,
            communities,
        );
        tracker.endOperation(
            "ensureGraphCache.calculateEntityMetrics",
            rawEntities.length,
            entityMetrics.length,
        );

        // Build graphology layout with overlap prevention
        tracker.startOperation("ensureGraphCache.buildGraphologyLayout");
        let presetLayout:
            | {
                  elements: any[];
                  layoutDuration?: number;
                  communityCount?: number;
              }
            | undefined;

        try {
            const layoutStart = Date.now();

            // Convert entities to graph nodes
            const graphNodes: GraphNode[] = entityMetrics.map(
                (entity: any) => ({
                    id: entity.name,
                    name: entity.name,
                    label: entity.name,
                    community: entity.community || 0,
                    importance: entity.importance || 0,
                }),
            );

            // Convert relationships to graph edges - match getGlobalImportanceLayer format
            const graphEdges: GraphEdge[] = relationships.map((rel: any) => ({
                from: rel.source || rel.fromEntity,
                to: rel.target || rel.toEntity,
                type: rel.type || rel.relationshipType,
                confidence: rel.confidence || 0.5,
                strength: rel.confidence || 0.5,
            }));

            // Debug: Check for graphEdges without types in ensureGraphCache
            const edgesWithoutType = graphEdges.filter((edge) => !edge.type);
            if (edgesWithoutType.length > 0) {
                console.log(
                    "[ensureGraphCache] Found graphEdges without type:",
                    {
                        count: edgesWithoutType.length,
                        total: graphEdges.length,
                        samples: edgesWithoutType.slice(0, 3),
                    },
                );
            }

            debug(
                `[Graphology] Building layout for ${graphNodes.length} nodes, ${graphEdges.length} edges`,
            );

            // Build graphology graph with ForceAtlas2 + noverlap
            const graph = buildGraphologyGraph(graphNodes, graphEdges);
            const cytoscapeElements = convertToCytoscapeElements(graph);

            const layoutDuration = Date.now() - layoutStart;
            const communityCount = new Set(
                graphNodes.map((n: any) => n.community),
            ).size;

            presetLayout = {
                elements: cytoscapeElements,
                layoutDuration,
                communityCount,
            };

            debug(
                `[Graphology] Layout computed in ${layoutDuration}ms with ${communityCount} communities`,
            );
        } catch (error) {
            console.error("[Graphology] Failed to build layout:", error);
            // Continue without preset layout - visualizer will fall back to client-side layout
        }

        tracker.endOperation(
            "ensureGraphCache.buildGraphologyLayout",
            entityMetrics.length,
            presetLayout?.elements?.length || 0,
        );

        // Store in cache
        const newCache: GraphCache = {
            entities: rawEntities,
            relationships: relationships,
            communities: communities,
            entityMetrics: entityMetrics,
            presetLayout: presetLayout,
            lastUpdated: Date.now(),
            isValid: true,
            sourceVersion,
        };

        setGraphCache(context.agentContext, newCache);

        debug(
            `[Knowledge Graph] Cached ${rawEntities.length} entities, ${relationships.length} relationships, ${communities.length} communities`,
        );

        tracker.endOperation(
            "ensureGraphCache",
            rawEntities.length + relationships.length + communities.length,
            entityMetrics.length,
        );
        tracker.printReport("ensureGraphCache");
    } catch (error) {
        console.error("[Knowledge Graph] Failed to build cache:", error);
        tracker.endOperation("ensureGraphCache", 0, 0);

        // Mark cache as invalid but keep existing data if available
        const existingCache = getGraphCache(context.agentContext);
        if (existingCache) {
            existingCache.isValid = false;
        }
    }
}

// ============================================================================
// Storage Abstraction Layer
// ============================================================================

/** Get Graphology graphs derived from the durable memory corpus. */
async function getGraphologyGraphs(
    context: SessionContext<BrowserActionContext>,
): Promise<{
    entityGraph?: any;
    topicGraph?: any;
    useGraphology: boolean;
}> {
    const memoryService = context.agentContext.browserMemoryService;
    if (memoryService === undefined) {
        throw new Error("Durable browser memory is not available");
    }

    try {
        const startedAt = Date.now();
        const durableGraph = await memoryService.getKnowledgeGraph();
        const entityGraph = buildGraphologyGraph(
            durableGraph.entities.map((entity) => ({
                id: entity.name,
                name: entity.name,
                type: entity.types[0] ?? "entity",
                count: entity.mentionCount,
                confidence: 1,
            })),
            durableGraph.relationships.map((relationship) => ({
                from: relationship.fromEntity,
                to: relationship.toEntity,
                type: relationship.relationshipType,
                strength: relationship.count,
                confidence: 1,
            })),
        );
        const topicGraph = buildGraphologyGraph(
            durableGraph.topics.map((topic) => ({
                id: topic.name,
                name: topic.name,
                type: "topic",
                count: topic.mentionCount,
                confidence: 1,
            })),
            [],
        );
        await cacheGraphologyGraphs(entityGraph, topicGraph, {
            buildTime: Date.now() - startedAt,
            source: "durable-memory",
        });
        return { entityGraph, topicGraph, useGraphology: true };
    } catch (error) {
        debug(`Error getting Graphology graphs: ${error}`);
        throw new Error(
            `Failed to get Graphology graphs: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
    }
}

/**
 * Get entity statistics from Graphology cache
 */
async function getEntityStatistics(
    context: SessionContext<BrowserActionContext>,
): Promise<{
    entityCount: number;
    relationshipCount: number;
    communityCount: number;
}> {
    try {
        await ensureGraphCache(context);
        const cache = getGraphCache(context.agentContext);

        console.log("[getEntityStatistics] Cache state:", {
            cacheExists: !!cache,
            isValid: cache?.isValid,
            entityMetricsLength: cache?.entityMetrics?.length,
            relationshipsLength: cache?.relationships?.length,
            communitiesLength: cache?.communities?.length,
            entityCount: cache?.entityMetrics?.length || 0,
        });

        if (!cache || !cache.isValid) {
            console.log("[getEntityStatistics] Cache invalid or missing");
            return { entityCount: 0, relationshipCount: 0, communityCount: 0 };
        }

        // Get statistics from Graphology cache
        const entityCount = cache.entityMetrics?.length || 0;
        const relationshipCount = cache.relationships?.length || 0;
        const communityCount = cache.communities?.length || 0;

        console.log("[getEntityStatistics] Final counts:", {
            entityCount,
            relationshipCount,
            communityCount,
        });

        return {
            entityCount,
            relationshipCount,
            communityCount,
        };
    } catch (error) {
        console.error(
            "Error getting entity statistics from Graphology cache:",
            error,
        );
        return { entityCount: 0, relationshipCount: 0, communityCount: 0 };
    }
}

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
        console.log("[getKnowledgeGraphStatus] Starting status check...");

        // Get statistics from Graphology cache
        const { entityCount, relationshipCount, communityCount } =
            await getEntityStatistics(context);

        console.log("[getKnowledgeGraphStatus] Retrieved statistics:", {
            entityCount,
            relationshipCount,
            communityCount,
        });

        // Determine if graph exists based on actual data
        const hasGraph = relationshipCount > 0 || entityCount > 0;

        console.log("[getKnowledgeGraphStatus] Final status:", {
            hasGraph,
            entityCount,
            relationshipCount,
            communityCount,
        });
        debug(
            `Graph status: ${hasGraph ? "exists" : "not found"} - Entities: ${entityCount}, Relationships: ${relationshipCount}, Communities: ${communityCount}`,
        );

        return {
            hasGraph: hasGraph,
            entityCount,
            relationshipCount,
            communityCount,
            isBuilding: false,
        };
    } catch (error) {
        console.error(
            "[getKnowledgeGraphStatus] Error getting graph status:",
            error,
        );
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
        debug(
            "[Knowledge Graph] Starting pure Graphology knowledge graph build with parameters:",
            parameters,
        );

        const startTime = Date.now();

        const { entityGraph, topicGraph } = await getGraphologyGraphs(context);
        if (!entityGraph || !topicGraph) {
            throw new Error("Failed to build graphs from durable memory");
        }
        await ensureGraphCache(context);

        const timeElapsed = Date.now() - startTime;

        // Get stats from the Graphology graphs
        const stats = {
            entitiesFound: entityGraph.order,
            relationshipsCreated: entityGraph.size,
            communitiesDetected: new Set(
                entityGraph.mapNodes((_node: string, attributes: any) =>
                    String(attributes.community ?? "default"),
                ),
            ).size,
            timeElapsed: timeElapsed,
        };

        debug("[Knowledge Graph] Pure Graphology build completed:", stats);

        return {
            success: true,
            message: `Graphology knowledge graph built in ${timeElapsed}ms. Entities: ${stats.entitiesFound}, Relationships: ${stats.relationshipsCreated}, Communities: ${stats.communitiesDetected}`,
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
        debug(
            "[Knowledge Graph] Starting Graphology-only knowledge graph rebuild",
        );

        invalidateAllGraphologyCaches();
        const cache = getGraphCache(context.agentContext);
        if (cache) {
            cache.isValid = false;
        }
        const { entityGraph, topicGraph } = await getGraphologyGraphs(context);
        if (!entityGraph || !topicGraph) {
            throw new Error("Failed to rebuild graphs from durable memory");
        }
        await ensureGraphCache(context);

        debug(
            "[Knowledge Graph] Graphology-only knowledge graph rebuild completed successfully",
        );

        return {
            success: true,
            message: `Knowledge graph rebuilt successfully from durable memory. Entity graph: ${entityGraph.order} nodes, ${entityGraph.size} edges. Topic graph: ${topicGraph.order} nodes, ${topicGraph.size} edges.`,
        };
    } catch (error) {
        console.error("Error rebuilding knowledge graph:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function mergeTopicHierarchies(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    mergeCount: number;
    message?: string;
    error?: string;
}> {
    void parameters;
    void context;
    return {
        success: false,
        mergeCount: 0,
        error: "Topic hierarchy merging is unsupported for durable browser memory because MemoryService does not provide a hierarchy mutation API.",
    };
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
        const { entityId, depth = 2, maxNodes = 100 } = parameters;

        try {
            const { entityGraph } = await getGraphologyGraphs(context);

            if (!entityGraph || !entityGraph.hasNode(entityId)) {
                return {
                    neighbors: [],
                    relationships: [],
                    error: `Entity "${entityId}" not found in graph`,
                };
            }

            debug(
                `[Knowledge Graph] Using Graphology for entity neighborhood "${entityId}" (depth: ${depth}, maxNodes: ${maxNodes})`,
            );

            // Get neighbors from Graphology
            const neighbors = entityGraph.neighbors(entityId);
            const limitedNeighbors = neighbors.slice(0, maxNodes);

            // Get center entity attributes
            const centerAttributes = entityGraph.getNodeAttributes(entityId);

            // Build neighbor entities
            const neighborEntities = limitedNeighbors.map(
                (neighborId: string) => {
                    const attrs = entityGraph.getNodeAttributes(neighborId);
                    return {
                        id: neighborId,
                        name: neighborId,
                        type: attrs.type || "entity",
                        confidence: attrs.confidence || 0.5,
                        count: attrs.count || 1,
                    };
                },
            );

            // Build relationships
            const relationships = limitedNeighbors.map(
                (neighborId: string, index: number) => {
                    const edgeData = entityGraph.getEdgeAttributes(
                        entityGraph.edge(entityId, neighborId),
                    );
                    return {
                        rowId: `${entityId}-${neighborId}`,
                        fromEntity: entityId,
                        toEntity: neighborId,
                        relationshipType: edgeData.type || "co_occurs",
                        confidence: edgeData.confidence || 0.5,
                        sources: [],
                        count: edgeData.count || 1,
                    };
                },
            );

            // Build graphology layout for neighborhood visualization
            debug(
                `[Knowledge Graph] Building graphology layout for entity neighborhood "${entityId}"`,
            );
            const layoutStart = performance.now();

            // Create nodes for layout generation (center entity + neighbors)
            // Use a Map to deduplicate nodes by ID to avoid duplicate node errors
            const nodeMap = new Map<string, any>();

            // Add center entity first
            nodeMap.set(entityId, {
                id: entityId,
                name: entityId,
                type: centerAttributes.type || "entity",
                confidence: centerAttributes.confidence || 0.5,
                count: centerAttributes.count || 1,
                importance: 1.0, // Center entity has highest importance
            });

            // Add neighbors, checking for duplicates
            neighborEntities.forEach((neighbor: any) => {
                if (!nodeMap.has(neighbor.id)) {
                    nodeMap.set(neighbor.id, {
                        id: neighbor.id,
                        name: neighbor.name,
                        type: neighbor.type,
                        confidence: neighbor.confidence,
                        count: neighbor.count,
                        importance: 0.7, // Neighbors have lower importance
                    });
                }
            });

            const allNeighborhoodNodes = Array.from(nodeMap.values());

            debug(
                `[Knowledge Graph] Deduplicating neighborhood nodes: ${neighborEntities.length + 1} -> ${allNeighborhoodNodes.length} unique nodes`,
            );

            // Create edges for layout generation
            const allNeighborhoodEdges = relationships.map((rel: any) => ({
                from: rel.fromEntity,
                to: rel.toEntity,
                type: rel.relationshipType,
                confidence: rel.confidence,
                strength: rel.confidence,
            }));

            // Build the graphology graph with layout
            const neighborhoodGraph = buildGraphologyGraph(
                allNeighborhoodNodes,
                allNeighborhoodEdges,
                {
                    nodeLimit: maxNodes + 1, // +1 for center entity
                    minEdgeConfidence: 0.1, // Lower threshold for neighborhood views
                    denseClusterThreshold: 50,
                    forceAtlas2Iterations: 100,
                    noverlapIterations: 500,
                    targetViewportSize: 1500,
                    skipEdgeFiltering: true, // Include all edges for entity neighborhoods
                },
            );

            // Convert to Cytoscape elements for UI consumption
            const cytoscapeElements = convertToCytoscapeElements(
                neighborhoodGraph,
                1500,
            );
            const layoutMetrics =
                calculateLayoutQualityMetrics(neighborhoodGraph);
            const layoutDuration = performance.now() - layoutStart;

            debug(
                `[Knowledge Graph] Neighborhood layout complete in ${layoutDuration.toFixed(2)}ms with ${cytoscapeElements.length} elements`,
            );

            return {
                centerEntity: {
                    id: entityId,
                    name: entityId,
                    type: centerAttributes.type || "entity",
                    confidence: centerAttributes.confidence || 0.5,
                    count: centerAttributes.count || 1,
                },
                neighbors: neighborEntities,
                relationships: relationships,
                searchData: {
                    relatedEntities: [],
                    topTopics: [],
                    websites: [],
                },
                metadata: {
                    source: "graphology",
                    queryDepth: depth,
                    maxNodes: maxNodes,
                    actualNodes: neighborEntities.length + 1,
                    actualEdges: relationships.length,
                    graphologyLayout: {
                        elements: cytoscapeElements,
                        layoutDuration: layoutDuration,
                        avgSpacing: layoutMetrics.avgSpacing,
                        communityCount: 1, // Neighborhood views typically have one community
                    },
                },
            };
        } catch (graphologyError) {
            debug(
                `[Graphology] Failed to get entity neighborhood: ${graphologyError}`,
            );

            return {
                neighbors: [],
                relationships: [],
                error: `Failed to get entity neighborhood: ${graphologyError}`,
            };
        }
    } catch (error) {
        console.error("Error getting entity neighborhood:", error);
        return {
            neighbors: [],
            relationships: [],
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

/**
 * Get entity neighborhood layout data only (Phase 2 optimization)
 * Returns only the graphology layout without raw neighbors/relationships
 */
export async function getEntityNeighborhoodLayoutData(
    parameters: {
        entityId: string;
        depth?: number;
        maxNodes?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
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
}> {
    try {
        const { entityId, depth = 2, maxNodes = 100 } = parameters;

        const { entityGraph } = await getGraphologyGraphs(context);

        if (!entityGraph || !entityGraph.hasNode(entityId)) {
            return {
                graphologyLayout: {
                    elements: [],
                    layoutDuration: 0,
                    avgSpacing: 0,
                    communityCount: 0,
                },
                metadata: {
                    entityId: parameters.entityId,
                    queryDepth: parameters.depth || 2,
                    maxNodes: parameters.maxNodes || 100,
                    actualNodes: 0,
                    actualEdges: 0,
                    layer: "entity_neighborhood",
                    source: "graphology",
                },
            };
        }

        try {
            debug(
                `[Knowledge Graph] Using Graphology for entity neighborhood layout "${entityId}" (depth: ${depth}, maxNodes: ${maxNodes})`,
            );

            // Get neighbors from Graphology
            const neighbors = entityGraph.neighbors(entityId);
            const limitedNeighbors = neighbors.slice(0, maxNodes);

            // Get center entity attributes
            const centerAttributes = entityGraph.getNodeAttributes(entityId);

            // Build relationships for layout generation
            const relationships = limitedNeighbors.map(
                (neighborId: string, index: number) => {
                    const edgeData = entityGraph.getEdgeAttributes(
                        entityGraph.edge(entityId, neighborId),
                    );
                    return {
                        from: entityId,
                        to: neighborId,
                        type: edgeData.type || "co_occurs",
                        confidence: edgeData.confidence || 0.5,
                        strength: edgeData.confidence || 0.5,
                    };
                },
            );

            // Build graphology layout for neighborhood visualization
            debug(
                `[Knowledge Graph] Building optimized layout for entity neighborhood "${entityId}"`,
            );
            const layoutStart = performance.now();

            // Create nodes for layout generation (center entity + neighbors)
            const nodeMap = new Map<string, any>();

            // Add center entity first
            nodeMap.set(entityId, {
                id: entityId,
                name: entityId,
                type: centerAttributes.type || "entity",
                confidence: centerAttributes.confidence || 0.5,
                count: centerAttributes.count || 1,
                importance: 1.0, // Center entity has highest importance
            });

            // Add neighbors, checking for duplicates
            limitedNeighbors.forEach((neighborId: string) => {
                if (!nodeMap.has(neighborId)) {
                    const attrs = entityGraph.getNodeAttributes(neighborId);
                    nodeMap.set(neighborId, {
                        id: neighborId,
                        name: neighborId,
                        type: attrs.type || "entity",
                        confidence: attrs.confidence || 0.5,
                        count: attrs.count || 1,
                        importance: 0.7, // Neighbors have lower importance
                    });
                }
            });

            const allNeighborhoodNodes = Array.from(nodeMap.values());

            debug(
                `[Knowledge Graph] Layout-only neighborhood: ${allNeighborhoodNodes.length} unique nodes, ${relationships.length} edges`,
            );

            // Build the graphology graph with layout
            const neighborhoodGraph = buildGraphologyGraph(
                allNeighborhoodNodes,
                relationships,
                {
                    nodeLimit: maxNodes + 1, // +1 for center entity
                    minEdgeConfidence: 0.1, // Lower threshold for neighborhood views
                    denseClusterThreshold: 50,
                    forceAtlas2Iterations: 100,
                    noverlapIterations: 500,
                    targetViewportSize: 1500,
                    skipEdgeFiltering: true, // Include all edges for entity neighborhoods
                },
            );

            // Convert to Cytoscape elements for UI consumption
            const cytoscapeElements = convertToCytoscapeElements(
                neighborhoodGraph,
                1500,
            );
            const layoutMetrics =
                calculateLayoutQualityMetrics(neighborhoodGraph);
            const layoutDuration = performance.now() - layoutStart;

            debug(
                `[Knowledge Graph] Optimized neighborhood layout complete in ${layoutDuration.toFixed(2)}ms with ${cytoscapeElements.length} elements`,
            );

            return {
                graphologyLayout: {
                    elements: cytoscapeElements,
                    layoutDuration: layoutDuration,
                    avgSpacing: layoutMetrics.avgSpacing,
                    communityCount: 1, // Neighborhood views typically have one community
                },
                metadata: {
                    entityId: entityId,
                    queryDepth: depth,
                    maxNodes: maxNodes,
                    actualNodes: allNeighborhoodNodes.length,
                    actualEdges: relationships.length,
                    layer: "entity_neighborhood",
                    source: "graphology",
                },
            };
        } catch (graphologyError) {
            debug(
                `[Graphology] Failed to get entity neighborhood layout: ${graphologyError}`,
            );

            return {
                graphologyLayout: {
                    elements: [],
                    layoutDuration: 0,
                    avgSpacing: 0,
                    communityCount: 0,
                },
                metadata: {
                    entityId: entityId,
                    queryDepth: depth,
                    maxNodes: maxNodes,
                    actualNodes: 0,
                    actualEdges: 0,
                    layer: "entity_neighborhood",
                    source: "graphology",
                },
            };
        }
    } catch (error) {
        console.error("Error getting entity neighborhood layout:", error);
        return {
            graphologyLayout: {
                elements: [],
                layoutDuration: 0,
                avgSpacing: 0,
                communityCount: 0,
            },
            metadata: {
                entityId: parameters.entityId,
                queryDepth: parameters.depth || 2,
                maxNodes: parameters.maxNodes || 100,
                actualNodes: 0,
                actualEdges: 0,
                layer: "entity_neighborhood",
                source: "graphology",
            },
        };
    }
}

/**
 * Discover related entities and topics from the knowledge graph
 * Performs multi-hop graph traversal to find connected knowledge
 */
async function loadDurableGraphSnapshot(memory: BrowserMemoryService): Promise<{
    graph: MemoryKnowledgeGraph;
    sources: MemorySource[];
    sourcesById: Map<string, MemorySource>;
}> {
    const [graph, sources] = await Promise.all([
        memory.getKnowledgeGraph(),
        memory.listSources(),
    ]);
    return {
        graph,
        sources,
        sourcesById: new Map(
            sources.map((source) => [source.sourceId, source]),
        ),
    };
}

function countSourceOverlap(left: string[], right: string[]): number {
    const rightIds = new Set(right);
    return left.reduce(
        (count, sourceId) => count + (rightIds.has(sourceId) ? 1 : 0),
        0,
    );
}

function getActiveRevisionTimestamp(source: MemorySource): string | undefined {
    const revision = source.revisions.find(
        (candidate) => candidate.revisionId === source.activeRevisionId,
    );
    return revision?.capturedAt ?? revision?.indexedAt;
}

async function getSourcesById(
    memory: BrowserMemoryService,
    sourceIds: string[],
): Promise<MemorySource[]> {
    const sources = await Promise.all(
        [...new Set(sourceIds)].map((sourceId) =>
            memory.getSourceById(sourceId),
        ),
    );
    return sources.filter(
        (source): source is MemorySource => source !== undefined,
    );
}

function getRelatedTopicsBySourceOverlap(
    seedTopics: string[],
    depth: number,
    graph: MemoryKnowledgeGraph,
): Map<string, { name: string; cooccurrenceCount: number; distance: number }> {
    const topicsByName = new Map(
        graph.topics.map((topic) => [topic.name.toLowerCase(), topic]),
    );
    const seedNames = new Set(seedTopics.map((topic) => topic.toLowerCase()));
    const related = new Map<
        string,
        { name: string; cooccurrenceCount: number; distance: number }
    >();
    let frontier = [...seedNames];

    for (let distance = 1; distance <= Math.max(1, depth); distance++) {
        const nextFrontier = new Set<string>();
        for (const currentName of frontier) {
            const current = topicsByName.get(currentName);
            if (current === undefined) {
                continue;
            }
            for (const candidate of graph.topics) {
                const candidateName = candidate.name.toLowerCase();
                if (
                    candidateName === currentName ||
                    seedNames.has(candidateName)
                ) {
                    continue;
                }
                const overlap = countSourceOverlap(
                    current.sourceIds,
                    candidate.sourceIds,
                );
                if (overlap === 0) {
                    continue;
                }
                const existing = related.get(candidateName);
                if (
                    existing === undefined ||
                    distance < existing.distance ||
                    (distance === existing.distance &&
                        overlap > existing.cooccurrenceCount)
                ) {
                    related.set(candidateName, {
                        name: candidate.name,
                        cooccurrenceCount: overlap,
                        distance,
                    });
                }
                nextFrontier.add(candidateName);
            }
        }
        frontier = [...nextFrontier];
        if (frontier.length === 0) {
            break;
        }
    }
    return related;
}

export async function discoverRelatedKnowledge(
    parameters: {
        entities: Array<{ name: string; type: string }>;
        topics: string[];
        depth?: number;
        maxEntities?: number;
        maxTopics?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    relatedEntities: Array<{
        name: string;
        type: string;
        relationshipPath: string[];
        distance: number;
        relevanceScore: number;
    }>;
    relatedTopics: Array<{
        name: string;
        cooccurrenceCount: number;
        distance: number;
        relevanceScore: number;
    }>;
    success: boolean;
}> {
    try {
        const memory = context.agentContext.browserMemoryService;
        if (memory === undefined) {
            return {
                relatedEntities: [],
                relatedTopics: [],
                success: false,
            };
        }

        const depth = parameters.depth || 2;
        const maxEntities = parameters.maxEntities || 10;
        const maxTopics = parameters.maxTopics || 10;
        const { graph } = await loadDurableGraphSnapshot(memory);

        debug(
            `[discoverRelatedKnowledge] Starting discovery with ${parameters.entities.length} entities, ${parameters.topics.length} topics, depth=${depth}`,
        );

        const entitiesByName = new Map(
            graph.entities.map((entity) => [entity.name.toLowerCase(), entity]),
        );
        const seedEntityNames = new Set(
            parameters.entities.map((entity) => entity.name.toLowerCase()),
        );
        const adjacency = new Map<
            string,
            Array<{ name: string; relationshipType: string }>
        >();
        for (const relationship of graph.relationships) {
            const from = relationship.fromEntity.toLowerCase();
            const to = relationship.toEntity.toLowerCase();
            const fromEdges = adjacency.get(from) ?? [];
            fromEdges.push({
                name: relationship.toEntity,
                relationshipType: relationship.relationshipType,
            });
            adjacency.set(from, fromEdges);
            const toEdges = adjacency.get(to) ?? [];
            toEdges.push({
                name: relationship.fromEntity,
                relationshipType: relationship.relationshipType,
            });
            adjacency.set(to, toEdges);
        }

        const relatedEntitiesMap = new Map<
            string,
            {
                name: string;
                type: string;
                relationshipPath: string[];
                distance: number;
                confidence: number;
                cooccurrenceCount: number;
            }
        >();
        for (const seedEntity of parameters.entities) {
            let frontier = [
                {
                    name: seedEntity.name,
                    relationshipPath: [] as string[],
                },
            ];
            const visited = new Set([seedEntity.name.toLowerCase()]);
            for (let distance = 1; distance <= depth; distance++) {
                const nextFrontier: typeof frontier = [];
                for (const current of frontier) {
                    for (const edge of adjacency.get(
                        current.name.toLowerCase(),
                    ) ?? []) {
                        const normalizedName = edge.name.toLowerCase();
                        if (visited.has(normalizedName)) {
                            continue;
                        }
                        visited.add(normalizedName);
                        const relationshipPath = [
                            ...current.relationshipPath,
                            edge.relationshipType,
                        ];
                        nextFrontier.push({
                            name: edge.name,
                            relationshipPath,
                        });
                        if (seedEntityNames.has(normalizedName)) {
                            continue;
                        }
                        const entity = entitiesByName.get(normalizedName);
                        const existing = relatedEntitiesMap.get(normalizedName);
                        if (entity !== undefined && existing === undefined) {
                            relatedEntitiesMap.set(normalizedName, {
                                name: entity.name,
                                type: entity.types[0] ?? "unknown",
                                relationshipPath,
                                distance,
                                confidence: 1,
                                cooccurrenceCount: entity.sourceIds.length,
                            });
                        }
                    }
                }
                frontier = nextFrontier;
                if (frontier.length === 0) {
                    break;
                }
            }
        }

        const relatedTopicsMap = getRelatedTopicsBySourceOverlap(
            parameters.topics,
            depth,
            graph,
        );

        // Rank and filter entities
        const rankedEntities = Array.from(relatedEntitiesMap.values())
            .map((entity) => ({
                ...entity,
                relevanceScore:
                    (1.0 / entity.distance) * 0.4 +
                    entity.confidence * 0.3 +
                    Math.min(entity.cooccurrenceCount / 10, 1.0) * 0.3,
            }))
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, maxEntities);

        // Rank and filter topics
        const rankedTopics = Array.from(relatedTopicsMap.values())
            .map((topic) => ({
                ...topic,
                relevanceScore:
                    (1.0 / topic.distance) * 0.5 +
                    Math.min(topic.cooccurrenceCount / 20, 1.0) * 0.5,
            }))
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, maxTopics);

        debug(
            `[discoverRelatedKnowledge] Discovered ${rankedEntities.length} related entities, ${rankedTopics.length} related topics`,
        );

        return {
            relatedEntities: rankedEntities,
            relatedTopics: rankedTopics,
            success: true,
        };
    } catch (error) {
        console.error("[discoverRelatedKnowledge] Error:", error);
        return {
            relatedEntities: [],
            relatedTopics: [],
            success: false,
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
}> {
    try {
        // Ensure cache is populated (this loads from Graphology and creates the cache)
        await ensureGraphCache(context);
        const cache = getGraphCache(context.agentContext);

        if (!cache || !cache.isValid) {
            console.log(
                `[ServerPerf] Cache validation failed: ${JSON.stringify({
                    hasCache: !!cache,
                    isValid: cache?.isValid,
                })}`,
            );
            return {
                graphologyLayout: {
                    elements: [],
                    layoutDuration: 0,
                    avgSpacing: 0,
                    communityCount: 0,
                },
                metadata: {
                    totalEntitiesInSystem: 0,
                    selectedEntityCount: 0,
                    coveragePercentage: 0,
                    importanceThreshold: 0,
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
                graphologyLayout: {
                    elements: [],
                    layoutDuration: 0,
                    avgSpacing: 0,
                    communityCount: 0,
                },
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

        // Debug: Check for entities with empty names before sorting
        const entitiesWithEmptyNames = entitiesWithMetrics.filter(
            (e: any) => !e.name || !e.name.trim(),
        );
        if (entitiesWithEmptyNames.length > 0) {
            console.warn(
                `[getGlobalImportanceLayer] Found ${entitiesWithEmptyNames.length} entities with empty names:`,
                entitiesWithEmptyNames.slice(0, 5).map((e: any) => ({
                    id: e.id,
                    name: e.name,
                    type: e.type,
                    hasId: !!e.id,
                    hasName: !!e.name,
                })),
            );
        }

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

        const optimizedEntities = selectedEntities
            .filter((entity: any) => entity.name && entity.name.trim()) // Filter out entities with empty names
            .map((entity: any) => ({
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

        // Build graphology layout for entities
        const cacheKey = `entity_importance_${maxNodes}`;
        let cachedGraph = getGraphologyCache(cacheKey);

        if (!cachedGraph) {
            debug(
                "[Graphology] Building layout for entity importance layer...",
            );
            const layoutStart = performance.now();

            const graphNodes: GraphNode[] = optimizedEntities
                .filter(
                    (entity: any) =>
                        entity.name &&
                        entity.name.trim() &&
                        (entity.id || entity.name),
                ) // Ensure valid ID and name
                .map((entity: any) => ({
                    id: entity.id || entity.name,
                    name: entity.name,
                    type: entity.type || "entity",
                    confidence: entity.confidence || 0.5,
                    count: entity.count || 1,
                    importance: entity.importance || 0,
                }));

            const graphEdges: GraphEdge[] = optimizedRelationships
                .filter(
                    (rel: any) =>
                        rel.fromEntity &&
                        rel.fromEntity.trim() &&
                        rel.toEntity &&
                        rel.toEntity.trim() &&
                        rel.fromEntity !== rel.toEntity, // Filter out self-referential edges
                )
                .map((rel: any) => ({
                    from: rel.fromEntity,
                    to: rel.toEntity,
                    type: rel.relationshipType,
                    confidence: rel.confidence || 0.5,
                    strength: rel.confidence || 0.5,
                }));

            const graph = buildGraphologyGraph(graphNodes, graphEdges, {
                nodeLimit: maxNodes * 2,
                minEdgeConfidence: 0.2,
                denseClusterThreshold: 100,
            });

            const cytoscapeElements = convertToCytoscapeElements(graph, 2000);
            const layoutMetrics = calculateLayoutQualityMetrics(graph);
            const layoutDuration = performance.now() - layoutStart;

            cachedGraph = createGraphologyCache(
                graph,
                cytoscapeElements,
                layoutDuration,
                layoutMetrics.avgSpacing,
            );

            setGraphologyCache(cacheKey, cachedGraph);

            debug(
                `[Graphology] Entity layout complete in ${layoutDuration.toFixed(2)}ms`,
            );
            debug(
                `[Graphology] Average node spacing: ${layoutMetrics.avgSpacing.toFixed(2)}`,
            );
        } else {
            debug("[Graphology] Using cached entity layout");
        }

        // Enrich entities with graphology colors and sizes
        // Only include entities that have corresponding graph elements (filter out isolated nodes)
        const enrichedEntities = optimizedEntities
            .filter((entity: any) => entity.name && entity.name.trim()) // Ensure valid names
            .map((entity: any) => {
                const graphElement = cachedGraph!.cytoscapeElements.find(
                    (el: any) =>
                        el.data?.id === entity.id ||
                        el.data?.label === entity.name,
                );
                if (graphElement?.data) {
                    return {
                        ...entity,
                        color: graphElement.data.color,
                        size: graphElement.data.size,
                        community: graphElement.data.community,
                    };
                }
                return null;
            })
            .filter((entity: any) => entity !== null);

        // Debug logging to verify entity vs topic data
        console.log(
            "[getGlobalImportanceLayer] DEBUG - First 10 entities:",
            enrichedEntities.slice(0, 10).map((e: any) => ({
                name: e.name,
                type: e.type,
                hasLevel: "level" in e,
                hasChildCount: "childCount" in e,
                hasParentId: "parentId" in e,
                hasDegree: "degree" in e,
                hasCommunityId: "communityId" in e,
            })),
        );

        console.log(
            "[getGlobalImportanceLayer] DEBUG - First 10 graphology nodes:",
            cachedGraph.cytoscapeElements
                .filter((el: any) => el.data && !el.data.source)
                .slice(0, 10)
                .map((el: any) => ({
                    id: el.data.id,
                    name: el.data.name,
                    type: el.data.type,
                    nodeType: el.data.nodeType,
                    hasLevel: "level" in el.data,
                    hasChildCount: "childCount" in el.data,
                    hasParentId: "parentId" in el.data,
                })),
        );

        console.log("[getGlobalImportanceLayer] Cache key used:", cacheKey);

        return {
            graphologyLayout: {
                elements: cachedGraph.cytoscapeElements,
                layoutDuration: cachedGraph.metadata.layoutDuration,
                avgSpacing: cachedGraph.metadata.avgSpacing,
                communityCount: cachedGraph.metadata.communityCount,
            },
            metadata: {
                totalEntitiesInSystem: metadata.totalEntitiesInSystem,
                selectedEntityCount: metadata.selectedEntityCount,
                coveragePercentage: metadata.coveragePercentage,
                importanceThreshold: metadata.importanceThreshold,
                layer: "global_importance",
                connectedComponents: metadata.connectedComponents,
            },
        };
    } catch (error) {
        console.error("Error getting global importance layer:", error);
        return {
            graphologyLayout: {
                elements: [],
                layoutDuration: 0,
                avgSpacing: 0,
                communityCount: 0,
            },
            metadata: {
                totalEntitiesInSystem: 0,
                selectedEntityCount: 0,
                coveragePercentage: 0,
                importanceThreshold: 0,
                layer: "global_importance",
            },
        };
    }
}

/**
 * Get global graph layout data only (optimized for Phase 3)
 * Returns only the graphology layout without raw entities/relationships
 */
export async function getGlobalGraphLayoutData(
    parameters: {
        maxNodes?: number;
        includeConnectivity?: boolean;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
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
}> {
    try {
        await ensureGraphCache(context);
        const cache = getGraphCache(context.agentContext);

        if (!cache || !cache.isValid) {
            return {
                graphologyLayout: {
                    elements: [],
                    layoutDuration: 0,
                    avgSpacing: 0,
                    communityCount: 0,
                },
                metadata: {
                    totalEntitiesInSystem: 0,
                    selectedEntityCount: 0,
                    coveragePercentage: 0,
                    importanceThreshold: 0,
                    layer: "global_graph_layout",
                },
            };
        }

        const allEntities = cache.entityMetrics || [];
        const allRelationships = cache.relationships || [];
        const communities = cache.communities || [];

        if (allEntities.length === 0) {
            return {
                graphologyLayout: {
                    elements: [],
                    layoutDuration: 0,
                    avgSpacing: 0,
                    communityCount: 0,
                },
                metadata: {
                    totalEntitiesInSystem: 0,
                    selectedEntityCount: 0,
                    coveragePercentage: 0,
                    importanceThreshold: 0,
                    layer: "global_graph_layout",
                },
            };
        }

        const entitiesWithMetrics = calculateEntityMetrics(
            allEntities,
            allRelationships,
            communities,
        );

        // Sort by importance and select top nodes
        const maxNodes = parameters.maxNodes || 1000;
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

        // Get relationships between selected entities
        const selectedEntityNames = new Set(
            selectedEntities.map((e) => e.name),
        );
        const selectedRelationships = allRelationships.filter(
            (rel: any) =>
                selectedEntityNames.has(rel.fromEntity) &&
                selectedEntityNames.has(rel.toEntity),
        );

        // Build graphology layout for the selected entities
        const cacheKey = `global_layout_${maxNodes}`;
        let cachedGraph = getGraphologyCache(cacheKey);

        if (!cachedGraph) {
            console.log("[Graphology] Building global graph layout...");
            const layoutStart = performance.now();

            const graphNodes: GraphNode[] = selectedEntities.map(
                (entity: any) => ({
                    id: entity.id || entity.name,
                    name: entity.name,
                    type: entity.type || "entity",
                    confidence: entity.confidence || 0.5,
                    count: entity.count || 1,
                    importance: entity.importance || 0,
                }),
            );

            const graphEdges: GraphEdge[] = selectedRelationships.map(
                (rel: any) => ({
                    from: rel.fromEntity,
                    to: rel.toEntity,
                    type: rel.relationshipType,
                    confidence: rel.confidence || 0.5,
                    strength: rel.confidence || 0.5,
                }),
            );

            const graph = buildGraphologyGraph(graphNodes, graphEdges, {
                nodeLimit: maxNodes * 2,
                minEdgeConfidence: 0.2,
                denseClusterThreshold: 100,
            });

            const cytoscapeElements = convertToCytoscapeElements(graph, 2000);
            const layoutMetrics = calculateLayoutQualityMetrics(graph);
            const layoutDuration = performance.now() - layoutStart;

            cachedGraph = createGraphologyCache(
                graph,
                cytoscapeElements,
                layoutDuration,
                layoutMetrics.avgSpacing,
            );

            setGraphologyCache(cacheKey, cachedGraph);

            console.log(
                `[Graphology] Global layout complete in ${layoutDuration.toFixed(2)}ms`,
            );
        } else {
            console.log("[Graphology] Using cached global layout");
        }

        return {
            graphologyLayout: {
                elements: cachedGraph.cytoscapeElements,
                layoutDuration: cachedGraph.metadata.layoutDuration,
                avgSpacing: cachedGraph.metadata.avgSpacing,
                communityCount: cachedGraph.metadata.communityCount,
            },
            metadata: {
                totalEntitiesInSystem: allEntities.length,
                selectedEntityCount: selectedEntities.length,
                coveragePercentage:
                    (selectedEntities.length / allEntities.length) * 100,
                importanceThreshold:
                    selectedEntities[selectedEntities.length - 1]?.importance ||
                    0,
                connectedComponents: analyzeConnectivity(
                    selectedEntities,
                    selectedRelationships,
                ),
                layer: "global_graph_layout",
            },
        };
    } catch (error) {
        console.error("Error getting global graph layout data:", error);
        return {
            graphologyLayout: {
                elements: [],
                layoutDuration: 0,
                avgSpacing: 0,
                communityCount: 0,
            },
            metadata: {
                totalEntitiesInSystem: 0,
                selectedEntityCount: 0,
                coveragePercentage: 0,
                importanceThreshold: 0,
                layer: "global_graph_layout",
            },
        };
    }
}

/**
 * Get topic graph data with graphology layout
 * Simplified version that returns topics with pre-computed graphology positions
 */
export async function getTopicImportanceLayer(
    parameters: {
        maxNodes?: number;
        minImportanceThreshold?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
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
}> {
    try {
        const { topicGraph } = await getGraphologyGraphs(context);

        if (!topicGraph) {
            return {
                graphologyLayout: {
                    elements: [],
                    layoutDuration: 0,
                    avgSpacing: 0,
                    communityCount: 0,
                },
                metadata: {
                    totalTopicsInSystem: 0,
                    selectedTopicCount: 0,
                    layer: "topic_importance",
                },
            };
        }

        // const maxNodes = parameters.maxNodes || 500;

        // Extract topics from Graphology topic graph
        const allTopics: any[] = [];
        topicGraph.forEachNode((nodeId: string, attributes: any) => {
            allTopics.push({
                id: nodeId,
                name: attributes.name || nodeId,
                type: "topic",
                confidence: attributes.confidence || 0.5,
                count: attributes.count || 1,
                importance: attributes.importance || 0,
                level: attributes.level || 0,
                parentId: attributes.parentId,
            });
        });

        debug(
            `[getTopicImportanceLayer] Found ${allTopics.length} total topics in topic graph`,
        );

        // Show the full topic graph - no filtering by importance or node count
        const selectedTopics = allTopics;

        debug(
            `[getTopicImportanceLayer] Using all ${selectedTopics.length} topics (full graph)`,
        );

        // Create set of selected topic IDs for filtering relationships
        const selectedTopicIds = new Set(selectedTopics.map((t) => t.id));

        // Extract relationships only between selected topics
        const relationships: any[] = [];
        const relationshipTypes = new Map<string, number>(); // Track relationship type counts

        topicGraph.forEachEdge(
            (
                edgeId: string,
                attributes: any,
                source: string,
                target: string,
            ) => {
                // Only include relationships where both source and target are in selected topics
                if (
                    selectedTopicIds.has(source) &&
                    selectedTopicIds.has(target)
                ) {
                    const relType = attributes.type || "unknown";
                    relationshipTypes.set(
                        relType,
                        (relationshipTypes.get(relType) || 0) + 1,
                    );

                    relationships.push({
                        from: source,
                        to: target,
                        type: relType,
                        strength: attributes.strength || 1,
                        confidence: attributes.confidence || 0.5,
                    });
                }
            },
        );

        debug(
            `[getTopicImportanceLayer] Filtered ${relationships.length} relationships between selected topics`,
        );

        // Debug: Log relationship type distribution
        console.log(
            "[getTopicImportanceLayer] Relationship type distribution:",
            Object.fromEntries(relationshipTypes),
        );

        // Create a subgraph with only selected topics and their relationships for Cytoscape conversion
        const graphNodes: GraphNode[] = selectedTopics.map((topic) => ({
            id: topic.id,
            name: topic.name,
            type: "topic",
            confidence: topic.confidence,
            count: topic.count,
            importance: topic.importance,
            level: topic.level,
            parentId: topic.parentId,
        }));

        const graphEdges: GraphEdge[] = relationships.map((rel) => ({
            from: rel.from,
            to: rel.to,
            type: rel.type,
            confidence: rel.confidence,
            strength: rel.strength,
        }));

        debug(
            `[getTopicImportanceLayer] Building subgraph with ${graphNodes.length} nodes and ${graphEdges.length} edges`,
        );

        // Build graphology layout using the same caching pipeline as entity layer
        const cacheKey = `topic_importance_full`;
        let cachedGraph = getGraphologyCache(cacheKey);

        if (!cachedGraph) {
            debug("[Graphology] Building layout for topic importance layer...");
            const layoutStart = performance.now();

            // Use buildGraphologyGraph to create a properly layouted graph
            const layoutedGraph = buildGraphologyGraph(graphNodes, graphEdges);

            // Convert subgraph to Cytoscape elements for UI rendering
            const cytoscapeElements = convertToCytoscapeElements(layoutedGraph);
            debug(
                `[getTopicImportanceLayer] Converted to ${cytoscapeElements.length} Cytoscape elements`,
            );

            const layoutMetrics = calculateLayoutQualityMetrics(layoutedGraph);
            const layoutDuration = performance.now() - layoutStart;

            cachedGraph = createGraphologyCache(
                layoutedGraph,
                cytoscapeElements,
                layoutDuration,
                layoutMetrics.avgSpacing,
            );

            setGraphologyCache(cacheKey, cachedGraph);

            debug(
                `[Graphology] Topic layout complete in ${layoutDuration.toFixed(2)}ms`,
            );
        } else {
            debug("[Graphology] Using cached topic layout");
        }

        return {
            graphologyLayout: {
                elements: cachedGraph.cytoscapeElements,
                layoutDuration: cachedGraph.metadata.layoutDuration,
                avgSpacing: cachedGraph.metadata.avgSpacing,
                communityCount: cachedGraph.metadata.communityCount,
            },
            metadata: {
                totalTopicsInSystem: allTopics.length,
                selectedTopicCount: selectedTopics.length,
                layer: "topic_importance",
            },
        };
    } catch (error) {
        console.error("Error getting topic importance layer:", error);
        return {
            graphologyLayout: {
                elements: [],
                layoutDuration: 0,
                avgSpacing: 0,
                communityCount: 0,
            },
            metadata: {
                totalTopicsInSystem: 0,
                selectedTopicCount: 0,
                layer: "topic_importance",
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
        // Ensure cache is populated
        await ensureGraphCache(context);

        // Get cached data
        const cache = getGraphCache(context.agentContext);
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
// Helper Functions
// ============================================================================

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
        const { topicGraph } = await getGraphologyGraphs(context);

        if (topicGraph && topicGraph.hasNode(parameters.topicId)) {
            debug("[Graphology] Getting topic metrics from Graphology graph");

            const nodeAttributes = topicGraph.getNodeAttributes(
                parameters.topicId,
            );
            const degree = topicGraph.degree(parameters.topicId);
            const inDegree = topicGraph.inDegree(parameters.topicId);
            const outDegree = topicGraph.outDegree(parameters.topicId);

            // Extract metrics from node attributes and graph structure
            const metrics = {
                topicId: parameters.topicId,
                name: nodeAttributes.name || parameters.topicId,
                degree: degree,
                inDegree: inDegree,
                outDegree: outDegree,
                betweennessCentrality:
                    nodeAttributes.betweennessCentrality || 0,
                degreeCentrality:
                    nodeAttributes.degreeCentrality ||
                    degree / Math.max(topicGraph.order - 1, 1),
                community: nodeAttributes.community || null,
                importance: nodeAttributes.importance || degree * 0.1,
                coherence: nodeAttributes.coherence || 0.5,
                entityCount: nodeAttributes.entityCount || 0,
                websiteCount: nodeAttributes.websiteCount || 0,
            };

            debug(
                `[Graphology] Retrieved metrics for topic: ${parameters.topicId}`,
            );
            return { success: true, metrics };
        } else {
            return {
                success: false,
                error: "Topic metrics not found for this topic",
            };
        }
    } catch (graphologyError) {
        debug(
            `[Graphology] Failed to get topic metrics from Graphology: ${graphologyError}`,
        );
        return {
            success: false,
            error:
                graphologyError instanceof Error
                    ? graphologyError.message
                    : "Unknown error",
        };
    }
}

/**
 * Get detailed information for a specific topic including entity references, keywords, and timeline
 * This is called on-demand when user clicks a topic node to populate the sidepanel
 */
export async function getTopicDetails(
    parameters: {
        topicId: string;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    details?: {
        topicId: string;
        topicName: string;
        level: number;
        confidence: number;
        entityReferences: string[];
        keywords: string[];
        firstSeen?: string;
        lastSeen?: string;
        parentTopicId?: string;
        childCount?: number;
    };
    error?: string;
}> {
    try {
        const memory = context.agentContext.browserMemoryService;
        if (memory === undefined) {
            return {
                success: false,
                error: "Durable browser memory is not available",
            };
        }
        const graph = await memory.getKnowledgeGraph();
        const topic = graph.topics.find(
            (candidate) =>
                candidate.name.toLowerCase() ===
                parameters.topicId.toLowerCase(),
        );
        if (topic === undefined) {
            return {
                success: false,
                error: "Topic not found",
            };
        }
        const topicSourceIds = new Set(topic.sourceIds);
        const entityReferences = graph.entities
            .filter((entity) =>
                entity.sourceIds.some((sourceId) =>
                    topicSourceIds.has(sourceId),
                ),
            )
            .map((entity) => entity.name);
        const keywords = graph.topics
            .filter(
                (candidate) =>
                    candidate.name !== topic.name &&
                    candidate.sourceIds.some((sourceId) =>
                        topicSourceIds.has(sourceId),
                    ),
            )
            .map((candidate) => candidate.name);
        const sources = await getSourcesById(memory, topic.sourceIds);
        const timestamps = sources
            .map(getActiveRevisionTimestamp)
            .filter((timestamp): timestamp is string => timestamp !== undefined)
            .sort();

        const details: {
            topicId: string;
            topicName: string;
            level: number;
            confidence: number;
            entityReferences: string[];
            keywords: string[];
            firstSeen?: string;
            lastSeen?: string;
            parentTopicId?: string;
            childCount?: number;
        } = {
            topicId: topic.name,
            topicName: topic.name,
            level: 0,
            confidence: 1,
            entityReferences,
            keywords,
            childCount: 0,
        };
        if (timestamps.length > 0) {
            details.firstSeen = timestamps[0];
            details.lastSeen = timestamps[timestamps.length - 1];
        }

        return {
            success: true,
            details,
        };
    } catch (error) {
        console.error("Error getting topic details:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

/**
 * Get detailed information for a specific entity including related topics, entities, and sources
 * This is called on-demand when user clicks an entity node to populate the sidepanel
 */
export async function getEntityDetails(
    parameters: {
        entityName: string;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    details?: {
        name: string;
        type: string;
        confidence: number;
        count: number;
        degree?: number;
        importance?: number;
        topicAffinity?: string[];
        relatedEntities?: string[];
        websites?: string[];
        firstSeen?: string;
        lastSeen?: string;
        facets?: any[];
    };
    error?: string;
}> {
    try {
        const memory = context.agentContext.browserMemoryService;
        if (memory === undefined) {
            return {
                success: false,
                error: "Durable browser memory is not available",
            };
        }
        const graph = await memory.getKnowledgeGraph();
        const entity = graph.entities.find(
            (candidate) =>
                candidate.name.toLowerCase() ===
                parameters.entityName.toLowerCase(),
        );
        if (entity === undefined) {
            return {
                success: false,
                error: "Entity not found",
            };
        }
        const entitySourceIds = new Set(entity.sourceIds);
        const relatedEntities = new Set<string>();
        let degree = 0;
        for (const relationship of graph.relationships) {
            if (relationship.fromEntity === entity.name) {
                relatedEntities.add(relationship.toEntity);
                degree++;
            } else if (relationship.toEntity === entity.name) {
                relatedEntities.add(relationship.fromEntity);
                degree++;
            }
        }
        const topics = graph.topics
            .filter((topic) =>
                topic.sourceIds.some((sourceId) =>
                    entitySourceIds.has(sourceId),
                ),
            )
            .map((topic) => topic.name);
        const sources = await getSourcesById(memory, entity.sourceIds);
        const websites = sources.flatMap((source) =>
            source.canonicalUri === undefined ? [] : [source.canonicalUri],
        );
        const timestamps = sources
            .map(getActiveRevisionTimestamp)
            .filter((timestamp): timestamp is string => timestamp !== undefined)
            .sort();

        const details: {
            name: string;
            type: string;
            confidence: number;
            count: number;
            degree?: number;
            importance?: number;
            topicAffinity?: string[];
            relatedEntities?: string[];
            websites?: string[];
            firstSeen?: string;
            lastSeen?: string;
        } = {
            name: entity.name,
            type: entity.types[0] ?? "entity",
            confidence: 1,
            count: entity.mentionCount,
            degree,
        };
        if (topics.length > 0) {
            details.topicAffinity = topics.slice(0, 15);
        }
        if (relatedEntities.size > 0) {
            details.relatedEntities = Array.from(relatedEntities).slice(0, 15);
        }
        if (websites.length > 0) {
            details.websites = websites.slice(0, 15);
        }
        if (timestamps.length > 0) {
            details.firstSeen = timestamps[0];
            details.lastSeen = timestamps[timestamps.length - 1];
        }

        return {
            success: true,
            details,
        };
    } catch (error) {
        console.error("Error getting entity details:", error);
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
        const memory = context.agentContext.browserMemoryService;
        if (memory === undefined) {
            return {
                success: false,
                error: "Durable browser memory is not available",
            };
        }

        const tracker = getPerformanceTracker();
        tracker.startOperation("getUrlContentBreakdown");
        const { graph, sources, sourcesById } =
            await loadDurableGraphSnapshot(memory);

        const urlStats = new Map<
            string,
            {
                topicCount: number;
                entityCount: number;
                semanticRefCount: number;
                relationshipCount: number;
            }
        >();
        for (const source of sources) {
            urlStats.set(source.canonicalUri ?? source.sourceId, {
                topicCount: 0,
                entityCount: 0,
                semanticRefCount: 0,
                relationshipCount: 0,
            });
        }

        const increment = (
            sourceIds: string[],
            field: "topicCount" | "entityCount" | "relationshipCount",
        ) => {
            for (const sourceId of new Set(sourceIds)) {
                const source = sourcesById.get(sourceId);
                if (source === undefined) {
                    continue;
                }
                const stats = urlStats.get(
                    source.canonicalUri ?? source.sourceId,
                );
                if (stats !== undefined) {
                    stats[field]++;
                }
            }
        };

        graph.topics.forEach((topic) =>
            increment(topic.sourceIds, "topicCount"),
        );
        graph.entities.forEach((entity) =>
            increment(entity.sourceIds, "entityCount"),
        );
        graph.relationships.forEach((relationship) =>
            increment(relationship.sourceIds, "relationshipCount"),
        );

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
            graph.entities.length +
                graph.topics.length +
                graph.relationships.length,
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

// ============================================================================
// Topic Timeline Functions
// ============================================================================

export async function getTopicTimelines(
    parameters: {
        topicNames: string[];
        maxTimelineEntries?: number;
        timeRange?: {
            startDate?: string;
            endDate?: string;
        };
        includeRelatedTopics?: boolean;
        neighborhoodDepth?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<TopicTimelineResponse> {
    try {
        const memory = context.agentContext.browserMemoryService;
        if (memory === undefined) {
            return {
                success: false,
                timelines: [],
                metadata: {
                    totalEntries: 0,
                    timeRange: { earliest: "", latest: "" },
                    topicsWithActivity: 0,
                },
                error: "Durable browser memory is not available",
            };
        }
        const { graph, sourcesById } = await loadDurableGraphSnapshot(memory);

        debug(
            `[Topic Timelines] Processing ${parameters.topicNames.length} topics`,
        );

        // 1. Expand topic list with neighborhood exploration
        let allTopics = [...parameters.topicNames];

        if (parameters.includeRelatedTopics) {
            allTopics = expandTopicNeighborhood(
                parameters.topicNames,
                parameters.neighborhoodDepth || 1,
                graph,
            );
            debug(
                `[Topic Timelines] Expanded to ${allTopics.length} topics including neighbors`,
            );
        }

        // 2. Get timeline data for each topic
        const timelines: TopicTimeline[] = [];

        for (const topicName of allTopics) {
            const timeline = buildTopicTimeline(
                topicName,
                graph,
                sourcesById,
                parameters,
            );
            if (timeline.activities.length > 0) {
                timelines.push(timeline);
            }
        }

        debug(
            `[Topic Timelines] Built ${timelines.length} timelines with activity`,
        );

        // 3. Ensure requested topics are always included, then add up to 4 neighbor topics
        const requestedTimelines = timelines.filter((t) =>
            parameters.topicNames.includes(t.topicName),
        );
        const neighborTimelines = timelines.filter(
            (t) => !parameters.topicNames.includes(t.topicName),
        );

        // Sort neighbors by activity
        const sortedNeighbors = neighborTimelines.sort(
            (a, b) => b.totalActivity - a.totalActivity,
        );

        // Combine: all requested topics + up to 4 neighbors
        const combinedTimelines = [
            ...requestedTimelines,
            ...sortedNeighbors.slice(0, 4),
        ];

        // Sort final result by activity level
        const sortedTimelines = combinedTimelines.sort(
            (a, b) => b.totalActivity - a.totalActivity,
        );

        // 4. Calculate metadata
        const allActivities = sortedTimelines.flatMap((t) => t.activities);
        const dates = allActivities.map((a) => new Date(a.timestamp));

        const response: TopicTimelineResponse = {
            success: true,
            timelines: sortedTimelines,
            metadata: {
                totalEntries: allActivities.length,
                timeRange: {
                    earliest:
                        dates.length > 0
                            ? new Date(
                                  Math.min(...dates.map((d) => d.getTime())),
                              ).toISOString()
                            : "",
                    latest:
                        dates.length > 0
                            ? new Date(
                                  Math.max(...dates.map((d) => d.getTime())),
                              ).toISOString()
                            : "",
                },
                topicsWithActivity: sortedTimelines.length,
            },
        };

        debug(
            `[Topic Timelines] Returning ${response.timelines.length} timelines with ${response.metadata.totalEntries} total activities`,
        );

        return response;
    } catch (error) {
        debug(`[Topic Timelines] Error: ${error}`);
        return {
            success: false,
            timelines: [],
            metadata: {
                totalEntries: 0,
                timeRange: { earliest: "", latest: "" },
                topicsWithActivity: 0,
            },
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

function expandTopicNeighborhood(
    seedTopics: string[],
    depth: number,
    graph: MemoryKnowledgeGraph,
): string[] {
    const related = getRelatedTopicsBySourceOverlap(seedTopics, depth, graph);
    return [
        ...seedTopics,
        ...Array.from(related.values(), (topic) => topic.name),
    ];
}

function buildTopicTimeline(
    topicName: string,
    graph: MemoryKnowledgeGraph,
    sourcesById: Map<string, MemorySource>,
    parameters: {
        maxTimelineEntries?: number;
        timeRange?: { startDate?: string; endDate?: string };
    },
): TopicTimeline {
    const topic = graph.topics.find(
        (candidate) => candidate.name.toLowerCase() === topicName.toLowerCase(),
    );
    if (topic === undefined) {
        return {
            topicName,
            totalActivity: 0,
            activities: [],
            relatedTopics: [],
            activityDistribution: { bookmarks: 0, visits: 0, extractions: 0 },
        };
    }

    const startTime = parameters.timeRange?.startDate
        ? Date.parse(parameters.timeRange.startDate)
        : undefined;
    const endTime = parameters.timeRange?.endDate
        ? Date.parse(parameters.timeRange.endDate)
        : undefined;
    const activities = topic.sourceIds.flatMap((sourceId): TopicActivity[] => {
        const source = sourcesById.get(sourceId);
        if (source === undefined) {
            return [];
        }
        const timestamp = getActiveRevisionTimestamp(source);
        if (timestamp === undefined) {
            return [];
        }
        const activityTime = Date.parse(timestamp);
        if (
            (startTime !== undefined && activityTime < startTime) ||
            (endTime !== undefined && activityTime > endTime)
        ) {
            return [];
        }
        const url = source.canonicalUri ?? source.sourceId;
        const metadataDomain = source.metadata?.domain;
        return [
            {
                timestamp,
                activityType: "extraction",
                url,
                title: source.title,
                domain:
                    typeof metadataDomain === "string"
                        ? metadataDomain
                        : extractDomainFromUrl(url),
                relevance: 1,
                metadata: { confidence: 1, extractionDate: timestamp },
            },
        ];
    });
    activities.sort(
        (left, right) =>
            Date.parse(right.timestamp) - Date.parse(left.timestamp),
    );
    const maxEntries = Math.max(0, parameters.maxTimelineEntries ?? 50);
    const limitedActivities = activities.slice(0, maxEntries);
    const relatedTopics = Array.from(
        getRelatedTopicsBySourceOverlap([topic.name], 1, graph).values(),
        (related) => related.name,
    );
    return {
        topicName: topic.name,
        topicId: topic.name,
        totalActivity: activities.length,
        activities: limitedActivities,
        relatedTopics,
        activityDistribution: {
            bookmarks: 0,
            visits: 0,
            extractions: activities.length,
        },
    };
}

function extractDomainFromUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch (error) {
        // Fallback for invalid URLs
        const match = url.match(/^https?:\/\/([^\/]+)/);
        return match ? match[1] : url;
    }
}
