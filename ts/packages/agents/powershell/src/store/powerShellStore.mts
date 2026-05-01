// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Storage } from "@typeagent/agent-sdk";
import type {
    ScriptRecipe,
    GrammarPattern,
    SandboxPolicy,
} from "../types/scriptRecipe.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:powershell:store");

export interface PowerShellFlowIndex {
    version: 1;
    flows: Record<string, PowerShellFlowIndexEntry>;
    deletedSamples: string[];
    lastModified: string;
}

export interface PowerShellFlowParameterMeta {
    name: string;
    type: "string" | "number" | "boolean" | "path";
    required: boolean;
    description: string;
}

export interface PowerShellFlowIndexEntry {
    actionName: string;
    displayName: string;
    description: string;
    flowPath: string;
    scriptPath: string;
    grammarRuleText: string;
    parameters: PowerShellFlowParameterMeta[];
    created: string;
    updated: string;
    source: "reasoning" | "manual" | "seed";
    usageCount: number;
    lastUsed?: string | undefined;
    enabled: boolean;
}

export interface PowerShellFlowDefinition {
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

function emptyIndex(): PowerShellFlowIndex {
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

        // Preserve named parameter captures — use flow's own actionName
        const captures = [...pattern.pattern.matchAll(/\$\((\w+):\w+\)/g)].map(
            (m) => m[1],
        );
        const paramJson =
            captures.length > 0 ? `{ ${captures.join(", ")} }` : "{}";

        rules.push(
            `<${ruleName}> [spacing=optional] = ${pattern.pattern}` +
                ` -> { actionName: "${actionName}", parameters: ${paramJson} };`,
        );
    }

    return rules.join("\n");
}

export class PowerShellStore {
    private index: PowerShellFlowIndex = emptyIndex();
    private initialized = false;

    constructor(private storage: Storage) {}

    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            const indexJson = await this.storage.read("index.json", "utf8");
            this.index = JSON.parse(indexJson) as PowerShellFlowIndex;
            debug(
                `Loaded index with ${Object.keys(this.index.flows).length} flows`,
            );

            // Regenerate grammar rules to pick up format changes
            await this.regenerateGrammarRules();
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

        const { actionName } = recipe;
        const flowPath = `flows/${actionName}.flow.json`;
        const scriptPath = `scripts/${actionName}.ps1`;

