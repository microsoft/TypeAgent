// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type AppAgent,
    type AppAction,
    type ActionContext,
    type ActionResult,
    type SessionContext,
    type SchemaContent,
    type GrammarContent,
    type GrammarValidationResult,
    AppAgentEvent,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromError,
    createStructuredResult,
} from "@typeagent/agent-sdk/helpers/action";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
    TaskFlowStore,
    type TaskFlowDefinition,
} from "./store/taskFlowStore.mjs";
import type { ScriptRecipe } from "./types/recipe.js";
import { TaskFlowScriptAPIImpl } from "./script/taskFlowScriptApi.mjs";
import { executeTaskFlowScript } from "./script/taskFlowScriptExecutor.mjs";
import {
    validateTaskFlowScript,
    transpileScript,
} from "./script/taskFlowScriptValidator.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:taskflow:handler");
const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, "..", "samples");

// How long flow authoring waits for grammar validation before failing closed.
const GRAMMAR_VALIDATION_WAIT_MS = 15_000;

/**
 * Await a grammar-validation result, but only up to `budgetMs`. Returns
 * `undefined` if validation does not finish in time or rejects. The underlying
 * validation keeps running in the background, and any late rejection is
 * consumed.
 */
async function awaitValidationWithinBudget(
    validation: Promise<GrammarValidationResult>,
    budgetMs: number,
): Promise<GrammarValidationResult | undefined> {
    // Once we stop awaiting, a late rejection must not surface as unhandled.
    validation.catch(() => {});

    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), budgetMs);
    });

    try {
        return await Promise.race([validation, budget]);
    } catch {
        return undefined;
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

// ── Agent context ───────────────────────────────────────────────────────────

interface TaskFlowAgentContext {
    store?: TaskFlowStore | undefined;
}

async function validateTaskFlowGrammarPatterns(
    actionName: string,
    description: string,
    patterns: unknown,
    context: ActionContext<TaskFlowAgentContext>,
): Promise<{ patterns: string[] } | { error: ActionResult }> {
    if (
        !Array.isArray(patterns) ||
        patterns.some(
            (pattern) =>
                typeof pattern !== "string" || pattern.trim().length === 0,
        )
    ) {
        return {
            error: createActionResultFromError(
                "Grammar patterns must be a JSON array of non-empty strings.",
            ),
        };
    }

    let approvedPatterns = patterns.map((pattern) => pattern.trim());
    const validate = context.sessionContext.validateGrammarPatterns;
    if (approvedPatterns.length === 0 || validate === undefined) {
        return { patterns: approvedPatterns };
    }

    const validationResult = await awaitValidationWithinBudget(
        validate({
            actionName,
            description,
            patterns: approvedPatterns,
        }),
        GRAMMAR_VALIDATION_WAIT_MS,
    );
    if (validationResult === undefined) {
        return {
            error: createActionResultFromError(
                `Grammar pattern validation did not complete within ${GRAMMAR_VALIDATION_WAIT_MS / 1000} seconds. No patterns were saved.`,
            ),
        };
    }
    if (!validationResult.approved) {
        const suggestions = validationResult.suggestions
            ? ` Suggestions: ${validationResult.suggestions.join("; ")}`
            : "";
        return {
            error: createActionResultFromError(
                `Grammar pattern validation failed: ${(validationResult.errors ?? []).join("; ")}${suggestions}`,
            ),
        };
    }
    if (validationResult.warnings?.length) {
        context.sessionContext.notify(
            AppAgentEvent.Warning,
            `Grammar pattern validation warnings:\n${validationResult.warnings.join("\n")}`,
        );
    }
    if (validationResult.patterns?.length) {
        approvedPatterns = validationResult.patterns;
    }
    return { patterns: approvedPatterns };
}

// ── Sample seeding ──────────────────────────────────────────────────────────

async function seedSampleFlows(store: TaskFlowStore): Promise<number> {
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

        if (store.hasFlow(recipe.name)) continue;
        if (store.isSampleDeleted(recipe.name)) continue;

        await store.saveFlow(recipe, "seed");
        seeded++;
    }

    if (seeded > 0) {
        debug(`Seeded ${seeded} sample flow(s)`);
    }
    return seeded;
}

