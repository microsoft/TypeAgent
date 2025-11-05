// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs/promises";
import path from "path";
import registerDebug from "debug";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Graph = require("graphology");

const debug = registerDebug("typeagent:browser:knowledge:graphology:persistence");

export interface GraphologyPersistenceManager {
    saveEntityGraph(graph: any, metadata?: any): Promise<void>;
    saveTopicGraph(graph: any, metadata?: any): Promise<void>;
    loadEntityGraph(): Promise<{ graph: any; metadata?: any } | null>;
    loadTopicGraph(): Promise<{ graph: any; metadata?: any } | null>;
    clearCache(): Promise<void>;
    getStoragePath(): string;
}

export class GraphologyFileManager implements GraphologyPersistenceManager {
    private storagePath: string;
    private entityGraphFile: string;
    private topicGraphFile: string;
    private metadataFile: string;

    constructor(storagePath: string) {
        this.storagePath = storagePath;
        this.entityGraphFile = path.join(storagePath, "entityGraph.graphology.json");
        this.topicGraphFile = path.join(storagePath, "topicGraph.graphology.json");
        this.metadataFile = path.join(storagePath, "graphology.metadata.json");
    }

    getStoragePath(): string {
        return this.storagePath;
    }

    async ensureStorageDirectory(): Promise<void> {
        try {
            await fs.mkdir(this.storagePath, { recursive: true });
        } catch (error) {
            debug(`Failed to create storage directory: ${error}`);
            throw error;
        }
    }

    /**
     * Save entity graph with metadata
     */
    async saveEntityGraph(graph: any, metadata?: any): Promise<void> {
        await this.ensureStorageDirectory();
        
        try {
            const startTime = Date.now();
            
            // Serialize Graphology graph to JSON
            const graphData = {
                nodes: [],
                edges: [],
                graphAttributes: graph.getAttributes()
            } as any;

            // Export nodes with all attributes
            graph.forEachNode((nodeId: string, attributes: any) => {
                graphData.nodes.push({
                    id: nodeId,
                    attributes: attributes
                });
            });

            // Export edges with all attributes
            graph.forEachEdge((edgeId: string, attributes: any, source: string, target: string) => {
                graphData.edges.push({
                    id: edgeId,
                    source: source,
                    target: target,
                    attributes: attributes
                });
            });

            const serializedData = JSON.stringify(graphData, null, 2);
            await fs.writeFile(this.entityGraphFile, serializedData, 'utf8');
            
            const saveTime = Date.now() - startTime;
            debug(`Saved entity graph: ${graph.order} nodes, ${graph.size} edges in ${saveTime}ms`);
            
            // Save metadata separately
            if (metadata) {
                await this.saveMetadata('entity', metadata);
            }
        } catch (error) {
            debug(`Failed to save entity graph: ${error}`);
            throw error;
        }
    }

    /**
     * Save topic graph with metadata
     */
    async saveTopicGraph(graph: any, metadata?: any): Promise<void> {
        await this.ensureStorageDirectory();
        
        try {
            const startTime = Date.now();
            
            // Serialize Graphology graph to JSON
            const graphData = {
                nodes: [],
                edges: [],
                graphAttributes: graph.getAttributes()
            } as any;

            // Export nodes with all attributes
            graph.forEachNode((nodeId: string, attributes: any) => {
                graphData.nodes.push({
                    id: nodeId,
                    attributes: attributes
                });
            });

            // Export edges with all attributes
            graph.forEachEdge((edgeId: string, attributes: any, source: string, target: string) => {
                graphData.edges.push({
                    id: edgeId,
                    source: source,
                    target: target,
                    attributes: attributes
                });
            });

            const serializedData = JSON.stringify(graphData, null, 2);
            await fs.writeFile(this.topicGraphFile, serializedData, 'utf8');
            
            const saveTime = Date.now() - startTime;
            debug(`Saved topic graph: ${graph.order} nodes, ${graph.size} edges in ${saveTime}ms`);
            
            // Save metadata separately
            if (metadata) {
                await this.saveMetadata('topic', metadata);
            }
        } catch (error) {
            debug(`Failed to save topic graph: ${error}`);
            throw error;
        }
    }

