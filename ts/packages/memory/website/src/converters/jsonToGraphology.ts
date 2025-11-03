// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRequire } from "module";
import registerDebug from "debug";
import type { 
    EntityGraphJson, 
    TopicGraphJson 
} from "../storage/graphJsonStorage.js";

const require = createRequire(import.meta.url);
const Graph = require("graphology");

const debug = registerDebug("typeagent:website:converter:json-to-graphology");

type Graph = any;

/**
 * Converts JSON graph data to Graphology Graph objects for in-memory operations
 */
export class JsonToGraphologyConverter {
    
    /**
     * Create a Graphology graph from entity graph JSON data
     */
    static createEntityGraph(jsonData: EntityGraphJson): Graph {
        debug(`Creating entity graph from JSON: ${jsonData.metadata.nodeCount} nodes, ${jsonData.metadata.edgeCount} edges`);
        
        const graph = new Graph({ type: "undirected" });
        
        // Add nodes
        this.addNodesToGraph(graph, jsonData.nodes.map(node => ({
            id: node.id,
            name: node.name,
            type: node.type,
            confidence: node.confidence,
            domain: node.metadata.domain,
            urls: node.metadata.urls,
            extractionDate: node.metadata.extractionDate
        })));
        
        // Add edges
        this.addEdgesToGraph(graph, jsonData.edges.map(edge => ({
            source: edge.source,
            target: edge.target,
            type: edge.type,
            confidence: edge.confidence,
            sources: edge.metadata.sources,
            count: edge.metadata.count,
            updated: edge.metadata.updated
        })));
        
        debug(`Entity graph created: ${graph.order} nodes, ${graph.size} edges`);
        return graph;
    }
    
    /**
     * Create a Graphology graph from topic graph JSON data (flat structure)
     */
    static createTopicGraph(jsonData: TopicGraphJson): Graph {
        debug(`Creating topic graph from JSON: ${jsonData.metadata.nodeCount} nodes, ${jsonData.metadata.edgeCount} edges`);
        
        const graph = new Graph({ type: "undirected" });
        
        // Add nodes (flatten hierarchy for undirected graph)
        this.addNodesToGraph(graph, jsonData.nodes.map(node => ({
            id: node.id,
            name: node.name,
            level: node.level,
            parentId: node.parentId,
            confidence: node.confidence,
            keywords: node.metadata.keywords,
            sourceTopicNames: node.metadata.sourceTopicNames,
            domains: node.metadata.domains,
            urls: node.metadata.urls,
            extractionDate: node.metadata.extractionDate
        })));
        
        // Add edges
        this.addEdgesToGraph(graph, jsonData.edges.map(edge => ({
            source: edge.source,
            target: edge.target,
            type: edge.type,
            strength: edge.strength,
            cooccurrenceCount: edge.metadata.cooccurrenceCount,
            sourceUrls: edge.metadata.sourceUrls,
            firstSeen: edge.metadata.firstSeen,
            lastSeen: edge.metadata.lastSeen,
            updated: edge.metadata.updated
        })));
        
        debug(`Topic graph created: ${graph.order} nodes, ${graph.size} edges`);
        return graph;
    }
    
    /**
     * Create a hierarchical Graphology graph from topic graph JSON data
     */
    static createHierarchicalTopicGraph(jsonData: TopicGraphJson): Graph {
        debug(`Creating hierarchical topic graph from JSON: ${jsonData.metadata.nodeCount} nodes`);
        
        const graph = new Graph({ type: "directed" });
        
        // Add nodes
        this.addNodesToGraph(graph, jsonData.nodes.map(node => ({
            id: node.id,
            name: node.name,
            level: node.level,
            parentId: node.parentId,
            confidence: node.confidence,
            keywords: node.metadata.keywords,
            sourceTopicNames: node.metadata.sourceTopicNames,
            domains: node.metadata.domains,
            urls: node.metadata.urls,
            extractionDate: node.metadata.extractionDate,
            isLeaf: node.metadata.sourceTopicNames.length > 0
        })));
        
        // Add hierarchical edges (parent-child relationships)
        const hierarchicalEdges = jsonData.nodes
            .filter(node => node.parentId)
            .map(node => ({
                source: node.parentId!,
                target: node.id,
                type: "parent-child",
                strength: 1.0,
                hierarchical: true
            }));
        
        this.addEdgesToGraph(graph, hierarchicalEdges);
        
        // Add topic relationship edges (but only between nodes at same level or nearby levels)
        const relationshipEdges = jsonData.edges
            .filter(edge => {
                const sourceNode = jsonData.nodes.find(n => n.id === edge.source);
                const targetNode = jsonData.nodes.find(n => n.id === edge.target);
                return sourceNode && targetNode && Math.abs(sourceNode.level - targetNode.level) <= 1;
            })
            .map(edge => ({
                source: edge.source,
                target: edge.target,
                type: edge.type,
                strength: edge.strength,
                cooccurrenceCount: edge.metadata.cooccurrenceCount,
                sourceUrls: edge.metadata.sourceUrls,
                firstSeen: edge.metadata.firstSeen,
                lastSeen: edge.metadata.lastSeen,
                updated: edge.metadata.updated,
                hierarchical: false
            }));
        
        this.addEdgesToGraph(graph, relationshipEdges);
        
        debug(`Hierarchical topic graph created: ${graph.order} nodes, ${graph.size} edges`);
        return graph;
    }
    
