// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import registerDebug from "debug";
import { GraphJsonStorageManager } from "../storage/graphJsonStorage.js";
import { SqliteToJsonConverter, type WebsiteCollection } from "../converters/sqliteToJson.js";
import { JsonToGraphologyConverter } from "../converters/jsonToGraphology.js";

const debug = registerDebug("typeagent:website:migration:sqlite-to-json");

export interface MigrationResult {
    success: boolean;
    migrated: boolean;
    reason: string;
    details?: {
        entityCount: number;
        topicCount: number;
        relationshipCount: number;
        communityCount: number;
        duration: number;
        backupPath?: string;
    };
    error?: string;
}

export interface MigrationOptions {
    forceRebuild?: boolean;
    createBackup?: boolean;
    validateAfterMigration?: boolean;
    skipIfExistsAndNewer?: boolean;
}

/**
 * Handles migration of graph data from SQLite to JSON format
 */
export class SqliteToJsonMigrator {
    constructor(
        private websiteCollection: WebsiteCollection,
        private storageManager: GraphJsonStorageManager,
        private sqliteDbPath: string
    ) {}

    /**
     * Perform migration if needed based on current state
     */
    async migrateIfNeeded(options: MigrationOptions = {}): Promise<MigrationResult> {
        try {
            debug("Checking if migration is needed");
            
            const shouldMigrateResult = await this.shouldMigrate(options);
            if (!shouldMigrateResult.shouldMigrate) {
                return {
                    success: true,
                    migrated: false,
                    reason: shouldMigrateResult.reason
                };
            }

            debug(`Migration needed: ${shouldMigrateResult.reason}`);
            return await this.performMigration(options);
            
        } catch (error) {
            debug(`Error during migration check: ${error}`);
            return {
                success: false,
                migrated: false,
                reason: "Error during migration check",
                error: String(error)
            };
        }
    }

    /**
     * Force migration regardless of current state
     */
    async performMigration(options: MigrationOptions = {}): Promise<MigrationResult> {
        const startTime = Date.now();
        let backupPath: string | undefined;

        try {
            debug("Starting SQLite to JSON migration");

            // Step 1: Validate that conversion is possible
            const converter = new SqliteToJsonConverter(this.websiteCollection);
            const validation = converter.validateConversionPossible();
            
            if (!validation.canConvert) {
                return {
                    success: false,
                    migrated: false,
                    reason: "Cannot convert SQLite data",
                    error: `Validation failed: ${validation.issues.join(", ")}`
                };
            }

            debug(`Validation passed: ${validation.entityCount} entities, ${validation.topicCount} topics`);

            // Step 2: Create backup if requested
            if (options.createBackup !== false) {
                try {
                    backupPath = await this.backupExistingFiles();
                    debug(`Backup created at: ${backupPath}`);
                } catch (error) {
                    debug(`Warning: Backup failed: ${error}`);
                }
            }

            // Step 3: Convert entity graph
            let entityCount = 0;
            let entityGraph;
            try {
                entityGraph = await converter.convertEntityGraph();
                entityCount = entityGraph.metadata.nodeCount;
                await this.storageManager.saveEntityGraph(entityGraph);
                debug(`Entity graph saved: ${entityCount} nodes`);
            } catch (error) {
                debug(`Error converting entity graph: ${error}`);
                // Continue with topic graph even if entity graph fails
            }

            // Step 4: Convert topic graph
            let topicCount = 0;
            let relationshipCount = 0;
            let topicGraph;
            try {
                topicGraph = await converter.convertTopicGraph();
                topicCount = topicGraph.metadata.nodeCount;
                relationshipCount = topicGraph.metadata.edgeCount;
                await this.storageManager.saveTopicGraph(topicGraph);
                debug(`Topic graph saved: ${topicCount} nodes, ${relationshipCount} edges`);
            } catch (error) {
                debug(`Error converting topic graph: ${error}`);
                // Continue even if topic graph fails
            }

            // Step 5: Validate migration if requested
            if (options.validateAfterMigration !== false) {
                const isValid = await this.validateMigration();
                if (!isValid) {
                    return {
                        success: false,
                        migrated: false,
                        reason: "Migration validation failed",
                        error: "Converted data does not match source"
                    };
                }
            }

            const duration = Date.now() - startTime;
            
            // Step 6: Update metadata with migration info
            const metadata = await this.storageManager.getStorageMetadata();
            if (metadata && backupPath) {
                metadata.migrationDate = new Date().toISOString();
                metadata.sqliteBackupPath = backupPath;
            }

            debug(`Migration completed successfully in ${duration}ms`);
            
            return {
                success: true,
                migrated: true,
                reason: "Successfully migrated from SQLite to JSON",
                details: {
                    entityCount,
                    topicCount,
                    relationshipCount,
                    communityCount: entityGraph?.metadata.communityCount || 0,
                    duration,
                    ...(backupPath && { backupPath })
                }
            };

        } catch (error) {
            debug(`Migration failed: ${error}`);
            
            // Attempt to restore from backup if we created one
            if (backupPath && options.createBackup !== false) {
                try {
                    await this.restoreFromBackup(backupPath);
                    debug("Restored from backup after migration failure");
                } catch (restoreError) {
                    debug(`Failed to restore from backup: ${restoreError}`);
                }
            }

            return {
                success: false,
                migrated: false,
                reason: "Migration failed",
                error: String(error)
            };
        }
    }