// ── Action handler ──────────────────────────────────────────────────────────

let _agentStore: TaskFlowStore | undefined;

async function handleTaskFlowAction(
    action: { actionName: string; parameters?: Record<string, unknown> },
    context: ActionContext<TaskFlowAgentContext>,
): Promise<ActionResult> {
    const store = _agentStore;

    switch (action.actionName) {
        case "listTaskFlows": {
            if (!store) {
                return createActionResultFromTextDisplay(
                    "Task flow store not available.",
                );
            }
            const entries = store.listFlows();
            if (entries.length === 0) {
                return createActionResultFromTextDisplay(
                    "No task flows registered.",
                );
            }
            return createStructuredResult(
                [
                    {
                        kind: "heading",
                        level: 3,
                        text: `Task flows (${entries.length})`,
                    },
                    {
                        kind: "table",
                        columns: [
                            { id: "actionName", header: "Task Flow" },
                            { id: "description", header: "Description" },
                            {
                                id: "usageCount",
                                header: "Usage",
                                type: "number",
                                align: "right",
                            },
                            { id: "source", header: "Source" },
                        ],
                        rows: entries.map((e) => [
                            e.actionName,
                            e.description,
                            e.usageCount,
                            e.source === "seed" ? "sample" : "user",
                        ]),
                        sortable: true,
                    },
                ],
                { rawData: entries },
            );
        }

        case "deleteTaskFlow": {
            if (!store) {
                return createActionResultFromError(
                    "Task flow store not available",
                );
            }
            const name = action.parameters?.name as string | undefined;
            if (!name) {
                return createActionResultFromError(
                    "Missing required parameter: name",
                );
            }
            const deleted = await store.deleteFlow(name);
            if (!deleted) {
                return createActionResultFromError(
                    `Task flow not found: ${name}`,
                );
            }
            try {
                await context.sessionContext.reloadAgentSchema();
            } catch (e) {
                debug(`Schema reload after delete: ${e}`);
            }
            return createActionResultFromTextDisplay(
                `Deleted task flow: ${name}`,
            );
        }

        case "createTaskFlow": {
            if (!store) {
                return createActionResultFromError(
                    "Task flow store not available",
                );
            }
            const params = action.parameters as Record<string, unknown>;
            const flowName = params.name as string;
            if (!flowName) {
                return createActionResultFromError(
                    "Missing required parameter: name",
                );
            }
            const script = params.script as string;
            if (!script) {
                return createActionResultFromError(
                    "Missing required parameter: script",
                );
            }
            const description = (params.description as string) ?? "";
            const parametersJson = (params.parameters as string) ?? "[]";
            const grammarPatternsJson =
                (params.grammarPatterns as string) ?? "[]";

            // Check for duplicate name
            if (store.hasFlow(flowName)) {
                return createActionResultFromError(
                    `Task flow '${flowName}' already exists. Use editTaskFlow to modify it.`,
                );
            }

            // Parse parameters and grammar patterns
            let paramDefs: Array<{
                name: string;
                type: "string" | "number" | "boolean";
                required: boolean;
                description: string;
                default?: unknown;
            }>;
            let grammarPatterns: string[];
            try {
                paramDefs = JSON.parse(parametersJson);
            } catch {
                return createActionResultFromError(
                    `Invalid JSON in parameters: ${parametersJson}`,
                );
            }
            try {
                grammarPatterns = JSON.parse(grammarPatternsJson);
            } catch {
                return createActionResultFromError(
                    `Invalid JSON in grammarPatterns: ${grammarPatternsJson}`,
                );
            }

            // Validate script syntax
            const validation = validateTaskFlowScript(
                script,
                paramDefs.map((p) => p.name),
                Object.fromEntries(
                    paramDefs.map((p) => [
                        p.name,
                        {
                            type: p.type,
                            required: p.required,
                            default: p.default,
                            description: p.description,
                        },
                    ]),
                ),
            );
            if (!validation.valid) {
                const errors = validation.errors
                    .filter((e) => e.severity === "error")
                    .map((e) => e.message);
                return createActionResultFromError(
                    `Script validation failed: ${errors.join("; ")}`,
                );
            }

            const grammarValidation = await validateTaskFlowGrammarPatterns(
                flowName,
                description,
                grammarPatterns,
                context,
            );
            if ("error" in grammarValidation) {
                return grammarValidation.error;
            }
            grammarPatterns = grammarValidation.patterns;

            // Create recipe
            const recipe: ScriptRecipe = {
                name: flowName,
                description,
                parameters: paramDefs,
                script,
                grammarPatterns,
            };

            await store.saveFlow(recipe, "reasoning");

            try {
                await context.sessionContext.reloadAgentSchema();
            } catch (e) {
                try {
                    await store.deleteFlow(flowName);
                    await context.sessionContext.reloadAgentSchema();
                } catch (rollbackError) {
                    return createActionResultFromError(
                        `Task flow '${flowName}' activation failed and rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
                    );
                }
                return createActionResultFromError(
                    `Task flow '${flowName}' was not created because its schema could not be activated: ${e instanceof Error ? e.message : String(e)}`,
                );
            }

            return createActionResultFromTextDisplay(
                `Created task flow '${flowName}'. It is now available for use.`,
            );
        }

        case "editTaskFlow": {
            if (!store) {
                return createActionResultFromError(
                    "Task flow store not available",
                );
            }
            const params = action.parameters as Record<string, unknown>;
            const flowName = params.name as string;
            if (!flowName) {
                return createActionResultFromError(
                    "Missing required parameter: name",
                );
            }

            // Check flow exists
            const existingFlow = await store.getFlow(flowName);
            if (!existingFlow) {
                return createActionResultFromError(
                    `Task flow '${flowName}' not found.`,
                );
            }

            const newScript = params.script as string | undefined;
            const newDescription = params.description as string | undefined;
            const newGrammarPatternsJson = params.grammarPatterns as
                | string
                | undefined;
            const newParametersJson = params.parameters as string | undefined;
            const previousGrammarPatterns =
                await store.getGrammarPatterns(flowName);

            // Parse new grammar patterns if provided
            let newGrammarPatterns: string[] | undefined;
            if (newGrammarPatternsJson) {
                try {
                    newGrammarPatterns = JSON.parse(newGrammarPatternsJson);
                } catch {
                    return createActionResultFromError(
                        `Invalid JSON in grammarPatterns: ${newGrammarPatternsJson}`,
                    );
                }
            }

            if (newGrammarPatterns !== undefined) {
                const grammarValidation = await validateTaskFlowGrammarPatterns(
                    flowName,
                    newDescription ?? existingFlow.description,
                    newGrammarPatterns,
                    context,
                );
                if ("error" in grammarValidation) {
                    return grammarValidation.error;
                }
                newGrammarPatterns = grammarValidation.patterns;
            }

            // Parse new parameters if provided
            let newParamDefs:
                | Array<{
                      name: string;
                      type: "string" | "number" | "boolean";
                      required: boolean;
                      description: string;
                      default?: unknown;
                  }>
                | undefined;
            let newParameters:
                | Record<
                      string,
                      {
                          type: "string" | "number" | "boolean";
                          required?: boolean;
                          default?: unknown;
                          description?: string;
                      }
                  >
                | undefined;

            if (newParametersJson) {
                try {
                    newParamDefs = JSON.parse(newParametersJson);
                    // Convert array format to record format
                    newParameters = Object.fromEntries(
                        newParamDefs!.map((p) => [
                            p.name,
                            {
                                type: p.type,
                                required: p.required,
                                default: p.default,
                                description: p.description,
                            },
                        ]),
                    );
                } catch {
                    return createActionResultFromError(
                        `Invalid JSON in parameters: ${newParametersJson}`,
                    );
                }
            }

            // Determine which parameters to use for script validation
            const validationParams = newParameters ?? existingFlow.parameters;

            // Validate new script if provided
            if (newScript) {
                const validation = validateTaskFlowScript(
                    newScript,
                    Object.keys(validationParams),
                    validationParams,
                );
                if (!validation.valid) {
                    const errors = validation.errors
                        .filter((e) => e.severity === "error")
                        .map((e) => e.message);
                    return createActionResultFromError(
                        `Script validation failed: ${errors.join("; ")}`,
                    );
                }
            }

            // Update flow - only include defined properties
            const updates: {
                script?: string;
                description?: string;
                grammarPatterns?: string[];
                parameters?: Record<
                    string,
                    {
                        type: "string" | "number" | "boolean";
                        required?: boolean;
                        default?: unknown;
                        description?: string;
                    }
                >;
            } = {};
            if (newScript !== undefined) updates.script = newScript;
            if (newDescription !== undefined)
                updates.description = newDescription;
            if (newGrammarPatterns !== undefined)
                updates.grammarPatterns = newGrammarPatterns;
            if (newParameters !== undefined) updates.parameters = newParameters;

            await store.updateFlow(flowName, updates);

            try {
                await context.sessionContext.reloadAgentSchema();
            } catch (e) {
                try {
                    await store.updateFlow(flowName, {
                        ...(existingFlow.script === undefined
                            ? {}
                            : { script: existingFlow.script }),
                        description: existingFlow.description,
                        grammarPatterns: previousGrammarPatterns,
                        parameters: existingFlow.parameters,
                    });
                    await context.sessionContext.reloadAgentSchema();
                } catch (rollbackError) {
                    return createActionResultFromError(
                        `Task flow '${flowName}' activation failed and rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
                    );
                }
                return createActionResultFromError(
                    `Task flow '${flowName}' was not updated because its schema could not be activated: ${e instanceof Error ? e.message : String(e)}`,
                );
            }

            return createActionResultFromTextDisplay(
                `Updated task flow '${flowName}'.`,
            );
        }

        case "addTaskFlowPatterns": {
            if (!store) {
                return createActionResultFromError(
                    "Task flow store not available",
                );
            }
            const flowName = action.parameters?.name as string | undefined;
            if (!flowName) {
                return createActionResultFromError(
                    "Missing required parameter: name",
                );
            }
            const flow = await store.getFlow(flowName);
            if (!flow) {
                return createActionResultFromError(
                    `Task flow '${flowName}' not found.`,
                );
            }
            let patterns: unknown;
            const suppliedPatterns = action.parameters?.grammarPatterns;
            if (typeof suppliedPatterns === "string") {
                try {
                    patterns = JSON.parse(suppliedPatterns);
                } catch {
                    return createActionResultFromError(
                        "Invalid JSON in grammarPatterns.",
                    );
                }
            } else {
                patterns = suppliedPatterns;
            }
            const validation = await validateTaskFlowGrammarPatterns(
                flowName,
                flow.description,
                patterns,
                context,
            );
            if ("error" in validation) {
                return validation.error;
            }

            const previousPatterns = await store.getGrammarPatterns(flowName);
            const added = await store.addGrammarPatterns(
                flowName,
                validation.patterns,
            );
            if (added > 0) {
                try {
                    await context.sessionContext.reloadAgentSchema();
                } catch (error) {
                    try {
                        await store.replaceGrammarPatterns(
                            flowName,
                            previousPatterns,
                        );
                        await context.sessionContext.reloadAgentSchema();
                    } catch (rollbackError) {
                        return createActionResultFromError(
                            `The TaskFlow grammar update failed and rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
                        );
                    }
                    return createActionResultFromError(
                        `No patterns were added because the updated TaskFlow grammar could not be activated: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }
            return createActionResultFromTextDisplay(
                added > 0
                    ? `Added ${added} grammar pattern(s) to task flow '${flowName}'.`
                    : `Task flow '${flowName}' already contains those grammar patterns.`,
            );
        }

        default: {
            // Dynamic flow execution — grammar routes directly to flow name
            if (!store) {
                return createActionResultFromError(
                    `Unknown action '${action.actionName}'`,
                );
            }

            const flow = await store.getFlow(action.actionName);
            if (!flow) {
                return createActionResultFromError(
                    `Unknown task flow '${action.actionName}'. Use 'list my task flows' to see available flows.`,
                );
            }

            const result = await executeFlow(
                flow,
                action.parameters ?? {},
                context,
            );
            if (result.error === undefined) {
                await store.recordUsage(action.actionName);
            }
            return result;
        }
    }
}

// ── Flow execution ──────────────────────────────────────────────────────────

async function executeFlow(
    flowDef: TaskFlowDefinition,
    flowParams: Record<string, unknown>,
    context: ActionContext<any>,
): Promise<ActionResult> {
    // Apply parameter defaults
    for (const [name, def] of Object.entries(flowDef.parameters)) {
        if (!(name in flowParams) && def.default !== undefined) {
            flowParams[name] = def.default;
        }
    }

    if (!flowDef.script) {
        return createActionResultFromError(
            `Flow '${flowDef.name}' has no script.`,
        );
    }

    // Validate TypeScript script
    const validation = validateTaskFlowScript(
        flowDef.script,
        Object.keys(flowDef.parameters),
        flowDef.parameters,
    );
    if (!validation.valid) {
        const errors = validation.errors
            .filter((e) => e.severity === "error")
            .map((e) => e.message);
        return createActionResultFromError(
            `Script validation failed for '${flowDef.name}': ${errors.join("; ")}`,
        );
    }

    // Transpile TypeScript to JavaScript for execution
    const jsScript = transpileScript(flowDef.script);

    // Build API and execute
    const api = new TaskFlowScriptAPIImpl(context);

    try {
        const result = await executeTaskFlowScript(jsScript, api, flowParams);

        if (result.success) {
            return createActionResultFromTextDisplay(
                result.message ?? "Flow completed",
            );
        } else {
            return createActionResultFromError(
                result.error ?? "Script execution failed",
            );
        }
    } catch (err) {
        return createActionResultFromError(
            `Flow execution failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

// ── Instantiate ─────────────────────────────────────────────────────────────

// Built-in management actions in the "taskflow" schema. Everything else is a
// dynamic, user-created flow.
const TASKFLOW_BUILTIN_ACTIONS = new Set([
    "listTaskFlows",
    "deleteTaskFlow",
    "createTaskFlow",
    "editTaskFlow",
    "addTaskFlowPatterns",
]);

export function instantiate(): AppAgent {
    const agentContext: TaskFlowAgentContext = {};

    return {
        async initializeAgentContext() {
            return agentContext;
        },

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

            const store = new TaskFlowStore(instanceStorage);
            await store.initialize();
            agentContext.store = store;
            _agentStore = store;

            await seedSampleFlows(store);
            debug(`Store initialized with ${store.listFlows().length} flow(s)`);
        },

        executeAction(action, context: ActionContext<TaskFlowAgentContext>) {
            return handleTaskFlowAction(
                action as {
                    actionName: string;
                    parameters?: Record<string, unknown>;
                },
                context,
            );
        },

        async validateWildcardMatch(
            action: AppAction,
            _context: SessionContext,
        ): Promise<boolean> {
            // Built-in management actions are always valid; a dynamic flow
            // action is valid only if its flow still exists, so stale cached
            // constructions for a deleted flow are rejected rather than
            // resolving to a now-missing action.
            if (TASKFLOW_BUILTIN_ACTIONS.has(action.actionName)) return true;
            if (!_agentStore) return true;
            return (await _agentStore.getFlow(action.actionName)) !== null;
        },

        async getDynamicSchema(
            _context: SessionContext,
            _schemaName: string,
        ): Promise<SchemaContent | undefined> {
            if (!_agentStore) return undefined;
            return {
                format: "ts",
                content: _agentStore.generateDynamicSchemaText(),
                cacheBinding: await _agentStore.getActionCacheBinding(),
            };
        },

        async getDynamicGrammar(
            _context: SessionContext,
            _schemaName: string,
        ): Promise<GrammarContent | undefined> {
            if (!_agentStore) return undefined;
            const text = _agentStore.getDynamicGrammarText();
            if (!text) return undefined;
            return { format: "agr", content: text };
        },
    };
}
