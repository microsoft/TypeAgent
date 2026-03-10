// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar Store - Manages persistence of dynamically generated grammar rules
 *
 * Similar to ConstructionStore, this stores grammar rules that are learned
 * from user interactions. Grammars are stored per-session in JSON format.
 *
 * The compiled Grammar AST (GrammarJson) is stored alongside the per-rule
 * grammar text so that subsequent loads can skip re-parsing. The grammarText
 * fields are retained for human readability and debugging.
 */

import fs from "node:fs";
import path from "node:path";
import { loadGrammarRulesNoThrow } from "./grammarLoader.js";
import { Grammar, GrammarJson } from "./grammarTypes.js";
import { grammarFromJson } from "./grammarDeserializer.js";
import { grammarToJson } from "./grammarSerializer.js";

/**
 * Stored grammar rule with metadata
 */
export interface StoredGrammarRule {
    // Stable numeric ID assigned at creation time; used for human-friendly deletion
    id: number;
    // The raw grammar text (.agr format) — retained for debugging and export
    grammarText: string;
    // When this rule was added
    timestamp: number;
    // The request that generated this rule
    sourceRequest?: string;
    // The action this rule maps to
    actionName?: string;
    // The schema/agent this belongs to
    schemaName: string;
}

/**
 * Grammar store data structure (JSON serializable)
 */
export interface GrammarStoreData {
    version: string;
    // Auto-incrementing counter for assigning stable rule IDs
    nextId?: number;
    // Map from schema name to array of grammar rules
    schemas: Record<string, StoredGrammarRule[]>;
    // Pre-compiled Grammar AST of all rules combined.
    // Written on save() so subsequent loads skip re-parsing grammarText.
    // Absent in older files — compileToGrammar() falls back to parsing text.
    compiledGrammar?: GrammarJson;
}

export interface GrammarStoreInfo {
    filePath: string | undefined;
    modified: boolean;
    ruleCount: number;
    schemaCount: number;
}

/**
 * Grammar Store - manages persistent storage of dynamically generated grammars
 */
export class GrammarStore {
    private data: GrammarStoreData;
    private modified: boolean = false;
    private filePath: string | undefined = undefined;
    private autoSave: boolean = false;
    // In-memory cache of the compiled Grammar; invalidated on addRule/deleteRule
    private _compiledCache: Grammar | undefined = undefined;

    constructor() {
        this.data = {
            version: "1.0",
            nextId: 1,
            schemas: {},
        };
    }

    /**
     * Check if the store has been modified since last save
     */
    public isModified(): boolean {
        return this.modified;
    }

    /**
     * Get the file path where this store is saved
     */
    public getFilePath(): string | undefined {
        return this.filePath;
    }

    /**
     * Check if auto-save is enabled
     */
    public isAutoSave(): boolean {
        return this.autoSave && this.filePath !== undefined;
    }

    /**
     * Enable or disable auto-save
     */
    public async setAutoSave(autoSave: boolean): Promise<void> {
        this.autoSave = autoSave;
        if (this.filePath !== undefined && autoSave && this.modified) {
            await this.save();
        }
    }

    /**
     * Get store information
     */
    public getInfo(): GrammarStoreInfo {
        let ruleCount = 0;
        for (const rules of Object.values(this.data.schemas)) {
            ruleCount += rules.length;
        }

        return {
            filePath: this.filePath,
            modified: this.modified,
            ruleCount,
            schemaCount: Object.keys(this.data.schemas).length,
        };
    }

    /**
     * Add a new grammar rule to the store
     */
    public async addRule(
        rule: Omit<StoredGrammarRule, "timestamp" | "id">,
    ): Promise<void> {
        if (this.data.nextId === undefined) {
            this.data.nextId = 1;
        }
        const storedRule: StoredGrammarRule = {
            ...rule,
            id: this.data.nextId++,
            timestamp: Date.now(),
        };

        if (!this.data.schemas[rule.schemaName]) {
            this.data.schemas[rule.schemaName] = [];
        }

        this.data.schemas[rule.schemaName].push(storedRule);
        this._compiledCache = undefined;
        this.modified = true;
        await this.doAutoSave();
    }

