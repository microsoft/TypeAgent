// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    StoredAction,
    ActionIndex,
    ActionIndexEntry,
    ValidationResult,
    ValidationError,
    ActionScope,
    ActionCategory,
    ActionAuthor,
    StoreStatistics,
} from "./types.mjs";

/**
 * Action validator for ensuring data integrity
 */
export class ActionValidator {
    /**
     * Validate a complete StoredAction
     */
    validateAction(action: StoredAction): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: string[] = [];

        // Validate core identity
        if (!action.id || typeof action.id !== "string") {
            errors.push({
                field: "id",
                message: "ID is required and must be a string",
            });
        } else if (action.id.length !== 32) {
            errors.push({
                field: "id",
                message: "ID must be a 32-character UUID without hyphens",
            });
        }

        if (!action.name || typeof action.name !== "string") {
            errors.push({
                field: "name",
                message: "Name is required and must be a string",
            });
        } else if (action.name.length > 100) {
            errors.push({
                field: "name",
                message: "Name must be 100 characters or less",
            });
        }

        if (!action.version || typeof action.version !== "string") {
            errors.push({
                field: "version",
                message: "Version is required and must be a string",
            });
        } else if (!/^\d+\.\d+\.\d+$/.test(action.version)) {
            warnings.push(
                'Version should follow semantic versioning (e.g., "1.0.0")',
            );
        }

        // Validate metadata
        if (!action.description || typeof action.description !== "string") {
            errors.push({
                field: "description",
                message: "Description is required and must be a string",
            });
        } else if (action.description.length > 500) {
            errors.push({
                field: "description",
                message: "Description must be 500 characters or less",
            });
        }

        if (!this.isValidCategory(action.category)) {
            errors.push({
                field: "category",
                message: "Category must be a valid ActionCategory",
            });
        }

        if (!Array.isArray(action.tags)) {
            errors.push({ field: "tags", message: "Tags must be an array" });
        } else {
            if (action.tags.length > 10) {
                errors.push({
                    field: "tags",
                    message: "Maximum 10 tags allowed",
                });
            }
            action.tags.forEach((tag, index) => {
                if (typeof tag !== "string") {
                    errors.push({
                        field: `tags[${index}]`,
                        message: "Each tag must be a string",
                    });
                } else if (tag.length > 30) {
                    errors.push({
                        field: `tags[${index}]`,
                        message: "Each tag must be 30 characters or less",
                    });
                }
            });
        }

        if (!this.isValidAuthor(action.author)) {
            errors.push({
                field: "author",
                message: 'Author must be "discovered" or "user"',
            });
        }

        // Validate scope
        const scopeValidation = this.validateScope(action.scope);
        errors.push(...scopeValidation.errors);
        warnings.push(...scopeValidation.warnings);

        // Validate URL patterns
        if (!Array.isArray(action.urlPatterns)) {
            errors.push({
                field: "urlPatterns",
                message: "urlPatterns must be an array",
            });
        } else {
            action.urlPatterns.forEach((pattern, index) => {
                const patternValidation = this.validateUrlPattern(pattern);
                patternValidation.errors.forEach((error) => {
                    errors.push({
                        field: `urlPatterns[${index}].${error.field}`,
                        message: error.message,
                    });
                });
            });
        }

        // Validate metadata
        const metadataValidation = this.validateMetadata(action.metadata);
        errors.push(...metadataValidation.errors);
        warnings.push(...metadataValidation.warnings);

