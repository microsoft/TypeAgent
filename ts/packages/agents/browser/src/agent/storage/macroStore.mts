// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FileManager } from "./fileManager.mjs";
import { MacroValidator, MacroIndexManager } from "./validator.mjs";
import { PatternResolver } from "./patternResolver.mjs";
import {
    StoredMacro,
    MacroIndex,
    StoreStatistics,
    SaveResult,
    ValidationResult,
} from "./types.mjs";
import { MacroConverter } from "../discovery/yamlMacro/converter.mjs";
import { YAMLMacroParser } from "../discovery/yamlMacro/yamlParser.mjs";
import { ArtifactsStorage } from "../discovery/yamlMacro/artifactsStorage.mjs";
import registerDebug from "debug";
const debug = registerDebug("typeagent:browser:macro:store");

/**
 * MacroStore - storage system with pattern matching and search
 *
 */
export class MacroStore {
    private fileManager: FileManager;
    private validator: MacroValidator;
    private indexManager: MacroIndexManager;
    private patternResolver: PatternResolver;
    private sessionStorage: any;
    private initialized: boolean = false;

    constructor(sessionStorage: any) {
        this.sessionStorage = sessionStorage;
        this.fileManager = new FileManager(sessionStorage);
        this.validator = new MacroValidator();
        this.indexManager = new MacroIndexManager();
        this.patternResolver = new PatternResolver();
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

            // Convert to YAML and save
            const artifactsBasePath = "actionsStore/macros";
            const artifactsStorage = new ArtifactsStorage(
                artifactsBasePath,
                this.sessionStorage,
            );
            const converter = new MacroConverter(artifactsStorage);
            const parser = new YAMLMacroParser();

            const yamlResult =
                await converter.convertJSONToYAML(sanitizedMacro);
            const yamlString = parser.stringify(yamlResult.yaml);

            // Get YAML file path
            const filePath = this.fileManager.getMacroFilePath(
                sanitizedMacro.id,
                sanitizedMacro.scope,
                "yaml",
            );

            // Save YAML to file
            await this.fileManager.writeText(filePath, yamlString);

            // Update index with yaml format
            this.indexManager.addMacro(sanitizedMacro, filePath, "yaml");
            await this.saveMacroIndex();

            // Clear pattern resolver cache so new macro appears immediately
            this.patternResolver.clearCache();

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
            const indexEntry = this.indexManager.getMacroEntry(id);
            if (!indexEntry) {
                return null;
            }

            // Check file format - support both YAML and JSON for backwards compatibility
            const isYaml =
                indexEntry.fileFormat === "yaml" ||
                (!indexEntry.fileFormat &&
                    indexEntry.filePath?.endsWith(".yaml"));

            const isJson =
                !indexEntry.fileFormat ||
                indexEntry.fileFormat === "json" ||
                indexEntry.filePath?.endsWith(".json");

            if (isYaml) {
                // Load YAML format (all YAML files now use full format)
                return await this.getStoredMacroFromFullYAML(id);
            } else if (isJson) {
                // Load legacy JSON format directly
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
            } else {
                debug(
                    `Macro ${id} has unsupported format (fileFormat: ${indexEntry.fileFormat}, filePath: ${indexEntry.filePath}), skipping`,
                );
                return null;
            }
        } catch (error) {
            console.error(`Failed to get macro ${id}:`, error);
            return null;
        }
    }

    /**
     * Get the raw YAML content from disk (for UI display)
     */
    async getRawYAML(id: string): Promise<string | null> {
        this.ensureInitialized();

        try {
            const indexEntry = this.indexManager.getMacroEntry(id);
            if (!indexEntry) return null;

            if (indexEntry.fileFormat !== "yaml") {
                return null;
            }

            return await this.fileManager.readText(indexEntry.filePath);
        } catch (error) {
            console.error(`Failed to get raw YAML for macro ${id}:`, error);
            return null;
        }
    }

    /**
     * Load macro from full YAML format
     */
    async getStoredMacroFromFullYAML(id: string): Promise<StoredMacro | null> {
        this.ensureInitialized();

        try {
            const indexEntry = this.indexManager.getMacroEntry(id);
            if (!indexEntry) return null;

            const yamlContent = await this.fileManager.readText(
                indexEntry.filePath,
            );
            if (!yamlContent) return null;

            const parser = new YAMLMacroParser();
            const fullYaml = parser.parse(yamlContent);

            const converter = new MacroConverter(
                new ArtifactsStorage(
                    "actionsStore/macros",
                    this.sessionStorage,
                ),
            );
            const storedMacro = await converter.convertYAMLToJSON(fullYaml, id);

            // Attach raw YAML content for UI display
            return {
                ...storedMacro,
                rawYAML: yamlContent,
            };
        } catch (error) {
            console.error(`Failed to get full YAML macro ${id}:`, error);
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

            // Clear pattern resolver cache so deleted macro is removed immediately
            this.patternResolver.clearCache();

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
                    () => Promise.resolve([]), // No URL patterns without domain manager
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