    /**
     * Get all rules for a specific schema
     */
    public getRulesForSchema(schemaName: string): StoredGrammarRule[] {
        return this.data.schemas[schemaName] || [];
    }

    /**
     * Get all rules across all schemas
     */
    public getAllRules(): StoredGrammarRule[] {
        const rules: StoredGrammarRule[] = [];
        for (const schemaRules of Object.values(this.data.schemas)) {
            rules.push(...schemaRules);
        }
        return rules;
    }

    /**
     * Delete a rule by index within a schema
     */
    public async deleteRule(
        schemaName: string,
        index: number,
    ): Promise<boolean> {
        const rules = this.data.schemas[schemaName];
        if (!rules || index < 0 || index >= rules.length) {
            return false;
        }

        rules.splice(index, 1);

        // Clean up empty schema entries
        if (rules.length === 0) {
            delete this.data.schemas[schemaName];
        }

        this._compiledCache = undefined;
        this.modified = true;
        await this.doAutoSave();
        return true;
    }

    /**
     * Delete a rule by its stable ID (searches all schemas)
     * Returns the deleted rule on success, undefined if not found
     */
    public async deleteRuleById(
        id: number,
    ): Promise<StoredGrammarRule | undefined> {
        for (const [schemaName, rules] of Object.entries(this.data.schemas)) {
            const index = rules.findIndex((r) => r.id === id);
            if (index !== -1) {
                const [deleted] = rules.splice(index, 1);
                if (rules.length === 0) {
                    delete this.data.schemas[schemaName];
                }
                this._compiledCache = undefined;
                this.modified = true;
                await this.doAutoSave();
                return deleted;
            }
        }
        return undefined;
    }

    /**
     * Clear all rules for a specific schema
     */
    public async clearSchema(schemaName: string): Promise<number> {
        const rules = this.data.schemas[schemaName];
        if (!rules) {
            return 0;
        }
        const count = rules.length;
        delete this.data.schemas[schemaName];
        this._compiledCache = undefined;
        this.modified = true;
        await this.doAutoSave();
        return count;
    }

    /**
     * Get all schema names that have stored rules
     */
    public getSchemaNames(): string[] {
        return Object.keys(this.data.schemas);
    }

    /**
     * Clear all rules
     */
    public clear(): void {
        this.data = {
            version: "1.0",
            nextId: this.data.nextId ?? 1,
            schemas: {},
        };
        this._compiledCache = undefined;
        this.modified = true;
    }

