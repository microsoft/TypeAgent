// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Storage } from "@typeagent/agent-sdk";
import type { Recipe } from "../types/recipe.js";

import registerDebug from "debug";

const debug = registerDebug("typeagent:taskflow:store");

// ── Index types ─────────────────────────────────────────────────────────────

export interface TaskFlowIndex {
    version: 1;
    flows: Record<string, TaskFlowIndexEntry>;
    deletedSamples: string[];
    lastModified: string;
}

export interface FlowParameterMeta {
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    description: string;
}

export interface TaskFlowIndexEntry {
    actionName: string;
    description: string;
    flowPath: string;
    grammarRuleText: string;
    parameters: FlowParameterMeta[];
    created: string;
    updated: string;
    source: "reasoning" | "manual" | "seed";
    usageCount: number;
    lastUsed?: string | undefined;
    enabled: boolean;
}

// ── Flow definition (stored in instance storage) ────────────────────────────

export interface TaskFlowDefinition {
    name: string;
    description: string;
    parameters: Record<
        string,
        {
            type: "string" | "number" | "boolean";
            required?: boolean;
            default?: unknown;
            description?: string;
        }
    >;
    steps: Array<{
        id: string;
        schemaName: string;
        actionName: string;
        parameters: Record<string, unknown>;
        observedOutputFormat?: string;
    }>;
}

// ── Grammar generation ──────────────────────────────────────────────────────

export function generateGrammarRuleText(
    actionName: string,
    grammarPatterns: string[],
): string {
    const rules: string[] = [];

    for (const pattern of grammarPatterns) {
        const captures = [...pattern.matchAll(/\$\((\w+):\w+\)/g)].map(
            (m) => m[1],
        );
        const paramJson =
            captures.length > 0 ? `{ ${captures.join(", ")} }` : "{}";

        rules.push(
            `<${actionName}> [spacing=optional] = ${pattern}` +
                ` -> { actionName: "${actionName}", parameters: ${paramJson} };`,
        );
    }

    return rules.join("\n");
}

// ── Recipe → FlowDefinition conversion ──────────────────────────────────────

export function recipeToFlowDef(recipe: Recipe): TaskFlowDefinition {
    const parameters: TaskFlowDefinition["parameters"] = {};
    for (const p of recipe.parameters) {
        parameters[p.name] = {
            type: p.type,
            required: p.required,
            default: p.default,
            description: p.description,
        };
    }

    return {
        name: recipe.actionName,
        description: recipe.description,
        parameters,
        steps: recipe.steps.map((s) => {
            const step: TaskFlowDefinition["steps"][number] = {
                id: s.id,
                schemaName: s.schemaName,
                actionName: s.actionName,
                parameters: s.parameters,
            };
            if (s.observedOutputFormat !== undefined) {
                step.observedOutputFormat = s.observedOutputFormat;
            }
            return step;
        }),
    };
}

// ── Store ────────────────────────────────────────────────────────────────────

function emptyIndex(): TaskFlowIndex {
    return {
        version: 1,
        flows: {},
        deletedSamples: [],
        lastModified: new Date().toISOString(),
    };
}

export class TaskFlowStore {
    private index: TaskFlowIndex = emptyIndex();
    private initialized = false;

    constructor(private storage: Storage) {}

    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            const indexJson = await this.storage.read("index.json", "utf8");
            this.index = JSON.parse(indexJson) as TaskFlowIndex;
            debug(
                `Loaded index with ${Object.keys(this.index.flows).length} flows`,
            );