        // Validate definition
        if (action.definition) {
            const definitionValidation = this.validateDefinition(
                action.definition,
            );
            errors.push(...definitionValidation.errors);
            warnings.push(...definitionValidation.warnings);
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
        };
    }

    /**
     * Validate action scope
     */
    private validateScope(scope: ActionScope): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: string[] = [];

        if (!scope || typeof scope !== "object") {
            errors.push({
                field: "scope",
                message: "Scope is required and must be an object",
            });
            return { isValid: false, errors, warnings };
        }

        const validTypes = ["global", "domain", "pattern", "page"];
        if (!validTypes.includes(scope.type)) {
            errors.push({
                field: "scope.type",
                message: `Type must be one of: ${validTypes.join(", ")}`,
            });
        }

        if (scope.type !== "global" && !scope.domain) {
            errors.push({
                field: "scope.domain",
                message: "Domain is required for non-global scopes",
            });
        }

        if (
            typeof scope.priority !== "number" ||
            scope.priority < 1 ||
            scope.priority > 100
        ) {
            errors.push({
                field: "scope.priority",
                message: "Priority must be a number between 1 and 100",
            });
        }

        return { isValid: errors.length === 0, errors, warnings };
    }

    /**
     * Validate URL pattern
     */
    private validateUrlPattern(pattern: any): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: string[] = [];

        if (!pattern || typeof pattern !== "object") {
            errors.push({
                field: "pattern",
                message: "Pattern must be an object",
            });
            return { isValid: false, errors, warnings };
        }

        if (!pattern.pattern || typeof pattern.pattern !== "string") {
            errors.push({
                field: "pattern",
                message: "Pattern string is required",
            });
        }

        const validTypes = ["exact", "glob", "regex"];
        if (!validTypes.includes(pattern.type)) {
            errors.push({
                field: "type",
                message: `Type must be one of: ${validTypes.join(", ")}`,
            });
        }

        if (
            typeof pattern.priority !== "number" ||
            pattern.priority < 1 ||
            pattern.priority > 100
        ) {
            errors.push({
                field: "priority",
                message: "Priority must be a number between 1 and 100",
            });
        }

        // Validate regex patterns
        if (pattern.type === "regex") {
            try {
                new RegExp(pattern.pattern);
            } catch (error) {
                errors.push({
                    field: "pattern",
                    message: "Invalid regex pattern",
                });
            }
        }

        return { isValid: errors.length === 0, errors, warnings };
    }

    /**
     * Validate action metadata
     */
    private validateMetadata(metadata: any): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: string[] = [];

        if (!metadata || typeof metadata !== "object") {
            errors.push({
                field: "metadata",
                message: "Metadata is required and must be an object",
            });
            return { isValid: false, errors, warnings };
        }

        // Validate timestamps
        if (!metadata.createdAt || !this.isValidISOString(metadata.createdAt)) {
            errors.push({
                field: "metadata.createdAt",
                message: "createdAt must be a valid ISO 8601 timestamp",
            });
        }

        if (!metadata.updatedAt || !this.isValidISOString(metadata.updatedAt)) {
            errors.push({
                field: "metadata.updatedAt",
                message: "updatedAt must be a valid ISO 8601 timestamp",
            });
        }

        if (
            typeof metadata.usageCount !== "number" ||
            metadata.usageCount < 0
        ) {
            errors.push({
                field: "metadata.usageCount",
                message: "usageCount must be a non-negative number",
            });
        }

        if (metadata.lastUsed && !this.isValidISOString(metadata.lastUsed)) {
            errors.push({
                field: "metadata.lastUsed",
                message: "lastUsed must be a valid ISO 8601 timestamp",
            });
        }

        if (typeof metadata.isValid !== "boolean") {
            errors.push({
                field: "metadata.isValid",
                message: "isValid must be a boolean",
            });
        }

        return { isValid: errors.length === 0, errors, warnings };
    }

    /**
     * Validate action definition
     */
    private validateDefinition(definition: any): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: string[] = [];

        if (!definition || typeof definition !== "object") {
            warnings.push(
                "Action definition is recommended for proper functionality",
            );
            return { isValid: true, errors, warnings };
        }

        // Validate intent JSON if present
        if (definition.intentJson) {
            if (
                !definition.intentJson.actionName ||
                typeof definition.intentJson.actionName !== "string"
            ) {
                errors.push({
                    field: "definition.intentJson.actionName",
                    message: "Intent action name is required",
                });
            }

            if (!Array.isArray(definition.intentJson.parameters)) {
                errors.push({
                    field: "definition.intentJson.parameters",
                    message: "Intent parameters must be an array",
                });
            }
        }

        // Validate action steps if present
        if (definition.actionSteps && !Array.isArray(definition.actionSteps)) {
            errors.push({
                field: "definition.actionSteps",
                message: "Action steps must be an array",
            });
        }

        return { isValid: errors.length === 0, errors, warnings };
    }

    /**
     * Check if category is valid
     */
    private isValidCategory(category: any): category is ActionCategory {
        const validCategories = [
            "navigation",
            "form",
            "commerce",
            "search",
            "content",
            "social",
            "media",
            "utility",
            "custom",
        ];
        return (
            typeof category === "string" && validCategories.includes(category)
        );
    }

    /**
     * Check if author is valid
     */
    private isValidAuthor(author: any): author is ActionAuthor {
        return author === "discovered" || author === "user";
    }

    /**
     * Check if string is valid ISO 8601 timestamp
     */
    private isValidISOString(dateString: string): boolean {
        const date = new Date(dateString);
        return (
            date instanceof Date &&
            !isNaN(date.getTime()) &&
            date.toISOString() === dateString
        );
    }

    /**
     * Sanitize action data before saving
     */
    sanitizeAction(action: StoredAction): StoredAction {
        const sanitized = { ...action };

        // Trim strings
        sanitized.name = sanitized.name?.trim() || "";
        sanitized.description = sanitized.description?.trim() || "";

        // Sanitize tags
        sanitized.tags =
            sanitized.tags
                ?.map((tag) => tag.trim().toLowerCase())
                .filter((tag) => tag.length > 0)
                .slice(0, 10) || [];

        // Remove duplicates from tags
        sanitized.tags = [...new Set(sanitized.tags)];

        // Ensure metadata dates are current if not set
        const now = new Date().toISOString();
        if (!sanitized.metadata.createdAt) {
            sanitized.metadata.createdAt = now;
        }
        sanitized.metadata.updatedAt = now;

        // Ensure usage count is non-negative
        sanitized.metadata.usageCount = Math.max(
            0,
            sanitized.metadata.usageCount || 0,
        );

        return sanitized;
    }

    /**
     * Create a new action with default values
     */
    createDefaultAction(overrides: Partial<StoredAction> = {}): StoredAction {
        const now = new Date().toISOString();
        const id = this.generateActionId();

        const defaultAction: StoredAction = {
            id,
            name: "",
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

    /**
     * Generate a unique action ID
     */
    private generateActionId(): string {
        return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(
            /[xy]/g,
            function (c) {
                const r = (Math.random() * 16) | 0;
                const v = c === "x" ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            },
        );
    }
}

/**
 * Action index manager for fast lookups
 */
export class ActionIndexManager {
    private index: ActionIndex;

    constructor() {
        this.index = {
            version: "1.0.0",
            lastUpdated: new Date().toISOString(),
            actions: {},
        };
    }

    /**
     * Load index from storage
     */
    loadIndex(indexData: ActionIndex | null): void {
        if (indexData && this.isValidIndex(indexData)) {
            this.index = indexData;
        } else {
            this.resetIndex();
        }
    }

    /**
     * Get current index
     */
    getIndex(): ActionIndex {
        return { ...this.index };
    }

    /**
     * Add action to index
     */
    addAction(action: StoredAction, filePath: string): void {
        const entry: ActionIndexEntry = {
            id: action.id,
            name: action.name,
            scope: action.scope,
            category: action.category,
            author: action.author,
            filePath,
            lastModified: action.metadata.updatedAt,
            usageCount: action.metadata.usageCount,
        };

        this.index.actions[action.id] = entry;
        this.index.lastUpdated = new Date().toISOString();
    }

    /**
     * Remove action from index
     */
    removeAction(actionId: string): void {
        delete this.index.actions[actionId];
        this.index.lastUpdated = new Date().toISOString();
    }

    /**
     * Update action in index
     */
    updateAction(action: StoredAction, filePath: string): void {
        if (this.index.actions[action.id]) {
            this.addAction(action, filePath); // This will overwrite existing entry
        }
    }

    /**
     * Get action entry by ID
     */
    getActionEntry(actionId: string): ActionIndexEntry | null {
        return this.index.actions[actionId] || null;
    }

    /**
     * Get all action entries
     */
    getAllActionEntries(): ActionIndexEntry[] {
        return Object.values(this.index.actions);
    }

    /**
     * Get actions by scope type
     */
    getActionsByScope(scopeType: ActionScope["type"]): ActionIndexEntry[] {
        return this.getAllActionEntries().filter(
            (entry) => entry.scope.type === scopeType,
        );
    }

    /**
     * Get actions by category
     */
    getActionsByCategory(category: ActionCategory): ActionIndexEntry[] {
        return this.getAllActionEntries().filter(
            (entry) => entry.category === category,
        );
    }

    /**
     * Get actions by author
     */
    getActionsByAuthor(author: ActionAuthor): ActionIndexEntry[] {
        return this.getAllActionEntries().filter(
            (entry) => entry.author === author,
        );
    }

    /**
     * Get actions for domain
     */
    getActionsForDomain(domain: string): ActionIndexEntry[] {
        return this.getAllActionEntries().filter(
            (entry) =>
                entry.scope.type === "global" ||
                (entry.scope.domain === domain &&
                    ["domain", "pattern", "page"].includes(entry.scope.type)),
        );
    }

    /**
     * Search actions by name
     */
    searchByName(query: string): ActionIndexEntry[] {
        const lowerQuery = query.toLowerCase();
        return this.getAllActionEntries().filter((entry) =>
            entry.name.toLowerCase().includes(lowerQuery),
        );
    }

    /**
     * Get statistics from index
     */
    getStatistics(): StoreStatistics {
        const entries = this.getAllActionEntries();

        const actionsByScope = entries.reduce(
            (acc, entry) => {
                acc[entry.scope.type] = (acc[entry.scope.type] || 0) + 1;
                return acc;
            },
            {} as Record<ActionScope["type"], number>,
        );

        const actionsByCategory = entries.reduce(
            (acc, entry) => {
                acc[entry.category] = (acc[entry.category] || 0) + 1;
                return acc;
            },
            {} as Record<ActionCategory, number>,
        );

        const actionsByAuthor = entries.reduce(
            (acc, entry) => {
                acc[entry.author] = (acc[entry.author] || 0) + 1;
                return acc;
            },
            {} as Record<ActionAuthor, number>,
        );

        const totalUsage = entries.reduce(
            (sum, entry) => sum + entry.usageCount,
            0,
        );
        const averageUsage =
            entries.length > 0 ? totalUsage / entries.length : 0;

        const mostUsedActions = entries
            .sort((a, b) => b.usageCount - a.usageCount)
            .slice(0, 10)
            .map((entry) => ({
                id: entry.id,
                name: entry.name,
                count: entry.usageCount,
            }));

        const domains = new Set(
            entries
                .filter((entry) => entry.scope.domain)
                .map((entry) => entry.scope.domain!),
        );

        return {
            totalActions: entries.length,
            actionsByScope,
            actionsByCategory,
            actionsByAuthor,
            totalDomains: domains.size,
            totalPatterns: 0, // Updated by domain manager when needed
            usage: {
                totalUsage,
                averageUsage,
                mostUsedActions,
            },
            storage: {
                totalSize: 0, // Will be calculated by FileManager
                actionFiles: entries.length,
                domainConfigs: domains.size,
                indexSize: 0, // Will be calculated by FileManager
            },
            health: {
                validActions: entries.length, // All indexed actions are considered valid
                invalidActions: 0,
            },
        };
    }

    /**
     * Reset index to empty state
     */
    resetIndex(): void {
        this.index = {
            version: "1.0.0",
            lastUpdated: new Date().toISOString(),
            actions: {},
        };
    }

    /**
     * Validate index structure
     */
    private isValidIndex(index: any): index is ActionIndex {
        return (
            index &&
            typeof index === "object" &&
            typeof index.version === "string" &&
            typeof index.lastUpdated === "string" &&
            typeof index.actions === "object"
        );
    }

    /**
     * Increment usage count for an action
     */
    incrementUsage(actionId: string): void {
        const entry = this.index.actions[actionId];
        if (entry) {
            entry.usageCount++;
            entry.lastModified = new Date().toISOString();
            this.index.lastUpdated = new Date().toISOString();
        }
    }

    /**
     * Get recently used actions
     */
    getRecentlyUsed(limit: number = 10): ActionIndexEntry[] {
        return this.getAllActionEntries()
            .filter((entry) => entry.usageCount > 0)
            .sort(
                (a, b) =>
                    new Date(b.lastModified).getTime() -
                    new Date(a.lastModified).getTime(),
            )
            .slice(0, limit);
    }

    /**
     * Get most used actions
     */
    getMostUsed(limit: number = 10): ActionIndexEntry[] {
        return this.getAllActionEntries()
            .sort((a, b) => b.usageCount - a.usageCount)
            .slice(0, limit);
    }
}
