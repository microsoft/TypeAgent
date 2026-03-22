// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type AppAgent,
    type SessionContext,
    type ActionContext,
    type ActionResult,
    type SchemaContent,
    type GrammarContent,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import {
    type CommandHandler,
    type CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import type { ParsedCommandParams } from "@typeagent/agent-sdk";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, dirname, isAbsolute, resolve, extname } from "path";
import { ScriptAnalyzer } from "./analysis/scriptAnalyzer.mjs";
import { fileURLToPath } from "url";
import { ScriptFlowStore } from "./store/scriptFlowStore.mjs";
import type { ScriptFlowDefinition } from "./store/scriptFlowStore.mjs";
import {
    type ScriptRecipe,
    type ScriptParameter,
} from "./types/scriptRecipe.js";
import {
    executeScript,
    type ScriptExecutionRequest,
} from "./execution/powershellRunner.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:scriptflow:handler");
const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, "..", "samples");

interface ScriptFlowAgentContext {
    store?: ScriptFlowStore | undefined;
}

async function seedSampleFlows(store: ScriptFlowStore): Promise<number> {
    let seeded = 0;
    let sampleFiles: string[];
    try {
        sampleFiles = readdirSync(SAMPLES_DIR).filter((f) =>
            f.endsWith(".recipe.json"),
        );
    } catch {
        debug("No samples directory found");
        return 0;
    }

    for (const file of sampleFiles) {
        const recipe: ScriptRecipe = JSON.parse(
            readFileSync(join(SAMPLES_DIR, file), "utf8"),
        );

        if (store.hasFlow(recipe.actionName)) continue;
        if (store.isSampleDeleted(recipe.actionName)) continue;

        await store.saveFlow(recipe, "seed");
        seeded++;
    }

    if (seeded > 0) {
        debug(`Seeded ${seeded} sample flow(s)`);
    }
    return seeded;
}

async function executeFlowScript(
    flow: ScriptFlowDefinition,
    script: string,
    parameters: Record<string, unknown>,
): Promise<ActionResult> {
    const resolvedParams: Record<string, unknown> = {};
    for (const paramDef of flow.parameters) {
        const value = parameters[paramDef.name] ?? paramDef.default;
        if (value !== undefined) {
            resolvedParams[paramDef.name] = value;
        }
    }

    const request: ScriptExecutionRequest = {
        script,
        parameters: resolvedParams,
        sandbox: {
            allowedCmdlets: flow.sandbox.allowedCmdlets,
            allowedPaths: flow.sandbox.allowedPaths,
            maxExecutionTime: flow.sandbox.maxExecutionTime,
            networkAccess: flow.sandbox.networkAccess,
        },
    };

    const result = await executeScript(request);

    if (result.success) {
        const output = result.stdout.trim() || "(no output)";
        return createActionResultFromTextDisplay(output);
    }

    const errorMsg =
        result.stderr || `Script exited with code ${result.exitCode}`;
    return { error: errorMsg, fallbackToReasoning: true };
}

function mapParamsToFlowDefs(
    provided: Record<string, unknown>,
    paramDefs: ScriptParameter[],
    out: Record<string, unknown>,
): void {
    const defsByLower = new Map(
        paramDefs.map((d) => [d.name.toLowerCase(), d.name]),
    );
    for (const [key, value] of Object.entries(provided)) {
        const actualName = defsByLower.get(key.toLowerCase());
        if (actualName) {
            out[actualName] = value;
        } else {
            // No matching param def — pass through as-is, the script may still accept it
            out[key] = value;
            debug(
                `Parameter '${key}' not found in flow definition, passing through`,
            );
        }
    }
}

function expandEnvVarsInParams(
    params: Record<string, unknown>,
    _paramDefs: ScriptParameter[],
): void {
    for (const key of Object.keys(params)) {
        const val = params[key];
        if (typeof val !== "string") continue;
        if (!/\$env:/i.test(val)) continue;
        params[key] = val.replace(/\$env:(\w+)/gi, (_match, varName) => {
            return process.env[varName] ?? _match;
        });
    }
}