            await this.regenerateGrammarRules();
        } catch {
            debug("No existing index found, starting fresh");
            this.index = emptyIndex();
        }

        this.initialized = true;
    }

    // ── CRUD ───────────────────────────────────────────────────────────

    async saveFlow(
        recipe: Recipe,
        source: "reasoning" | "manual" | "seed" = "manual",
    ): Promise<string> {
        this.ensureInitialized();

        const { actionName } = recipe;
        const flowPath = `flows/${actionName}.flow.json`;

        const flowDef = recipeToFlowDef(recipe);
        await this.storage.write(flowPath, JSON.stringify(flowDef, null, 2));

        const grammarRuleText = generateGrammarRuleText(
            actionName,
            recipe.grammarPatterns,
        );

        const paramMeta: FlowParameterMeta[] = recipe.parameters.map((p) => ({
            name: p.name,
            type: p.type,
            required: p.required,
            description: p.description,
        }));

        const now = new Date().toISOString();
        this.index.flows[actionName] = {
            actionName,
            description: recipe.description,
            flowPath,
            grammarRuleText,
            parameters: paramMeta,
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

    async getFlow(actionName: string): Promise<TaskFlowDefinition | null> {
        this.ensureInitialized();

        const entry = this.index.flows[actionName];
        if (!entry) return null;

        try {
            const json = await this.storage.read(entry.flowPath, "utf8");
            return JSON.parse(json) as TaskFlowDefinition;
        } catch {
            debug(`Failed to read flow file for ${actionName}`);
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

        delete this.index.flows[actionName];

        if (entry.source === "seed") {
            this.index.deletedSamples.push(actionName);
        }

        this.index.lastModified = new Date().toISOString();
        await this.saveIndex();
        debug(`Flow deleted: ${actionName}`);
        return true;
    }

    listFlows(): TaskFlowIndexEntry[] {
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

    async savePending(recipe: Recipe): Promise<string> {
        this.ensureInitialized();
        const id = recipe.actionName + "_" + Date.now().toString(36);
        const pendingPath = `pending/${id}.recipe.json`;
        await this.storage.write(pendingPath, JSON.stringify(recipe, null, 2));
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

    async getPending(filename: string): Promise<Recipe | null> {
        this.ensureInitialized();
        try {
            const json = await this.storage.read(`pending/${filename}`, "utf8");
            return JSON.parse(json) as Recipe;
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

    // ── Suggestions ────────────────────────────────────────────────────

    async saveSuggestion(actionName: string, content: string): Promise<string> {
        this.ensureInitialized();
        const filename = `suggestions/${actionName}.suggestions.md`;
        await this.storage.write(filename, content);
        debug(`Suggestion saved: ${filename}`);
        return filename;
    }

    async getSuggestion(actionName: string): Promise<string | null> {
        this.ensureInitialized();
        try {
            return await this.storage.read(
                `suggestions/${actionName}.suggestions.md`,
                "utf8",
            );
        } catch {
            return null;
        }
    }

    async listSuggestions(): Promise<string[]> {
        this.ensureInitialized();
        try {
            const files = await this.storage.list("suggestions");
            return files.filter((f) => f.endsWith(".suggestions.md"));
        } catch {
            return [];
        }
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

    // ── Dynamic grammar ────────────────────────────────────────────────

    getDynamicGrammarText(): string {
        const ruleNames: string[] = [];
        const ruleTexts: string[] = [];

        for (const entry of Object.values(this.index.flows)) {
            if (!entry.enabled || !entry.grammarRuleText) continue;
            ruleTexts.push(entry.grammarRuleText);
            for (const line of entry.grammarRuleText.split("\n")) {
                const m = line.match(/^<(\w+)>/);
                if (m && !ruleNames.includes(m[1])) {
                    ruleNames.push(m[1]);
                }
            }
        }

        if (ruleNames.length === 0) return "";

        const startRule = `<Start> = ${ruleNames.map((n) => `<${n}>`).join(" | ")};`;
        return `${startRule}\n\n${ruleTexts.join("\n\n")}`;
    }

    // ── Dynamic schema ─────────────────────────────────────────────────

    generateDynamicSchemaText(): string {
        const enabledFlows = Object.values(this.index.flows).filter(
            (e) => e.enabled,
        );

        const lines: string[] = [
            "// Lists all registered task flows",
            "export type ListTaskFlows = {",
            '    actionName: "listTaskFlows";',
            "};",
            "",
            "// Delete a task flow by name",
            "export type DeleteTaskFlow = {",
            '    actionName: "deleteTaskFlow";',
            "    parameters: {",
            "        name: string;",
            "    };",
            "};",
        ];

        // Generate per-flow action types with unique actionNames
        const flowTypeNames: string[] = [];
        for (const entry of enabledFlows) {
            const typeName =
                entry.actionName.charAt(0).toUpperCase() +
                entry.actionName.slice(1) +
                "Action";
            flowTypeNames.push(typeName);

            lines.push("");
            lines.push(`// ${entry.description}`);
            lines.push(`export type ${typeName} = {`);
            lines.push(`    actionName: "${entry.actionName}";`);

            if ((entry.parameters ?? []).length > 0) {
                lines.push("    parameters: {");
                for (const p of entry.parameters ?? []) {
                    const tsType =
                        p.type === "number"
                            ? "number"
                            : p.type === "boolean"
                              ? "boolean"
                              : "string";
                    const opt = p.required ? "" : "?";
                    if (p.description) {
                        lines.push(`        // ${p.description}`);
                    }
                    lines.push(`        ${p.name}${opt}: ${tsType};`);
                }
                lines.push("    };");
            }

            lines.push("};");
        }

        lines.push("");
        lines.push("export type TaskFlowActions =");
        lines.push("    | ListTaskFlows");
        lines.push("    | DeleteTaskFlow");
        for (const typeName of flowTypeNames) {
            lines.push(`    | ${typeName}`);
        }
        lines.push(";");
        lines.push("");

        return lines.join("\n");
    }

    // ── Internal ───────────────────────────────────────────────────────

    private async regenerateGrammarRules(): Promise<void> {
        let updated = false;
        for (const entry of Object.values(this.index.flows)) {
            try {
                const json = await this.storage.read(entry.flowPath, "utf8");
                const flow = JSON.parse(json) as TaskFlowDefinition;
                // Re-derive grammar patterns from the stored flow
                // The flow itself doesn't store grammarPatterns, so we
                // rely on the cached grammarRuleText in the index.
                // If the rule format changes, we'd regenerate here.
                void flow;
            } catch {
                debug(`Could not read flow for ${entry.actionName}`);
            }
        }
        if (updated) {
            await this.saveIndex();
            debug("Regenerated grammar rules for existing flows");
        }
    }

    private async saveIndex(): Promise<void> {
        await this.storage.write(
            "index.json",
            JSON.stringify(this.index, null, 2),
        );
    }

    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error(
                "TaskFlowStore not initialized. Call initialize() first.",
            );
        }
    }
}
