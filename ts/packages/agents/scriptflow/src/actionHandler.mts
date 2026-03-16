// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type AppAgent,
    type SessionContext,
    type ActionContext,
    type ActionResult,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ScriptFlowStore } from "./store/scriptFlowStore.mjs";
import type { ScriptFlowDefinition } from "./store/scriptFlowStore.mjs";
import type { ScriptRecipe } from "./types/scriptRecipe.js";
import {
    executeScript,
    type ScriptExecutionRequest,
} from "./execution/powershellRunner.mjs";
import { globalAgentGrammarRegistry } from "action-grammar";
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

function registerAllGrammars(store: ScriptFlowStore): void {
    const allRules = store.getAllGrammarRules();
    if (!allRules) return;

    const result = globalAgentGrammarRegistry.addGeneratedRules(
        "scriptflow",
        allRules,
    );
    if (result.success) {
        debug("Registered scriptflow grammar rules");
    } else {
        debug("Failed to register grammar rules:", result.errors);
    }
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

    const errorMsg = result.stderr || `Script exited with code ${result.exitCode}`;
    return createActionResultFromError(errorMsg);
}

async function handleScriptFlowAction(
    action: { actionName: string; parameters?: Record<string, unknown> },
    context: ActionContext<ScriptFlowAgentContext>,
): Promise<ActionResult> {
    const flowStore = (context as any).__store as
        | ScriptFlowStore
        | undefined;

    switch (action.actionName) {
        case "listScriptFlows": {
            if (!flowStore) {
                const manifestPath = join(__dirname, "..", "manifest.json");
                const manifest = JSON.parse(
                    readFileSync(manifestPath, "utf8"),
                );
                const flows = Object.keys(manifest.flows ?? {});
                return createActionResultFromTextDisplay(
                    `Script flows (from manifest):\n${flows.map((f) => `  - ${f}`).join("\n") || "  (none)"}`,
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
            // Re-register remaining grammars
            const agent =
                globalAgentGrammarRegistry.getAgent("scriptflow");
            if (agent) agent.resetToBase();
            registerAllGrammars(flowStore);
            return createActionResultFromTextDisplay(
                `Deleted script flow: ${name}`,
            );
        }

        default: {
            // Try to execute as a dynamic script flow
            if (!flowStore) {
                return createActionResultFromError(
                    `Unknown action '${action.actionName}'`,
                );
            }

            const flow = await flowStore.getFlow(action.actionName);
            if (!flow) {
                return createActionResultFromError(
                    `Unknown script flow '${action.actionName}'. Use 'list script flows' to see available flows.`,
                );
            }

            const script = await flowStore.getScript(action.actionName);
            if (!script) {
                return createActionResultFromError(
                    `Script not found for flow: ${action.actionName}`,
                );
            }

            const result = await executeFlowScript(
                flow,
                script,
                action.parameters ?? {},
            );

            await flowStore.recordUsage(action.actionName);
            return result;
        }
    }
}

export function instantiate(): AppAgent {
    let agentContext: ScriptFlowAgentContext = {};

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

            const store = new ScriptFlowStore(instanceStorage);
            await store.initialize();
            agentContext.store = store;

            await seedSampleFlows(store);
            registerAllGrammars(store);
        },

        executeAction(action, context: ActionContext<ScriptFlowAgentContext>) {
            // Attach store to context for the handler
            (context as any).__store = agentContext.store;
            return handleScriptFlowAction(
                action as {
                    actionName: string;
                    parameters?: Record<string, unknown>;
                },
                context,
            );
        },
    };
}