    /**
     * Create multiple graphs for different use cases from topic graph JSON
     */
    static createTopicGraphs(jsonData: TopicGraphJson): {
        flatGraph: Graph;
        hierarchicalGraph: Graph;
    } {
        return {
            flatGraph: this.createTopicGraph(jsonData),
            hierarchicalGraph: this.createHierarchicalTopicGraph(jsonData)
        };
    }
    
    /**
     * Helper method to add nodes to a graph
     */
    private static addNodesToGraph(graph: Graph, nodes: any[]): void {
        for (const node of nodes) {
            try {
                const { id, ...nodeAttributes } = node;
                
                if (!graph.hasNode(id)) {
                    graph.addNode(id, nodeAttributes);
                } else {
                    // Update existing node attributes
                    graph.mergeNodeAttributes(id, nodeAttributes);
                }
            } catch (error) {
                debug(`Warning: Could not add node ${node.id}: ${error}`);
            }
        }
        
        debug(`Added ${nodes.length} nodes to graph`);
    }
    
    /**
     * Helper method to add edges to a graph
     */
    private static addEdgesToGraph(graph: Graph, edges: any[]): void {
        let edgeCount = 0;
        
        for (const edge of edges) {
            try {
                const { source, target, ...edgeAttributes } = edge;
                
                // Skip self-loops
                if (source === target) {
                    continue;
                }
                
                // Ensure both nodes exist
                if (!graph.hasNode(source) || !graph.hasNode(target)) {
                    debug(`Warning: Skipping edge ${source} -> ${target} - missing nodes`);
                    continue;
                }
                
                // For undirected graphs, check if edge already exists in either direction
                if (graph.type === "undirected" && graph.hasEdge(source, target)) {
                    // Merge attributes instead of adding duplicate edge
                    graph.mergeEdgeAttributes(source, target, edgeAttributes);
                } else if (graph.type === "directed" && graph.hasDirectedEdge(source, target)) {
                    // Merge attributes for directed edge
                    graph.mergeEdgeAttributes(source, target, edgeAttributes);
                } else {
                    // Add new edge
                    graph.addEdge(source, target, edgeAttributes);
                    edgeCount++;
                }
            } catch (error) {
                debug(`Warning: Could not add edge ${edge.source} -> ${edge.target}: ${error}`);
            }
        }
        
        debug(`Added ${edgeCount} edges to graph`);
    }
    
    /**
     * Extract entity-topic relationships as a separate data structure
     */
    static extractTopicEntityRelations(jsonData: TopicGraphJson): Map<string, Array<{
        entityName: string;
        relevance: number;
        domain: string;
    }>> {
        const relationMap = new Map<string, Array<{
            entityName: string;
            relevance: number;
            domain: string;
        }>>();
        
        for (const relation of jsonData.topicEntityRelations) {
            if (!relationMap.has(relation.topicId)) {
                relationMap.set(relation.topicId, []);
            }
            
            relationMap.get(relation.topicId)!.push({
                entityName: relation.entityName,
                relevance: relation.relevance,
                domain: relation.domain
            });
        }
        
        // Sort by relevance
        for (const relations of relationMap.values()) {
            relations.sort((a, b) => b.relevance - a.relevance);
        }
        
        debug(`Extracted topic-entity relations for ${relationMap.size} topics`);
        return relationMap;
    }
    
    /**
     * Extract topic metrics as a Map for efficient lookup
     */
    static extractTopicMetrics(jsonData: TopicGraphJson): Map<string, TopicGraphJson['metrics'][string]> {
        const metricsMap = new Map<string, TopicGraphJson['metrics'][string]>();
        
        for (const [topicId, metrics] of Object.entries(jsonData.metrics)) {
            metricsMap.set(topicId, metrics);
        }
        
        debug(`Extracted metrics for ${metricsMap.size} topics`);
        return metricsMap;
    }
    
    /**
     * Create a simplified graph with only high-confidence nodes and edges for visualization
     */
    static createSimplifiedEntityGraph(
        jsonData: EntityGraphJson, 
        options: {
            minNodeConfidence?: number;
            minEdgeConfidence?: number;
            maxNodes?: number;
        } = {}
    ): Graph {
        const {
            minNodeConfidence = 0.3,
            minEdgeConfidence = 0.3,
            maxNodes = 500
        } = options;
        
        debug(`Creating simplified entity graph with filters: nodeConf>=${minNodeConfidence}, edgeConf>=${minEdgeConfidence}, maxNodes=${maxNodes}`);
        
        // Filter and sort nodes by confidence
        const filteredNodes = jsonData.nodes
            .filter(node => node.confidence >= minNodeConfidence)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, maxNodes);
        
        const nodeIds = new Set(filteredNodes.map(node => node.id));
        
        // Filter edges to only include those between selected nodes with sufficient confidence
        const filteredEdges = jsonData.edges.filter(edge => 
            edge.confidence >= minEdgeConfidence &&
            nodeIds.has(edge.source) && 
            nodeIds.has(edge.target)
        );
        
        const simplifiedJson: EntityGraphJson = {
            ...jsonData,
            nodes: filteredNodes,
            edges: filteredEdges,
            metadata: {
                ...jsonData.metadata,
                nodeCount: filteredNodes.length,
                edgeCount: filteredEdges.length
            }
        };
        
        const graph = this.createEntityGraph(simplifiedJson);
        debug(`Simplified entity graph created: ${graph.order} nodes, ${graph.size} edges`);
        
        return graph;
    }
}