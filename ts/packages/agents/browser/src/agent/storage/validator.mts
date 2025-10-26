// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    StoredMacro,
    MacroIndex,
    MacroIndexEntry,
    ValidationResult,
    ValidationError,
    StoreStatistics,
    StoredAction,
    ActionIndexEntry,
} from "./types.mjs";

/**
 * Macro validator for ensuring data integrity
 */
export class MacroValidator {
    /**
     * Validate a complete StoredMacro
     */
    validateMacro(macro: StoredMacro): ValidationResult {
        // For now, delegate to validateAction with cast for compatibility
        return this.validateAction(macro as any);
    }

    /**
     * Sanitize macro data
     */
    sanitizeMacro(macro: StoredMacro): StoredMacro {
        // For now, delegate to sanitizeAction with cast for compatibility
        return this.sanitizeAction(macro as any) as StoredMacro;
    }

    /**
     * Create default macro
     */
    createDefaultMacro(overrides: Partial<StoredMacro> = {}): StoredMacro {
        // For now, delegate to createDefaultAction with cast for compatibility
        return this.createDefaultAction(overrides as any) as StoredMacro;
    }

    // Backward compatibility methods - these delegate to the original logic
    validateAction(action: StoredAction): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: string[] = [];

        // Basic validation logic - simplified for now
        if (!action.id || typeof action.id !== "string") {
            errors.push({
                field: "id",
                message: "ID is required and must be a string",
            });
        }

        if (!action.name || typeof action.name !== "string") {
            errors.push({
                field: "name",
                message: "Name is required and must be a string",
            });
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
        };
    }

    sanitizeAction(action: StoredAction): StoredAction {
        // Basic sanitization - return the action for now
        return {
            ...action,
            name: action.name?.trim() || "",
            description: action.description?.trim() || "",
        };
    }

    createDefaultAction(overrides: Partial<StoredAction> = {}): StoredAction {
        const now = new Date().toISOString();

        const defaultAction: StoredAction = {
            id: this.generateActionId(),
            name: "Untitled Action",
            version: "1.0.0",
            description: "",
            category: "utility",
            tags: [],
            author: "user",
            scope: {
                type: "page",
                priority: 50,
            },
            urlPatterns: [],
            definition: {},
            context: {},
            metadata: {
                createdAt: now,
                updatedAt: now,
                usageCount: 0,
                isValid: true,
            },
            ...overrides,
        };

        return this.sanitizeAction(defaultAction);
    }

    private generateActionId(): string {
        return (
            Math.random().toString(36).substring(2) + Date.now().toString(36)
        );
    }
}

/**
 * Macro index manager for fast lookups and statistics
 */
export class MacroIndexManager {
    private index: MacroIndex;

    constructor() {
        this.index = {
            version: "1.0.0",
            lastUpdated: new Date().toISOString(),
            macros: {},
        };
    }

    /**
     * Add macro to index
     */
    addMacro(
        macro: StoredMacro,
        filePath: string,
        fileFormat: "yaml" | "json" = "yaml",
    ): void {
        return this.addAction(macro as any, filePath, fileFormat);
    }

    /**
     * Get macro entry
     */
    getMacroEntry(id: string): MacroIndexEntry | null {
        return this.getActionEntry(id) as MacroIndexEntry | null;
    }

    /**
     * Remove macro from index
     */
    removeMacro(id: string): void {
        return this.removeAction(id);
    }

    /**
     * Get all macro entries
     */
    getAllMacroEntries(): MacroIndexEntry[] {
        return this.getAllActionEntries() as MacroIndexEntry[];
    }

    /**
     * Get macros for domain
     */
    getMacrosForDomain(domain: string): MacroIndexEntry[] {
        return this.getActionsForDomain(domain) as MacroIndexEntry[];
    }

    /**
     * Get macros by scope
     */
    getMacrosByScope(scope: string): MacroIndexEntry[] {
        return this.getActionsByScope(scope) as MacroIndexEntry[];
    }

    /**
     * Get statistics
     */
    getStatistics(): StoreStatistics {
        // Return basic statistics for now
        const entries = Object.values(this.index.macros || {});

        return {
            totalMacros: entries.length,
            macrosByScope: {
                global: entries.filter((e) => e.scope.type === "global").length,
                domain: entries.filter((e) => e.scope.type === "domain").length,
                pattern: entries.filter((e) => e.scope.type === "pattern")
                    .length,
                page: entries.filter((e) => e.scope.type === "page").length,
            },
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
                macroFiles: entries.length,
                domainConfigs: 0,
                indexSize: 0,
            },
            health: {
                validMacros: entries.length,
                invalidMacros: 0,
            },
        };
    }

    /**
     * Increment usage count
     */
    incrementUsage(macroId: string): void {
        const entry = this.index.macros?.[macroId];
        if (entry) {
            entry.usageCount = (entry.usageCount || 0) + 1;
        }
    }

    /**
     * Load index
     */
    loadIndex(indexData: MacroIndex | null): void {
        if (indexData && indexData.macros) {
            this.index = indexData;
        } else {
            this.resetIndex();
        }
    }

    /**
     * Get index
     */
    getIndex(): MacroIndex {
        return this.index;
    }

    private resetIndex(): void {
        this.index = {
            version: "1.0.0",
            lastUpdated: new Date().toISOString(),
            macros: {},
        };
    }

    // Backward compatibility methods
    addAction(
        action: StoredAction,
        filePath: string,
        fileFormat: "yaml" | "json" = "yaml",
    ): void {
        const entry: ActionIndexEntry = {
            id: action.id,
            name: action.name,
            domain: action.scope.domain || "",
            scope: action.scope,
            category: action.category,
            author: action.author,
            filePath,
            fileFormat,
            created: action.metadata.createdAt,
            updated: action.metadata.updatedAt,
            lastModified: action.metadata.updatedAt,
            usageCount: action.metadata.usageCount,
            isValid: action.metadata.isValid,
            tags: action.tags || [],
            recordingId: (action as any).recordingId,
        };

        if (this.index.macros) {
            this.index.macros[action.id] = entry as any;
        }
        this.index.lastUpdated = new Date().toISOString();
    }

    getActionEntry(id: string): ActionIndexEntry | null {
        return (this.index.macros?.[id] as any) || null;
    }

    removeAction(id: string): void {
        if (this.index.macros?.[id]) {
            delete this.index.macros[id];
            this.index.lastUpdated = new Date().toISOString();
        }
    }

    getAllActionEntries(): ActionIndexEntry[] {
        return Object.values(this.index.macros || {}) as ActionIndexEntry[];
    }

    getActionsForDomain(domain: string): ActionIndexEntry[] {
        return this.getAllActionEntries().filter(
            (entry) => entry.scope.domain === domain,
        );
    }

    getActionsByScope(scopeType: string): ActionIndexEntry[] {
        return this.getAllActionEntries().filter(
            (entry) => entry.scope.type === scopeType,
        );
    }
}

// Export backward compatibility aliases
export const ActionValidator = MacroValidator;
export const ActionIndexManager = MacroIndexManager;