function validatePathParameters(
    params: Record<string, unknown>,
    paramDefs: ScriptParameter[],
): string | undefined {
    for (const def of paramDefs) {
        if (def.type !== "path") continue;
        const val = params[def.name];
        if (val === undefined || val === "") continue;
        if (typeof val !== "string") {
            return `Parameter '${def.name}' must be a string path, got ${typeof val}`;
        }
        // Reject values that contain natural language (spaces + non-path words)
        if (/\b(and|or|show|with|the|ones|that|filter|find)\b/i.test(val)) {
            return `Parameter '${def.name}' contains non-path text: "${val}". Extract the path separately from the rest of the request.`;
        }
        // Check for obviously invalid path characters
        if (/[<>"|?*]/.test(val.replace(/^[a-zA-Z]:\\/, ""))) {
            return `Parameter '${def.name}' contains invalid path characters: "${val}"`;
        }
        // Warn if the path doesn't exist (for absolute paths)
        if (isAbsolute(val) && !existsSync(val)) {
            debug(`Path parameter '${def.name}' does not exist: ${val}`);
        }
    }
    return undefined;
}

async function handleScriptFlowAction(
    action: { actionName: string; parameters?: Record<string, unknown> },
    context: ActionContext<ScriptFlowAgentContext>,
): Promise<ActionResult> {
    const flowStore = (context as any).__store as ScriptFlowStore | undefined;

    switch (action.actionName) {
        case "listScriptFlows": {
            if (!flowStore) {
                return createActionResultFromTextDisplay(
                    "Script flow store not available.",
                );
            }
            const entries = flowStore.listFlows();
            if (entries.length === 0) {
                return createActionResultFromTextDisplay(
                    "No script flows registered.",
                );
            }
            const lines = entries.map(
                (e) =>
                    `  - ${e.actionName}: ${e.description} [usage: ${e.usageCount}]${e.source === "seed" ? " (sample)" : ""}`,
            );
            return createActionResultFromTextDisplay(
                `Script flows (${entries.length}):\n${lines.join("\n")}`,
            );
        }

        case "deleteScriptFlow": {
            if (!flowStore) {
                return createActionResultFromError(
                    "Script flow store not available",
                );
            }
            const name = action.parameters?.name as string | undefined;
            if (!name) {
                return createActionResultFromError(
                    "Missing required parameter: name",
                );
            }
            const deleted = await flowStore.deleteFlow(name);
            if (!deleted) {
                return createActionResultFromError(
                    `Script flow not found: ${name}`,
                );
            }
            await context.sessionContext.reloadAgentSchema();
            return createActionResultFromTextDisplay(
                `Deleted script flow: ${name}`,
            );
        }

        case "createScriptFlow": {
            if (!flowStore) {
                return createActionResultFromError(
                    "Script flow store not available",
                );
            }
            const params = action.parameters as Record<string, unknown>;
            const newActionName = params.actionName as string;
            if (!newActionName) {
                return createActionResultFromError(
                    "Missing required parameter: actionName",
                );
            }
            const scriptBody = params.script as string;
            if (!scriptBody) {
                return createActionResultFromError(
                    "Missing required parameter: script",
                );
            }
            const scriptParams = (params.scriptParameters as any[]) ?? [];
            const grammarPats = (params.grammarPatterns as any[]) ?? [];
            const allowedCmdlets = (params.allowedCmdlets as string[]) ?? [];

            const recipe: ScriptRecipe = {
                version: 1,
                actionName: newActionName,
                description: (params.description as string) ?? "",
                displayName: (params.displayName as string) ?? newActionName,
                parameters: scriptParams.map((p: any) => ({
                    name: p.name,
                    type: p.type ?? "string",
                    required: p.required ?? false,
                    description: p.description ?? "",
                    default: p.default,
                })),
                script: {
                    language: "powershell",
                    body: scriptBody,
                    expectedOutputFormat: "text",
                },
                grammarPatterns: grammarPats.map((g: any) => ({
                    pattern: g.pattern,
                    isAlias: g.isAlias ?? false,
                    examples: [],
                })),
                sandbox: {
                    allowedCmdlets,
                    allowedPaths: ["$env:USERPROFILE", "$PWD", "$env:TEMP"],
                    allowedModules: ["Microsoft.PowerShell.Management"],
                    maxExecutionTime: 30,
                    networkAccess: false,
                },
                source: {
                    type: "reasoning",
                    timestamp: new Date().toISOString(),
                },
            };

            await flowStore.saveFlow(recipe, "reasoning");
            await context.sessionContext.reloadAgentSchema();
            return createActionResultFromTextDisplay(
                `Created script flow '${newActionName}': ${recipe.description}`,
            );
        }

        case "editScriptFlow": {
            if (!flowStore) {
                return createActionResultFromError(
                    "Script flow store not available",
                );
            }
            const editFlowName = action.parameters?.flowName as
                | string
                | undefined;
            if (!editFlowName) {
                return createActionResultFromError(
                    "Missing required parameter: flowName",
                );
            }
            const existingFlow = await flowStore.getFlow(editFlowName);
            if (!existingFlow) {
                return createActionResultFromError(
                    `Script flow not found: ${editFlowName}`,
                );
            }
            const newScript = action.parameters?.script as string | undefined;
            if (!newScript) {
                return createActionResultFromError(
                    "Missing required parameter: script",
                );
            }
            const newCmdlets =
                (action.parameters?.allowedCmdlets as string[]) ??
                existingFlow.sandbox.allowedCmdlets;

            // Update the script and sandbox policy while preserving everything else
            await flowStore.updateFlowScript(
                editFlowName,
                newScript,
                newCmdlets,
            );
            return createActionResultFromTextDisplay(
                `Updated script flow '${editFlowName}'`,
            );
        }

        case "executeScriptFlow": {
            if (!flowStore) {
                return createActionResultFromError(
                    "Script flow store not available",
                );
            }
            const flowName = action.parameters?.flowName as string | undefined;
            if (!flowName) {
                return createActionResultFromError(
                    "Missing required parameter: flowName",
                );
            }

            const flow = await flowStore.getFlow(flowName);
            if (!flow) {
                return {
                    error: `Unknown script flow '${flowName}'. Use 'listScriptFlows' to see available flows.`,
                    fallbackToReasoning: true,
                };
            }

            const script = await flowStore.getScript(flowName);
            if (!script) {
                return createActionResultFromError(
                    `Script not found for flow: ${flowName}`,
                );
            }

            // Prefer named flowParametersJson over single flowArgs string
            const flowParamsJson = action.parameters?.flowParametersJson as
                | string
                | undefined;
            let namedParams: Record<string, unknown> | undefined;
            if (flowParamsJson) {
                try {
                    namedParams = JSON.parse(flowParamsJson);
                } catch {
                    debug(
                        `Failed to parse flowParametersJson: ${flowParamsJson}`,
                    );
                }
            }
            const flowParameters: Record<string, unknown> = {};
            if (namedParams && Object.keys(namedParams).length > 0) {
                // Map provided param names to actual flow param names (case-insensitive)
                mapParamsToFlowDefs(
                    namedParams,
                    flow.parameters,
                    flowParameters,
                );
            } else {
                const flowArgs = action.parameters?.flowArgs as
                    | string
                    | undefined;
                if (flowArgs && flow.parameters.length > 0) {
                    flowParameters[flow.parameters[0].name] = flowArgs;
                }
            }

            // Expand environment variable references in path parameters
            expandEnvVarsInParams(flowParameters, flow.parameters);

            // Validate path-type parameters before execution
            const pathError = validatePathParameters(
                flowParameters,
                flow.parameters,
            );
            if (pathError) {
                return { error: pathError, fallbackToReasoning: true };
            }

            const result = await executeFlowScript(
                flow,
                script,
                flowParameters,
            );
            if (result.error !== undefined) {
                return { ...result, fallbackToReasoning: true };
            }

            await flowStore.recordUsage(flowName);
            return result;
        }

        case "importScriptFlow": {
            if (!flowStore) {
                return createActionResultFromError(
                    "Script flow store not available",
                );
            }
            const importParams = action.parameters as Record<string, unknown>;
            const filePath = importParams?.filePath as string | undefined;
            if (!filePath) {
                return createActionResultFromError(
                    "Missing required parameter: filePath",
                );
            }

            const resolvedPath = isAbsolute(filePath)
                ? filePath
                : resolve(process.cwd(), filePath);

            if (!existsSync(resolvedPath)) {
                return createActionResultFromError(
                    `File not found: ${resolvedPath}`,
                );
            }

            if (extname(resolvedPath).toLowerCase() !== ".ps1") {
                return createActionResultFromError(
                    "Only PowerShell (.ps1) files can be imported",
                );
            }

            let scriptContent: string;
            try {
                scriptContent = readFileSync(resolvedPath, "utf8");
            } catch (err) {
                return createActionResultFromError(
                    `Failed to read file: ${err}`,
                );
            }

            if (!scriptContent.trim()) {
                return createActionResultFromError("Script file is empty");
            }

            const overrideName = importParams?.actionName as string | undefined;

            let recipe;
            try {
                const analyzer = new ScriptAnalyzer();
                recipe = await analyzer.analyze(
                    scriptContent,
                    resolvedPath,
                    overrideName,
                );
            } catch (err) {
                return createActionResultFromError(
                    `Failed to analyze script: ${err}`,
                );
            }

            if (flowStore.hasFlow(recipe.actionName)) {
                return createActionResultFromError(
                    `A flow named '${recipe.actionName}' already exists. Use a different name: @scriptflow import ${filePath} with actionName set to a new name`,
                );
            }

            await flowStore.saveFlow(recipe, "manual");
            await context.sessionContext.reloadAgentSchema();

            const patternList = recipe.grammarPatterns
                .map((p) => `  "${p.pattern}"`)
                .join("\n");
            return createActionResultFromTextDisplay(
                `Imported script flow '${recipe.actionName}': ${recipe.description}\n\nGrammar patterns:\n${patternList}`,
            );
        }

        default: {
            if (!flowStore) {
                return createActionResultFromError(
                    `Unknown action '${action.actionName}'`,
                );
            }

            const flow = await flowStore.getFlow(action.actionName);
            if (!flow) {
                return {
                    error: `Unknown script flow '${action.actionName}'. Use 'list script flows' to see available flows.`,
                    fallbackToReasoning: true,
                };
            }

            const script = await flowStore.getScript(action.actionName);
            if (!script) {
                return createActionResultFromError(
                    `Script not found for flow: ${action.actionName}`,
                );
            }

            const directParams = { ...(action.parameters ?? {}) };
            expandEnvVarsInParams(directParams, flow.parameters);
            const pathError = validatePathParameters(
                directParams,
                flow.parameters,
            );
            if (pathError) {
                return { error: pathError, fallbackToReasoning: true };
            }

            const result = await executeFlowScript(flow, script, directParams);
            if (result.error !== undefined) {
                return { ...result, fallbackToReasoning: true };
            }

            await flowStore.recordUsage(action.actionName);
            return result;
        }
    }
}

let _agentStore: ScriptFlowStore | undefined;

class ImportScriptHandler implements CommandHandler {
    public readonly description =
        "Import a PowerShell script as a reusable script flow";
    public readonly parameters = {
        args: {
            filePath: {
                description: "Path to the .ps1 file to import",
                implicitQuotes: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<ScriptFlowAgentContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const store = _agentStore;
        if (!store) {
            throw new Error("Script flow store not available");
        }

        const filePath = params.args.filePath;
        if (!filePath) {
            throw new Error("Missing required argument: filePath");
        }

        const resolvedPath = isAbsolute(filePath)
            ? filePath
            : resolve(process.cwd(), filePath);

        if (!existsSync(resolvedPath)) {
            throw new Error(`File not found: ${resolvedPath}`);
        }

        if (extname(resolvedPath).toLowerCase() !== ".ps1") {
            throw new Error("Only PowerShell (.ps1) files can be imported");
        }

        const scriptContent = readFileSync(resolvedPath, "utf8");
        if (!scriptContent.trim()) {
            throw new Error("Script file is empty");
        }

        const analyzer = new ScriptAnalyzer();
        const recipe = await analyzer.analyze(scriptContent, resolvedPath);

        if (store.hasFlow(recipe.actionName)) {
            throw new Error(
                `A flow named '${recipe.actionName}' already exists. Delete it first or use a different name.`,
            );
        }

        await store.saveFlow(recipe, "manual");
        await context.sessionContext.reloadAgentSchema();

        const patternList = recipe.grammarPatterns
            .map((p) => `  "${p.pattern}"`)
            .join("\n");
        context.actionIO.setDisplay(
            `Imported script flow '${recipe.actionName}': ${recipe.description}\n\nGrammar patterns:\n${patternList}`,
        );
    }
}

const handlers: CommandHandlerTable = {
    description: "ScriptFlow commands",
    commands: {
        import: new ImportScriptHandler(),
    },
};

export function instantiate(): AppAgent {
    let agentContext: ScriptFlowAgentContext = {};

    return {
        async initializeAgentContext() {
            return agentContext;
        },
        ...getCommandInterface(handlers),

        async updateAgentContext(
            enable: boolean,
            sessionContext: SessionContext,
        ) {
            if (!enable) return;

            const instanceStorage = sessionContext.instanceStorage;
            if (!instanceStorage) {
                debug("No instance storage available, skipping store init");
                return;
            }

            const store = new ScriptFlowStore(instanceStorage);
            await store.initialize();
            agentContext.store = store;
            _agentStore = store;

            await seedSampleFlows(store);
            // Dynamic grammar rules are written to grammar/dynamic.agr by the store.
            // The dispatcher reads this file after updateAgentContext completes
            // and registers the rules in its own grammar system.
            debug(`Store initialized with ${store.listFlows().length} flow(s)`);
        },

        executeAction(action, context: ActionContext<ScriptFlowAgentContext>) {
            (context as any).__store = agentContext.store;
            return handleScriptFlowAction(
                action as {
                    actionName: string;
                    parameters?: Record<string, unknown>;
                },
                context,
            );
        },

        async getDynamicSchema(
            _context: SessionContext,
            _schemaName: string,
        ): Promise<SchemaContent | undefined> {
            if (!agentContext.store) return undefined;
            return {
                format: "ts",
                content: agentContext.store.generateDynamicSchemaText(),
            };
        },

        async getDynamicGrammar(
            _context: SessionContext,
            _schemaName: string,
        ): Promise<GrammarContent | undefined> {
            if (!agentContext.store) return undefined;
            const text = agentContext.store.getDynamicGrammarText();
            if (!text) return undefined;
            return { format: "agr", content: text };
        },
    };
}
