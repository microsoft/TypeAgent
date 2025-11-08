// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";
import { GraphCache, TopicGraphCache } from "../types/knowledgeTypes.mjs";
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
import { createGraphologyPersistenceManager } from "../utils/graphologyPersistence.mjs";
import registerDebug from "debug";
import { openai as ai } from "aiclient";
import { createJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { TopicRelationshipAnalysis } from "./schema/topicRelationship.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function getSchemaFileContents(fileName: string): string {
    const packageRoot = path.join("..", "..", "..", "..");
    return fs.readFileSync(
        fileURLToPath(
            new URL(
                path.join(
                    packageRoot,
                    "./src/agent/knowledge/actions/schema",
                    fileName,
                ),
                import.meta.url,
            ),
        ),
        "utf8",
    );
}

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
    websiteCollection: any,
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

function extractEntitiesFromGraphology(entityGraph: any): any[] {
    const entities: any[] = [];

    // Extract entity nodes from Graphology graph
    entityGraph.forEachNode((nodeId: string, attributes: any) => {
        if (attributes.type === "entity") {
            entities.push({
                name: attributes.name || nodeId,
                entityType: attributes.entityType || "unknown",
                frequency: attributes.frequency || 0,
                websites: attributes.websites || [],
                confidence: attributes.confidence || 1.0,
            });
        }
    });

    return entities;
}

function extractRelationshipsFromGraphology(entityGraph: any): any[] {
    const relationships: any[] = [];

    // Extract relationship edges from Graphology graph
    entityGraph.forEachEdge(
        (edgeId: string, attributes: any, source: string, target: string) => {
            relationships.push({
                id: edgeId,
                rowId: edgeId,
                fromEntity: source,
                toEntity: target,
                source: source,
                target: target,
                relationshipType:
                    attributes.relationshipType ||
                    attributes.type ||
                    "co_occurs",
                type:
                    attributes.relationshipType ||
                    attributes.type ||
                    "co_occurs",
                strength: attributes.weight || attributes.strength || 1.0,
                confidence: attributes.confidence || 1.0,
                count: attributes.cooccurrenceCount || attributes.count || 1,
                cooccurrenceCount:
                    attributes.cooccurrenceCount || attributes.count || 1,
            });
        },
    );

    return relationships;
}

function extractCommunitiesFromGraphology(entityGraph: any): any[] {
    const communities: any[] = [];

    // Extract community nodes from Graphology graph
    entityGraph.forEachNode((nodeId: string, attributes: any) => {
        if (attributes.type === "community") {
            communities.push({
                id: nodeId,
                name: attributes.name || `Community ${nodeId}`,
                entities: attributes.entities || [],
                size: attributes.size || 0,
                coherence: attributes.coherence || 0.0,
                importance: attributes.importance || 0.0,
            });
        }
    });

    return communities;
}

// Entity graph cache storage attached to websiteCollection
function getGraphCache(websiteCollection: any): GraphCache | null {
    return (websiteCollection as any).__graphCache || null;
}

function setGraphCache(websiteCollection: any, cache: GraphCache): void {
    (websiteCollection as any).__graphCache = cache;
}

// Topic graph cache storage attached to websiteCollection
function setTopicGraphCache(
    websiteCollection: any,
    cache: TopicGraphCache,
): void {
    (websiteCollection as any).__topicGraphCache = cache;
}

