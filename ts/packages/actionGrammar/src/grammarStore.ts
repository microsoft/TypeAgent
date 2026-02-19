// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar Store - Manages persistence of dynamically generated grammar rules
 *
 * Similar to ConstructionStore, this stores grammar rules that are learned
 * from user interactions. Grammars are stored per-session in JSON format.
 */

import fs from "node:fs";
import path from "node:path";
import { loadGrammarRules } from "./grammarLoader.js";
import { Grammar } from "./grammarTypes.js";

/**
 * Stored grammar rule with metadata
 */
export interface StoredGrammarRule {
    // The raw grammar text (.agr format)
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
    // Map from schema name to array of grammar rules
    schemas: Record<string, StoredGrammarRule[]>;
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

    constructor() {
        this.data = {
            version: "1.0",
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
        rule: Omit<StoredGrammarRule, "timestamp">,
    ): Promise<void> {
        const storedRule: StoredGrammarRule = {
            ...rule,
            timestamp: Date.now(),
        };

        if (!this.data.schemas[rule.schemaName]) {
            this.data.schemas[rule.schemaName] = [];
        }

        this.data.schemas[rule.schemaName].push(storedRule);
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

        this.modified = true;
        await this.doAutoSave();
        return true;
    }

    /**
     * Clear all rules
     */
    public clear(): void {
        this.data = {
            version: "1.0",
            schemas: {},
        };
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
                schemas: {},
            };
        } else {
            this.data = JSON.parse(fileContent);
        }

        this.filePath = resolvedPath;
        this.modified = false;
    }

    /**
     * Save grammar store to a file
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
     * Compile all stored grammars into a single Grammar object
     * This can be used to load the dynamic rules into the agent grammar registry
     */
    public compileToGrammar(): Grammar | undefined {
        const allRules = this.getAllRules();

        if (allRules.length === 0) {
            return undefined;
        }

        // Concatenate all grammar texts
        const combinedGrammarText = allRules
            .map((rule) => rule.grammarText)
            .join("\n\n");

        // Parse the combined grammar
        const errors: string[] = [];
        const grammar = loadGrammarRules(
            "dynamic-grammar",
            combinedGrammarText,
            errors,
        );

        if (errors.length > 0) {
            console.warn("Errors compiling dynamic grammar:", errors);
        }

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
