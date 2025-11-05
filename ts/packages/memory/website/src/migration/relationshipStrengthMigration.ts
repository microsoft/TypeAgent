// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { GraphJsonStorageManager, EntityGraphJson, TopicGraphJson } from "../storage/graphJsonStorage.js";

const debug = registerDebug("typeagent:website:migration:strength");

/**
 * Migration utility to convert relationship strengths from logarithmic scale back to linear scale
 * and restore original relationship types from SQLite era
 */
export class RelationshipStrengthMigration {
    private static readonly MIGRATION_VERSION = "1.1.0";

    constructor(private storageManager: GraphJsonStorageManager) {}

    /**
     * Main migration method - converts both entity and topic graphs
     */
    async migrate(): Promise<{entityGraph: boolean, topicGraph: boolean}> {
        debug("Starting relationship strength migration");
        
        const results = {
            entityGraph: false,
            topicGraph: false
        };

        try {
            // Migrate entity graph
            const entityGraph = await this.storageManager.loadEntityGraph();
            if (entityGraph && this.needsMigration(entityGraph.metadata)) {
                await this.migrateEntityGraph(entityGraph);
                results.entityGraph = true;
                debug("Entity graph migration completed");
            } else {
                debug("Entity graph migration skipped - already migrated or no data");
            }

            // Migrate topic graph  
            const topicGraph = await this.storageManager.loadTopicGraph();
            if (topicGraph && this.needsMigration(topicGraph.metadata)) {
                await this.migrateTopicGraph(topicGraph);
                results.topicGraph = true;
                debug("Topic graph migration completed");
            } else {
                debug("Topic graph migration skipped - already migrated or no data");
            }

        } catch (error) {
            debug(`Migration error: ${error}`);
            throw new Error(`Relationship strength migration failed: ${error}`);
        }

        debug(`Migration results: ${JSON.stringify(results)}`);
        return results;
    }

    /**
     * Check if migration is needed based on metadata
     */
    private needsMigration(metadata: any): boolean {
        // Skip if already migrated
        if ((metadata as any).strengthLinearized === true) {
            debug("Migration already completed - skipping");
            return false;
        }

        // Skip if already on target version or higher
        if (metadata.version && this.compareVersions(metadata.version, RelationshipStrengthMigration.MIGRATION_VERSION) >= 0) {
            debug(`Version ${metadata.version} >= ${RelationshipStrengthMigration.MIGRATION_VERSION} - skipping`);
            return false;
        }

        return true;
    }

    /**
     * Migrate entity graph relationships
     */
    private async migrateEntityGraph(entityGraph: EntityGraphJson): Promise<void> {
        debug(`Migrating entity graph: ${entityGraph.edges.length} relationships`);
        
        let migratedCount = 0;
        let typeRestoredCount = 0;

        for (const edge of entityGraph.edges) {
            // Convert logarithmic strength back to linear
            const originalLogStrength = edge.confidence;
            const linearStrength = this.convertLogToLinearStrength(originalLogStrength);
            
            if (Math.abs(originalLogStrength - linearStrength) > 0.01) {
                edge.confidence = linearStrength;
                migratedCount++;
                debug(`Converted edge ${edge.source}-${edge.target}: ${originalLogStrength.toFixed(3)} → ${linearStrength.toFixed(3)}`);
            }

            // Restore relationship types from "related" back to "co_occurs" when appropriate
            if (edge.type === "related" && edge.metadata.count && edge.metadata.count >= 2) {
                edge.type = "co_occurs";
                typeRestoredCount++;
                debug(`Restored relationship type: ${edge.source}-${edge.target} → co_occurs`);
            }
        }

        // Update metadata to mark migration as complete
        entityGraph.metadata.version = RelationshipStrengthMigration.MIGRATION_VERSION;
        (entityGraph.metadata as any).strengthLinearized = true;
        entityGraph.metadata.lastUpdated = new Date().toISOString();
        (entityGraph.metadata as any).migrationNotes = `Converted ${migratedCount} strengths from log to linear scale, restored ${typeRestoredCount} relationship types`;

        // Save updated graph
        await this.storageManager.saveEntityGraph(entityGraph);
        debug(`Entity graph migration saved: ${migratedCount} strengths converted, ${typeRestoredCount} types restored`);
    }

