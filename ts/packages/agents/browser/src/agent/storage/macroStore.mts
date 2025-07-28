// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FileManager } from "./fileManager.mjs";
import { MacroValidator, MacroIndexManager } from "./validator.mjs";
import { PatternResolver } from "./patternResolver.mjs";
import { DomainManager } from "./domainManager.mjs";
import { MacroSearchEngine } from "./searchEngine.mjs";
import { AnalyticsManager } from "./analyticsManager.mjs";
import {
    StoredMacro,
    MacroIndex,
    StoreStatistics,
    SaveResult,
    ValidationResult,
    DomainConfig,
    UrlPatternDefinition,
    UrlPattern,
} from "./types.mjs";
import registerDebug from "debug";
const debug = registerDebug("typeagent:browser:macro:store");

/**
 * MacroStore - storage system with pattern matching, search, and analytics
 *
 */
export class MacroStore {
    private fileManager: FileManager;
    private validator: MacroValidator;
    private indexManager: MacroIndexManager;
    private patternResolver: PatternResolver;
    private domainManager: DomainManager;
    private searchEngine: MacroSearchEngine;
    private analyticsManager: AnalyticsManager;
    private initialized: boolean = false;

    constructor(sessionStorage: any) {
        this.fileManager = new FileManager(sessionStorage);
        this.validator = new MacroValidator();
        this.indexManager = new MacroIndexManager();
        this.patternResolver = new PatternResolver();
        this.domainManager = new DomainManager(this.fileManager);
        this.searchEngine = new MacroSearchEngine();
        this.analyticsManager = new AnalyticsManager(this.fileManager);

        debug(this.searchEngine);
    }

