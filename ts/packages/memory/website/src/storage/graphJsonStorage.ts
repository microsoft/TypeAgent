// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import registerDebug from "debug";

const debug = registerDebug("typeagent:website:storage:json");

/**
 * JSON representation of an entity graph with nodes, edges, and communities
 */
export interface EntityGraphJson {
    nodes: Array<{
        id: string;
        name: string;
        type: string;
        confidence: number;
        metadata: {
            domain: string;
            urls: string[];
            extractionDate: string;
        };
    }>;
    edges: Array<{
        source: string;
        target: string;
        type: string;
        confidence: number;
        metadata: {
            sources: string[];
            count: number;
            updated: string;
        };
    }>;
    communities: Array<{
        id: string;
        entities: string[];
        topics: string[];
        size: number;
        density: number;
        updated: string;
    }>;
    metadata: {
        version: string;
        lastUpdated: string;
        nodeCount: number;
        edgeCount: number;
        communityCount: number;
    };
}

/**
 * JSON representation of a topic graph with hierarchical structure and relationships
 */
export interface TopicGraphJson {
    nodes: Array<{
        id: string;
        name: string;
        level: number;
        parentId?: string;
        confidence: number;
        metadata: {
            keywords: string[];
            sourceTopicNames: string[];
            domains: string[];
            urls: string[];
            extractionDate: string;
        };
    }>;
    edges: Array<{
        source: string;
        target: string;
        type: string;
        strength: number;
        metadata: {
            cooccurrenceCount?: number;
            sourceUrls: string[];
            firstSeen?: string;
            lastSeen?: string;
            updated: string;
        };
    }>;
    topicEntityRelations: Array<{
        topicId: string;
        entityName: string;
        relevance: number;
        domain: string;
    }>;
    metrics: Record<string, {
        topicId: string;
        topicName: string;
        documentCount: number;
        domainCount: number;
        degreeCentrality: number;
        betweennessCentrality: number;
        firstSeen?: string;
        lastSeen?: string;
        activityPeriod: number;
        avgConfidence: number;
        maxConfidence: number;
        totalRelationships: number;
        strongRelationships: number;
        entityCount: number;
        topEntities?: string;
        updated: string;
    }>;
    metadata: {
        version: string;
        lastUpdated: string;
        nodeCount: number;
        edgeCount: number;
        relationshipCount: number;
    };
}

/**
 * Metadata about the graph storage state and versioning
 */
export interface GraphStorageMetadata {
    version: string;
    entityGraphLastUpdated: string;
    topicGraphLastUpdated: string;
    migrationDate?: string;
    sqliteBackupPath?: string;
    filesSizes: {
        entityGraphBytes: number;
        topicGraphBytes: number;
    };
}

/**
 * Manager class for reading and writing graph data as JSON files
 */
export class GraphJsonStorageManager {
    private static readonly CURRENT_VERSION = "1.0.0";
    private static readonly ENTITY_GRAPH_FILENAME = "entityGraph.json";
    private static readonly TOPIC_GRAPH_FILENAME = "topicGraph.json";
    private static readonly METADATA_FILENAME = "graphMetadata.json";

    constructor(private basePath: string) {}

    /**
     * Save entity graph to JSON file
     */
    async saveEntityGraph(graph: EntityGraphJson): Promise<void> {
        try {
            await this.ensureDirectoryExists();
            
            // Update metadata
            graph.metadata.version = GraphJsonStorageManager.CURRENT_VERSION;
            graph.metadata.lastUpdated = new Date().toISOString();

            const filePath = this.getEntityGraphPath();
            const jsonData = JSON.stringify(graph, null, 2);
            
            debug(`Saving entity graph to ${filePath} (${jsonData.length} bytes)`);
            await fs.promises.writeFile(filePath, jsonData, 'utf8');
            
            // Update storage metadata
            await this.updateStorageMetadata({
                entityGraphLastUpdated: graph.metadata.lastUpdated,
                entityGraphBytes: jsonData.length
            });

            debug(`Entity graph saved successfully: ${graph.metadata.nodeCount} nodes, ${graph.metadata.edgeCount} edges`);
        } catch (error) {
            debug(`Error saving entity graph: ${error}`);
            throw new Error(`Failed to save entity graph: ${error}`);
        }
    }