        const flowDef: PowerShellFlowDefinition = {
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

        const paramMeta: PowerShellFlowParameterMeta[] = recipe.parameters.map(
            (p) => ({
                name: p.name,
                type: p.type,
                required: p.required,
                description: p.description,
            }),
        );

        const now = new Date().toISOString();
        this.index.flows[actionName] = {
            actionName,
            displayName: recipe.displayName,
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
        debug(`Flow saved: ${actionName}`);
        return actionName;
    }

    async updateFlowScript(
        actionName: string,
        newScript: string,
        newCmdlets: string[],
    ): Promise<void> {
        this.ensureInitialized();
        const entry = this.index.flows[actionName];
        if (!entry) throw new Error(`Flow not found: ${actionName}`);

        // Update the script file
        await this.storage.write(entry.scriptPath, newScript);

        // Update the flow definition's sandbox cmdlets
        const json = await this.storage.read(entry.flowPath, "utf8");
        const flow = JSON.parse(json) as PowerShellFlowDefinition;
        flow.sandbox.allowedCmdlets = newCmdlets;
        await this.storage.write(entry.flowPath, JSON.stringify(flow, null, 2));

        entry.updated = new Date().toISOString();
        this.index.lastModified = entry.updated;
        await this.saveIndex();
        debug(`Flow script updated: ${actionName}`);
    }

    async getFlow(
        actionName: string,
    ): Promise<PowerShellFlowDefinition | null> {
        this.ensureInitialized();

        const entry = this.index.flows[actionName];
        if (!entry) return null;

        try {
            const json = await this.storage.read(entry.flowPath, "utf8");
            return JSON.parse(json) as PowerShellFlowDefinition;
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
        await this.writeDynamicGrammarFile();
        debug(`Flow deleted: ${actionName}`);
        return true;
    }

    listFlows(): PowerShellFlowIndexEntry[] {
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

    async getPending(filename: string): Promise<ScriptRecipe | null> {
        this.ensureInitialized();
        try {
            const json = await this.storage.read(`pending/${filename}`, "utf8");
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

    async writeDynamicGrammarFile(): Promise<void> {
        const ruleNames: string[] = [];
        const ruleTexts: string[] = [];

        for (const entry of Object.values(this.index.flows)) {
            if (!entry.enabled || !entry.grammarRuleText) continue;
            ruleTexts.push(entry.grammarRuleText);
            // Extract rule definition names (lines starting with <Name>)
            for (const line of entry.grammarRuleText.split("\n")) {
                const m = line.match(/^<(\w+)>/);
                if (m && !ruleNames.includes(m[1])) {
                    ruleNames.push(m[1]);
                }
            }
        }

        if (ruleNames.length === 0) {
            await this.storage.write("grammar/dynamic.agr", "");
            return;
        }

        const startRule = `<Start> = ${ruleNames.map((n) => `<${n}>`).join(" | ")};`;
        const fullGrammar = `${startRule}\n\n${ruleTexts.join("\n\n")}`;
        await this.storage.write("grammar/dynamic.agr", fullGrammar);
        debug("Wrote grammar/dynamic.agr with %d rule(s)", ruleNames.length);
    }

    generateDynamicSchemaText(): string {
        const enabledFlows = Object.values(this.index.flows).filter(
            (e) => e.enabled,
        );

        const flowNames = enabledFlows.map((e) => e.actionName);
        const flowNameType =
            flowNames.length > 0
                ? flowNames.map((n) => `"${n}"`).join(" | ")
                : "string";

        const lines: string[] = [
            "// Lists all registered PowerShell flows",
            "export type ListPowerShellFlows = {",
            '    actionName: "listPowerShellFlows";',
            "};",
            "",
            "// Delete a PowerShell flow by name",
            "export type DeletePowerShellFlow = {",
            '    actionName: "deletePowerShellFlow";',
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

        lines.push(
            "",
            "// Test a script without registering it (test-then-register pattern)",
            "export type TestPowerShellFlow = {",
            '    actionName: "testPowerShellFlow";',
            "    parameters: {",
            "        // PowerShell script body to test",
            "        script: string;",
            "        // Cmdlets the script is allowed to use",
            "        allowedCmdlets: string[];",
            "        // Modules the script is allowed to use (optional)",
            "        allowedModules?: string[];",
            "        // Whether the script needs network access (optional, default false)",
            "        networkAccess?: boolean;",
            "        // JSON string of test parameters to pass to the script (optional)",
            "        testParameters?: string;",
            "    };",
            "};",
            "",
            "// Create a new PowerShell flow with grammar rules for future reuse",
            "export type CreatePowerShellFlow = {",
            '    actionName: "createPowerShellFlow";',
            "    parameters: {",
            "        actionName: string;",
            "        description: string;",
            "        displayName: string;",
            "        script: string;",
            "        scriptParameters: {",
            "            name: string;",
            '            type: "string" | "number" | "boolean" | "path";',
            "            required: boolean;",
            "            description: string;",
            "            default?: string;",
            "        }[];",
            "        grammarPatterns: {",
            "            pattern: string;",
            "            isAlias: boolean;",
            "        }[];",
            "        allowedCmdlets: string[];",
            "    };",
            "};",
            "",
            "// Edit an existing PowerShell flow's script body",
            "export type EditPowerShellFlow = {",
            '    actionName: "editPowerShellFlow";',
            "    parameters: {",
            `        flowName: ${flowNameType};`,
            "        script: string;",
            "        allowedCmdlets: string[];",
            "    };",
            "};",
            "",
            "// Import an existing PowerShell script file as a new PowerShell flow",
            "export type ImportPowerShellFlow = {",
            '    actionName: "importPowerShellFlow";',
            "    parameters: {",
            "        filePath: string;",
            "        actionName?: string;",
            "    };",
            "};",
        );

        lines.push("");
        lines.push("export type PowerShellActions =");
        lines.push("    | ListPowerShellFlows");
        lines.push("    | DeletePowerShellFlow");
        for (const typeName of flowTypeNames) {
            lines.push(`    | ${typeName}`);
        }
        lines.push("    | TestPowerShellFlow");
        lines.push("    | CreatePowerShellFlow");
        lines.push("    | EditPowerShellFlow");
        lines.push("    | ImportPowerShellFlow;");
        lines.push("");

        return lines.join("\n");
    }

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

    private async regenerateGrammarRules(): Promise<void> {
        let updated = false;
        for (const entry of Object.values(this.index.flows)) {
            try {
                const json = await this.storage.read(entry.flowPath, "utf8");
                const flow = JSON.parse(json) as PowerShellFlowDefinition;
                const newText = generateGrammarRuleText(
                    entry.actionName,
                    flow.grammarPatterns,
                );
                if (newText !== entry.grammarRuleText) {
                    entry.grammarRuleText = newText;
                    updated = true;
                }
            } catch {
                debug(`Could not regenerate grammar for ${entry.actionName}`);
            }
        }
        if (updated) {
            await this.saveIndex();
            debug("Regenerated grammar rules for existing flows");
        }
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
                "PowerShellStore not initialized. Call initialize() first.",
            );
        }
    }
}