    /**
     * Initialize the MacroStore with all components
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            // Initialize file system structure
            await this.fileManager.initialize();

            // Load existing macro index
            await this.loadMacroIndex();

            // Initialize analytics manager
            await this.analyticsManager.initialize();

            this.initialized = true;
            debug("MacroStore initialized successfully with enhanced features");
        } catch (error) {
            debug("Failed to initialize MacroStore:", error);
            console.error("Failed to initialize MacroStore:", error);
            throw new Error("MacroStore initialization failed");
        }
    }

    /**
     * Check if store is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Save a macro to storage
     */
    async saveMacro(macro: StoredMacro): Promise<SaveResult> {
        this.ensureInitialized();

        try {
            // Validate macro data
            const validation = this.validator.validateMacro(macro);
            if (!validation.isValid) {
                return {
                    success: false,
                    error: `Validation failed: ${validation.errors.map((e) => e.message).join(", ")}`,
                };
            }

            // Sanitize macro data
            const sanitizedMacro = this.validator.sanitizeMacro(macro);

            // Ensure domain directory exists for non-global macros
            if (
                sanitizedMacro.scope.type !== "global" &&
                sanitizedMacro.scope.domain
            ) {
                const domainDir = `macros/domains/${this.fileManager.sanitizeFilename(sanitizedMacro.scope.domain)}`;
                await this.fileManager.createDirectory(domainDir);
            }

            // Get file path
            const filePath = this.fileManager.getMacroFilePath(
                sanitizedMacro.id,
                sanitizedMacro.scope,
            );

            // Save macro to file
            await this.fileManager.writeJson(filePath, sanitizedMacro);

            // Update index
            this.indexManager.addMacro(sanitizedMacro, filePath);
            await this.saveMacroIndex();

            debug(`Macro saved: ${sanitizedMacro.name} (${sanitizedMacro.id})`);

            return {
                success: true,
                macroId: sanitizedMacro.id,
            };
        } catch (error) {
            console.error("Failed to save macro:", error);
            return {
                success: false,
                error: `Failed to save macro: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
        }
    }

    /**
     * Get a macro by ID
     */
    async getMacro(id: string): Promise<StoredMacro | null> {
        this.ensureInitialized();

        try {
            // Check index first
            const indexEntry = this.indexManager.getMacroEntry(id);
            if (!indexEntry) {
                return null;
            }

            // Load macro from file
            const macro = await this.fileManager.readJson<StoredMacro>(
                indexEntry.filePath,
            );

            if (!macro) {
                // Macro file missing but in index - remove from index
                this.indexManager.removeMacro(id);
                await this.saveMacroIndex();
                return null;
            }

            return macro;
        } catch (error) {
            console.error(`Failed to get macro ${id}:`, error);
            return null;
        }
    }

    /**
     * Update a macro
     */
    async updateMacro(
        id: string,
        updates: Partial<StoredMacro>,
    ): Promise<SaveResult> {
        this.ensureInitialized();

        try {
            // Get existing macro
            const existingMacro = await this.getMacro(id);
            if (!existingMacro) {
                return {
                    success: false,
                    error: `Macro not found: ${id}`,
                };
            }

            // Apply updates
            const updatedMacro: StoredMacro = {
                ...existingMacro,
                ...updates,
                id: existingMacro.id, // Prevent ID changes
                metadata: {
                    ...existingMacro.metadata,
                    ...updates.metadata,
                    updatedAt: new Date().toISOString(), // Always update timestamp
                },
            };

            // Save updated macro
            return await this.saveMacro(updatedMacro);
        } catch (error) {
            console.error(`Failed to update macro ${id}:`, error);
            return {
                success: false,
                error: `Failed to update macro: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
        }
    }

    /**
     * Delete a macro
     */
    async deleteMacro(id: string): Promise<SaveResult> {
        this.ensureInitialized();

        try {
            // Check if macro exists
            const indexEntry = this.indexManager.getMacroEntry(id);
            if (!indexEntry) {
                return {
                    success: false,
                    error: `Macro not found: ${id}`,
                };
            }

            // Delete file
            await this.fileManager.delete(indexEntry.filePath);

            // Remove from index
            this.indexManager.removeMacro(id);
            await this.saveMacroIndex();

            debug(`Macro deleted: ${id}`);

            return {
                success: true,
                macroId: id,
            };
        } catch (error) {
            console.error(`Failed to delete macro ${id}:`, error);
            return {
                success: false,
                error: `Failed to delete macro: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
        }
    }

    /**
     * Get all macros
     */
    async getAllMacros(): Promise<StoredMacro[]> {
        this.ensureInitialized();

        try {
            const indexEntries = this.indexManager.getAllMacroEntries();
            const macros: StoredMacro[] = [];

            for (const entry of indexEntries) {
                const macro = await this.fileManager.readJson<StoredMacro>(
                    entry.filePath,
                );
                if (macro) {
                    macros.push(macro);
                } else {
                    // Clean up missing macro from index
                    this.indexManager.removeMacro(entry.id);
                }
            }

            // Save index if we cleaned up any missing macros
            if (indexEntries.length !== macros.length) {
                await this.saveMacroIndex();
            }

            return macros;
        } catch (error) {
            console.error("Failed to get all macros:", error);
            return [];
        }
    }

    /**
     * Get macros for a specific URL using pattern matching
     */
    async getMacrosForUrl(url: string): Promise<StoredMacro[]> {
        this.ensureInitialized();

        try {
            // Use pattern resolver for enhanced URL matching
            const resolvedMacros =
                await this.patternResolver.resolveMacrosForUrl(
                    url,
                    (id: string) => this.getMacro(id),
                    () => this.getAllUrlPatterns(),
                    (domain: string) =>
                        this.indexManager.getMacrosForDomain(domain),
                    () => this.indexManager.getMacrosByScope("global"),
                );

            // Extract just the macros from resolved results
            return resolvedMacros.map((resolved) => resolved.macro);
        } catch (error) {
            console.error(`Failed to get macros for URL ${url}:`, error);
            return [];
        }
    }

    /**
     * Get macros for a domain
     */
    async getMacrosForDomain(domain: string): Promise<StoredMacro[]> {
        this.ensureInitialized();

        try {
            const domainEntries = this.indexManager.getMacrosForDomain(domain);
            const macros: StoredMacro[] = [];

            for (const entry of domainEntries) {
                const macro = await this.getMacro(entry.id);
                if (macro) {
                    macros.push(macro);
                }
            }

            return macros;
        } catch (error) {
            console.error(`Failed to get macros for domain ${domain}:`, error);
            return [];
        }
    }

    /**
     * Get global macros
     */
    async getGlobalMacros(): Promise<StoredMacro[]> {
        this.ensureInitialized();

        try {
            const globalEntries = this.indexManager.getMacrosByScope("global");
            const macros: StoredMacro[] = [];

            for (const entry of globalEntries) {
                const macro = await this.getMacro(entry.id);
                if (macro) {
                    macros.push(macro);
                }
            }

            return macros;
        } catch (error) {
            console.error("Failed to get global macros:", error);
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
                    macroFiles: storageStats.fileCount,
                },
            };
        } catch (error) {
            console.error("Failed to get statistics:", error);
            // Return empty stats on error
            return {
                totalMacros: 0,
                macrosByScope: {
                    global: 0,
                    domain: 0,
                    pattern: 0,
                    page: 0,
                } as Record<"global" | "domain" | "pattern" | "page", number>,
                macrosByCategory: {} as any,
                macrosByAuthor: {} as any,
                totalDomains: 0,
                totalPatterns: 0,
                usage: {
                    totalUsage: 0,
                    averageUsage: 0,
                    mostUsedMacros: [],
                },
                storage: {
                    totalSize: 0,
                    macroFiles: 0,
                    domainConfigs: 0,
                    indexSize: 0,
                },
                health: {
                    validMacros: 0,
                    invalidMacros: 0,
                },
            };
        }
    }

    /**
     * Record macro usage (increment usage count)
     */
    async recordUsage(macroId: string): Promise<void> {
        this.ensureInitialized();

        try {
            // Update index
            this.indexManager.incrementUsage(macroId);

            // Update macro file
            const macro = await this.getMacro(macroId);
            if (macro) {
                macro.metadata.usageCount++;
                macro.metadata.lastUsed = new Date().toISOString();
                await this.saveMacro(macro);
            }
        } catch (error) {
            console.error(
                `Failed to record usage for macro ${macroId}:`,
                error,
            );
        }
    }

    /**
     * Validate a macro without saving it
     */
    validateMacro(macro: StoredMacro): ValidationResult {
        return this.validator.validateMacro(macro);
    }

    /**
     * Create a new macro with default values
     */
    createDefaultMacro(overrides: Partial<StoredMacro> = {}): StoredMacro {
        return this.validator.createDefaultMacro(overrides);
    }

    /**
     * Create backup of all macros
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
     * Get macros for a specific pattern
     */
    async getMacrosForPattern(
        domain: string,
        pattern: string,
    ): Promise<StoredMacro[]> {
        this.ensureInitialized();

        try {
            // For now, return macros that match the domain
            // This could be enhanced to match specific patterns
            return await this.getMacrosForDomain(domain);
        } catch (error) {
            console.error(
                `Failed to get macros for pattern ${pattern} in domain ${domain}:`,
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

    /**
     * Load macro index from storage
     */
    private async loadMacroIndex(): Promise<void> {
        try {
            const indexPath = this.fileManager.getIndexPath("macro");
            const indexData =
                await this.fileManager.readJson<MacroIndex>(indexPath);
            this.indexManager.loadIndex(indexData);

            if (indexData) {
                debug(
                    `Loaded macro index with ${Object.keys(indexData.macros).length} macros`,
                );
            } else {
                debug("No existing macro index found, starting fresh");
            }
        } catch (error) {
            console.error("Failed to load macro index:", error);
            // Start with empty index on error
            this.indexManager.loadIndex(null);
        }
    }

    /**
     * Save macro index to storage
     */
    private async saveMacroIndex(): Promise<void> {
        try {
            const indexPath = this.fileManager.getIndexPath("macro");
            const index = this.indexManager.getIndex();
            await this.fileManager.writeJson(indexPath, index);
        } catch (error) {
            console.error("Failed to save macro index:", error);
            // Don't throw here as this would break the main operation
        }
    }

    /**
     * Ensure the store is initialized
     */
    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error(
                "MacroStore not initialized. Call initialize() first.",
            );
        }
    }
}