    /**
     * Load entity graph from disk
     */
    async loadEntityGraph(): Promise<{ graph: any; metadata?: any } | null> {
        try {
            const startTime = Date.now();
            
            // Check if file exists
            try {
                await fs.access(this.entityGraphFile);
            } catch {
                debug("Entity graph file does not exist");
                return null;
            }

            const fileContent = await fs.readFile(this.entityGraphFile, 'utf8');
            const graphData = JSON.parse(fileContent);
            
            // Reconstruct Graphology graph
            const graph = new Graph({ type: "undirected" });
            
            // Set graph attributes
            if (graphData.graphAttributes) {
                graph.replaceAttributes(graphData.graphAttributes);
            }
            
            // Add nodes
            for (const nodeData of graphData.nodes) {
                graph.addNode(nodeData.id, nodeData.attributes);
            }
            
            // Add edges
            for (const edgeData of graphData.edges) {
                if (graph.hasNode(edgeData.source) && graph.hasNode(edgeData.target)) {
                    try {
                        graph.addEdge(edgeData.source, edgeData.target, edgeData.attributes);
                    } catch (error) {
                        // Edge might already exist in undirected graph, skip duplicate
                        debug(`Skipping duplicate edge: ${edgeData.source} -> ${edgeData.target}`);
                    }
                }
            }
            
            const loadTime = Date.now() - startTime;
            debug(`Loaded entity graph: ${graph.order} nodes, ${graph.size} edges in ${loadTime}ms`);
            
            // Load metadata if available
            const metadata = await this.loadMetadata('entity');
            
            return { graph, metadata };
        } catch (error) {
            debug(`Failed to load entity graph: ${error}`);
            return null;
        }
    }

    /**
     * Load topic graph from disk
     */
    async loadTopicGraph(): Promise<{ graph: any; metadata?: any } | null> {
        try {
            const startTime = Date.now();
            
            // Check if file exists
            try {
                await fs.access(this.topicGraphFile);
            } catch {
                debug("Topic graph file does not exist");
                return null;
            }

            const fileContent = await fs.readFile(this.topicGraphFile, 'utf8');
            const graphData = JSON.parse(fileContent);
            
            // Reconstruct Graphology graph
            const graph = new Graph({ type: "directed" }); // Topics are directed
            
            // Set graph attributes
            if (graphData.graphAttributes) {
                graph.replaceAttributes(graphData.graphAttributes);
            }
            
            // Add nodes
            for (const nodeData of graphData.nodes) {
                graph.addNode(nodeData.id, nodeData.attributes);
            }
            
            // Add edges
            for (const edgeData of graphData.edges) {
                if (graph.hasNode(edgeData.source) && graph.hasNode(edgeData.target)) {
                    try {
                        graph.addEdge(edgeData.source, edgeData.target, edgeData.attributes);
                    } catch (error) {
                        debug(`Failed to add edge: ${edgeData.source} -> ${edgeData.target}: ${error}`);
                    }
                }
            }
            
            const loadTime = Date.now() - startTime;
            debug(`Loaded topic graph: ${graph.order} nodes, ${graph.size} edges in ${loadTime}ms`);
            
            // Load metadata if available
            const metadata = await this.loadMetadata('topic');
            
            return { graph, metadata };
        } catch (error) {
            debug(`Failed to load topic graph: ${error}`);
            return null;
        }
    }

    /**
     * Save metadata for a specific graph type
     */
    private async saveMetadata(graphType: 'entity' | 'topic', metadata: any): Promise<void> {
        try {
            let existingMetadata = {};
            
            // Try to load existing metadata
            try {
                const existingContent = await fs.readFile(this.metadataFile, 'utf8');
                existingMetadata = JSON.parse(existingContent);
            } catch {
                // File doesn't exist or is invalid, start fresh
            }
            
            // Update metadata for specific graph type
            const updatedMetadata = {
                ...existingMetadata,
                [graphType]: {
                    ...metadata,
                    lastSaved: new Date().toISOString()
                }
            };
            
            await fs.writeFile(this.metadataFile, JSON.stringify(updatedMetadata, null, 2), 'utf8');
            debug(`Saved ${graphType} metadata`);
        } catch (error) {
            debug(`Failed to save ${graphType} metadata: ${error}`);
        }
    }

    /**
     * Load metadata for a specific graph type
     */
    private async loadMetadata(graphType: 'entity' | 'topic'): Promise<any | null> {
        try {
            const content = await fs.readFile(this.metadataFile, 'utf8');
            const allMetadata = JSON.parse(content);
            return allMetadata[graphType] || null;
        } catch {
            return null;
        }
    }

    /**
     * Clear all cached graph files
     */
    async clearCache(): Promise<void> {
        try {
            const files = [this.entityGraphFile, this.topicGraphFile, this.metadataFile];
            
            for (const file of files) {
                try {
                    await fs.unlink(file);
                    debug(`Deleted ${file}`);
                } catch {
                    // File doesn't exist, ignore
                }
            }
            
            debug("Cleared Graphology cache");
        } catch (error) {
            debug(`Failed to clear cache: ${error}`);
            throw error;
        }
    }
}

/**
 * Factory function to create persistence manager
 */
export function createGraphologyPersistenceManager(storagePath: string): GraphologyPersistenceManager {
    return new GraphologyFileManager(storagePath);
}