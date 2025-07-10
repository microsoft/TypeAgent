// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FileManager } from "./fileManager.mjs";
import { ActionValidator, ActionIndexManager } from "./validator.mjs";
import { PatternResolver } from "./patternResolver.mjs";
import { DomainManager } from "./domainManager.mjs";
import { ActionSearchEngine } from "./searchEngine.mjs";
import { AnalyticsManager } from "./analyticsManager.mjs";
import {
    StoredAction,
    ActionIndex,
    StoreStatistics,
    SaveResult,
    ValidationResult,
    DomainConfig,
    UrlPatternDefinition,
    UrlPattern,
} from "./types.mjs";
import registerDebug from "debug";
const debug = registerDebug("typeagent:browser:action:store");

/**
 * ActionsStore - Advanced storage system with pattern matching, search, and analytics
 *
 * This is the comprehensive storage system for actions, providing:
 * - File-based storage using agent sessionStorage
 * - Action validation and sanitization
 * - Fast lookup through indexing
 * - URL pattern matching and domain configuration
 * - Advanced search and filtering capabilities
 * - Usage analytics and performance tracking
 * - Import/export and backup functionality
 * - CRUD operations for actions and domain configs
 */
export class ActionsStore {
    private fileManager: FileManager;
    private validator: ActionValidator;
    private indexManager: ActionIndexManager;
    private patternResolver: PatternResolver;
    private domainManager: DomainManager;
    private searchEngine: ActionSearchEngine;
    private analyticsManager: AnalyticsManager;
    private initialized: boolean = false;

    constructor(sessionStorage: any) {
        this.fileManager = new FileManager(sessionStorage);
        this.validator = new ActionValidator();
        this.indexManager = new ActionIndexManager();
        this.patternResolver = new PatternResolver();
        this.domainManager = new DomainManager(this.fileManager);
        this.searchEngine = new ActionSearchEngine();
        this.analyticsManager = new AnalyticsManager(this.fileManager);

        debug(this.searchEngine);
    }

