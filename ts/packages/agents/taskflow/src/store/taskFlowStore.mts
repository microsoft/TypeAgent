// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Storage } from "@typeagent/agent-sdk";
import type { ScriptRecipe } from "../types/recipe.js";

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
    scriptPath: string;
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

export interface ParameterDefinition {
    type: "string" | "number" | "boolean";
    required?: boolean;
    default?: unknown;
    description?: string;
}

export interface TaskFlowDefinition {
    name: string;
    description: string;
    parameters: Record<string, ParameterDefinition>;
    script?: string;
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

function recipeToFlowDef(recipe: ScriptRecipe): TaskFlowDefinition {
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
        name: recipe.name,
        description: recipe.description,
        parameters,
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
        } catch {
            debug("No existing index found, starting fresh");
            this.index = emptyIndex();
        }

        this.initialized = true;
        await this.writeDynamicGrammarFile();
    }

    // ── CRUD ───────────────────────────────────────────────────────────

    async saveFlow(
        recipe: ScriptRecipe,
        source: "reasoning" | "manual" | "seed" = "manual",
    ): Promise<string> {
        this.ensureInitialized();

        const { name } = recipe;
        const flowPath = `flows/${name}.flow.json`;
        const scriptPath = `scripts/${name}.ts`;

        // Write flow metadata (without script)
        const flowDef = recipeToFlowDef(recipe);
        await this.storage.write(flowPath, JSON.stringify(flowDef, null, 2));

        // Write script separately
        await this.storage.write(scriptPath, recipe.script);

        const grammarRuleText = generateGrammarRuleText(
            name,
            recipe.grammarPatterns,
        );

        const paramMeta: FlowParameterMeta[] = recipe.parameters.map((p) => ({
            name: p.name,
            type: p.type,
            required: p.required,
            description: p.description,
        }));

        const now = new Date().toISOString();
        this.index.flows[name] = {
            actionName: name,
            description: recipe.description,
            flowPath,
            scriptPath,
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
        await this.writeDynamicGrammarFile();
        debug(`Flow saved: ${name}`);
        return name;
    }

    async getFlow(actionName: string): Promise<TaskFlowDefinition | null> {
        this.ensureInitialized();

        const entry = this.index.flows[actionName];
        if (!entry) return null;

        try {
            const json = await this.storage.read(entry.flowPath, "utf8");
            const flow = JSON.parse(json) as TaskFlowDefinition;

            // Load script from separate file
            try {
                flow.script = await this.storage.read(entry.scriptPath, "utf8");
            } catch {
                debug(`Failed to read script for ${actionName}`);
                return null;
            }

            return flow;
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
        try {
            await this.storage.delete(entry.scriptPath);
        } catch {}

        delete this.index.flows[actionName];

        if (entry.source === "seed") {
            this.index.deletedSamples.push(actionName);
        }

        this.index.lastModified = new Date().toISOString();
        await this.saveIndex();
        await this.writeDynamicGrammarFile();
        debug(`Flow deleted: ${actionName}`);
        return true;
    }

    async updateFlow(
        actionName: string,
        updates: {
            script?: string;
            description?: string;
            grammarPatterns?: string[];
            parameters?: Record<string, ParameterDefinition>;
        },
    ): Promise<boolean> {
        this.ensureInitialized();

        const entry = this.index.flows[actionName];
        if (!entry) return false;

        // Load existing flow
        let flowDef: TaskFlowDefinition;
        try {
            const json = await this.storage.read(entry.flowPath, "utf8");
            flowDef = JSON.parse(json) as TaskFlowDefinition;
        } catch {
            debug(`Failed to read flow for update: ${actionName}`);
            return false;
        }

        // Apply updates
        if (updates.description !== undefined) {
            flowDef.description = updates.description;
            entry.description = updates.description;
        }

        // Update parameters if provided
        if (updates.parameters !== undefined) {
            flowDef.parameters = updates.parameters;
        }

        // Write updated flow metadata
        await this.storage.write(
            entry.flowPath,
            JSON.stringify(flowDef, null, 2),
        );

        // Update script if provided
        if (updates.script !== undefined) {
            await this.storage.write(entry.scriptPath, updates.script);
        }

        // Update grammar if provided
        if (updates.grammarPatterns !== undefined) {
            entry.grammarRuleText = generateGrammarRuleText(
                actionName,
                updates.grammarPatterns,
            );
        }

        entry.updated = new Date().toISOString();
        this.index.lastModified = entry.updated;
        await this.saveIndex();
        if (
            updates.grammarPatterns !== undefined ||
            updates.parameters !== undefined
        ) {
            await this.writeDynamicGrammarFile();
        }
        debug(`Flow updated: ${actionName}`);
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
        const ruleNames: string[] = [
            "listTaskFlows",
            "deleteTaskFlow",
            "createTaskFlow",
            "editTaskFlow",
        ];
        const ruleTexts: string[] = [
            '<listTaskFlows> = (show | list | display) (all)? (the)? (available)? task flows -> { actionName: "listTaskFlows" };',
            '<deleteTaskFlow> [spacing=optional] = (delete | remove) (the)? task flow $(name:wildcard) -> { actionName: "deleteTaskFlow", parameters: { name } };',
            '<createTaskFlow> [spacing=optional] = create (a)? (new)? task flow (named | called)? $(name:wildcard) -> { actionName: "createTaskFlow", parameters: { name } };',
            '<editTaskFlow> [spacing=optional] = (edit | update | modify) (the)? task flow $(name:wildcard) -> { actionName: "editTaskFlow", parameters: { name } };',
        ];

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

        const startRule = `<Start> = ${ruleNames.map((n) => `<${n}>`).join(" | ")};`;
        return `${startRule}\n\n${ruleTexts.join("\n\n")}`;
    }

    async writeDynamicGrammarFile(): Promise<void> {
        const grammarText = this.getDynamicGrammarText();
        await this.storage.write("grammar/dynamic.agr", grammarText);
        debug(`Wrote grammar/dynamic.agr`);
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
            "",
            "// Create a new task flow",
            "export type CreateTaskFlow = {",
            '    actionName: "createTaskFlow";',
            "    parameters: {",
            "        // camelCase action name for the flow",
            "        name: string;",
            "        // Description of what the flow does",
            "        description: string;",
            "        // JSON array of parameter definitions",
            "        parameters: string;",
            "        // TypeScript function source",
            "        script: string;",
            "        // JSON array of natural language patterns",
            "        grammarPatterns: string;",
            "    };",
            "};",
            "",
            "// Edit an existing task flow",
            "export type EditTaskFlow = {",
            '    actionName: "editTaskFlow";',
            "    parameters: {",
            "        // Name of the flow to edit",
            "        name: string;",
            "        // New parameter definitions as JSON array (optional)",
            "        parameters?: string;",
            "        // New script (optional)",
            "        script?: string;",
            "        // New description (optional)",
            "        description?: string;",
            "        // New grammar patterns as JSON array (optional)",
            "        grammarPatterns?: string;",
            "    };",
            "};",
        ];

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
        lines.push("    | CreateTaskFlow");
        lines.push("    | EditTaskFlow");
        for (const typeName of flowTypeNames) {
            lines.push(`    | ${typeName}`);
        }
        lines.push(";");
        lines.push("");

        return lines.join("\n");
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
                "TaskFlowStore not initialized. Call initialize() first.",
            );
        }
    }
}
