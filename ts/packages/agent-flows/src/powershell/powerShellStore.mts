// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionCacheBinding, Storage } from "@typeagent/agent-sdk";
import { createHash, randomUUID } from "node:crypto";
import { getRequiredModules } from "./scriptRecipe.js";
import {
    createPowerShellRevision,
    matchesPowerShellRevision,
    PowerShellIntegrityError,
    validatePowerShellIdentifier,
    validatePowerShellPendingFilename,
    type PowerShellRevision,
} from "./integrity.js";
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
    requiredModules?: string[] | undefined;
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

export interface PowerShellExecutionSnapshot {
    flow: PowerShellFlowDefinition;
    script: string;
    revision: PowerShellRevision;
    revisionStatus: "verified" | "unverified" | "changed";
    acceptRevision(): Promise<void>;
}

// Grammar generation uses @typeagent/workflow's generateGrammarRuleText

export class PowerShellStore {
    private index: PowerShellFlowIndex = emptyIndex();
    private initialized = false;

    constructor(private storage: Storage) {}

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
                    "Invalid PowerShell index. Existing data was not replaced.",
                );
            }
            for (const [name, entry] of Object.entries(this.index.flows))
                this.validateEntry(name, entry);
            this.index.deletedSamples.forEach(validatePowerShellIdentifier);
            debug(
                `Loaded index with ${Object.keys(this.index.flows).length} flows`,
            );

            // Regenerate grammar rules to pick up format changes
            await this.regenerateGrammarRules();
        }

        this.initialized = true;
        await this.writeDynamicGrammarFile();
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
            if (await this.storage.exists(path))
                throw new PowerShellIntegrityError(
                    `Unindexed PowerShell data exists for '${actionName}'. It was not overwritten.`,
                );
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
            sandbox: { maxExecutionTime: recipe.sandbox.maxExecutionTime },
            requiredModules: getRequiredModules(recipe),
            source: storedSource,
        };
        const revision = createPowerShellRevision(recipe.script.body, flowDef);

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
        newModules?: string[],
        newSource?: ScriptSource,
    ): Promise<void> {
        this.ensureInitialized();
        validatePowerShellIdentifier(actionName);
        const entry = this.index.flows[actionName];
        if (!entry) throw new Error(`Flow not found: ${actionName}`);
        this.validateEntry(actionName, entry);
        const revisionPath = `revisions/${actionName}.json`;
        const previousRevision = (await this.storage.exists(revisionPath))
            ? await this.storage.read(revisionPath, "utf8")
            : undefined;

        const previousScript = await this.storage.read(
            entry.scriptPath,
            "utf8",
        );
        const previousFlowJson = await this.storage.read(
            entry.flowPath,
            "utf8",
        );
        const previousEntry = JSON.parse(
            JSON.stringify(entry),
        ) as PowerShellFlowIndexEntry;
        const flow = JSON.parse(previousFlowJson) as PowerShellFlowDefinition;
        if (newModules !== undefined) {
            flow.requiredModules = newModules;
        }
        if (newSource !== undefined) {
            flow.source = newSource;
        }
        const revision = createPowerShellRevision(newScript, flow);

        try {
            await this.storage.write(entry.scriptPath, newScript);
            await this.storage.write(
                entry.flowPath,
                JSON.stringify(flow, null, 2),
            );
            await this.storage.write(revisionPath, JSON.stringify(revision));

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
                if (previousRevision === undefined) {
                    if (await this.storage.exists(revisionPath))
                        await this.storage.delete(revisionPath);
                } else {
                    await this.storage.write(revisionPath, previousRevision);
                }
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
        validatePowerShellIdentifier(actionName);
        const entry = this.index.flows[actionName];
        if (!entry) throw new Error(`Flow not found: ${actionName}`);
        this.validateEntry(actionName, entry);

        const previousFlowJson = await this.storage.read(
            entry.flowPath,
            "utf8",
        );
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
        this.ensureInitialized();
        validatePowerShellIdentifier(actionName);
        const entry = this.index.flows[actionName];
        if (!entry) return null;
        this.validateEntry(actionName, entry);
        const flow = await this.readJson<PowerShellFlowDefinition>(
            entry.flowPath,
        );
        if (
            flow?.version !== 1 ||
            flow.actionName !== actionName ||
            flow.scriptRef !== entry.scriptPath
        ) {
            throw new PowerShellIntegrityError(
                `Invalid stored definition for '${actionName}'.`,
            );
        }
        return flow;
    }

    async getScript(actionName: string): Promise<string | null> {
        this.ensureInitialized();
        validatePowerShellIdentifier(actionName);
        const entry = this.index.flows[actionName];
        if (!entry) return null;
        this.validateEntry(actionName, entry);
        try {
            return new TextDecoder("utf-8", {
                fatal: true,
                ignoreBOM: true,
            }).decode(await this.storage.read(entry.scriptPath));
        } catch (error) {
            throw new PowerShellIntegrityError(
                `Cannot read exact PowerShell script '${actionName}': ${String(error)}`,
            );
        }
    }

    async getExecutionSnapshot(
        actionName: string,
    ): Promise<PowerShellExecutionSnapshot | null> {
        const flow = await this.getFlow(actionName);
        if (!flow) return null;
        const script = await this.getScript(actionName);
        if (script === null)
            throw new PowerShellIntegrityError(
                `Script missing for '${actionName}'.`,
            );
        const revision = createPowerShellRevision(script, flow);
        const path = `revisions/${actionName}.json`;
        const recorded = (await this.storage.exists(path))
            ? await this.readJson<PowerShellRevision>(path)
            : undefined;
        const revisionStatus =
            recorded === undefined
                ? "unverified"
                : matchesPowerShellRevision(recorded, revision)
                  ? "verified"
                  : "changed";
        return {
            flow,
            script,
            revision,
            revisionStatus,
            // The runner calls this after UI authorization, never during load.
            acceptRevision: async () => {
                const currentFlow = await this.getFlow(actionName);
                const currentScript = await this.getScript(actionName);
                if (
                    !currentFlow ||
                    currentScript === null ||
                    !matchesPowerShellRevision(
                        revision,
                        createPowerShellRevision(currentScript, currentFlow),
                    )
                ) {
                    throw new PowerShellIntegrityError(
                        "PowerShell changed while approval was pending. Review the new version.",
                    );
                }
                if (revisionStatus !== "verified")
                    await this.storage.write(path, JSON.stringify(revision));
            },
        };
    }

    async deleteFlow(actionName: string): Promise<boolean> {
        this.ensureInitialized();
        validatePowerShellIdentifier(actionName);
        const entry = this.index.flows[actionName];
        if (!entry) return false;
        this.validateEntry(actionName, entry);
        for (const path of [
            entry.flowPath,
            entry.scriptPath,
            `revisions/${actionName}.json`,
        ]) {
            if (await this.storage.exists(path))
                await this.storage.delete(path);
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
        return Object.values(this.index.flows);
    }

    hasFlow(actionName: string): boolean {
        validatePowerShellIdentifier(actionName);
        return Object.prototype.hasOwnProperty.call(
            this.index.flows,
            actionName,
        );
    }

    isSampleDeleted(actionName: string): boolean {
        return this.index.deletedSamples.includes(actionName);
    }

    // ── Pending recipes ────────────────────────────────────────────────

    async savePending(recipe: ScriptRecipe): Promise<string> {
        this.ensureInitialized();
        validatePowerShellIdentifier(recipe.actionName);
        const revision = createPowerShellRevision(recipe.script.body, recipe);
        const id = "candidate_" + randomUUID().replaceAll("-", "");
        const pendingPath = `pending/${id}.recipe.json`;
        const revisionPath = `revisions/${id}.json`;
        await this.storage.write(pendingPath, JSON.stringify(recipe, null, 2));
        try {
            await this.storage.write(revisionPath, JSON.stringify(revision));
        } catch (error) {
            await this.storage.delete(pendingPath);
            throw error;
        }
        debug(`Pending recipe saved: ${id}`);
        return id;
    }

    async listPending(): Promise<string[]> {
        this.ensureInitialized();
        if (!(await this.storage.exists("pending"))) return [];
        const files = await this.storage.list("pending");
        return files.filter((f) => f.endsWith(".recipe.json"));
    }

    async getPending(filename: string): Promise<ScriptRecipe | null> {
        this.ensureInitialized();
        validatePowerShellPendingFilename(filename);
        const path = `pending/${filename}`;
        if (!(await this.storage.exists(path))) return null;
        const recipe = await this.readJson<ScriptRecipe>(path);
        const revisionPath = `revisions/${filename.slice(0, -".recipe.json".length)}.json`;
        if (!(await this.storage.exists(revisionPath)))
            throw new PowerShellIntegrityError(
                "Pending recipe has no revision record. Review and re-import it.",
            );
        const revision = await this.readJson<PowerShellRevision>(revisionPath);
        if (
            !matchesPowerShellRevision(
                revision,
                createPowerShellRevision(recipe.script.body, recipe),
            )
        ) {
            throw new PowerShellIntegrityError(
                "Pending recipe changed before promotion.",
            );
        }
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
        for (const path of [
            `pending/${filename}`,
            `revisions/${filename.slice(0, -".recipe.json".length)}.json`,
        ]) {
            if (await this.storage.exists(path))
                await this.storage.delete(path);
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
        return this.index.flows[actionName]?.grammarRuleText;
    }

    async getActionCacheBinding(): Promise<ActionCacheBinding> {
        const actionFingerprints: Record<string, string> = {};
        for (const entry of Object.values(this.index.flows)) {
            if (!entry.enabled) continue;
            this.validateEntry(entry.actionName, entry);
            const flowJson = await this.storage.read(entry.flowPath, "utf8");
            const flow = JSON.parse(flowJson) as PowerShellFlowDefinition;
            const script = await this.storage.read(entry.scriptPath, "utf8");
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
                        requiredModules: getRequiredModules(flow),
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
            "        // Installed modules loaded after authorization, before the script.",
            "        requiredModules?: string[];",
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
            "        requiredModules?: string[];",
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
            "        requiredModules?: string[];",
            "        executionParametersJson?: string;",
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
            "        // Omit to preserve the existing dependencies.",
            "        requiredModules?: string[];",
            "    };",
            "};",
            "",
            "// Repair an existing flow and retry once",
            "export type RepairAndExecutePowerShellFlow = {",
            '    actionName: "repairAndExecutePowerShellFlow";',
            "    parameters: {",
            `        flowName: ${flowNameType};`,
            "        script: string;",
            "        requiredModules?: string[];",
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
            } catch (error) {
                throw new PowerShellIntegrityError(
                    `Could not read stored flow '${entry.actionName}': ${String(error)}. Existing data was not replaced.`,
                );
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

    private async readJson<T>(path: string): Promise<T> {
        try {
            return JSON.parse(await this.storage.read(path, "utf8")) as T;
        } catch (error) {
            throw new PowerShellIntegrityError(
                `Cannot read PowerShell record '${path}': ${String(error)}`,
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
