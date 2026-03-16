// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Storage } from "@typeagent/agent-sdk";
import type {
    ScriptRecipe,
    GrammarPattern,
    SandboxPolicy,
} from "../types/scriptRecipe.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:scriptflow:store");

export interface ScriptFlowIndex {
    version: 1;
    flows: Record<string, ScriptFlowIndexEntry>;
    deletedSamples: string[];
    lastModified: string;
}

export interface ScriptFlowIndexEntry {
    actionName: string;
    displayName: string;
    description: string;
    flowPath: string;
    scriptPath: string;
    grammarRuleText: string;
    created: string;
    updated: string;
    source: "reasoning" | "manual" | "seed";
    usageCount: number;
    lastUsed?: string | undefined;
    enabled: boolean;
}

export interface ScriptFlowDefinition {
    version: 1;
    actionName: string;
    displayName: string;
    description: string;
    parameters: ScriptRecipe["parameters"];
    scriptRef: string;
    expectedOutputFormat: "text" | "json" | "objects" | "table";
    grammarPatterns: GrammarPattern[];
    sandbox: SandboxPolicy;
    source?: ScriptRecipe["source"] | undefined;
}

function emptyIndex(): ScriptFlowIndex {
    return {
        version: 1,
        flows: {},
        deletedSamples: [],
        lastModified: new Date().toISOString(),
    };
}