    /**
     * Initialize the ActionsStore with all components
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            // Initialize file system structure
            await this.fileManager.initialize();

            // Load existing action index
            await this.loadActionIndex();

            // Initialize analytics manager
            await this.analyticsManager.initialize();

            this.initialized = true;
            debug(
                "ActionsStore initialized successfully with enhanced features",
            );
        } catch (error) {
            debug("Failed to initialize ActionsStore:", error);
            console.error("Failed to initialize ActionsStore:", error);
            throw new Error("ActionsStore initialization failed");
        }
    }

    /**
     * Check if store is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Save an action to storage
     */
    async saveAction(action: StoredAction): Promise<SaveResult> {
        this.ensureInitialized();

        try {
            // Validate action data
            const validation = this.validator.validateAction(action);
            if (!validation.isValid) {
                return {
                    success: false,
                    error: `Validation failed: ${validation.errors.map((e) => e.message).join(", ")}`,
                };
            }

            // Sanitize action data
            const sanitizedAction = this.validator.sanitizeAction(action);

            // Ensure domain directory exists for non-global actions
            if (
                sanitizedAction.scope.type !== "global" &&
                sanitizedAction.scope.domain
            ) {
                const domainDir = `actions/domains/${this.fileManager.sanitizeFilename(sanitizedAction.scope.domain)}`;
                await this.fileManager.createDirectory(domainDir);
            }

            // Get file path
            const filePath = this.fileManager.getActionFilePath(
                sanitizedAction.id,
                sanitizedAction.scope,
            );

            // Save action to file
            await this.fileManager.writeJson(filePath, sanitizedAction);

            // Update index
            this.indexManager.addAction(sanitizedAction, filePath);
            await this.saveActionIndex();

            debug(
                `Action saved: ${sanitizedAction.name} (${sanitizedAction.id})`,
            );

            return {
                success: true,
                actionId: sanitizedAction.id,
            };
        } catch (error) {
            console.error("Failed to save action:", error);
            return {
                success: false,
                error: `Failed to save action: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
        }
    }

    /**
     * Get an action by ID
     */
    async getAction(id: string): Promise<StoredAction | null> {
        this.ensureInitialized();

        try {
            // Check index first
            const indexEntry = this.indexManager.getActionEntry(id);
            if (!indexEntry) {
                return null;
            }

            // Load action from file
            const action = await this.fileManager.readJson<StoredAction>(
                indexEntry.filePath,
            );

            if (!action) {
                // Action file missing but in index - remove from index
                this.indexManager.removeAction(id);
                await this.saveActionIndex();
                return null;
            }

            return action;
        } catch (error) {
            console.error(`Failed to get action ${id}:`, error);
            return null;
        }
    }

    /**
     * Update an action
     */
    async updateAction(
        id: string,
        updates: Partial<StoredAction>,
    ): Promise<SaveResult> {
        this.ensureInitialized();

        try {
            // Get existing action
            const existingAction = await this.getAction(id);
            if (!existingAction) {
                return {
                    success: false,
                    error: `Action not found: ${id}`,
                };
            }

            // Apply updates
            const updatedAction: StoredAction = {
                ...existingAction,
                ...updates,
                id: existingAction.id, // Prevent ID changes
                metadata: {
                    ...existingAction.metadata,
                    ...updates.metadata,
                    updatedAt: new Date().toISOString(), // Always update timestamp
                },
            };

            // Save updated action
            return await this.saveAction(updatedAction);
        } catch (error) {
            console.error(`Failed to update action ${id}:`, error);
            return {
                success: false,
                error: `Failed to update action: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
        }
    }

    /**
     * Delete an action
     */
    async deleteAction(id: string): Promise<SaveResult> {
        this.ensureInitialized();

        try {
            // Check if action exists
            const indexEntry = this.indexManager.getActionEntry(id);
            if (!indexEntry) {
                return {
                    success: false,
                    error: `Action not found: ${id}`,
                };
            }

            // Delete file
            await this.fileManager.delete(indexEntry.filePath);

            // Remove from index
            this.indexManager.removeAction(id);
            await this.saveActionIndex();

            debug(`Action deleted: ${id}`);

            return {
                success: true,
                actionId: id,
            };
        } catch (error) {
            console.error(`Failed to delete action ${id}:`, error);
            return {
                success: false,
                error: `Failed to delete action: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
        }
    }

    /**
     * Get all actions
     */
    async getAllActions(): Promise<StoredAction[]> {
        this.ensureInitialized();

        try {
            const indexEntries = this.indexManager.getAllActionEntries();
            const actions: StoredAction[] = [];

            for (const entry of indexEntries) {
                const action = await this.fileManager.readJson<StoredAction>(
                    entry.filePath,
                );
                if (action) {
                    actions.push(action);
                } else {
                    // Clean up missing action from index
                    this.indexManager.removeAction(entry.id);
                }
            }

            // Save index if we cleaned up any missing actions
            if (indexEntries.length !== actions.length) {
                await this.saveActionIndex();
            }

            return actions;
        } catch (error) {
            console.error("Failed to get all actions:", error);
            return [];
        }
    }

    /**
     * Get actions for a specific URL using pattern matching
     */
    async getActionsForUrl(url: string): Promise<StoredAction[]> {
        this.ensureInitialized();

        try {
            // Use pattern resolver for enhanced URL matching
            const resolvedActions =
                await this.patternResolver.resolveActionsForUrl(
                    url,
                    (id: string) => this.getAction(id),
                    () => this.getAllUrlPatterns(),
                    (domain: string) =>
                        this.indexManager.getActionsForDomain(domain),
                    () => this.indexManager.getActionsByScope("global"),
                );

            // Extract just the actions from resolved results
            return resolvedActions.map((resolved) => resolved.action);
        } catch (error) {
            console.error(`Failed to get actions for URL ${url}:`, error);
            return [];
        }
    }

    /**
     * Get actions for a domain
     */
    async getActionsForDomain(domain: string): Promise<StoredAction[]> {
        this.ensureInitialized();

        try {
            const domainEntries = this.indexManager.getActionsForDomain(domain);
            const actions: StoredAction[] = [];

            for (const entry of domainEntries) {
                const action = await this.getAction(entry.id);
                if (action) {
                    actions.push(action);
                }
            }

            return actions;
        } catch (error) {
            console.error(`Failed to get actions for domain ${domain}:`, error);
            return [];
        }
    }

    /**
     * Get global actions
     */
    async getGlobalActions(): Promise<StoredAction[]> {
        this.ensureInitialized();

        try {
            const globalEntries = this.indexManager.getActionsByScope("global");
            const actions: StoredAction[] = [];

            for (const entry of globalEntries) {
                const action = await this.getAction(entry.id);
                if (action) {
                    actions.push(action);
                }
            }

            return actions;
        } catch (error) {
            console.error("Failed to get global actions:", error);
            return [];
        }
    }

    /**
     * Get storage statistics
     */
    async getStatistics(): Promise<StoreStatistics> {
        this.ensureInitialized();

        try {
            const baseStats = this.indexManager.getStatistics();
            const storageStats = await this.fileManager.getStorageStats();

            return {
                ...baseStats,
                storage: {
                    ...baseStats.storage,
                    totalSize: storageStats.totalSize,
                    actionFiles: storageStats.fileCount,
                },
            };
        } catch (error) {
            console.error("Failed to get statistics:", error);
            // Return empty stats on error
            return {
                totalActions: 0,
                actionsByScope: {
                    global: 0,
                    domain: 0,
                    pattern: 0,
                    page: 0,
                } as Record<"global" | "domain" | "pattern" | "page", number>,
                actionsByCategory: {} as any,
                actionsByAuthor: {} as any,
                totalDomains: 0,
                totalPatterns: 0,
                usage: {
                    totalUsage: 0,
                    averageUsage: 0,
                    mostUsedActions: [],
                },
                storage: {
                    totalSize: 0,
                    actionFiles: 0,
                    domainConfigs: 0,
                    indexSize: 0,
                },
                health: {
                    validActions: 0,
                    invalidActions: 0,
                },
            };
        }
    }

    /**
     * Record action usage (increment usage count)
     */
    async recordUsage(actionId: string): Promise<void> {
        this.ensureInitialized();

        try {
            // Update index
            this.indexManager.incrementUsage(actionId);

            // Update action file
            const action = await this.getAction(actionId);
            if (action) {
                action.metadata.usageCount++;
                action.metadata.lastUsed = new Date().toISOString();
                await this.saveAction(action);
            }
        } catch (error) {
            console.error(
                `Failed to record usage for action ${actionId}:`,
                error,
            );
        }
    }

    /**
     * Validate an action without saving it
     */
    validateAction(action: StoredAction): ValidationResult {
        return this.validator.validateAction(action);
    }

    /**
     * Create a new action with default values
     */
    createDefaultAction(overrides: Partial<StoredAction> = {}): StoredAction {
        return this.validator.createDefaultAction(overrides);
    }

    /**
     * Create backup of all actions
     */
    async backup(): Promise<string> {
        this.ensureInitialized();

        try {
            return await this.fileManager.createBackup();
        } catch (error) {
            console.error("Failed to create backup:", error);
            throw new Error("Backup creation failed");
        }
    }

    // Domain Configuration Methods

    /**
     * Get domain configuration
     */
    async getDomainConfig(domain: string): Promise<DomainConfig | null> {
        this.ensureInitialized();
        return await this.domainManager.getDomainConfig(domain);
    }

    /**
     * Save domain configuration
     */
    async saveDomainConfig(config: DomainConfig): Promise<SaveResult> {
        this.ensureInitialized();
        return await this.domainManager.saveDomainConfig(config);
    }

    /**
     * Delete domain configuration
     */
    async deleteDomainConfig(domain: string): Promise<SaveResult> {
        this.ensureInitialized();
        return await this.domainManager.deleteDomainConfig(domain);
    }

    /**
     * Add URL pattern to domain
     */
    async addDomainPattern(
        domain: string,
        pattern: UrlPatternDefinition,
    ): Promise<SaveResult> {
        this.ensureInitialized();
        return await this.domainManager.addUrlPattern(domain, pattern);
    }

    /**
     * Remove URL pattern from domain
     */
    async removeDomainPattern(
        domain: string,
        patternName: string,
    ): Promise<SaveResult> {
        this.ensureInitialized();
        return await this.domainManager.removeUrlPattern(domain, patternName);
    }

    /**
     * Get URL patterns for domain
     */
    async getUrlPatterns(domain: string): Promise<UrlPatternDefinition[]> {
        this.ensureInitialized();
        return await this.domainManager.getUrlPatterns(domain);
    }

    /**
     * Get actions for a specific pattern
     */
    async getActionsForPattern(
        domain: string,
        pattern: string,
    ): Promise<StoredAction[]> {
        this.ensureInitialized();

        try {
            // For now, return actions that match the domain
            // This could be enhanced to match specific patterns
            return await this.getActionsForDomain(domain);
        } catch (error) {
            console.error(
                `Failed to get actions for pattern ${pattern} in domain ${domain}:`,
                error,
            );
            return [];
        }
    }

    /**
     * Get all URL patterns from all domains
     */
    async getAllUrlPatterns(): Promise<UrlPattern[]> {
        this.ensureInitialized();

        try {
            const allDomains = await this.domainManager.getAllDomains();
            const allPatterns: UrlPattern[] = [];

            for (const domain of allDomains) {
                const domainPatterns =
                    await this.domainManager.getUrlPatterns(domain);
                const urlPatterns = domainPatterns.map(
                    (dp: UrlPatternDefinition) =>
                        ({
                            pattern: dp.pattern,
                            type: dp.type,
                            priority: dp.priority,
                            description: dp.description,
                        }) as UrlPattern,
                );
                allPatterns.push(...urlPatterns);
            }

            return allPatterns;
        } catch (error) {
            console.error("Failed to get all URL patterns:", error);
            return [];
        }
    }

    /**
     * Initialize domain with default configuration
     */
    async initializeDomain(domain: string): Promise<DomainConfig> {
        this.ensureInitialized();
        return await this.domainManager.initializeDomain(domain);
    }
    /*
    private generateOptimizationRecommendations(actions: StoredAction[]): string[] {
        const recommendations: string[] = [];
        
        // Check for unused actions
        const unusedActions = actions.filter(a => a.metadata.usageCount === 0);
        if (unusedActions.length > 10) {
            recommendations.push(`Consider reviewing ${unusedActions.length} unused actions for cleanup`);
        }
        
        // Check for duplicate names
        const nameMap = new Map<string, number>();
        for (const action of actions) {
            nameMap.set(action.name, (nameMap.get(action.name) || 0) + 1);
        }
        const duplicateNames = Array.from(nameMap.entries()).filter(([, count]) => count > 1);
        if (duplicateNames.length > 0) {
            recommendations.push(`${duplicateNames.length} actions have duplicate names and could be consolidated`);
        }
        
        // Check for untagged actions
        const untaggedActions = actions.filter(a => a.tags.length === 0);
        if (untaggedActions.length > actions.length * 0.3) {
            recommendations.push(`${untaggedActions.length} actions have no tags - consider adding tags for better organization`);
        }
        
        return recommendations;
    }

    private getDaysSince(dateString: string): number {
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - date.getTime());
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
        */

    /**
     * Load action index from storage
     */
    private async loadActionIndex(): Promise<void> {
        try {
            const indexPath = this.fileManager.getIndexPath("action");
            const indexData =
                await this.fileManager.readJson<ActionIndex>(indexPath);
            this.indexManager.loadIndex(indexData);

            if (indexData) {
                debug(
                    `Loaded action index with ${Object.keys(indexData.actions).length} actions`,
                );
            } else {
                debug("No existing action index found, starting fresh");
            }
        } catch (error) {
            console.error("Failed to load action index:", error);
            // Start with empty index on error
            this.indexManager.loadIndex(null);
        }
    }

    /**
     * Save action index to storage
     */
    private async saveActionIndex(): Promise<void> {
        try {
            const indexPath = this.fileManager.getIndexPath("action");
            const index = this.indexManager.getIndex();
            await this.fileManager.writeJson(indexPath, index);
        } catch (error) {
            console.error("Failed to save action index:", error);
            // Don't throw here as this would break the main operation
        }
    }

    /**
     * Ensure the store is initialized
     */
    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error(
                "ActionsStore not initialized. Call initialize() first.",
            );
        }
    }
}