// Invalidate topic cache (called on graph rebuild or knowledge import)
function invalidateTopicCache(websiteCollection: any): void {
    setTopicGraphCache(websiteCollection, {
        topics: [],
        relationships: [],
        topicMetrics: [],
        lastUpdated: 0,
        isValid: false,
    });
    // Also clear the graphology layout cache
    invalidateAllGraphologyCaches();
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
    const websiteCollection = context.agentContext.websiteCollection;
    if (!websiteCollection) {
        throw new Error("Website collection not available");
    }

    const cache = getGraphCache(websiteCollection);

    // Check if cache is valid (no TTL - only invalidated on rebuild)
    if (cache && cache.isValid) {
        debug("[Knowledge Graph] Using valid cached graph data");
        return;
    }

    debug("[Knowledge Graph] Building in-memory cache from Graphology data");

    const tracker = getPerformanceTracker();
    tracker.startOperation("ensureGraphCache");

    try {
        // Build the graph using websiteCollection - returns Graphology graphs directly
        tracker.startOperation("ensureGraphCache.buildGraphologyGraphs");
        const buildResult = await websiteCollection.buildGraph();
        tracker.endOperation(
            "ensureGraphCache.buildGraphologyGraphs",
            1,
            buildResult ? 1 : 0,
        );

        if (!buildResult?.entityGraph || !buildResult?.topicGraph) {
            throw new Error(
                "Failed to build Graphology graphs from websiteCollection",
            );
        }

        // Extract entities, relationships, and communities from Graphology graphs
        tracker.startOperation("ensureGraphCache.extractFromGraphology");

        const entityGraph = buildResult.entityGraph;
        const rawEntities: any[] = [];
        const relationships: any[] = [];
        const communities: any[] = [];

        // Extract entities from Graphology graph
        entityGraph.forEachNode((nodeId: string, attributes: any) => {
            if (!attributes.type || attributes.type === "entity") {
                rawEntities.push({
                    name: nodeId,
                    id: nodeId,
                    type: attributes.type || "entity",
                    confidence: attributes.confidence || 0.5,
                    count: attributes.count || 1,
                    importance: attributes.importance || 0,
                    communityId: attributes.community || 0,
                });
            }
        });

        // Extract relationships from Graphology graph
        entityGraph.forEachEdge(
            (
                edgeId: string,
                attributes: any,
                source: string,
                target: string,
            ) => {
                relationships.push({
                    fromEntity: source,
                    toEntity: target,
                    source: source,
                    target: target,
                    relationshipType: attributes.type || "related",
                    type: attributes.type || "related",
                    confidence: attributes.confidence || 0.5,
                    count: attributes.count || 1,
                });
            },
        );

        // Extract communities (simplified approach)
        const communityMap = new Map<
            number,
            { id: number; entities: string[] }
        >();
        rawEntities.forEach((entity) => {
            const communityId = entity.communityId || 0;
            if (!communityMap.has(communityId)) {
                communityMap.set(communityId, {
                    id: communityId,
                    entities: [],
                });
            }
            communityMap.get(communityId)!.entities.push(entity.name);
        });
        communities.push(...Array.from(communityMap.values()));

        tracker.endOperation(
            "ensureGraphCache.extractFromGraphology",
            rawEntities.length,
            relationships.length,
        );

        console.log("[ensureGraphCache] Extracted from Graphology:", {
            entities: rawEntities.length,
            relationships: relationships.length,
            communities: communities.length,
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
        };

        setGraphCache(websiteCollection, newCache);

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
        const existingCache = getGraphCache(websiteCollection);
        if (existingCache) {
            existingCache.isValid = false;
        }
    }
}

// ============================================================================
// Storage Abstraction Layer
// ============================================================================

/**
 * Get Graphology graphs from cache or persistence (new primary method)
 */
async function getGraphologyGraphs(
    context: SessionContext<BrowserActionContext>,
): Promise<{
    entityGraph?: any;
    topicGraph?: any;
    useGraphology: boolean;
}> {
    const websiteCollection = context.agentContext.websiteCollection;
    if (!websiteCollection) {
        throw new Error("Website collection not available");
    }

    try {
        // Try to get from memory cache first (fastest)
        const entityCache = getGraphologyCache("entity_default");
        const topicCache = getGraphologyCache("topic_default");

        if (entityCache?.graph && topicCache?.graph) {
            debug("[Graphology] Using memory-cached Graphology graphs");
            return {
                entityGraph: entityCache.graph,
                topicGraph: topicCache.graph,
                useGraphology: true,
            };
        }

        // Try to load from disk persistence (fast)
        debug("[Graphology] Memory cache miss, trying disk persistence...");
        const jsonStorage = context.agentContext.graphJsonStorage;
        if (jsonStorage?.manager) {
            const storagePath = jsonStorage.manager.getStoragePath();
            const persistenceManager =
                createGraphologyPersistenceManager(storagePath);

            const entityResult = await persistenceManager.loadEntityGraph();
            const topicResult = await persistenceManager.loadTopicGraph();

            if (entityResult?.graph && topicResult?.graph) {
                debug("[Graphology] Loaded graphs from disk persistence");

                // Cache in memory for next time
                await cacheGraphologyGraphs(
                    websiteCollection,
                    entityResult.graph,
                    topicResult.graph,
                    {
                        buildTime: entityResult.metadata?.buildTime || 0,
                        loadedFromDisk: true,
                    },
                );

                return {
                    entityGraph: entityResult.graph,
                    topicGraph: topicResult.graph,
                    useGraphology: true,
                };
            }
        }

        // If no cache or persistence, rebuild graphs (slowest)
        debug("[Graphology] No cached graphs found, rebuilding from source...");
        const buildResult = await websiteCollection.buildGraph();

        if (buildResult?.entityGraph && buildResult?.topicGraph) {
            // Cache in memory
            await cacheGraphologyGraphs(
                websiteCollection,
                buildResult.entityGraph,
                buildResult.topicGraph,
                buildResult.metadata,
            );

            // Persist to disk for next time
            if (jsonStorage?.manager) {
                const storagePath = jsonStorage.manager.getStoragePath();
                const persistenceManager =
                    createGraphologyPersistenceManager(storagePath);

                try {
                    debug(
                        `[Graphology] Persisting entity graph with ${buildResult.entityGraph.order} nodes and ${buildResult.entityGraph.size} edges to ${storagePath}`,
                    );
                    await persistenceManager.saveEntityGraph(
                        buildResult.entityGraph,
                        buildResult.metadata,
                    );
                    debug(`[Graphology] ✓ Entity graph saved to disk`);

                    debug(
                        `[Graphology] Persisting topic graph with ${buildResult.topicGraph.order} nodes and ${buildResult.topicGraph.size} edges to ${storagePath}`,
                    );
                    await persistenceManager.saveTopicGraph(
                        buildResult.topicGraph,
                        buildResult.metadata,
                    );
                    debug(`[Graphology] ✓ Topic graph saved to disk`);

                    debug(
                        "[Graphology] ✓ All graphs saved to disk persistence successfully",
                    );
                } catch (persistError) {
                    debug(
                        `[Graphology] ❌ Failed to persist graphs: ${persistError}`,
                    );
                    console.error(
                        `[Graphology] Persistence error details:`,
                        persistError,
                    );
                    // Continue anyway since we have the graphs in memory
                }
            }

            return {
                entityGraph: buildResult.entityGraph,
                topicGraph: buildResult.topicGraph,
                useGraphology: true,
            };
        }

        throw new Error("Failed to build Graphology graphs");
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
        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection) {
            console.log("[getEntityStatistics] No websiteCollection available");
            return { entityCount: 0, relationshipCount: 0, communityCount: 0 };
        }

        await ensureGraphCache(context);
        const cache = getGraphCache(websiteCollection);

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

        // Get website collection for building Graphology graphs
        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection) {
            return {
                success: false,
                error: "Website collection not available",
            };
        }

        // Build the graph using websiteCollection - returns Graphology graphs directly
        debug(
            "[Knowledge Graph] Building Graphology graphs from website collection...",
        );
        const buildResult = await websiteCollection.buildGraph();
        debug("[Knowledge Graph] Graphology graph build completed");

        // Check if we got Graphology graphs
        if (!buildResult?.entityGraph || !buildResult?.topicGraph) {
            throw new Error(
                "Failed to build Graphology graphs from website collection",
            );
        }

        const { entityGraph, topicGraph, metadata } = buildResult;

        // Cache the Graphology graphs directly
        debug("[Knowledge Graph] Caching Graphology graphs...");
        await cacheGraphologyGraphs(
            websiteCollection,
            entityGraph,
            topicGraph,
            metadata,
        );

        // Persist Graphology graphs to disk
        const jsonStorage = context.agentContext.graphJsonStorage;
        if (jsonStorage?.manager) {
            const storagePath = jsonStorage.manager.getStoragePath();
            debug(`[Graphology Persistence] Storage path: ${storagePath}`);
            const persistenceManager =
                createGraphologyPersistenceManager(storagePath);

            try {
                debug("[Graphology Persistence] Saving entity graph...");
                await persistenceManager.saveEntityGraph(entityGraph, metadata);

                debug("[Graphology Persistence] Saving topic graph...");
                await persistenceManager.saveTopicGraph(topicGraph, metadata);

                debug("[Graphology Persistence] ✓ All graphs saved to disk");
            } catch (persistError) {
                debug(
                    `[Graphology Persistence] ❌ Failed to persist graphs: ${persistError}`,
                );
                // Continue since we have graphs in memory
            }
        } else {
            debug("[Graphology Persistence] ❌ No storage manager available");
        }

        const timeElapsed = Date.now() - startTime;

        // Get stats from the Graphology graphs
        const stats = {
            entitiesFound: entityGraph.order,
            relationshipsCreated: entityGraph.size,
            communitiesDetected: metadata?.communityCount || 0,
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

        // Get website collection to rebuild from cache
        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection) {
            return {
                success: false,
                error: "Website collection not available",
            };
        }

        // Rebuild the knowledge graph using websiteCollection - returns Graphology graphs directly
        debug(
            "[Knowledge Graph] Building Graphology graphs directly from cache...",
        );
        const buildResult = await websiteCollection.buildGraph();
        debug("[Knowledge Graph] Direct Graphology graph build completed");

        // Check if we got Graphology graphs
        if (!buildResult?.entityGraph || !buildResult?.topicGraph) {
            throw new Error(
                "Failed to build Graphology graphs from website collection",
            );
        }

        const { entityGraph, topicGraph, metadata } = buildResult;

        // Cache the Graphology graphs directly in memory
        debug("[Knowledge Graph] Caching Graphology graphs directly...");
        await cacheGraphologyGraphs(
            websiteCollection,
            entityGraph,
            topicGraph,
            metadata,
        );

        // Persist Graphology graphs to disk in native format
        const storagePath = `.scratch/storage`; // Use direct path instead of JSON storage manager
        debug(`[Graphology Persistence] Using storage path: ${storagePath}`);
        const persistenceManager =
            createGraphologyPersistenceManager(storagePath);

        try {
            debug(
                "[Graphology Persistence] Attempting to save entity graph to disk...",
            );
            await persistenceManager.saveEntityGraph(entityGraph, metadata);
            debug("[Graphology Persistence] ✓ Entity graph saved to disk");

            debug(
                "[Graphology Persistence] Attempting to save topic graph to disk...",
            );
            await persistenceManager.saveTopicGraph(topicGraph, metadata);
            debug("[Graphology Persistence] ✓ Topic graph saved to disk");

            debug(
                "[Graphology Persistence] ✓ All Graphology graphs saved to disk successfully",
            );
        } catch (persistError) {
            debug(
                `[Graphology Persistence] ❌ Failed to persist graphs: ${persistError}`,
            );
            // Continue anyway since we have the graphs in memory
        }

        // Update traditional caches to maintain compatibility
        const entities = extractEntitiesFromGraphology(entityGraph);
        const relationships = extractRelationshipsFromGraphology(entityGraph);
        const communities = extractCommunitiesFromGraphology(entityGraph);

        // Calculate entity metrics properly to avoid 0 entity count issue
        const entityMetrics = calculateEntityMetrics(
            entities,
            relationships,
            communities,
        );

        setGraphCache(websiteCollection, {
            entities,
            relationships,
            communities,
            entityMetrics,
            lastUpdated: Date.now(),
            isValid: true,
        });

        debug(
            `[Knowledge Graph] Traditional cache updated with ${entityMetrics.length} entity metrics`,
        );

        debug(
            "[Knowledge Graph] Graphology-only knowledge graph rebuild completed successfully",
        );

        return {
            success: true,
            message: `Knowledge graph rebuilt successfully using Graphology-only architecture. Entity graph: ${entityGraph.order} nodes, ${entityGraph.size} edges. Topic graph: ${topicGraph.order} nodes, ${topicGraph.size} edges. Build time: ${metadata?.buildTime || 0}ms`,
        };
    } catch (error) {
        console.error("Error rebuilding knowledge graph:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

async function analyzeTopicRelationshipsWithLLM(topicNames: string[]): Promise<
    Map<
        string,
        {
            action: "keep_root" | "make_child" | "merge";
            targetTopic?: string;
            confidence: number;
            reasoning: string;
        }
    >
> {
    const relationshipMap = new Map();

    if (topicNames.length === 0) {
        return relationshipMap;
    }

    const BATCH_SIZE = 50;
    const totalTopics = topicNames.length;
    const needsBatching = totalTopics > BATCH_SIZE;

    console.log(`[LLM Topic Analysis] Analyzing ${totalTopics} topics...`);
    console.log(`[LLM Topic Analysis] Sample topics:`, topicNames.slice(0, 10));

    if (needsBatching) {
        const numBatches = Math.ceil(totalTopics / BATCH_SIZE);
        console.log(
            `[LLM Topic Analysis] Processing in ${numBatches} batches of up to ${BATCH_SIZE} topics each`,
        );

        for (let i = 0; i < numBatches; i++) {
            const start = i * BATCH_SIZE;
            const end = Math.min(start + BATCH_SIZE, totalTopics);
            const batch = topicNames.slice(start, end);

            console.log(
                `[LLM Topic Analysis] Processing batch ${i + 1}/${numBatches} (topics ${start + 1}-${end})...`,
            );

            const batchResults = await analyzeBatchOfTopics(batch, topicNames);

            for (const [topic, relationship] of batchResults) {
                relationshipMap.set(topic, relationship);
            }
        }

        let makeChildCount = 0;
        let mergeCount = 0;
        let keepRootCount = 0;
        const sampleRelationships: string[] = [];

        for (const [topic, relationship] of relationshipMap) {
            if (relationship.action === "make_child") {
                makeChildCount++;
                if (sampleRelationships.length < 5) {
                    sampleRelationships.push(
                        `  "${topic}" → child of "${relationship.targetTopic}" (${relationship.confidence.toFixed(2)})`,
                    );
                }
            } else if (relationship.action === "merge") {
                mergeCount++;
                if (sampleRelationships.length < 5) {
                    sampleRelationships.push(
                        `  "${topic}" → merge into "${relationship.targetTopic}" (${relationship.confidence.toFixed(2)})`,
                    );
                }
            } else {
                keepRootCount++;
            }
        }

        console.log(`[LLM Topic Analysis] Final Summary:`);
        console.log(`  - Keep as root: ${keepRootCount}`);
        console.log(`  - Make child: ${makeChildCount}`);
        console.log(`  - Merge: ${mergeCount}`);

        if (sampleRelationships.length > 0) {
            console.log(`[LLM Topic Analysis] Sample relationships:`);
            sampleRelationships.forEach((rel) => console.log(rel));
        }

        return relationshipMap;
    } else {
        return await analyzeBatchOfTopics(topicNames, topicNames);
    }
}

async function analyzeBatchOfTopics(
    batchTopics: string[],
    allTopics: string[],
): Promise<
    Map<
        string,
        {
            action: "keep_root" | "make_child" | "merge";
            targetTopic?: string;
            confidence: number;
            reasoning: string;
        }
    >
> {
    const relationshipMap = new Map();

    try {
        const schemaText = getSchemaFileContents("topicRelationship.mts");

        const apiSettings = ai.azureApiSettingsFromEnv(
            ai.ModelType.Chat,
            undefined,
            "GPT_4_O",
        );
        const model = ai.createChatModel(apiSettings);

        const validator =
            createTypeScriptJsonValidator<TopicRelationshipAnalysis>(
                schemaText,
                "TopicRelationshipAnalysis",
            );
        const translator = createJsonTranslator(model, validator);

        const topicList = batchTopics
            .map((t, i) => `${i + 1}. ${t}`)
            .join("\n");

        const allTopicsList =
            batchTopics.length < allTopics.length
                ? `\n\nFor context, here are all topics in the system (consider these as potential parent topics):\n${allTopics.join(", ")}`
                : "";
        // all-topics list is getting truncated - not useful!
        const prompt = `Analyze these topic names and identify semantic relationships between them.

Topics to analyze:
${topicList}${allTopicsList}

For each topic, determine the appropriate action based on the TopicRelationshipAnalysis schema.`;

        const estimatedPromptSize = prompt.length + schemaText.length;
        const estimatedTokens = Math.ceil(estimatedPromptSize / 4);

        console.log(`[LLM Topic Analysis] Batch request details:`);
        console.log(`  - Batch size: ${batchTopics.length} topics`);
        console.log(`  - Prompt size: ${prompt.length} chars`);
        console.log(`  - Schema size: ${schemaText.length} chars`);
        console.log(
            `  - Estimated total: ${estimatedPromptSize} chars (~${estimatedTokens} tokens)`,
        );

        const response = await translator.translate(prompt);

        if (!response.success) {
            console.warn("LLM batch analysis failed:", response.message);
            return relationshipMap;
        }

        const analysisResult = response.data;

        console.log(
            `[LLM Topic Analysis] Batch received ${analysisResult.relationships.length} relationship recommendations`,
        );

        for (const relationship of analysisResult.relationships) {
            if (relationship.topic && relationship.action) {
                relationshipMap.set(relationship.topic, {
                    action: relationship.action,
                    targetTopic: relationship.targetTopic,
                    confidence: relationship.confidence || 0.5,
                    reasoning: relationship.reasoning || "LLM analysis",
                });
            }
        }

        return relationshipMap;
    } catch (error) {
        console.error("[LLM Topic Analysis] Batch error:", error);
        return relationshipMap;
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
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                success: false,
                mergeCount: 0,
                error: "Website collection not available",
            };
        }

        console.log(
            "[Merge Action] Starting topic hierarchy merge with LLM analysis...",
        );

        const result = await websiteCollection.mergeTopicHierarchiesWithLLM(
            analyzeTopicRelationshipsWithLLM,
        );

        invalidateTopicCache(websiteCollection);

        const message = `✓ Topic merge completed! ${result.mergeCount} topics reorganized. Reload the page to see updated hierarchy.`;
        console.log(`[Merge Action] ${message}`);

        return {
            success: true,
            mergeCount: result.mergeCount,
            message,
        };
    } catch (error) {
        console.error("Error merging topic hierarchies:", error);
        const errorMsg =
            error instanceof Error ? error.message : "Unknown error";
        return {
            success: false,
            mergeCount: 0,
            error: `Failed to merge topics: ${errorMsg}`,
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
        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection) {
            debug("[discoverRelatedKnowledge] No website collection available");
            return {
                relatedEntities: [],
                relatedTopics: [],
                success: false,
            };
        }

        const depth = parameters.depth || 2;
        const maxEntities = parameters.maxEntities || 10;
        const maxTopics = parameters.maxTopics || 10;

        debug(
            `[discoverRelatedKnowledge] Starting discovery with ${parameters.entities.length} entities, ${parameters.topics.length} topics, depth=${depth}`,
        );

        // Discover related entities via graph traversal
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

        // Traverse from each seed entity
        for (const seedEntity of parameters.entities) {
            try {
                const neighborhoodResult = await getEntityNeighborhood(
                    { entityId: seedEntity.name, depth, maxNodes: 50 },
                    context,
                );

                if (neighborhoodResult.neighbors) {
                    for (const neighbor of neighborhoodResult.neighbors) {
                        // Skip if this is one of the seed entities
                        if (
                            parameters.entities.some(
                                (e) =>
                                    e.name.toLowerCase() ===
                                    neighbor.name.toLowerCase(),
                            )
                        ) {
                            continue;
                        }

                        const existingEntry = relatedEntitiesMap.get(
                            neighbor.name.toLowerCase(),
                        );

                        // Calculate distance from relationships
                        const relationships =
                            neighborhoodResult.relationships?.filter(
                                (r: any) =>
                                    r.toEntity === neighbor.name ||
                                    r.fromEntity === neighbor.name,
                            ) || [];

                        const distance = relationships.length > 0 ? 1 : depth;

                        // Calculate co-occurrence count (how many pages this entity appears on)
                        const cooccurrenceCount =
                            neighbor.occurrences?.length || 1;

                        if (
                            !existingEntry ||
                            distance < existingEntry.distance
                        ) {
                            // Get relationship path
                            const relationshipPath: string[] = [];
                            if (relationships.length > 0) {
                                relationshipPath.push(
                                    relationships[0].relationshipType ||
                                        "related_to",
                                );
                            }

                            relatedEntitiesMap.set(
                                neighbor.name.toLowerCase(),
                                {
                                    name: neighbor.name,
                                    type: neighbor.type || "unknown",
                                    relationshipPath,
                                    distance,
                                    confidence: neighbor.confidence || 0.5,
                                    cooccurrenceCount,
                                },
                            );
                        }
                    }
                }
            } catch (error) {
                debug(
                    `[discoverRelatedKnowledge] Error processing entity ${seedEntity.name}: ${error}`,
                );
            }
        }

        // Discover related topics via co-occurrence
        const relatedTopicsMap = new Map<
            string,
            {
                name: string;
                cooccurrenceCount: number;
                distance: number;
            }
        >();

        if (parameters.topics.length > 0) {
            try {
                const expandedTopics = await expandTopicNeighborhood(
                    parameters.topics,
                    depth,
                    websiteCollection,
                );

                for (const topic of expandedTopics) {
                    // Skip if this is one of the seed topics
                    if (
                        parameters.topics.some(
                            (t) => t.toLowerCase() === topic.toLowerCase(),
                        )
                    ) {
                        continue;
                    }

                    // Get co-occurrence count
                    let cooccurrenceCount = 0;
                    if (
                        websiteCollection.knowledgeTopics &&
                        (websiteCollection.knowledgeTopics as any)
                            .getRelatedTopics
                    ) {
                        const relatedEntries = (
                            websiteCollection.knowledgeTopics as any
                        ).getRelatedTopics(topic, 100);
                        cooccurrenceCount = relatedEntries?.length || 1;
                    }

                    // Calculate distance (1 for direct co-occurrence, 2+ for multi-hop)
                    const isDirectlyRelated = parameters.topics.some(
                        (seedTopic) => {
                            if (
                                websiteCollection.knowledgeTopics &&
                                (websiteCollection.knowledgeTopics as any)
                                    .getRelatedTopics
                            ) {
                                const related =
                                    (
                                        websiteCollection.knowledgeTopics as any
                                    ).getRelatedTopics(seedTopic, 50) || [];
                                return related.some(
                                    (r: any) =>
                                        r.topic?.toLowerCase() ===
                                        topic.toLowerCase(),
                                );
                            }
                            return false;
                        },
                    );

                    const distance = isDirectlyRelated ? 1 : 2;

                    relatedTopicsMap.set(topic.toLowerCase(), {
                        name: topic,
                        cooccurrenceCount,
                        distance,
                    });
                }
            } catch (error) {
                debug(
                    `[discoverRelatedKnowledge] Error expanding topics: ${error}`,
                );
            }
        }

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
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            console.log(`[ServerPerf] No website collection available`);
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

        // Ensure cache is populated (this loads from Graphology and creates the cache)
        await ensureGraphCache(context);
        const cache = getGraphCache(websiteCollection);

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
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
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

        await ensureGraphCache(context);
        const cache = getGraphCache(websiteCollection);

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
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return { distribution: [], recommendedLevel: 1, levelPreview: [] };
        }

        // Ensure cache is populated
        await ensureGraphCache(context);

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
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                success: false,
                error: "Website collection not available",
            };
        }

        const allTopics = websiteCollection.getTopicHierarchy() || [];

        if (allTopics.length === 0) {
            return {
                success: false,
                error: "Hierarchical topics not available",
            };
        }

        const topic = allTopics.find(
            (t: any) => t.topicId === parameters.topicId,
        );

        if (!topic) {
            return {
                success: false,
                error: "Topic not found",
            };
        }

        const topicData: any = topic;

        const entityReferences: Set<string> = new Set();
        const keywords: Set<string> = new Set();
        let firstSeen: string | undefined;
        let lastSeen: string | undefined;

        const sourceRefOrdinals: Set<number> = new Set();

        if (
            topicData.sourceRefOrdinals &&
            Array.isArray(topicData.sourceRefOrdinals)
        ) {
            topicData.sourceRefOrdinals.forEach((ordinal: number) =>
                sourceRefOrdinals.add(ordinal),
            );
        }

        if (topicData.childIds && Array.isArray(topicData.childIds)) {
            topicData.childIds.forEach((childId: string) => {
                const childTopic: any = allTopics.find(
                    (t: any) => t.topicId === childId,
                );
                if (
                    childTopic &&
                    childTopic.sourceRefOrdinals &&
                    Array.isArray(childTopic.sourceRefOrdinals)
                ) {
                    childTopic.sourceRefOrdinals.forEach((ordinal: number) =>
                        sourceRefOrdinals.add(ordinal),
                    );
                }
            });
        }

        const timestamps: string[] = [];
        const processedMessages = new Set<number>();

        if (websiteCollection.semanticRefs && sourceRefOrdinals.size > 0) {
            for (const ordinal of sourceRefOrdinals) {
                const semanticRef = websiteCollection.semanticRefs.get(ordinal);
                if (semanticRef) {
                    const messageOrdinal =
                        semanticRef.range.start.messageOrdinal;

                    if (!processedMessages.has(messageOrdinal)) {
                        processedMessages.add(messageOrdinal);

                        const message =
                            websiteCollection.messages.get(messageOrdinal);
                        if (message) {
                            if (message.timestamp) {
                                timestamps.push(message.timestamp);
                            }

                            const knowledge = message.knowledge;
                            if (knowledge) {
                                if (
                                    knowledge.entities &&
                                    Array.isArray(knowledge.entities)
                                ) {
                                    knowledge.entities.forEach(
                                        (entity: any) => {
                                            if (entity.name) {
                                                entityReferences.add(
                                                    entity.name,
                                                );
                                            }
                                        },
                                    );
                                }

                                if (
                                    knowledge.topics &&
                                    Array.isArray(knowledge.topics)
                                ) {
                                    knowledge.topics.forEach((topic: any) => {
                                        if (typeof topic === "string") {
                                            keywords.add(topic);
                                        }
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        if (timestamps.length > 0) {
            timestamps.sort();
            firstSeen = timestamps[0];
            lastSeen = timestamps[timestamps.length - 1];
        }

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
            topicId: topic.topicId,
            topicName: topic.topicName,
            level: topic.level || 0,
            confidence: topic.confidence || 0,
            entityReferences: Array.from(entityReferences),
            keywords: Array.from(keywords),
        };

        if (firstSeen) details.firstSeen = firstSeen;
        if (lastSeen) details.lastSeen = lastSeen;
        if (topic.parentTopicId) details.parentTopicId = topic.parentTopicId;
        if (topicData.childCount !== undefined)
            details.childCount = topicData.childCount as number;

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
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                success: false,
                error: "Website collection not available",
            };
        }

        // Use cache for performance - loads from JSON storage if needed
        await ensureGraphCache(context);
        const cache = getGraphCache(websiteCollection);

        if (!cache || !cache.isValid || !cache.entityMetrics) {
            return {
                success: false,
                error: "Entity cache not available",
            };
        }

        const entity = cache.entityMetrics.find(
            (e: any) => e.name === parameters.entityName,
        );

        if (!entity) {
            return {
                success: false,
                error: "Entity not found",
            };
        }

        const entityReferences: Set<string> = new Set();
        const topics: Set<string> = new Set();
        const websites: Set<string> = new Set();
        const timestamps: string[] = [];
        const processedMessages = new Set<number>();

        const kp = await import("knowpro");
        const searchTermGroup = kp.createEntitySearchTermGroup(
            parameters.entityName,
            undefined,
            undefined,
            undefined,
            false,
        );

        const whenFilter = { knowledgeType: "entity" as const };
        const searchResult = await kp.searchConversationKnowledge(
            websiteCollection,
            searchTermGroup,
            whenFilter,
            { maxKnowledgeMatches: 100 },
        );

        if (searchResult) {
            for (const [, result] of searchResult) {
                if (result.semanticRefMatches) {
                    for (const scoredRef of result.semanticRefMatches) {
                        const semanticRef = websiteCollection.semanticRefs.get(
                            scoredRef.semanticRefOrdinal,
                        );
                        if (semanticRef) {
                            const messageOrdinal =
                                semanticRef.range.start.messageOrdinal;

                            if (!processedMessages.has(messageOrdinal)) {
                                processedMessages.add(messageOrdinal);

                                const message =
                                    websiteCollection.messages.get(
                                        messageOrdinal,
                                    );
                                if (message) {
                                    if (message.timestamp) {
                                        timestamps.push(message.timestamp);
                                    }

                                    if ((message as any).url) {
                                        websites.add((message as any).url);
                                    }

                                    const knowledge = message.knowledge;
                                    if (knowledge) {
                                        if (
                                            knowledge.entities &&
                                            Array.isArray(knowledge.entities)
                                        ) {
                                            knowledge.entities.forEach(
                                                (e: any) => {
                                                    if (
                                                        e.name &&
                                                        e.name !==
                                                            parameters.entityName
                                                    ) {
                                                        entityReferences.add(
                                                            e.name,
                                                        );
                                                    }
                                                },
                                            );
                                        }

                                        if (
                                            knowledge.topics &&
                                            Array.isArray(knowledge.topics)
                                        ) {
                                            knowledge.topics.forEach(
                                                (topic: any) => {
                                                    if (
                                                        typeof topic ===
                                                        "string"
                                                    ) {
                                                        topics.add(topic);
                                                    }
                                                },
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        let firstSeen: string | undefined;
        let lastSeen: string | undefined;
        if (timestamps.length > 0) {
            timestamps.sort();
            firstSeen = timestamps[0];
            lastSeen = timestamps[timestamps.length - 1];
        }

        const details: any = {
            name: entity.name,
            type: entity.type || "entity",
            confidence: entity.confidence || 0.5,
            count: entity.count || 1,
        };

        if (entity.degree !== undefined) details.degree = entity.degree;
        if (entity.importance !== undefined)
            details.importance = entity.importance;

        if (topics.size > 0) {
            details.topicAffinity = Array.from(topics).slice(0, 15);
        }

        if (entityReferences.size > 0) {
            details.relatedEntities = Array.from(entityReferences).slice(0, 15);
        }

        if (websites.size > 0) {
            details.websites = Array.from(websites).slice(0, 15);
        }

        if (firstSeen) details.firstSeen = firstSeen;
        if (lastSeen) details.lastSeen = lastSeen;

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
        try {
            const topics = websiteCollection.getTopicHierarchy() || [];
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
            tracker.endOperation("getUrlContentBreakdown.countTopics", 0, 0);
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

        // Note: Relationship counting removed - relationships now computed from Graphology graphs
        tracker.startOperation("getUrlContentBreakdown.countRelationships");
        tracker.endOperation("getUrlContentBreakdown.countRelationships", 0, 0);

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
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                success: false,
                timelines: [],
                metadata: {
                    totalEntries: 0,
                    timeRange: { earliest: "", latest: "" },
                    topicsWithActivity: 0,
                },
                error: "Website collection not available",
            };
        }

        debug(
            `[Topic Timelines] Processing ${parameters.topicNames.length} topics`,
        );

        // 1. Expand topic list with neighborhood exploration
        let allTopics = [...parameters.topicNames];

        if (parameters.includeRelatedTopics) {
            allTopics = await expandTopicNeighborhood(
                parameters.topicNames,
                parameters.neighborhoodDepth || 1,
                websiteCollection,
            );
            debug(
                `[Topic Timelines] Expanded to ${allTopics.length} topics including neighbors`,
            );
        }

        // 2. Get timeline data for each topic
        const timelines: TopicTimeline[] = [];

        for (const topicName of allTopics) {
            const timeline = await buildTopicTimeline(
                topicName,
                websiteCollection,
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

async function expandTopicNeighborhood(
    seedTopics: string[],
    depth: number,
    websiteCollection: any,
): Promise<string[]> {
    const allTopics = new Set(seedTopics);

    try {
        // Use existing topic relationship functionality to find connected topics
        for (const seedTopic of seedTopics) {
            // Get related topics from knowledge topics table
            if (
                websiteCollection.knowledgeTopics &&
                websiteCollection.knowledgeTopics.getRelatedTopics
            ) {
                const relatedTopics =
                    websiteCollection.knowledgeTopics.getRelatedTopics(
                        seedTopic,
                        10,
                    ) || [];

                relatedTopics.forEach((topicEntry: any) => {
                    if (topicEntry.topic && topicEntry.topic !== seedTopic) {
                        allTopics.add(topicEntry.topic);
                    }
                });
            }
        }

        debug(
            `[Topic Neighborhood] Expanded ${seedTopics.length} seed topics to ${allTopics.size} total topics`,
        );
    } catch (error) {
        debug(`[Topic Neighborhood] Error expanding topics: ${error}`);
        // Return original topics if expansion fails
        return seedTopics;
    }

    return Array.from(allTopics);
}

async function buildTopicTimeline(
    topicName: string,
    websiteCollection: any,
    parameters: any,
): Promise<TopicTimeline> {
    const activities: TopicActivity[] = [];

    try {
        // 1. Get all URLs associated with this topic from knowledgeTopics table
        let topicEntries: any[] = [];

        if (websiteCollection.knowledgeTopics) {
            // Query the database directly for topics matching the name
            const stmt = websiteCollection.knowledgeTopics.db.prepare(`
                SELECT * FROM knowledgeTopics 
                WHERE topic LIKE ? 
                ORDER BY relevance DESC
            `);
            topicEntries = stmt.all(`%${topicName}%`) || [];
        }

        debug(
            `[Topic Timeline] Found ${topicEntries.length} topic entries for "${topicName}"`,
        );

        // 2. For each URL, get temporal engagement data from website collection
        const websites = websiteCollection.getWebsiteDocParts() || [];
        const urlToWebsiteMap = new Map();

        websites.forEach((website: any) => {
            if (website.url) {
                urlToWebsiteMap.set(website.url, website);
            }
        });

        for (const topicEntry of topicEntries) {
            const websiteData = urlToWebsiteMap.get(topicEntry.url);

            if (websiteData && websiteData.metadata) {
                const metadata = websiteData.metadata;
                const title =
                    metadata.title || websiteData.title || "Unknown Title";
                const snippet =
                    metadata.description ||
                    metadata.contentSummary ||
                    websiteData.snippet;

                // Add bookmark activity
                if (metadata.bookmarkDate) {
                    activities.push({
                        timestamp: metadata.bookmarkDate,
                        activityType: "bookmark",
                        url: topicEntry.url,
                        title: title,
                        domain:
                            topicEntry.domain ||
                            metadata.domain ||
                            extractDomainFromUrl(topicEntry.url),
                        relevance: topicEntry.relevance || 0,
                        snippet: snippet,
                        metadata: {
                            extractionDate: topicEntry.extractionDate,
                        },
                    });
                }

                // Add visit activity
                if (metadata.visitDate) {
                    activities.push({
                        timestamp: metadata.visitDate,
                        activityType: "visit",
                        url: topicEntry.url,
                        title: title,
                        domain:
                            topicEntry.domain ||
                            metadata.domain ||
                            extractDomainFromUrl(topicEntry.url),
                        relevance: topicEntry.relevance || 0,
                        snippet: snippet,
                        metadata: {
                            visitCount: metadata.visitCount,
                            extractionDate: topicEntry.extractionDate,
                        },
                    });
                }

                // Add knowledge extraction activity
                if (topicEntry.extractionDate) {
                    const knowledgeChunk = await getKnowledgeChunkForTopic(
                        websiteData,
                        topicName,
                    );

                    activities.push({
                        timestamp: topicEntry.extractionDate,
                        activityType: "extraction",
                        url: topicEntry.url,
                        title: title,
                        domain:
                            topicEntry.domain ||
                            metadata.domain ||
                            extractDomainFromUrl(topicEntry.url),
                        relevance: topicEntry.relevance || 0,
                        knowledgeChunk: knowledgeChunk,
                        metadata: {
                            confidence: topicEntry.relevance,
                        },
                    });
                }
            }
        }

        // Deduplicate activities with same URL and timestamp
        // Priority: bookmark > visit > extraction
        const activityPriority: Record<string, number> = {
            bookmark: 3,
            visit: 2,
            extraction: 1,
        };

        const dedupeMap = new Map<string, TopicActivity>();

        for (const activity of activities) {
            const key = `${activity.url}|${activity.timestamp}`;
            const existing = dedupeMap.get(key);

            if (!existing) {
                dedupeMap.set(key, activity);
            } else {
                // Keep the activity with higher priority
                const existingPriority =
                    activityPriority[existing.activityType] || 0;
                const newPriority =
                    activityPriority[activity.activityType] || 0;

                if (newPriority > existingPriority) {
                    dedupeMap.set(key, activity);
                }
            }
        }

        // Convert deduplicated map back to array
        const deduplicatedActivities = Array.from(dedupeMap.values());

        debug(
            `[Topic Timeline] Deduplicated ${activities.length} activities to ${deduplicatedActivities.length} unique entries`,
        );

        // Sort activities by timestamp (most recent first)
        deduplicatedActivities.sort(
            (a, b) =>
                new Date(b.timestamp).getTime() -
                new Date(a.timestamp).getTime(),
        );

        // Limit activities if specified
        const maxEntries = parameters.maxTimelineEntries || 50;
        const limitedActivities = deduplicatedActivities.slice(0, maxEntries);

        // Calculate activity distribution based on deduplicated activities
        const activityDistribution = {
            bookmarks: deduplicatedActivities.filter(
                (a) => a.activityType === "bookmark",
            ).length,
            visits: deduplicatedActivities.filter(
                (a) => a.activityType === "visit",
            ).length,
            extractions: deduplicatedActivities.filter(
                (a) => a.activityType === "extraction",
            ).length,
        };

        debug(
            `[Topic Timeline] Built timeline for "${topicName}" with ${deduplicatedActivities.length} activities (${limitedActivities.length} limited)`,
        );

        return {
            topicName,
            totalActivity: deduplicatedActivities.length,
            activities: limitedActivities,
            relatedTopics: [], // Could be populated from topic relationships
            activityDistribution,
        };
    } catch (error) {
        debug(
            `[Topic Timeline] Error building timeline for "${topicName}": ${error}`,
        );
        return {
            topicName,
            totalActivity: 0,
            activities: [],
            relatedTopics: [],
            activityDistribution: { bookmarks: 0, visits: 0, extractions: 0 },
        };
    }
}

async function getKnowledgeChunkForTopic(
    websiteData: any,
    topicName: string,
): Promise<string | undefined> {
    try {
        // Try to find text chunks that mention this topic
        if (websiteData.text && typeof websiteData.text === "string") {
            const text = websiteData.text.toLowerCase();
            const topicLower = topicName.toLowerCase();

            if (text.includes(topicLower)) {
                // Find the sentence or paragraph containing the topic
                const sentences = websiteData.text.split(/[.!?]+/);
                for (const sentence of sentences) {
                    if (sentence.toLowerCase().includes(topicLower)) {
                        return (
                            sentence.trim().substring(0, 200) +
                            (sentence.length > 200 ? "..." : "")
                        );
                    }
                }
            }
        }

        // Fallback to content summary or description
        if (websiteData.metadata) {
            return (
                websiteData.metadata.contentSummary?.substring(0, 200) +
                    (websiteData.metadata.contentSummary?.length > 200
                        ? "..."
                        : "") ||
                websiteData.metadata.description?.substring(0, 200) +
                    (websiteData.metadata.description?.length > 200
                        ? "..."
                        : "")
            );
        }

        return undefined;
    } catch (error) {
        debug(`[Knowledge Chunk] Error extracting chunk: ${error}`);
        return undefined;
    }
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