    /**
     * Load entity graph from JSON file
     */
    async loadEntityGraph(): Promise<EntityGraphJson | null> {
        try {
            const filePath = this.getEntityGraphPath();
            
            if (!fs.existsSync(filePath)) {
                debug(`Entity graph file not found: ${filePath}`);
                return null;
            }

            debug(`Loading entity graph from ${filePath}`);
            const jsonData = await fs.promises.readFile(filePath, 'utf8');
            const graph = JSON.parse(jsonData) as EntityGraphJson;
            
            debug(`Entity graph loaded: ${graph.metadata.nodeCount} nodes, ${graph.metadata.edgeCount} edges`);
            return graph;
        } catch (error) {
            debug(`Error loading entity graph: ${error}`);
            throw new Error(`Failed to load entity graph: ${error}`);
        }
    }

    /**
     * Save topic graph to JSON file
     */
    async saveTopicGraph(graph: TopicGraphJson): Promise<void> {
        try {
            await this.ensureDirectoryExists();
            
            // Update metadata
            graph.metadata.version = GraphJsonStorageManager.CURRENT_VERSION;
            graph.metadata.lastUpdated = new Date().toISOString();

            const filePath = this.getTopicGraphPath();
            const jsonData = JSON.stringify(graph, null, 2);
            
            debug(`Saving topic graph to ${filePath} (${jsonData.length} bytes)`);
            await fs.promises.writeFile(filePath, jsonData, 'utf8');
            
            // Update storage metadata
            await this.updateStorageMetadata({
                topicGraphLastUpdated: graph.metadata.lastUpdated,
                topicGraphBytes: jsonData.length
            });

            debug(`Topic graph saved successfully: ${graph.metadata.nodeCount} nodes, ${graph.metadata.edgeCount} edges`);
        } catch (error) {
            debug(`Error saving topic graph: ${error}`);
            throw new Error(`Failed to save topic graph: ${error}`);
        }
    }

    /**
     * Load topic graph from JSON file
     */
    async loadTopicGraph(): Promise<TopicGraphJson | null> {
        try {
            const filePath = this.getTopicGraphPath();
            
            if (!fs.existsSync(filePath)) {
                debug(`Topic graph file not found: ${filePath}`);
                return null;
            }

            debug(`Loading topic graph from ${filePath}`);
            const jsonData = await fs.promises.readFile(filePath, 'utf8');
            const graph = JSON.parse(jsonData) as TopicGraphJson;
            
            debug(`Topic graph loaded: ${graph.metadata.nodeCount} nodes, ${graph.metadata.edgeCount} edges`);
            return graph;
        } catch (error) {
            debug(`Error loading topic graph: ${error}`);
            throw new Error(`Failed to load topic graph: ${error}`);
        }
    }

    /**
     * Get storage metadata
     */
    async getStorageMetadata(): Promise<GraphStorageMetadata | null> {
        try {
            const filePath = this.getMetadataPath();
            
            if (!fs.existsSync(filePath)) {
                return null;
            }

            const jsonData = await fs.promises.readFile(filePath, 'utf8');
            return JSON.parse(jsonData) as GraphStorageMetadata;
        } catch (error) {
            debug(`Error loading storage metadata: ${error}`);
            return null;
        }
    }

    /**
     * Check if JSON graph files exist
     */
    async hasJsonGraphs(): Promise<{ hasEntity: boolean; hasTopic: boolean }> {
        const entityExists = fs.existsSync(this.getEntityGraphPath());
        const topicExists = fs.existsSync(this.getTopicGraphPath());
        
        return {
            hasEntity: entityExists,
            hasTopic: topicExists
        };
    }

    /**
     * Create backup of current JSON files with timestamp
     */
    async createBackup(): Promise<string> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(this.basePath, 'backups');
        
