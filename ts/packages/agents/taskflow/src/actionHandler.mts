// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type AppAgent,
    type ActionContext,
    type ActionResult,
    type SessionContext,
    type SchemaContent,
    type GrammarContent,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromError,
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
import { validateTaskFlowScript } from "./script/taskFlowScriptValidator.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:taskflow:handler");
const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, "..", "samples");

// ── Agent context ───────────────────────────────────────────────────────────

interface TaskFlowAgentContext {
    store?: TaskFlowStore | undefined;
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
            const lines = entries.map(
                (e) =>
                    `  \u2022 ${e.actionName}: ${e.description} [usage: ${e.usageCount}]${e.source === "seed" ? " (sample)" : ""}`,
            );
            return createActionResultFromTextDisplay(
                `Task flows (${entries.length}):\n${lines.join("\n")}`,
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
            await store.recordUsage(action.actionName);
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

    // Validate script
    const validation = validateTaskFlowScript(
        flowDef.script,
        Object.keys(flowDef.parameters),
    );
    if (!validation.valid) {
        const errors = validation.errors
            .filter((e) => e.severity === "error")
            .map((e) => e.message);
        return createActionResultFromError(
            `Script validation failed for '${flowDef.name}': ${errors.join("; ")}`,
        );
    }

    // Build API and execute
    const api = new TaskFlowScriptAPIImpl(context);

    try {
        const result = await executeTaskFlowScript(
            flowDef.script,
            api,
            flowParams,
        );

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

export function instantiate(): AppAgent {
    let agentContext: TaskFlowAgentContext = {};

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

        async getDynamicSchema(
            _context: SessionContext,
            _schemaName: string,
        ): Promise<SchemaContent | undefined> {
            if (!_agentStore) return undefined;
            return {
                format: "ts",
                content: _agentStore.generateDynamicSchemaText(),
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