    /**
     * Migrate topic graph relationships  
     */
    private async migrateTopicGraph(topicGraph: TopicGraphJson): Promise<void> {
        debug(`Migrating topic graph: ${topicGraph.edges.length} relationships`);
        
        let migratedCount = 0;

        for (const edge of topicGraph.edges) {
            // Convert logarithmic strength back to linear
            const originalLogStrength = edge.strength;
            const linearStrength = this.convertLogToLinearStrength(originalLogStrength);
            
            if (Math.abs(originalLogStrength - linearStrength) > 0.01) {
                edge.strength = linearStrength;
                migratedCount++;
                debug(`Converted topic edge ${edge.source}-${edge.target}: ${originalLogStrength.toFixed(3)} → ${linearStrength.toFixed(3)}`);
            }
        }

        // Update metadata to mark migration as complete
        topicGraph.metadata.version = RelationshipStrengthMigration.MIGRATION_VERSION;
        (topicGraph.metadata as any).strengthLinearized = true;
        topicGraph.metadata.lastUpdated = new Date().toISOString();
        (topicGraph.metadata as any).migrationNotes = `Converted ${migratedCount} strengths from log to linear scale`;

        // Save updated graph
        await this.storageManager.saveTopicGraph(topicGraph);
        debug(`Topic graph migration saved: ${migratedCount} strengths converted`);
    }

    /**
     * Convert logarithmic strength value back to linear scale
     * Reverses: Math.min(1.0, Math.log(count + 1) / Math.log(10))
     * To get: Math.min(count / 10, 1.0) 
     */
    private convertLogToLinearStrength(logStrength: number): number {
        if (logStrength >= 1.0) {
            return 1.0; // Max value stays the same
        }
        
        // Reverse the logarithmic calculation to estimate original count
        // logStrength = Math.log(count + 1) / Math.log(10)
        // count + 1 = 10^logStrength
        // count = 10^logStrength - 1
        const estimatedCount = Math.max(1, Math.round(Math.pow(10, logStrength) - 1));
        
        // Apply linear formula: Math.min(count / 10, 1.0)
        const linearStrength = Math.min(estimatedCount / 10, 1.0);
        
        debug(`Log→Linear conversion: ${logStrength.toFixed(3)} (count≈${estimatedCount}) → ${linearStrength.toFixed(3)}`);
        return linearStrength;
    }

    /**
     * Compare version strings (returns -1, 0, or 1)
     */
    private compareVersions(version1: string, version2: string): number {
        const v1parts = version1.split('.').map(Number);
        const v2parts = version2.split('.').map(Number);
        
        for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
            const v1part = v1parts[i] || 0;
            const v2part = v2parts[i] || 0;
            
            if (v1part < v2part) return -1;
            if (v1part > v2part) return 1;
        }
        
        return 0;
    }

    /**
     * Dry run - shows what would be migrated without making changes
     */
    async dryRun(): Promise<{
        entityGraph: {needsMigration: boolean, edgeCount: number, estimatedChanges: number},
        topicGraph: {needsMigration: boolean, edgeCount: number, estimatedChanges: number}
    }> {
        debug("Running dry-run migration analysis");
        
        const results = {
            entityGraph: {needsMigration: false, edgeCount: 0, estimatedChanges: 0},
            topicGraph: {needsMigration: false, edgeCount: 0, estimatedChanges: 0}
        };

        // Analyze entity graph
        const entityGraph = await this.storageManager.loadEntityGraph();
        if (entityGraph) {
            results.entityGraph.needsMigration = this.needsMigration(entityGraph.metadata);
            results.entityGraph.edgeCount = entityGraph.edges.length;
            
            if (results.entityGraph.needsMigration) {
                for (const edge of entityGraph.edges) {
                    const linearStrength = this.convertLogToLinearStrength(edge.confidence);
                    if (Math.abs(edge.confidence - linearStrength) > 0.01) {
                        results.entityGraph.estimatedChanges++;
                    }
                }
            }
        }

        // Analyze topic graph
        const topicGraph = await this.storageManager.loadTopicGraph();
        if (topicGraph) {
            results.topicGraph.needsMigration = this.needsMigration(topicGraph.metadata);
            results.topicGraph.edgeCount = topicGraph.edges.length;
            
            if (results.topicGraph.needsMigration) {
                for (const edge of topicGraph.edges) {
                    const linearStrength = this.convertLogToLinearStrength(edge.strength);
                    if (Math.abs(edge.strength - linearStrength) > 0.01) {
                        results.topicGraph.estimatedChanges++;
                    }
                }
            }
        }

        debug(`Dry run results: ${JSON.stringify(results, null, 2)}`);
        return results;
    }
}