// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionCacheBinding, Storage } from "@typeagent/agent-sdk";
import { createHash, randomUUID } from "node:crypto";
import type {
    ScriptRecipe,
    GrammarPattern,
    SandboxPolicy,
    ScriptSource,
    StoredScriptSourceType,
} from "./scriptRecipe.js";
import {
    generateGrammarRuleText,
    assembleDynamicGrammar,
} from "../grammar/grammarBuilder.js";
import {
    generateFlowActionTypes,
    buildUnionType,
} from "../schema/schemaBuilder.js";
import registerDebug from "debug";
import {
    createPowerShellRevision,
    PowerShellIntegrityError,
    validatePowerShellIdentifier,
    validatePowerShellPendingFilename,
    verifyPowerShellRevision,
    type PowerShellRevision,
} from "./integrity.js";

const debug = registerDebug("typeagent:powershell:store");

function throwPersistenceError(
    error: unknown,
    rollbackErrors: unknown[],
): never {
    if (rollbackErrors.length === 0) {
        throw error;
    }
    const originalMessage =
        error instanceof Error ? error.message : String(error);
    const rollbackMessage = rollbackErrors
        .map((rollbackError) =>
            rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError),
        )
        .join("; ");
    throw new AggregateError(
        [error, ...rollbackErrors],
        `${originalMessage}. Rollback failed: ${rollbackMessage}`,
    );
}

export interface PowerShellFlowIndex {
    version: 1;
    flows: Record<string, PowerShellFlowIndexEntry>;
    deletedSamples: string[];
    lastModified: string;
}

export interface PowerShellFlowParameterMeta {
    name: string;
    type: "string" | "number" | "boolean" | "path" | "executable";
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
    source: StoredScriptSourceType;
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

// Grammar generation uses @typeagent/workflow's generateGrammarRuleText

export class PowerShellStore {
    private index: PowerShellFlowIndex = emptyIndex();
    private initialized = false;
    private readonly generations = new Map<string, number>();

    constructor(private storage: Storage) {}

    async refresh(): Promise<void> {
        for (const name of Object.keys(this.index.flows)) {
            this.invalidateSnapshot(name);
        }
        this.initialized = false;
        await this.initialize();
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        if (await this.storage.exists("index.json")) {
            this.index = await this.readJson<PowerShellFlowIndex>("index.json");
            if (
                this.index?.version !== 1 ||
                !this.index.flows ||
                !Array.isArray(this.index.deletedSamples)
            ) {
                throw new PowerShellIntegrityError(
                    "Unsupported PowerShell index.",
                );
            }
            for (const [name, entry] of Object.entries(this.index.flows)) {
                this.validateEntry(name, entry);
            }
            this.index.deletedSamples.forEach(validatePowerShellIdentifier);
            debug(
                `Loaded index with ${Object.keys(this.index.flows).length} flows`,
            );
        } else if (Object.keys(this.index.flows).length > 0) {
            throw new PowerShellIntegrityError(
                "PowerShell index disappeared during refresh.",
            );
        }

        this.initialized = true;
        try {
            await this.regenerateGrammarRules();
            await this.writeDynamicGrammarFile();
        } catch (error) {
            this.initialized = false;
            throw error;
        }
    }

    // ── CRUD ───────────────────────────────────────────────────────────

    async saveFlow(
        recipe: ScriptRecipe,
        source: StoredScriptSourceType = "manual",
    ): Promise<string> {
        this.ensureInitialized();
        recipe = structuredClone(recipe);

        const { actionName } = recipe;
        validatePowerShellIdentifier(actionName);
        if (this.hasFlow(actionName)) {
            throw new Error(`Flow already exists: ${actionName}`);
        }
        const flowPath = `flows/${actionName}.flow.json`;
        const scriptPath = `scripts/${actionName}.ps1`;
        const revisionPath = `revisions/${actionName}.json`;
        for (const path of [flowPath, scriptPath, revisionPath]) {
            if (await this.storage.exists(path)) {
                throw new PowerShellIntegrityError(
                    `Unindexed PowerShell data already exists for '${actionName}'.`,
                );
            }
        }
        let addedEntry: PowerShellFlowIndexEntry | undefined;
        const now = new Date().toISOString();
        const storedSource: ScriptSource = {
            ...(recipe.source ?? {}),
            type: source,
            timestamp: recipe.source?.timestamp ?? now,
        };

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
            source: storedSource,
        };
        const revision = createPowerShellRevision(recipe.script.body, flowDef);
        this.invalidateSnapshot(actionName);

