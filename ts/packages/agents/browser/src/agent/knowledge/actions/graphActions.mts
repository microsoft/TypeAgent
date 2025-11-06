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
    metadata: any
): Promise<void> {
    // Convert Graphology graphs to Cytoscape elements for caching
    const entityElements = convertToCytoscapeElements(entityGraph);
    const topicElements = convertToCytoscapeElements(topicGraph);
    
    // Create cache entries with proper parameters
    const entityCache = createGraphologyCache(entityGraph, entityElements, metadata.buildTime || 0, 100);
    const topicCache = createGraphologyCache(topicGraph, topicElements, metadata.buildTime || 0, 100);
    
    // Store in cache with appropriate keys
    setGraphologyCache('entity_default', entityCache);
    setGraphologyCache('topic_default', topicCache);
    
    debug("[Graphology Cache] Cached entity graph with", entityGraph.order, "nodes", entityGraph.size, "edges");
    debug("[Graphology Cache] Cached topic graph with", topicGraph.order, "nodes", topicGraph.size, "edges");
}

function extractEntitiesFromGraphology(entityGraph: any): any[] {
    const entities: any[] = [];
    
    // Extract entity nodes from Graphology graph
    entityGraph.forEachNode((nodeId: string, attributes: any) => {
        if (attributes.type === 'entity') {
            entities.push({
                name: attributes.name || nodeId,
                entityType: attributes.entityType || 'unknown',
                frequency: attributes.frequency || 0,
                websites: attributes.websites || [],
                confidence: attributes.confidence || 1.0
            });
        }
    });
    
    return entities;
}

function extractRelationshipsFromGraphology(entityGraph: any): any[] {
    const relationships: any[] = [];
    
    // Extract relationship edges from Graphology graph
    entityGraph.forEachEdge((edgeId: string, attributes: any, source: string, target: string) => {
        relationships.push({
            id: edgeId,
            rowId: edgeId,
            fromEntity: source,
            toEntity: target,
            source: source,
            target: target,
            relationshipType: attributes.relationshipType || attributes.type || 'co_occurs',
            type: attributes.relationshipType || attributes.type || 'co_occurs',
            strength: attributes.weight || attributes.strength || 1.0,
            confidence: attributes.confidence || 1.0,
            count: attributes.cooccurrenceCount || attributes.count || 1,
            cooccurrenceCount: attributes.cooccurrenceCount || attributes.count || 1
        });
    });
    
    return relationships;
}