    /**
     * Determine if migration should be performed
     */
    private async shouldMigrate(options: MigrationOptions): Promise<{
        shouldMigrate: boolean;
        reason: string;
    }> {
        // Check if force rebuild is requested
        if (options.forceRebuild) {
            return {
                shouldMigrate: true,
                reason: "Force rebuild requested"
            };
        }

        // Check if SQLite database exists
        if (!fs.existsSync(this.sqliteDbPath)) {
            return {
                shouldMigrate: false,
                reason: "No SQLite database found"
            };
        }

        // Check if JSON files exist
        const jsonStatus = await this.storageManager.hasJsonGraphs();
        
        if (!jsonStatus.hasEntity && !jsonStatus.hasTopic) {
            return {
                shouldMigrate: true,
                reason: "No JSON graph files found"
            };
        }

        // If skipIfExistsAndNewer is true, check file timestamps
        if (options.skipIfExistsAndNewer) {
            try {
                const sqliteStats = fs.statSync(this.sqliteDbPath);
                const metadata = await this.storageManager.getStorageMetadata();
                
                if (metadata) {
                    const migrationDate = new Date(metadata.migrationDate || 0);
                    if (migrationDate > sqliteStats.mtime) {
                        return {
                            shouldMigrate: false,
                            reason: "JSON files are newer than SQLite database"
                        };
                    }
                }
            } catch (error) {
                debug(`Error checking timestamps: ${error}`);
            }
        }

        // Check if the conversion would be meaningful
        const converter = new SqliteToJsonConverter(this.websiteCollection);
        const validation = converter.validateConversionPossible();
        
        if (!validation.canConvert) {
            return {
                shouldMigrate: false,
                reason: `Cannot convert: ${validation.issues.join(", ")}`
            };
        }

        if (validation.entityCount === 0 && validation.topicCount === 0) {
            return {
                shouldMigrate: false,
                reason: "No data to migrate"
            };
        }

        return {
            shouldMigrate: true,
            reason: "JSON files exist but migration may be needed"
        };
    }

    /**
     * Create backup of existing files
     */
    private async backupExistingFiles(): Promise<string> {
        const backupDir = await this.storageManager.createBackup();
        
        // Also backup SQLite file
        if (fs.existsSync(this.sqliteDbPath)) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const sqliteBackupPath = path.join(backupDir, `index_dataFrames_${timestamp}.sqlite`);
            await fs.promises.copyFile(this.sqliteDbPath, sqliteBackupPath);
            debug(`SQLite backed up to: ${sqliteBackupPath}`);
        }

        return backupDir;
    }

    /**
     * Validate that migration was successful by comparing key metrics
     */
    private async validateMigration(): Promise<boolean> {
        try {
            debug("Validating migration");

            // Load converted JSON data
            const entityGraph = await this.storageManager.loadEntityGraph();
            const topicGraph = await this.storageManager.loadTopicGraph();

            // Test that we can create graphology graphs from the JSON
            if (entityGraph) {
                const entityGraphology = JsonToGraphologyConverter.createEntityGraph(entityGraph);
                debug(`Entity graph validation: ${entityGraphology.order} nodes, ${entityGraphology.size} edges`);
                
                if (entityGraphology.order !== entityGraph.metadata.nodeCount) {
                    debug("Entity graph node count mismatch");
                    return false;
                }
            }

            if (topicGraph) {
                const topicGraphology = JsonToGraphologyConverter.createTopicGraph(topicGraph);
                debug(`Topic graph validation: ${topicGraphology.order} nodes, ${topicGraphology.size} edges`);
                
                if (topicGraphology.order !== topicGraph.metadata.nodeCount) {
                    debug("Topic graph node count mismatch");
                    return false;
                }
            }

            debug("Migration validation passed");
            return true;

        } catch (error) {
            debug(`Migration validation failed: ${error}`);
            return false;
        }
    }

    /**
     * Restore from backup in case of migration failure
     */
    private async restoreFromBackup(backupDir: string): Promise<void> {
        try {
            const files = await fs.promises.readdir(backupDir);
            
            for (const file of files) {
                if (file.startsWith('entityGraph_') && file.endsWith('.json')) {
                    const backupPath = path.join(backupDir, file);
                    const targetPath = path.join(path.dirname(backupDir), 'entityGraph.json');
                    await fs.promises.copyFile(backupPath, targetPath);
                }
                
                if (file.startsWith('topicGraph_') && file.endsWith('.json')) {
                    const backupPath = path.join(backupDir, file);
                    const targetPath = path.join(path.dirname(backupDir), 'topicGraph.json');
                    await fs.promises.copyFile(backupPath, targetPath);
                }
            }
            
            debug("Restored from backup");
        } catch (error) {
            debug(`Error restoring from backup: ${error}`);
            throw error;
        }
    }

    /**
     * Get migration status and recommendations
     */
    async getMigrationStatus(): Promise<{
        sqliteExists: boolean;
        jsonExists: { entity: boolean; topic: boolean };
        recommendation: 'migrate' | 'skip' | 'force-rebuild';
        details: string;
    }> {
        const sqliteExists = fs.existsSync(this.sqliteDbPath);
        const jsonExists = await this.storageManager.hasJsonGraphs();
        
        let recommendation: 'migrate' | 'skip' | 'force-rebuild';
        let details: string;

        if (!sqliteExists) {
            recommendation = 'skip';
            details = 'No SQLite database found';
        } else if (!jsonExists.hasEntity && !jsonExists.hasTopic) {
            recommendation = 'migrate';
            details = 'SQLite exists but no JSON graphs found';
        } else {
            recommendation = 'skip';
            details = 'JSON graphs already exist';
        }

        return {
            sqliteExists,
            jsonExists: {
                entity: jsonExists.hasEntity,
                topic: jsonExists.hasTopic
            },
            recommendation,
            details
        };
    }
}