    /**
     * Load grammar store from a file
     */
    public async load(filePath: string): Promise<void> {
        const resolvedPath = path.resolve(filePath);

        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Grammar store file not found: ${resolvedPath}`);
        }

        const fileContent = await fs.promises.readFile(resolvedPath, "utf-8");

        if (fileContent === "") {
            // Empty file indicates new/empty store
            this.data = {
                version: "1.0",
                nextId: 1,
                schemas: {},
            };
        } else {
            this.data = JSON.parse(fileContent);
        }

        // Restore pre-compiled grammar from JSON if present, avoiding re-parse
        if (this.data.compiledGrammar !== undefined) {
            this._compiledCache = grammarFromJson(this.data.compiledGrammar);
        } else {
            this._compiledCache = undefined;
        }

        // Migration: assign stable IDs to rules from older files that lack them
        if (!this.data.nextId) {
            let maxId = 0;
            for (const rules of Object.values(this.data.schemas)) {
                for (const rule of rules) {
                    if ((rule as any).id) {
                        maxId = Math.max(maxId, (rule as any).id);
                    }
                }
            }
            this.data.nextId = maxId + 1;
            for (const rules of Object.values(this.data.schemas)) {
                for (const rule of rules) {
                    if (!rule.id) {
                        rule.id = this.data.nextId++;
                    }
                }
            }
        }

        this.filePath = resolvedPath;
        this.modified = false;
    }

    /**
     * Save grammar store to a file.
     * The combined compiled Grammar AST is serialized alongside rule text so
     * that the next load() can skip re-parsing.
     */
    public async save(filePath?: string): Promise<boolean> {
        const outFile = filePath ? path.resolve(filePath) : this.filePath;

        if (outFile === undefined) {
            throw new Error("No output file specified");
        }

        // Don't save if nothing has changed
        if (outFile === this.filePath && !this.modified) {
            return false;
        }

        // Ensure the compiled grammar is up to date before writing
        const compiled = this.compileToGrammar();
        if (compiled !== undefined) {
            this.data.compiledGrammar = grammarToJson(compiled);
        } else {
            delete this.data.compiledGrammar;
        }

        // Create directory if it doesn't exist
        const dir = path.dirname(outFile);
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }

        // Write the store data as JSON
        const jsonStr = JSON.stringify(this.data, null, 2);
        await fs.promises.writeFile(outFile, jsonStr, "utf-8");

        this.filePath = outFile;
        this.modified = false;
        return true;
    }

    /**
     * Create a new grammar store at the specified path
     */
    public async newStore(filePath?: string): Promise<void> {
        this.clear();

        if (filePath) {
            const resolvedPath = path.resolve(filePath);
            const dir = path.dirname(resolvedPath);

            if (!fs.existsSync(dir)) {
                await fs.promises.mkdir(dir, { recursive: true });
            }

            await fs.promises.writeFile(resolvedPath, "", "utf-8");
            this.filePath = resolvedPath;
        }

        this.modified = false;
    }

    /**
     * Compile all stored grammars into a single Grammar object.
     * Returns the cached result when the store has not been modified since the
     * last compilation or load.  When the cache is stale, all grammarText
     * entries are concatenated and re-parsed so that cross-rule references
     * (e.g. <Start> referencing <playTrack> defined in another stored rule)
     * continue to resolve correctly.
     */
    public compileToGrammar(): Grammar | undefined {
        // Return cached result if still valid
        if (this._compiledCache !== undefined) {
            return this._compiledCache;
        }

        const allRules = this.getAllRules();

        if (allRules.length === 0) {
            return undefined;
        }

        // Concatenate all grammar texts so cross-rule references resolve
        const combinedGrammarText = allRules
            .map((rule) => rule.grammarText)
            .join("\n\n");

        // Parse the combined grammar
        const errors: string[] = [];
        const grammar = loadGrammarRulesNoThrow(
            "dynamic-grammar",
            combinedGrammarText,
            errors,
        );

        if (errors.length > 0) {
            console.warn("Errors compiling dynamic grammar:", errors);
        }

        this._compiledCache = grammar;
        return grammar;
    }

    /**
     * Export grammars for a specific schema as a single .agr file
     */
    public exportSchemaGrammar(schemaName: string): string {
        const rules = this.getRulesForSchema(schemaName);

        if (rules.length === 0) {
            return "";
        }

        // Create header comment
        const header = `# Dynamic Grammar Rules for ${schemaName}\n# Generated from user interactions\n# ${rules.length} rule(s)\n\n`;

        // Combine all rules
        const grammarText = rules
            .map((rule) => {
                const comment = rule.sourceRequest
                    ? `# Source: "${rule.sourceRequest}"\n# Added: ${new Date(rule.timestamp).toISOString()}\n`
                    : `# Added: ${new Date(rule.timestamp).toISOString()}\n`;
                return comment + rule.grammarText;
            })
            .join("\n\n");

        return header + grammarText;
    }

    /**
     * Perform auto-save if enabled
     */
    private async doAutoSave(): Promise<void> {
        if (this.isAutoSave()) {
            await this.save();
        }
    }
}

/**
 * Get the path to the grammar store directory for a session
 */
export function getSessionGrammarDirPath(sessionDirPath: string): string {
    return path.join(sessionDirPath, "grammars");
}

/**
 * Get the default grammar store file path for a session
 */
export function getSessionGrammarStorePath(sessionDirPath: string): string {
    return path.join(getSessionGrammarDirPath(sessionDirPath), "dynamic.json");
}