function extractCommunitiesFromGraphology(entityGraph: any): any[] {
    const communities: any[] = [];
    
    // Extract community nodes from Graphology graph
    entityGraph.forEachNode((nodeId: string, attributes: any) => {
        if (attributes.type === 'community') {
            communities.push({
                id: nodeId,
                name: attributes.name || `Community ${nodeId}`,
                entities: attributes.entities || [],
                size: attributes.size || 0,
                coherence: attributes.coherence || 0.0,
                importance: attributes.importance || 0.0
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
async function ensureGraphCache(context: SessionContext<BrowserActionContext>): Promise<void> {
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
        tracker.endOperation("ensureGraphCache.buildGraphologyGraphs", 1, buildResult ? 1 : 0);

        if (!buildResult?.entityGraph || !buildResult?.topicGraph) {
            throw new Error("Failed to build Graphology graphs from websiteCollection");
        }

        // Extract entities, relationships, and communities from Graphology graphs
        tracker.startOperation("ensureGraphCache.extractFromGraphology");
        
        const entityGraph = buildResult.entityGraph;
        const rawEntities: any[] = [];
        const relationships: any[] = [];
        const communities: any[] = [];

        // Extract entities from Graphology graph
        entityGraph.forEachNode((nodeId: string, attributes: any) => {
            if (!attributes.type || attributes.type === 'entity') {
                rawEntities.push({
                    name: nodeId,
                    id: nodeId,
                    type: attributes.type || 'entity',
                    confidence: attributes.confidence || 0.5,
                    count: attributes.count || 1,
                    importance: attributes.importance || 0,
                    communityId: attributes.community || 0,
                });
            }
        });

        // Extract relationships from Graphology graph
        entityGraph.forEachEdge((edgeId: string, attributes: any, source: string, target: string) => {
            relationships.push({
                fromEntity: source,
                toEntity: target,
                source: source,
                target: target,
                relationshipType: attributes.type || 'related',
                type: attributes.type || 'related',
                confidence: attributes.confidence || 0.5,
                count: attributes.count || 1,
            });
        });

        // Extract communities (simplified approach)
        const communityMap = new Map<number, { id: number; entities: string[] }>();
        rawEntities.forEach(entity => {
            const communityId = entity.communityId || 0;
            if (!communityMap.has(communityId)) {
                communityMap.set(communityId, { id: communityId, entities: [] });
            }
            communityMap.get(communityId)!.entities.push(entity.name);
        });
        communities.push(...Array.from(communityMap.values()));

        tracker.endOperation("ensureGraphCache.extractFromGraphology", rawEntities.length, relationships.length);

        console.log("[ensureGraphCache] Extracted from Graphology:", {
            entities: rawEntities.length,
            relationships: relationships.length, 
            communities: communities.length
        });

        // Calculate metrics with instrumentation
        tracker.startOperation("ensureGraphCache.calculateEntityMetrics");
        const entityMetrics = calculateEntityMetrics(rawEntities, relationships, communities);
        tracker.endOperation("ensureGraphCache.calculateEntityMetrics", rawEntities.length, entityMetrics.length);

        // Build graphology layout with overlap prevention
        tracker.startOperation("ensureGraphCache.buildGraphologyLayout");
        let presetLayout: { elements: any[]; layoutDuration?: number; communityCount?: number; } | undefined;

        try {
            const layoutStart = Date.now();

            // Convert entities to graph nodes
            const graphNodes: GraphNode[] = entityMetrics.map((entity: any) => ({
                id: entity.name,
                name: entity.name,
                label: entity.name,
                community: entity.community || 0,
                importance: entity.importance || 0,
            }));

            // Convert relationships to graph edges - match getGlobalImportanceLayer format
            const graphEdges: GraphEdge[] = relationships.map((rel: any) => ({
                from: rel.source || rel.fromEntity,
                to: rel.target || rel.toEntity,
                type: rel.type || rel.relationshipType,
                confidence: rel.confidence || 0.5,
                strength: rel.confidence || 0.5,
            }));

            // Debug: Check for graphEdges without types in ensureGraphCache
            const edgesWithoutType = graphEdges.filter(edge => !edge.type);
            if (edgesWithoutType.length > 0) {
                console.log("[ensureGraphCache] Found graphEdges without type:", {
                    count: edgesWithoutType.length,
                    total: graphEdges.length,
                    samples: edgesWithoutType.slice(0, 3)
                });
            }

            debug(`[Graphology] Building layout for ${graphNodes.length} nodes, ${graphEdges.length} edges`);

            // Build graphology graph with ForceAtlas2 + noverlap
            const graph = buildGraphologyGraph(graphNodes, graphEdges);
            const cytoscapeElements = convertToCytoscapeElements(graph);

            const layoutDuration = Date.now() - layoutStart;
            const communityCount = new Set(graphNodes.map((n: any) => n.community)).size;

            presetLayout = {
                elements: cytoscapeElements,
                layoutDuration,
                communityCount,
            };

            debug(`[Graphology] Layout computed in ${layoutDuration}ms with ${communityCount} communities`);
        } catch (error) {
            console.error("[Graphology] Failed to build layout:", error);
            // Continue without preset layout - visualizer will fall back to client-side layout
        }

        tracker.endOperation("ensureGraphCache.buildGraphologyLayout", entityMetrics.length, presetLayout?.elements?.length || 0);

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

        debug(`[Knowledge Graph] Cached ${rawEntities.length} entities, ${relationships.length} relationships, ${communities.length} communities`);

        tracker.endOperation("ensureGraphCache", rawEntities.length + relationships.length + communities.length, entityMetrics.length);
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
async function getGraphologyGraphs(context: SessionContext<BrowserActionContext>): Promise<{
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
        const entityCache = getGraphologyCache('entity_default');
        const topicCache = getGraphologyCache('topic_default');
        
        if (entityCache?.graph && topicCache?.graph) {
            debug("[Graphology] Using memory-cached Graphology graphs");
            return {
                entityGraph: entityCache.graph,
                topicGraph: topicCache.graph,
                useGraphology: true
            };
        }
        
        // Try to load from disk persistence (fast)
        debug("[Graphology] Memory cache miss, trying disk persistence...");
        const jsonStorage = context.agentContext.graphJsonStorage;
        if (jsonStorage?.manager) {
            const storagePath = jsonStorage.manager.getStoragePath();
            const persistenceManager = createGraphologyPersistenceManager(storagePath);
            
            const entityResult = await persistenceManager.loadEntityGraph();
            const topicResult = await persistenceManager.loadTopicGraph();
            
            if (entityResult?.graph && topicResult?.graph) {
                debug("[Graphology] Loaded graphs from disk persistence");
                
                // Cache in memory for next time
                await cacheGraphologyGraphs(websiteCollection, entityResult.graph, topicResult.graph, {
                    buildTime: entityResult.metadata?.buildTime || 0,
                    loadedFromDisk: true
                });
                
                return {
                    entityGraph: entityResult.graph,
                    topicGraph: topicResult.graph,
                    useGraphology: true
                };
            }
        }
        
        // If no cache or persistence, rebuild graphs (slowest)
        debug("[Graphology] No cached graphs found, rebuilding from source...");
        const buildResult = await websiteCollection.buildGraph();
        
        if (buildResult?.entityGraph && buildResult?.topicGraph) {
            // Cache in memory
            await cacheGraphologyGraphs(websiteCollection, buildResult.entityGraph, buildResult.topicGraph, buildResult.metadata);
            
            // Persist to disk for next time
            if (jsonStorage?.manager) {
                const storagePath = jsonStorage.manager.getStoragePath();
                const persistenceManager = createGraphologyPersistenceManager(storagePath);
                
                try {
                    debug(`[Graphology] Persisting entity graph with ${buildResult.entityGraph.order} nodes and ${buildResult.entityGraph.size} edges to ${storagePath}`);
                    await persistenceManager.saveEntityGraph(buildResult.entityGraph, buildResult.metadata);
                    debug(`[Graphology] ✓ Entity graph saved to disk`);
                    
                    debug(`[Graphology] Persisting topic graph with ${buildResult.topicGraph.order} nodes and ${buildResult.topicGraph.size} edges to ${storagePath}`);
                    await persistenceManager.saveTopicGraph(buildResult.topicGraph, buildResult.metadata);
                    debug(`[Graphology] ✓ Topic graph saved to disk`);
                    
                    debug("[Graphology] ✓ All graphs saved to disk persistence successfully");
                } catch (persistError) {
                    debug(`[Graphology] ❌ Failed to persist graphs: ${persistError}`);
                    console.error(`[Graphology] Persistence error details:`, persistError);
                    // Continue anyway since we have the graphs in memory
                }
            }
            
            return {
                entityGraph: buildResult.entityGraph,
                topicGraph: buildResult.topicGraph,
                useGraphology: true
            };
        }
        
        throw new Error("Failed to build Graphology graphs");
    } catch (error) {
        debug(`Error getting Graphology graphs: ${error}`);
        throw new Error(`Failed to get Graphology graphs: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}

/**
 * Get entity statistics from Graphology cache
 */
async function getEntityStatistics(context: SessionContext<BrowserActionContext>): Promise<{
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

        console.log("[getEntityStatistics] Final counts:", { entityCount, relationshipCount, communityCount });

        return {
            entityCount,
            relationshipCount,
            communityCount
        };
    } catch (error) {
        console.error("Error getting entity statistics from Graphology cache:", error);
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
        const { entityCount, relationshipCount, communityCount } = await getEntityStatistics(context);
        
        console.log("[getKnowledgeGraphStatus] Retrieved statistics:", { entityCount, relationshipCount, communityCount });
        
        // Determine if graph exists based on actual data
        const hasGraph = relationshipCount > 0 || entityCount > 0;

        console.log("[getKnowledgeGraphStatus] Final status:", { hasGraph, entityCount, relationshipCount, communityCount });
        debug(`Graph status: ${hasGraph ? 'exists' : 'not found'} - Entities: ${entityCount}, Relationships: ${relationshipCount}, Communities: ${communityCount}`);

        return {
            hasGraph: hasGraph,
            entityCount,
            relationshipCount,
            communityCount,
            isBuilding: false,
        };
    } catch (error) {
        console.error("[getKnowledgeGraphStatus] Error getting graph status:", error);
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
        debug("[Knowledge Graph] Building Graphology graphs from website collection...");
        const buildResult = await websiteCollection.buildGraph();
        debug("[Knowledge Graph] Graphology graph build completed");

        // Check if we got Graphology graphs
        if (!buildResult?.entityGraph || !buildResult?.topicGraph) {
            throw new Error("Failed to build Graphology graphs from website collection");
        }

        const { entityGraph, topicGraph, metadata } = buildResult;

        // Cache the Graphology graphs directly
        debug("[Knowledge Graph] Caching Graphology graphs...");
        await cacheGraphologyGraphs(websiteCollection, entityGraph, topicGraph, metadata);

        // Persist Graphology graphs to disk
        const jsonStorage = context.agentContext.graphJsonStorage;
        if (jsonStorage?.manager) {
            const storagePath = jsonStorage.manager.getStoragePath();
            debug(`[Graphology Persistence] Storage path: ${storagePath}`);
            const persistenceManager = createGraphologyPersistenceManager(storagePath);
            
            try {
                debug("[Graphology Persistence] Saving entity graph...");
                await persistenceManager.saveEntityGraph(entityGraph, metadata);
                
                debug("[Graphology Persistence] Saving topic graph...");
                await persistenceManager.saveTopicGraph(topicGraph, metadata);
                
                debug("[Graphology Persistence] ✓ All graphs saved to disk");
            } catch (persistError) {
                debug(`[Graphology Persistence] ❌ Failed to persist graphs: ${persistError}`);
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
        debug("[Knowledge Graph] Starting Graphology-only knowledge graph rebuild");

        // Get website collection to rebuild from cache
        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection) {
            return {
                success: false,
                error: "Website collection not available",
            };
        }

        // Clear existing SQLite graph tables if they exist
        try {
            if (websiteCollection.relationships) {
                websiteCollection.relationships.clear();
            }
            if (websiteCollection.communities) {
                websiteCollection.communities.clear();
            }
            debug("[Knowledge Graph] Cleared existing SQLite graph data");
        } catch (clearError) {
            // Continue even if clearing fails, as the rebuild might overwrite
            console.warn("Failed to clear existing graph data:", clearError);
        }

        // Rebuild the knowledge graph using websiteCollection - returns Graphology graphs directly
        debug("[Knowledge Graph] Building Graphology graphs directly from cache...");
        const buildResult = await websiteCollection.buildGraph();
        debug("[Knowledge Graph] Direct Graphology graph build completed");

        // Check if we got Graphology graphs
        if (!buildResult?.entityGraph || !buildResult?.topicGraph) {
            throw new Error("Failed to build Graphology graphs from website collection");
        }

        const { entityGraph, topicGraph, metadata } = buildResult;

        // Cache the Graphology graphs directly in memory
        debug("[Knowledge Graph] Caching Graphology graphs directly...");
        await cacheGraphologyGraphs(websiteCollection, entityGraph, topicGraph, metadata);

        // Persist Graphology graphs to disk in native format
        const storagePath = `.scratch/storage`; // Use direct path instead of JSON storage manager
        debug(`[Graphology Persistence] Using storage path: ${storagePath}`);
        const persistenceManager = createGraphologyPersistenceManager(storagePath);
        
        try {
            debug("[Graphology Persistence] Attempting to save entity graph to disk...");
            await persistenceManager.saveEntityGraph(entityGraph, metadata);
            debug("[Graphology Persistence] ✓ Entity graph saved to disk");
            
            debug("[Graphology Persistence] Attempting to save topic graph to disk...");
            await persistenceManager.saveTopicGraph(topicGraph, metadata);
            debug("[Graphology Persistence] ✓ Topic graph saved to disk");
            
            debug("[Graphology Persistence] ✓ All Graphology graphs saved to disk successfully");
        } catch (persistError) {
            debug(`[Graphology Persistence] ❌ Failed to persist graphs: ${persistError}`);
            // Continue anyway since we have the graphs in memory
        }

        // Update traditional caches to maintain compatibility
        const entities = extractEntitiesFromGraphology(entityGraph);
        const relationships = extractRelationshipsFromGraphology(entityGraph);
        const communities = extractCommunitiesFromGraphology(entityGraph);
        
        // Calculate entity metrics properly to avoid 0 entity count issue
        const entityMetrics = calculateEntityMetrics(entities, relationships, communities);
        
        setGraphCache(websiteCollection, {
            entities,
            relationships,
            communities,
            entityMetrics,
            lastUpdated: Date.now(),
            isValid: true,
        });
        
        debug(`[Knowledge Graph] Traditional cache updated with ${entityMetrics.length} entity metrics`);

        debug("[Knowledge Graph] Graphology-only knowledge graph rebuild completed successfully");

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

export async function testMergeTopicHierarchies(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    mergeCount: number;
    message?: string;
    changes?: Array<{
        action: string;
        sourceTopic: string;
        targetTopic?: string;
    }>;
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
            "[Test Merge] Running preview mode - NO CHANGES WILL BE SAVED",
        );

        const result = await websiteCollection.testMergeTopicHierarchies(
            analyzeTopicRelationshipsWithLLM,
        );

        const message = `⚠️ Preview completed: ${result.mergeCount} potential changes found. Use 'mergeTopicHierarchies' action to apply changes.`;
        console.log(`[Test Merge] ${message}`);

        return {
            success: true,
            mergeCount: result.mergeCount,
            message,
            changes: result.changes,
        };
    } catch (error) {
        console.error("Error testing topic merge:", error);
        return {
            success: false,
            mergeCount: 0,
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
        // Try Graphology first
        try {
            const { entityGraph } = await getGraphologyGraphs(context);
            
            if (entityGraph) {
                debug("[Graphology] Getting relationships from Graphology graph");
                const relationships = extractRelationshipsFromGraphology(entityGraph);
                
                // Apply optimization for consistency
                const optimizedRelationships = relationships.map((rel: any, index: number) => ({
                    rowId: index + 1, // Generate rowId since Graphology doesn't have one
                    fromEntity: rel.source || rel.fromEntity,
                    toEntity: rel.target || rel.toEntity,
                    relationshipType: "co_occurs",
                    confidence: rel.confidence,
                    sources: [], // TODO: Extract sources from edge attributes if available
                    count: rel.cooccurrenceCount,
                    weight: rel.strength
                }));
                
                debug(`[Graphology] Returning ${optimizedRelationships.length} relationships`);
                return { relationships: optimizedRelationships };
            }
        } catch (graphologyError) {
            debug(`[Graphology] Failed to get relationships from Graphology: ${graphologyError}`);
        }
        
        // No fallback - return empty if Graphology fails
        return {
            relationships: [],
            error: "No graph data available",
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
        // Try Graphology first (new primary method)
        try {
            const { entityGraph } = await getGraphologyGraphs(context);
            
            if (entityGraph) {
                debug("[Graphology] Getting communities from Graphology graph");
                const communities = extractCommunitiesFromGraphology(entityGraph);
                
                debug(`[Graphology] Returning ${communities.length} communities`);
                return { communities };
            }
        } catch (graphologyError) {
            debug(`[Graphology] Failed to get communities from Graphology: ${graphologyError}`);
        }
        
        // No fallback - return empty if Graphology fails
        return {
            communities: [],
            error: "No graph data available",
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
        // Try Graphology first (new primary method)
        try {
            const { entityGraph } = await getGraphologyGraphs(context);
            
            if (entityGraph) {
                debug("[Graphology] Getting entities from Graphology graph");
                const entities = extractEntitiesFromGraphology(entityGraph);
                
                // Add degree calculations for each entity
                const entitiesWithMetrics = entities.map((entity: any) => {
                    const degree = entityGraph.hasNode(entity.name) ? entityGraph.degree(entity.name) : 0;
                    const neighbors = entityGraph.hasNode(entity.name) ? entityGraph.neighbors(entity.name) : [];
                    
                    return {
                        id: entity.name,
                        name: entity.name,
                        type: entity.entityType || "entity",
                        confidence: entity.confidence || 0.5,
                        count: entity.frequency || 0,
                        degree: degree,
                        importance: degree * (entity.confidence || 0.5), // Simple importance calculation
                        communityId: entityGraph.hasNode(entity.name) ? 
                            entityGraph.getNodeAttribute(entity.name, 'community') : undefined,
                        websites: entity.websites || [],
                        neighbors: neighbors.slice(0, 5) // Limit to first 5 neighbors
                    };
                });
                
                debug(`[Graphology] Returning ${entitiesWithMetrics.length} entities with metrics`);
                return { entities: entitiesWithMetrics };
            }
        } catch (graphologyError) {
            debug(`[Graphology] Failed to get entities from Graphology: ${graphologyError}`);
        }
        
        // No fallback - return empty if Graphology fails
        return {
            entities: [],
            error: "No graph data available",
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
            const neighborEntities = limitedNeighbors.map((neighborId: string) => {
                const attrs = entityGraph.getNodeAttributes(neighborId);
                return {
                    id: neighborId,
                    name: neighborId,
                    type: attrs.type || "entity",
                    confidence: attrs.confidence || 0.5,
                    count: attrs.count || 1,
                };
            });

            // Build relationships
            const relationships = limitedNeighbors.map((neighborId: string, index: number) => {
                const edgeData = entityGraph.getEdgeAttributes(entityGraph.edge(entityId, neighborId));
                return {
                    rowId: `${entityId}-${neighborId}`,
                    fromEntity: entityId,
                    toEntity: neighborId,
                    relationshipType: edgeData.type || "co_occurs",
                    confidence: edgeData.confidence || 0.5,
                    sources: [],
                    count: edgeData.count || 1,
                };
            });

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
                },
            };
        } catch (graphologyError) {
            debug(`[Graphology] Failed to get entity neighborhood: ${graphologyError}`);
        }
        
        // No fallback - return empty if Graphology fails
        return {
            neighbors: [],
            relationships: [],
            error: "No graph data available",
        };
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
                                    (r.target || r.toEntity) === neighbor.name ||
                                    (r.source || r.fromEntity) === neighbor.name,
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
    entities: any[];
    relationships: any[];
    metadata: any;
}> {
    try {
        // Use cache-based approach like main branch
        console.log(`[getGlobalImportanceLayer] Loading data from cache...`);
        
        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection) {
            console.log(`[getGlobalImportanceLayer] No website collection available`);
            return {
                entities: [],
                relationships: [],
                metadata: {
                    totalEntitiesInSystem: 0,
                    selectedEntityCount: 0,
                    coveragePercentage: 0,
                    importanceThreshold: 0,
                    layer: "global_importance",
                    error: "Website collection not available",
                },
            };
        }

        // Ensure cache is populated (this loads from Graphology and creates the cache)
        await ensureGraphCache(context);
        const cache = getGraphCache(websiteCollection);

        if (!cache || !cache.isValid) {
            console.log(`[getGlobalImportanceLayer] Cache validation failed`);
            return {
                entities: [],
                relationships: [],
                metadata: {
                    totalEntitiesInSystem: 0,
                    selectedEntityCount: 0,
                    coveragePercentage: 0,
                    importanceThreshold: 0,
                    layer: "global_importance",
                    error: "Graph cache not available",
                },
            };
        }

        // Get all entities and relationships from cache (like main branch)
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

        console.log(`[getGlobalImportanceLayer] ✓ Using cache with ${allEntities.length} entities and ${allRelationships.length} relationships`);
        
        // Debug: Log first few entities to see their structure
        console.log(`[getGlobalImportanceLayer] DEBUG - First 3 entities from cache:`, 
            allEntities.slice(0, 3).map(e => ({
                name: e.name,
                type: e.type,
                importance: e.importance,
                hasImportance: 'importance' in e,
                keys: Object.keys(e)
            }))
        );
        
        // Calculate entity metrics if not already calculated
        const entitiesWithMetrics = allEntities.length > 0 && allEntities[0].importance !== undefined
            ? allEntities
            : calculateEntityMetrics(allEntities, allRelationships, communities);

        console.log(`[getGlobalImportanceLayer] DEBUG - After calculateEntityMetrics: ${entitiesWithMetrics.length} entities`);
        console.log(`[getGlobalImportanceLayer] DEBUG - First 3 entities with metrics:`, 
            entitiesWithMetrics.slice(0, 3).map(e => ({
                name: e.name,
                type: e.type,
                importance: e.importance,
                hasImportance: 'importance' in e,
                keys: Object.keys(e)
            }))
        );

        // Apply filtering (importance threshold, max nodes) 
        const { maxNodes = 500, minImportanceThreshold } = parameters;
        let filteredEntities = entitiesWithMetrics;
        
        console.log(`[getGlobalImportanceLayer] DEBUG - Filtering parameters:`, {
            maxNodes,
            maxNodesType: typeof maxNodes,
            maxNodesValue: maxNodes,
            minImportanceThreshold,
            parametersReceived: parameters
        });
        
        // Ensure maxNodes is a valid number
        const maxNodesNumber = typeof maxNodes === 'number' ? maxNodes : 500;
        console.log(`[getGlobalImportanceLayer] DEBUG - Using maxNodes: ${maxNodesNumber}`);
        
        if (minImportanceThreshold && minImportanceThreshold > 0) {
            const beforeFilter = filteredEntities.length;
            filteredEntities = entitiesWithMetrics.filter(e => (e.importance || 0) >= minImportanceThreshold);
            debug(`[getGlobalImportanceLayer] Filtered by importance (${minImportanceThreshold}): ${beforeFilter} -> ${filteredEntities.length}`);
            console.log(`[getGlobalImportanceLayer] Importance filter: ${beforeFilter} -> ${filteredEntities.length}`);
            
            if (filteredEntities.length === 0) {
                console.log(`[getGlobalImportanceLayer] DEBUG - All entities filtered by importance! First 5 rejected entities:`,
                    entitiesWithMetrics.slice(0, 5).map(e => ({
                        name: e.name,
                        importance: e.importance,
                        threshold: minImportanceThreshold,
                        passes: (e.importance || 0) >= minImportanceThreshold
                    }))
                );
            }
        }
        
        // Sort by importance and limit to maxNodes
        console.log(`[getGlobalImportanceLayer] DEBUG - Before sorting: ${filteredEntities.length} entities`);
        const sortedEntities = filteredEntities.sort((a, b) => (b.importance || 0) - (a.importance || 0));
        console.log(`[getGlobalImportanceLayer] DEBUG - After sorting: ${sortedEntities.length} entities, top 3 importance values:`,
            sortedEntities.slice(0, 3).map(e => ({ name: e.name, importance: e.importance }))
        );
        
        let selectedEntities = sortedEntities.slice(0, maxNodesNumber);
        
        debug(`[getGlobalImportanceLayer] After limiting: ${selectedEntities.length} entities remaining`);
        console.log(`[getGlobalImportanceLayer] After limiting to ${maxNodesNumber}: ${selectedEntities.length} entities remaining`);
        
        // Get relationships between selected entities
        const selectedEntityNames = new Set(selectedEntities.map(e => e.name));
        console.log(`[getGlobalImportanceLayer] DEBUG - Selected entity names sample:`, Array.from(selectedEntityNames).slice(0, 5));
        
        const selectedRelationships = allRelationships.filter((rel: any) =>
            selectedEntityNames.has(rel.fromEntity) && selectedEntityNames.has(rel.toEntity) &&
            rel.fromEntity && rel.toEntity && rel.fromEntity.trim() !== '' && rel.toEntity.trim() !== ''
        );
        
        console.log(`[getGlobalImportanceLayer] DEBUG - Relationship filtering details:`);
        console.log(`  Total relationships: ${allRelationships.length}`);
        console.log(`  Selected entities: ${selectedEntityNames.size}`);
        console.log(`  First 3 relationships:`, allRelationships.slice(0, 3).map(r => ({
            fromEntity: r.fromEntity,
            toEntity: r.toEntity,
            hasFromInSet: selectedEntityNames.has(r.fromEntity),
            hasToInSet: selectedEntityNames.has(r.toEntity),
            hasValidNames: r.fromEntity && r.toEntity && r.fromEntity.trim() !== '' && r.toEntity.trim() !== ''
        })));
        
        console.log(`[getGlobalImportanceLayer] Filtered to ${selectedEntities.length} entities and ${selectedRelationships.length} relationships`);
        
        // Optimize entities format (like main branch)
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

        // Optimize relationships format (like main branch)
        const optimizedRelationships = selectedRelationships.map((rel: any) => ({
            rowId: rel.id || rel.rowId || `${rel.fromEntity}-${rel.toEntity}`,
            fromEntity: rel.fromEntity,
            toEntity: rel.toEntity,
            relationshipType: rel.relationshipType || rel.type || "co_occurs",
            confidence: rel.confidence || 0.5,
            count: rel.count || 1,
        }));

        // Build graphology layout using the same pipeline as main branch
        const cacheKey = `entity_importance_${maxNodesNumber}`;
        let cachedGraph = getGraphologyCache(cacheKey);
        
        if (!cachedGraph) {
            debug("[Graphology] Building layout for entity importance layer...");
            const layoutStart = performance.now();

            const graphNodes: GraphNode[] = optimizedEntities.map(
                (entity: any) => ({
                    id: entity.id || entity.name,
                    name: entity.name,
                    type: entity.type || "entity",
                    confidence: entity.confidence || 0.5,
                    count: entity.count || 1,
                    importance: entity.importance || 0,
                }),
            );

            const graphEdges: GraphEdge[] = optimizedRelationships.map(
                (rel: any) => ({
                    from: rel.fromEntity,
                    to: rel.toEntity,
                    type: rel.relationshipType,
                    confidence: rel.confidence || 0.5,
                    strength: rel.confidence || 0.5,
                }),
            );

            debug(`[getGlobalImportanceLayer] Building graphology graph with ${graphNodes.length} nodes and ${graphEdges.length} edges`);
            console.log(`[getGlobalImportanceLayer] Building graphology graph with ${graphNodes.length} nodes and ${graphEdges.length} edges`);

            const graph = buildGraphologyGraph(graphNodes, graphEdges, {
                nodeLimit: maxNodesNumber * 2,
                minEdgeConfidence: 0.2,
                denseClusterThreshold: 100,
            });

            const cytoscapeElements = convertToCytoscapeElements(graph, 2000);
            debug(`[getGlobalImportanceLayer] convertToCytoscapeElements produced ${cytoscapeElements.length} elements`);
            const layoutMetrics = calculateLayoutQualityMetrics(graph);
            const layoutDuration = performance.now() - layoutStart;

            cachedGraph = createGraphologyCache(
                graph,
                cytoscapeElements,
                layoutDuration,
                layoutMetrics.avgSpacing,
            );

            setGraphologyCache(cacheKey, cachedGraph);

            debug(`[Graphology] Entity layout complete in ${layoutDuration.toFixed(2)}ms`);
        } else {
            debug("[Graphology] Using cached entity layout");
        }
        
        debug(`[getGlobalImportanceLayer] cachedGraph.cytoscapeElements length: ${cachedGraph?.cytoscapeElements?.length || 0}`);
        debug(`[getGlobalImportanceLayer] selectedEntities length: ${selectedEntities.length}`);

        // Enrich entities with graphology colors and sizes (like main branch)
        const enrichedEntities = optimizedEntities
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
        
        const metadata = {
            totalEntitiesInSystem: allEntities.length,
            selectedEntityCount: enrichedEntities.length,
            totalRelationships: allRelationships.length,
            selectedRelationships: optimizedRelationships.length,
            coveragePercentage: Math.round((enrichedEntities.length / allEntities.length) * 100),
            importanceThreshold: minImportanceThreshold || 0,
            layer: "global_importance_graphology",
            useGraphology: true,
        };
        
        return {
            entities: enrichedEntities,
            relationships: optimizedRelationships,
            metadata: {
                ...metadata,
                graphologyLayout: {
                    elements: cachedGraph.cytoscapeElements,
                    layoutDuration: cachedGraph.metadata.layoutDuration,
                    avgSpacing: cachedGraph.metadata.avgSpacing,
                    communityCount: cachedGraph.metadata.communityCount,
                },
            },
        };
    } catch (error) {
        console.error("[getGlobalImportanceLayer] Error:", error);
        return {
            entities: [],
            relationships: [],
            metadata: {
                totalEntitiesInSystem: 0,
                selectedEntityCount: 0,
                coveragePercentage: 0,
                importanceThreshold: 0,
                layer: "global_importance",
                error: error instanceof Error ? error.message : "Unknown error",
            },
        };
    }
}

/**
 * Get viewport-based neighborhood around center entity with context from viewport nodes
 * Combines importance-based selection with spatial neighborhood exploration
 */
export async function getViewportBasedNeighborhood(
    parameters: {
        centerEntity: string;
        viewportNodeNames: string[];
        maxNodes: number;
        importanceWeighting?: boolean;
        includeGlobalContext?: boolean;
        exploreFromAllViewportNodes?: boolean;
        minDepthFromViewport?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    entities: any[];
    relationships: any[];
    metadata: {
        source: string;
        centerEntity: string;
        viewportAnchorCount: number;
        totalFound: number;
        actualNodes: number;
    };
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection) {
            throw new Error("Website collection not available");
        }

        // Use cache for performance
        await ensureGraphCache(context);
        const cache = getGraphCache(websiteCollection);
        
        if (!cache || !cache.isValid) {
            throw new Error("Graph cache not available");
        }

        const {
            centerEntity,
            viewportNodeNames,
            maxNodes = 5000,
            importanceWeighting = true,
            exploreFromAllViewportNodes = true,
            minDepthFromViewport = 1,
        } = parameters;

        const entitiesWithMetrics = cache.entityMetrics || [];
        const allRelationships = cache.relationships || [];

        // Find center entity
        const centerEntityData = entitiesWithMetrics.find(
            (e: any) => e.name === centerEntity,
        );

        if (!centerEntityData) {
            throw new Error(`Center entity '${centerEntity}' not found`);
        }

        // Build entity map for fast lookup
        const entityMap = new Map<string, any>();
        entitiesWithMetrics.forEach((entity: any) => {
            entityMap.set(entity.name, entity);
        });

        // Build relationship index
        const relationshipIndex = new Map<string, any[]>();
        allRelationships.forEach((rel: any) => {
            const source = rel.source || rel.fromEntity;
            const target = rel.target || rel.toEntity;
            
            if (!relationshipIndex.has(source)) {
                relationshipIndex.set(source, []);
            }
            if (!relationshipIndex.has(target)) {
                relationshipIndex.set(target, []);
            }
            
            relationshipIndex.get(source)!.push(rel);
            relationshipIndex.get(target)!.push(rel);
        });

        // Start with center entity and viewport nodes
        const selectedEntities = new Set<string>([centerEntity]);
        const entitiesToExplore = new Set<string>([centerEntity]);

        // Add viewport nodes
        viewportNodeNames.forEach((name: string) => {
            if (entityMap.has(name)) {
                selectedEntities.add(name);
                if (exploreFromAllViewportNodes) {
                    entitiesToExplore.add(name);
                }
            }
        });

        // Explore neighborhood
        let currentDepth = 0;
        const maxDepth = 3;

        while (
            entitiesToExplore.size > 0 &&
            selectedEntities.size < maxNodes &&
            currentDepth < maxDepth
        ) {
            const currentLevel = Array.from(entitiesToExplore);
            entitiesToExplore.clear();
            currentDepth++;

            // Skip exploration for depths less than minimum from viewport
            if (currentDepth < minDepthFromViewport) {
                currentLevel.forEach((entityName) => {
                    const relationships = relationshipIndex.get(entityName) || [];
                    relationships.forEach((rel: any) => {
                        const neighbor = rel.source === entityName ? rel.target : rel.source;
                        if (!selectedEntities.has(neighbor) && entityMap.has(neighbor)) {
                            entitiesToExplore.add(neighbor);
                        }
                    });
                });
                continue;
            }

            for (const entityName of currentLevel) {
                const relationships = relationshipIndex.get(entityName) || [];
                const neighbors: Array<{ name: string; importance: number; confidence: number }> = [];

                relationships.forEach((rel: any) => {
                    const neighborName = rel.source === entityName ? rel.target : rel.source;
                    if (!selectedEntities.has(neighborName)) {
                        const neighbor = entityMap.get(neighborName);
                        if (neighbor) {
                            neighbors.push({
                                name: neighborName,
                                importance: neighbor.importance || 0,
                                confidence: rel.confidence || rel.count || 1,
                            });
                        }
                    }
                });

                // Sort neighbors by importance or confidence
                neighbors.sort((a, b) => {
                    if (importanceWeighting) {
                        return b.importance - a.importance;
                    }
                    return b.confidence - a.confidence;
                });

                // Add top neighbors
                const neighborsToAdd = Math.min(neighbors.length, Math.floor((maxNodes - selectedEntities.size) / currentLevel.length) + 1);
                for (let i = 0; i < neighborsToAdd && selectedEntities.size < maxNodes; i++) {
                    const neighbor = neighbors[i];
                    selectedEntities.add(neighbor.name);
                    entitiesToExplore.add(neighbor.name);
                }
            }
        }

        // Convert to entities array
        const resultEntities = Array.from(selectedEntities)
            .map((name) => entityMap.get(name))
            .filter((entity) => entity);

        // Get relationships between selected entities
        const selectedEntitySet = new Set(selectedEntities);
        const resultRelationships = allRelationships.filter((rel: any) => {
            const source = rel.source || rel.fromEntity;
            const target = rel.target || rel.toEntity;
            return selectedEntitySet.has(source) && selectedEntitySet.has(target);
        });

        return {
            entities: resultEntities,
            relationships: resultRelationships,
            metadata: {
                source: "viewport_based_neighborhood",
                centerEntity,
                viewportAnchorCount: viewportNodeNames.length,
                totalFound: entitiesWithMetrics.length,
                actualNodes: resultEntities.length,
            },
        };
    } catch (error) {
        console.error("Error in getViewportBasedNeighborhood:", error);
        throw error;
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
    topics: any[];
    relationships: any[];
    metadata: any;
}> {
    debug(`[getTopicImportanceLayer] Called with parameters: ${JSON.stringify(parameters)}`);

    try {

        // Try Graphology topics
        try {
            const { topicGraph } = await getGraphologyGraphs(context);
            
            if (!topicGraph) {
                return {
                    topics: [],
                    relationships: [],
                    metadata: {
                        error: "Topic graph data not available",
                        layer: "topic_importance",
                    },
                };
            }

            const maxNodes = parameters.maxNodes || 500;
            const minImportanceThreshold = parameters.minImportanceThreshold || 0;

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

            debug(`[getTopicImportanceLayer] Found ${allTopics.length} total topics in topic graph`);

            // Filter topics by importance threshold
            const filteredTopics = allTopics.filter(topic => 
                topic.importance >= minImportanceThreshold
            );

            // Sort by importance and limit
            const selectedTopics = filteredTopics
                .sort((a, b) => (b.importance || 0) - (a.importance || 0))
                .slice(0, maxNodes);

            debug(`[getTopicImportanceLayer] Selected ${selectedTopics.length} topics after filtering and limiting`);

            // Create set of selected topic IDs for filtering relationships
            const selectedTopicIds = new Set(selectedTopics.map(t => t.id));

            // Extract relationships only between selected topics
            const relationships: any[] = [];
            topicGraph.forEachEdge((edgeId: string, attributes: any, source: string, target: string) => {
                // Only include relationships where both source and target are in selected topics
                if (selectedTopicIds.has(source) && selectedTopicIds.has(target)) {
                    relationships.push({
                        from: source,
                        to: target,
                        type: attributes.type || "related",
                        strength: attributes.strength || 1,
                        confidence: attributes.confidence || 0.5,
                    });
                }
            });

            debug(`[getTopicImportanceLayer] Filtered ${relationships.length} relationships between selected topics`);

            // Create a subgraph with only selected topics and their relationships for Cytoscape conversion
            const graphNodes: GraphNode[] = selectedTopics.map(topic => ({
                id: topic.id,
                name: topic.name,
                type: "topic",
                confidence: topic.confidence,
                count: topic.count,
                importance: topic.importance,
                level: topic.level,
                parentId: topic.parentId,
            }));

            const graphEdges: GraphEdge[] = relationships.map(rel => ({
                from: rel.from,
                to: rel.to,
                type: rel.type,
                confidence: rel.confidence,
                strength: rel.strength,
            }));

            debug(`[getTopicImportanceLayer] Building subgraph with ${graphNodes.length} nodes and ${graphEdges.length} edges`);

            // Use buildGraphologyGraph to create a properly layouted graph
            const layoutedGraph = buildGraphologyGraph(graphNodes, graphEdges);

            // Convert subgraph to Cytoscape elements for UI rendering
            const cytoscapeElements = convertToCytoscapeElements(layoutedGraph);
            debug(`[getTopicImportanceLayer] Converted to ${cytoscapeElements.length} Cytoscape elements`);

            return {
                topics: selectedTopics,
                relationships: relationships,
                metadata: {
                    totalTopicsInSystem: allTopics.length,
                    selectedTopicCount: selectedTopics.length,
                    layer: "topic_importance_graphology",
                    useGraphology: true,
                    graphologyLayout: {
                        elements: cytoscapeElements,
                        layoutDuration: 0, // No layout computation time for this simple conversion
                        avgSpacing: 100, // Default spacing
                        communityCount: 1, // Single community for topic layer
                    },
                },
            };
        } catch (graphologyError) {
            debug(`[Graphology] Failed to get topic importance layer: ${graphologyError}`);
        }
        
        // No fallback - return empty if Graphology fails
        return {
            topics: [],
            relationships: [],
            metadata: {
                error: "Topic graph data not available",
                layer: "topic_importance",
            },
        };
    } catch (error) {
        console.error("Error in getTopicImportanceLayer:", error);
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

export async function getImportanceStatistics(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    distribution: number[];
    recommendedLevel: number;
    levelPreview: Array<{ level: number; nodeCount: number; coverage: number }>;
}> {
    try {
        // Use cache for performance - loads from JSON storage if needed
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return { distribution: [], recommendedLevel: 1, levelPreview: [] };
        }

        await ensureGraphCache(context);
        const cache = getGraphCache(websiteCollection);

        if (!cache || !cache.isValid || !cache.entityMetrics) {
            return { distribution: [], recommendedLevel: 1, levelPreview: [] };
        }

        const entitiesWithMetrics = cache.entityMetrics;

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
        const totalNodes = entitiesWithMetrics.length;
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
    {
        level: 3,
        threshold: 0.2,
        maxNodes: 10000,
        description: "All Major Nodes",
    },
    {
        level: 4,
        threshold: 0.0,
        maxNodes: 50000,
        description: "Complete Graph",
    },
];

// Importance levels for hierarchical loading
interface ImportanceLevelConfig {
    level: 1 | 2 | 3 | 4;
    threshold: number;
    maxNodes: number;
    description: string;
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
        // Try Graphology first (new primary method)
        try {
            const { topicGraph } = await getGraphologyGraphs(context);
            
            if (topicGraph && topicGraph.hasNode(parameters.topicId)) {
                debug("[Graphology] Getting topic metrics from Graphology graph");
                
                const nodeAttributes = topicGraph.getNodeAttributes(parameters.topicId);
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
                    betweennessCentrality: nodeAttributes.betweennessCentrality || 0,
                    degreeCentrality: nodeAttributes.degreeCentrality || (degree / Math.max(topicGraph.order - 1, 1)),
                    community: nodeAttributes.community || null,
                    importance: nodeAttributes.importance || degree * 0.1,
                    coherence: nodeAttributes.coherence || 0.5,
                    entityCount: nodeAttributes.entityCount || 0,
                    websiteCount: nodeAttributes.websiteCount || 0
                };
                
                debug(`[Graphology] Retrieved metrics for topic: ${parameters.topicId}`);
                return { success: true, metrics };
            }
        } catch (graphologyError) {
            debug(`[Graphology] Failed to get topic metrics from Graphology: ${graphologyError}`);
            // Fall back to SQLite approach
        }
        
        // Fallback to SQLite method (legacy)
        debug("[SQLite Fallback] Using SQLite for topic metrics");
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

        if (!websiteCollection.hierarchicalTopics) {
            return {
                success: false,
                error: "Hierarchical topics not available",
            };
        }

        const allTopics =
            websiteCollection.hierarchicalTopics.getTopicHierarchy() || [];
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