export function generateGrammarRuleText(
    actionName: string,
    patterns: GrammarPattern[],
): string {
    const rules: string[] = [];
    let aliasIndex = 0;

    for (const pattern of patterns) {
        const ruleName = pattern.isAlias
            ? `${actionName}Alias${++aliasIndex}`
            : actionName;

        const paramNames = [
            ...pattern.pattern.matchAll(/\$\((\w+):/g),
        ].map((m) => m[1]);
        const paramJson =
            paramNames.length > 0 ? `{ ${paramNames.join(", ")} }` : "{}";

        rules.push(
            `<${ruleName}> [spacing=optional] = ${pattern.pattern}` +
                ` -> { actionName: "${actionName}", parameters: ${paramJson} };`,
        );
    }

    return rules.join("\n");
}

export class ScriptFlowStore {
    private index: ScriptFlowIndex = emptyIndex();
    private initialized = false;

    constructor(private storage: Storage) {}

    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            const indexJson = await this.storage.read("index.json", "utf8");
            this.index = JSON.parse(indexJson) as ScriptFlowIndex;
            debug(
                `Loaded index with ${Object.keys(this.index.flows).length} flows`,
            );
        } catch {
            debug("No existing index found, starting fresh");
            this.index = emptyIndex();
        }

        this.initialized = true;
    }

    // ── CRUD ───────────────────────────────────────────────────────────

    async saveFlow(
        recipe: ScriptRecipe,
        source: "reasoning" | "manual" | "seed" = "manual",
    ): Promise<string> {
        this.ensureInitialized();

        const { actionName } = recipe;
        const flowPath = `flows/${actionName}.flow.json`;
        const scriptPath = `scripts/${actionName}.ps1`;

        const flowDef: ScriptFlowDefinition = {
            version: 1,
            actionName,
            displayName: recipe.displayName,
            description: recipe.description,
            parameters: recipe.parameters,
            scriptRef: scriptPath,
            expectedOutputFormat: recipe.script.expectedOutputFormat,
            grammarPatterns: recipe.grammarPatterns,
            sandbox: recipe.sandbox,
            source: recipe.source,
        };

        await this.storage.write(flowPath, JSON.stringify(flowDef, null, 2));
        await this.storage.write(scriptPath, recipe.script.body);

        const grammarRuleText = generateGrammarRuleText(
            actionName,
            recipe.grammarPatterns,
        );

        const now = new Date().toISOString();
        this.index.flows[actionName] = {
            actionName,
            displayName: recipe.displayName,
            description: recipe.description,
            flowPath,
            scriptPath,
            grammarRuleText,
            created: now,
            updated: now,
            source,
            usageCount: 0,
            enabled: true,
        };
        this.index.lastModified = now;

        await this.saveIndex();
        debug(`Flow saved: ${actionName}`);
        return actionName;
    }

    async getFlow(
        actionName: string,
    ): Promise<ScriptFlowDefinition | null> {
        this.ensureInitialized();

        const entry = this.index.flows[actionName];
        if (!entry) return null;

        try {
            const json = await this.storage.read(entry.flowPath, "utf8");
            return JSON.parse(json) as ScriptFlowDefinition;
        } catch {
            debug(`Failed to read flow file for ${actionName}`);
            return null;
        }
    }

    async getScript(actionName: string): Promise<string | null> {
        this.ensureInitialized();

        const entry = this.index.flows[actionName];
        if (!entry) return null;

        try {
            return await this.storage.read(entry.scriptPath, "utf8");
        } catch {
            debug(`Failed to read script for ${actionName}`);
            return null;
        }
    }

    async deleteFlow(actionName: string): Promise<boolean> {
        this.ensureInitialized();

        const entry = this.index.flows[actionName];
        if (!entry) return false;

        try {
            await this.storage.delete(entry.flowPath);
        } catch {}
        try {
            await this.storage.delete(entry.scriptPath);
        } catch {}

        delete this.index.flows[actionName];

        if (entry.source === "seed") {
            this.index.deletedSamples.push(actionName);
        }

        this.index.lastModified = new Date().toISOString();
        await this.saveIndex();
        debug(`Flow deleted: ${actionName}`);
        return true;
    }

    listFlows(): ScriptFlowIndexEntry[] {
        this.ensureInitialized();
        return Object.values(this.index.flows);
    }

    hasFlow(actionName: string): boolean {
        return actionName in this.index.flows;
    }

    isSampleDeleted(actionName: string): boolean {
        return this.index.deletedSamples.includes(actionName);
    }

    // ── Pending recipes ────────────────────────────────────────────────

    async savePending(recipe: ScriptRecipe): Promise<string> {
        this.ensureInitialized();
        const id =
            recipe.actionName + "_" + Date.now().toString(36);
        const pendingPath = `pending/${id}.recipe.json`;
        await this.storage.write(
            pendingPath,
            JSON.stringify(recipe, null, 2),
        );
        debug(`Pending recipe saved: ${id}`);
        return id;
    }

    async listPending(): Promise<string[]> {
        this.ensureInitialized();
        try {
            const files = await this.storage.list("pending");
            return files.filter((f) => f.endsWith(".recipe.json"));
        } catch {
            return [];
        }
    }

    async getPending(filename: string): Promise<ScriptRecipe | null> {
        this.ensureInitialized();
        try {
            const json = await this.storage.read(
                `pending/${filename}`,
                "utf8",
            );
            return JSON.parse(json) as ScriptRecipe;
        } catch {
            return null;
        }
    }

    async promotePending(filename: string): Promise<string | null> {
        this.ensureInitialized();
        const recipe = await this.getPending(filename);
        if (!recipe) return null;

        const actionName = await this.saveFlow(recipe, "reasoning");
        try {
            await this.storage.delete(`pending/${filename}`);
        } catch {}
        return actionName;
    }

    // ── Usage tracking ─────────────────────────────────────────────────

    async recordUsage(actionName: string): Promise<void> {
        const entry = this.index.flows[actionName];
        if (!entry) return;

        entry.usageCount++;
        entry.lastUsed = new Date().toISOString();
        this.index.lastModified = entry.lastUsed;
        await this.saveIndex();
    }

    // ── Grammar ────────────────────────────────────────────────────────

    getAllGrammarRules(): string {
        this.ensureInitialized();
        const rules: string[] = [];
        for (const entry of Object.values(this.index.flows)) {
            if (entry.enabled && entry.grammarRuleText) {
                rules.push(entry.grammarRuleText);
            }
        }
        return rules.join("\n\n");
    }

    getFlowGrammarRules(actionName: string): string | undefined {
        return this.index.flows[actionName]?.grammarRuleText;
    }

    // ── Internal ───────────────────────────────────────────────────────

    private async saveIndex(): Promise<void> {
        await this.storage.write(
            "index.json",
            JSON.stringify(this.index, null, 2),
        );
    }

    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error(
                "ScriptFlowStore not initialized. Call initialize() first.",
            );
        }
    }
}