        try {
            await this.storage.write(
                flowPath,
                JSON.stringify(flowDef, null, 2),
            );
            await this.storage.write(scriptPath, recipe.script.body);
            await this.storage.write(revisionPath, JSON.stringify(revision));

            const grammarRuleText = generateGrammarRuleText(
                actionName,
                recipe.grammarPatterns,
            );

            const paramMeta: PowerShellFlowParameterMeta[] =
                recipe.parameters.map((p) => ({
                    name: p.name,
                    type: p.type,
                    required: p.required,
                    description: p.description,
                }));

            addedEntry = {
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
            this.index.flows[actionName] = addedEntry;
            this.index.lastModified = now;

            await this.saveIndex();
            await this.writeDynamicGrammarFile();
            debug(`Flow saved: ${actionName}`);
            return actionName;
        } catch (error) {
            const rollbackErrors: unknown[] = [];
            const currentEntry = this.index.flows[actionName];
            if (currentEntry === undefined || currentEntry === addedEntry) {
                for (const path of [flowPath, scriptPath, revisionPath]) {
                    try {
                        await this.storage.delete(path);
                    } catch (rollbackError) {
                        rollbackErrors.push(rollbackError);
                    }
                }
            }
            if (currentEntry === addedEntry) {
                delete this.index.flows[actionName];
            }
            try {
                await this.saveIndex();
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            try {
                await this.writeDynamicGrammarFile();
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            throwPersistenceError(error, rollbackErrors);
        }
    }

    async updateFlowScript(
        actionName: string,
        newScript: string,
        newCmdlets: string[],
        newModules?: string[],
        newSource?: ScriptSource,
    ): Promise<void> {
        this.ensureInitialized();
        newCmdlets = [...newCmdlets];
        newModules = newModules === undefined ? undefined : [...newModules];
        newSource =
            newSource === undefined ? undefined : structuredClone(newSource);
        const snapshot = await this.getExecutionSnapshot(actionName);
        const entry = this.index.flows[actionName];
        if (!entry || !snapshot) throw new Error(`Flow not found: ${actionName}`);
        const previousScript = snapshot.script;
        const previousFlowJson = JSON.stringify(snapshot.flow, null, 2);
        const previousEntry = JSON.parse(
            JSON.stringify(entry),
        ) as PowerShellFlowIndexEntry;
        const flow = JSON.parse(previousFlowJson) as PowerShellFlowDefinition;
        const revisionPath = `revisions/${actionName}.json`;
        const previousRevision = JSON.stringify(snapshot.revision);
        flow.sandbox.allowedCmdlets = newCmdlets;
        if (newModules !== undefined) {
            flow.sandbox.allowedModules = newModules;
        }
        if (newSource !== undefined) {
            flow.source = newSource;
        }
        this.invalidateSnapshot(actionName);

        try {
            await this.storage.write(entry.scriptPath, newScript);
            await this.storage.write(
                entry.flowPath,
                JSON.stringify(flow, null, 2),
            );
            await this.storage.write(
                revisionPath,
                JSON.stringify(createPowerShellRevision(newScript, flow)),
            );

            entry.updated = new Date().toISOString();
            if (newSource !== undefined) {
                entry.source = newSource.type;
            }
            this.index.lastModified = entry.updated;
            await this.saveIndex();
            debug(`Flow script updated: ${actionName}`);
        } catch (error) {
            const rollbackErrors: unknown[] = [];
            try {
                await this.storage.write(entry.scriptPath, previousScript);
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            try {
                await this.storage.write(entry.flowPath, previousFlowJson);
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            this.index.flows[actionName] = previousEntry;
            try {
                await this.storage.write(revisionPath, previousRevision);
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            try {
                await this.saveIndex();
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            throwPersistenceError(error, rollbackErrors);
        }
    }

    async addGrammarPatterns(
        actionName: string,
        patterns: GrammarPattern[],
    ): Promise<number> {
        this.ensureInitialized();
        const flow = await this.getFlow(actionName);
        if (!flow) throw new Error(`Flow not found: ${actionName}`);
        const existing = new Set(
            flow.grammarPatterns.map((pattern) => pattern.pattern),
        );
        const additions = patterns.filter(
            (pattern) => !existing.has(pattern.pattern),
        );
        if (additions.length === 0) {
            return 0;
        }

        await this.replaceGrammarPatterns(actionName, [
            ...flow.grammarPatterns,
            ...additions,
        ]);
        return additions.length;
    }

    async replaceGrammarPatterns(
        actionName: string,
        patterns: GrammarPattern[],
    ): Promise<void> {
        this.ensureInitialized();
        patterns = structuredClone(patterns);
        const snapshot = await this.getExecutionSnapshot(actionName);
        const entry = this.index.flows[actionName];
        if (!entry || !snapshot) throw new Error(`Flow not found: ${actionName}`);
        const previousFlowJson = JSON.stringify(snapshot.flow, null, 2);
        const previousEntry = { ...entry };
        const previousLastModified = this.index.lastModified;
        const flow = JSON.parse(previousFlowJson) as PowerShellFlowDefinition;
        flow.grammarPatterns = patterns;

        try {
            await this.storage.write(
                entry.flowPath,
                JSON.stringify(flow, null, 2),
            );
            entry.grammarRuleText = generateGrammarRuleText(
                actionName,
                patterns,
            );
            entry.updated = new Date().toISOString();
            this.index.lastModified = entry.updated;
            await this.saveIndex();
            await this.writeDynamicGrammarFile();
        } catch (error) {
            const rollbackErrors: unknown[] = [];
            this.index.flows[actionName] = previousEntry;
            this.index.lastModified = previousLastModified;
            try {
                await this.storage.write(entry.flowPath, previousFlowJson);
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            try {
                await this.saveIndex();
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            try {
                await this.writeDynamicGrammarFile();
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            throwPersistenceError(error, rollbackErrors);
        }
    }

    async getFlow(
        actionName: string,
    ): Promise<PowerShellFlowDefinition | null> {
        return (await this.getExecutionSnapshot(actionName))?.flow ?? null;
    }

    async getScript(actionName: string): Promise<string | null> {
        return (await this.getExecutionSnapshot(actionName))?.script ?? null;
    }

    async getExecutionSnapshot(actionName: string): Promise<{
        flow: PowerShellFlowDefinition;
        script: string;
        revision: PowerShellRevision;
        assertCurrent: () => Promise<void>;
    } | null> {
        this.ensureInitialized();
        validatePowerShellIdentifier(actionName);
        const generation = this.generations.get(actionName);
        const entry = this.index.flows[actionName];
        if (!entry) return null;
        this.validateEntry(actionName, entry);
        const revisionPath = `revisions/${actionName}.json`;
        if (!(await this.storage.exists(revisionPath))) {
            throw new PowerShellIntegrityError(
                `Missing host revision for '${actionName}'.`,
            );
        }
        const flow = await this.readJson<PowerShellFlowDefinition>(
            entry.flowPath,
        );
        if (
            flow?.actionName !== actionName ||
            flow.scriptRef !== entry.scriptPath ||
            flow.version !== 1 ||
            !(await this.storage.exists(entry.scriptPath))
        ) {
            throw new PowerShellIntegrityError(
                `Invalid flow metadata or missing script for '${actionName}'.`,
            );
        }
        const script = await this.readScript(entry.scriptPath);
        const revision = await this.readJson<PowerShellRevision>(revisionPath);
        verifyPowerShellRevision(
            revision,
            createPowerShellRevision(script, flow),
        );
        const assertCurrent = async () => {
            if (this.generations.get(actionName) !== generation) {
                throw new PowerShellIntegrityError(
                    "PowerShell revision changed while approval was pending.",
                );
            }
            if (!(await this.storage.exists(revisionPath))) {
                throw new PowerShellIntegrityError(
                    "PowerShell revision was removed while approval was pending.",
                );
            }
            const current = await this.readJson<PowerShellRevision>(
                revisionPath,
            );
            verifyPowerShellRevision(revision, current);
        };
        await assertCurrent();
        return { flow, script, revision, assertCurrent };
    }

    async deleteFlow(actionName: string): Promise<boolean> {
        this.ensureInitialized();
        validatePowerShellIdentifier(actionName);
        const entry = this.index.flows[actionName];
        if (!entry) return false;

        this.validateEntry(actionName, entry);
        this.invalidateSnapshot(actionName);
        for (const path of [
            entry.flowPath,
            entry.scriptPath,
            `revisions/${actionName}.json`,
        ]) {
            if (await this.storage.exists(path)) await this.storage.delete(path);
        }

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
        return structuredClone(Object.values(this.index.flows));
    }

    hasFlow(actionName: string): boolean {
        validatePowerShellIdentifier(actionName);
        return Object.prototype.hasOwnProperty.call(this.index.flows, actionName);
    }

    isSampleDeleted(actionName: string): boolean {
        validatePowerShellIdentifier(actionName);
        return this.index.deletedSamples.includes(actionName);
    }

    // ── Pending recipes ────────────────────────────────────────────────

    async savePending(recipe: ScriptRecipe): Promise<string> {
        this.ensureInitialized();
        recipe = structuredClone(recipe);
        validatePowerShellIdentifier(recipe.actionName);
        const id = "pending_" + randomUUID().replaceAll("-", "");
        validatePowerShellIdentifier(id);
        const pendingPath = `pending/${id}.recipe.json`;
        const revision = createPowerShellRevision(recipe.script.body, {
            ...recipe,
            expectedOutputFormat: recipe.script.expectedOutputFormat,
        });
        if (await this.storage.exists(pendingPath)) {
            throw new PowerShellIntegrityError("Pending recipe already exists.");
        }
        await this.storage.write(pendingPath, JSON.stringify(recipe, null, 2));
        await this.storage.write(
            `revisions/${id}.pending.json`,
            JSON.stringify(revision),
        );
        debug(`Pending recipe saved: ${id}`);
        return id;
    }

    async listPending(): Promise<string[]> {
        this.ensureInitialized();
        try {
            const files = await this.storage.list("pending");
            const pending = files.filter((f) => f.endsWith(".recipe.json"));
            pending.forEach(validatePowerShellPendingFilename);
            return pending;
        } catch (error) {
            if (await this.storage.exists("pending")) throw error;
            return [];
        }
    }

    async getPending(filename: string): Promise<ScriptRecipe | null> {
        this.ensureInitialized();
        validatePowerShellPendingFilename(filename);
        if (!(await this.storage.exists(`pending/${filename}`))) return null;
        const recipe = await this.readJson<ScriptRecipe>(`pending/${filename}`);
        const revisionPath = `revisions/${filename.slice(0, -".recipe.json".length)}.pending.json`;
        if (!(await this.storage.exists(revisionPath))) {
            throw new PowerShellIntegrityError("Missing pending revision.");
        }
        const revision = await this.readJson<PowerShellRevision>(revisionPath);
        verifyPowerShellRevision(
            revision,
            createPowerShellRevision(recipe.script.body, {
                ...recipe,
                expectedOutputFormat: recipe.script.expectedOutputFormat,
            }),
        );
        return recipe;
    }

    async promotePending(filename: string): Promise<string | null> {
        this.ensureInitialized();
        const recipe = await this.getPending(filename);
        if (!recipe) return null;
        if (this.hasFlow(recipe.actionName)) return null;

        const actionName = await this.saveFlow(recipe, "reasoning");
        await this.deletePending(filename);
        return actionName;
    }

    async deletePending(filename: string): Promise<void> {
        this.ensureInitialized();
        validatePowerShellPendingFilename(filename);
        if (await this.storage.exists(`pending/${filename}`)) {
            await this.storage.delete(`pending/${filename}`);
        }
        const revisionPath = `revisions/${filename.slice(0, -".recipe.json".length)}.pending.json`;
        if (await this.storage.exists(revisionPath)) {
            await this.storage.delete(revisionPath);
        }
    }

    // ── Usage tracking ─────────────────────────────────────────────────

    async recordUsage(actionName: string): Promise<void> {
        validatePowerShellIdentifier(actionName);
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
        validatePowerShellIdentifier(actionName);
        return this.index.flows[actionName]?.grammarRuleText;
    }

    async getActionCacheBinding(): Promise<ActionCacheBinding> {
        const actionFingerprints: Record<string, string> = {};
        for (const entry of Object.values(this.index.flows)) {
            if (!entry.enabled) continue;
            const snapshot = await this.getExecutionSnapshot(entry.actionName);
            if (!snapshot) {
                throw new PowerShellIntegrityError(
                    "Flow disappeared during schema generation.",
                );
            }
            const { flow, script } = snapshot;
            actionFingerprints[entry.actionName] = createHash("sha256")
                .update(
                    JSON.stringify({
                        version: flow.version,
                        actionName: flow.actionName,
                        displayName: flow.displayName,
                        description: flow.description,
                        parameters: flow.parameters,
                        expectedOutputFormat: flow.expectedOutputFormat,
                        sandbox: flow.sandbox,
                    }),
                )
                .update("\0")
                .update(script)
                .digest("base64");
        }
        return {
            sourceId: "typeagent.powershell",
            actionFingerprints,
        };
    }

    async writeDynamicGrammarFile(): Promise<void> {
        const fullGrammar = assembleDynamicGrammar(
            Object.values(this.index.flows),
        );
        await this.storage.write("grammar/dynamic.agr", fullGrammar);
        debug("Wrote grammar/dynamic.agr");
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

        const builtInTypesStart = [
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
        ].join("\n");

        const { typeDefinitions, typeNames } =
            generateFlowActionTypes(enabledFlows);

        const builtInTypesEnd = [
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
            '            type: "string" | "number" | "boolean" | "path" | "executable";',
            "            required: boolean;",
            "            description: string;",
            "            default?: string;",
            "        }[];",
            "        grammarPatterns: {",
            "            pattern: string;",
            "            isAlias: boolean;",
            "        }[];",
            "        allowedCmdlets: string[];",
            '        // Modules to import for the script\'s cmdlets (e.g. ["NetTCPIP"]',
            "        // for Get-NetTCPConnection). Include every module required by",
            "        // allowedCmdlets, matching the list that made testPowerShellFlow pass.",
            "        allowedModules?: string[];",
            "    };",
            "};",
            "",
            "// Create, execute once, and promote a reusable PowerShell flow",
            "export type CreateAndExecutePowerShellFlow = {",
            '    actionName: "createAndExecutePowerShellFlow";',
            "    parameters: {",
            "        actionName: string;",
            "        description: string;",
            "        displayName: string;",
            "        script: string;",
            "        scriptParameters: {",
            "            name: string;",
            '            type: "string" | "number" | "boolean" | "path" | "executable";',
            "            required: boolean;",
            "            description: string;",
            "            default?: string;",
            "        }[];",
            "        grammarPatterns: {",
            "            pattern: string;",
            "            isAlias: boolean;",
            "        }[];",
            "        allowedCmdlets: string[];",
            "        allowedModules?: string[];",
            "        executionParametersJson?: string;",
            "        networkAccess?: boolean;",
            "    };",
            "};",
            "",
            "// Add validated phrases to an existing flow",
            "export type AddPowerShellFlowPatterns = {",
            '    actionName: "addPowerShellFlowPatterns";',
            "    parameters: {",
            `        flowName: ${flowNameType};`,
            "        grammarPatterns: {",
            "            pattern: string;",
            "            isAlias: boolean;",
            "        }[];",
            "    };",
            "};",
            "",
            "// Report the machine-readable result of PowerShell capability reasoning",
            "export type ReportPowerShellCapabilityOutcome = {",
            '    actionName: "reportPowerShellCapabilityOutcome";',
            "    parameters: {",
            '        status: "handledExisting" | "created" | "notSuitable" | "failed";',
            "        schema?: string;",
            "        actionName?: string;",
            "        flowName?: string;",
            "        reasonCode?: string;",
            '        phase?: "classify" | "discover" | "validate" | "execute" | "persist";',
            "        mayHaveSideEffects?: boolean;",
            "        reason?: string;",
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
            "        // Updated modules to import (optional; preserved if omitted)",
            "        allowedModules?: string[];",
            "    };",
            "};",
            "",
            "// Repair an existing flow and retry once",
            "export type RepairAndExecutePowerShellFlow = {",
            '    actionName: "repairAndExecutePowerShellFlow";',
            "    parameters: {",
            `        flowName: ${flowNameType};`,
            "        script: string;",
            "        allowedCmdlets: string[];",
            "        allowedModules?: string[];",
            "        executionParametersJson?: string;",
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
        ].join("\n");

        const allTypeNames = [
            "ListPowerShellFlows",
            "DeletePowerShellFlow",
            ...typeNames,
            "TestPowerShellFlow",
            "CreatePowerShellFlow",
            "CreateAndExecutePowerShellFlow",
            "AddPowerShellFlowPatterns",
            "ReportPowerShellCapabilityOutcome",
            "EditPowerShellFlow",
            "RepairAndExecutePowerShellFlow",
            "ImportPowerShellFlow",
        ];

        return [
            builtInTypesStart,
            typeDefinitions,
            builtInTypesEnd,
            "",
            buildUnionType("PowerShellActions", allTypeNames),
            "",
        ].join("\n");
    }

    getDynamicGrammarText(): string {
        return assembleDynamicGrammar(Object.values(this.index.flows));
    }

    private async regenerateGrammarRules(): Promise<void> {
        let updated = false;
        for (const entry of Object.values(this.index.flows)) {
            const snapshot = await this.getExecutionSnapshot(entry.actionName);
            if (!snapshot) {
                throw new PowerShellIntegrityError(
                    "Flow disappeared during registration.",
                );
            }
            const { flow } = snapshot;
            entry.parameters = flow.parameters.map(
                ({ name, type, required, description }) => ({
                    name,
                    type,
                    required,
                    description,
                }),
            );
            const newText = generateGrammarRuleText(
                entry.actionName,
                flow.grammarPatterns,
            );
            if (newText !== entry.grammarRuleText) {
                entry.grammarRuleText = newText;
                updated = true;
            }
        }
        if (updated) {
            await this.saveIndex();
            debug("Regenerated grammar rules for existing flows");
        }
    }

    // ── Internal ───────────────────────────────────────────────────────

    private validateEntry(name: string, entry: PowerShellFlowIndexEntry): void {
        validatePowerShellIdentifier(name);
        if (
            entry?.actionName !== name ||
            entry.flowPath !== `flows/${name}.flow.json` ||
            entry.scriptPath !== `scripts/${name}.ps1`
        ) {
            throw new PowerShellIntegrityError(
                `Invalid PowerShell storage destination for '${name}'.`,
            );
        }
    }

    private invalidateSnapshot(actionName: string): void {
        this.generations.set(
            actionName,
            (this.generations.get(actionName) ?? 0) + 1,
        );
    }

    private async readJson<T>(path: string): Promise<T> {
        try {
            return JSON.parse(await this.storage.read(path, "utf8")) as T;
        } catch (error) {
            throw new PowerShellIntegrityError(
                `Cannot read PowerShell record '${path}': ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private async readScript(path: string): Promise<string> {
        try {
            return new TextDecoder("utf-8", {
                fatal: true,
                ignoreBOM: true,
            }).decode(await this.storage.read(path));
        } catch (error) {
            throw new PowerShellIntegrityError(
                `Cannot read exact UTF-8 PowerShell script '${path}': ${error instanceof Error ? error.message : String(error)}`,
            );
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
                "PowerShellStore not initialized. Call initialize() first.",
            );
        }
    }
}