        await this.ensureDirectoryExists(backupDir);
        
        const backupPaths: string[] = [];
        
        // Backup entity graph if exists
        const entityPath = this.getEntityGraphPath();
        if (fs.existsSync(entityPath)) {
            const backupEntityPath = path.join(backupDir, `entityGraph_${timestamp}.json`);
            await fs.promises.copyFile(entityPath, backupEntityPath);
            backupPaths.push(backupEntityPath);
        }
        
        // Backup topic graph if exists
        const topicPath = this.getTopicGraphPath();
        if (fs.existsSync(topicPath)) {
            const backupTopicPath = path.join(backupDir, `topicGraph_${timestamp}.json`);
            await fs.promises.copyFile(topicPath, backupTopicPath);
            backupPaths.push(backupTopicPath);
        }
        
        debug(`Created backup with ${backupPaths.length} files in ${backupDir}`);
        return backupDir;
    }

    /**
     * Remove old backup files, keeping only the most recent N backups
     */
    async cleanupOldBackups(keepCount: number = 5): Promise<void> {
        try {
            const backupDir = path.join(this.basePath, 'backups');
            
            if (!fs.existsSync(backupDir)) {
                return;
            }

            const files = await fs.promises.readdir(backupDir);
            const backupFiles = files
                .filter(f => f.endsWith('.json'))
                .map(f => ({
                    name: f,
                    path: path.join(backupDir, f),
                    stat: fs.statSync(path.join(backupDir, f))
                }))
                .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

            if (backupFiles.length > keepCount) {
                const filesToDelete = backupFiles.slice(keepCount);
                for (const file of filesToDelete) {
                    await fs.promises.unlink(file.path);
                }
                debug(`Cleaned up ${filesToDelete.length} old backup files`);
            }
        } catch (error) {
            debug(`Error cleaning up backups: ${error}`);
        }
    }

    private getEntityGraphPath(): string {
        return path.join(this.basePath, GraphJsonStorageManager.ENTITY_GRAPH_FILENAME);
    }

    private getTopicGraphPath(): string {
        return path.join(this.basePath, GraphJsonStorageManager.TOPIC_GRAPH_FILENAME);
    }

    private getMetadataPath(): string {
        return path.join(this.basePath, GraphJsonStorageManager.METADATA_FILENAME);
    }

    private async ensureDirectoryExists(dirPath?: string): Promise<void> {
        const targetPath = dirPath || this.basePath;
        
        if (!fs.existsSync(targetPath)) {
            await fs.promises.mkdir(targetPath, { recursive: true });
            debug(`Created directory: ${targetPath}`);
        }
    }

    private async updateStorageMetadata(updates: Partial<{ 
        entityGraphLastUpdated: string; 
        topicGraphLastUpdated: string;
        entityGraphBytes: number;
        topicGraphBytes: number;
    }>): Promise<void> {
        try {
            let metadata = await this.getStorageMetadata() || {
                version: GraphJsonStorageManager.CURRENT_VERSION,
                entityGraphLastUpdated: '',
                topicGraphLastUpdated: '',
                filesSizes: {
                    entityGraphBytes: 0,
                    topicGraphBytes: 0
                }
            };

            // Update with new values
            if (updates.entityGraphLastUpdated) {
                metadata.entityGraphLastUpdated = updates.entityGraphLastUpdated;
            }
            if (updates.topicGraphLastUpdated) {
                metadata.topicGraphLastUpdated = updates.topicGraphLastUpdated;
            }
            if (updates.entityGraphBytes !== undefined) {
                metadata.filesSizes.entityGraphBytes = updates.entityGraphBytes;
            }
            if (updates.topicGraphBytes !== undefined) {
                metadata.filesSizes.topicGraphBytes = updates.topicGraphBytes;
            }

            const filePath = this.getMetadataPath();
            await fs.promises.writeFile(filePath, JSON.stringify(metadata, null, 2), 'utf8');
        } catch (error) {
            debug(`Error updating storage metadata: ${error}`);
        }
    }
}