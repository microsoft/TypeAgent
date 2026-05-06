// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
    AppAgent,
    ActionContext,
    SessionContext,
    ActionResult,
    DisplayType,
} from "@typeagent/agent-sdk";
import {
    WorkflowEngine,
    TaskRegistry,
    allBuiltinTasks,
    RunResult,
    WorkflowEvent,
} from "workflow-engine";
import { WorkflowIR } from "workflow-model";
import { discoverWorkflows } from "./workflowDiscovery.js";
import { generateDynamicSchemaText } from "./generateSchema.js";

// ---- Agent context ----

interface WorkflowAgentContext {
    engine: WorkflowEngine;
    registry: TaskRegistry;
    workflows: Map<string, WorkflowIR>;
    workflowDir: string;
    /** Active run progress keyed by dynamicDisplayId. */
    activeRuns: Map<string, RunProgress>;
}

interface RunProgress {
    events: string[];
    done: boolean;
    result?: RunResult;
}

// ---- Module state ----

let agentContext: WorkflowAgentContext | undefined;

// ---- Helpers ----

function getWorkflowDir(): string {
    const thisFile = fileURLToPath(import.meta.url);
    const thisDir = dirname(thisFile);
    // From dist/ -> ../workflows/
    return join(thisDir, "..", "..", "workflows");
}

function formatRunResult(result: RunResult): string {
    if (result.success) {
        const output =
            result.output !== undefined
                ? "```\n" +
                  (typeof result.output === "string"
                      ? result.output
                      : JSON.stringify(result.output, null, 2)) +
                  "\n```"
                : "_No output._";
        return `**Workflow completed successfully.**\n\n${output}`;
    }
    const err = result.error;
    const loc = err?.nodeId ? ` (node: \`${err.nodeId}\`)` : "";
    return `**Workflow failed${loc}:**\n\n${err?.message ?? "Unknown error"}`;
}

function formatProgress(progress: RunProgress): string {
    const lines = progress.events.slice(-20); // last 20 events
    if (progress.done && progress.result) {
        return formatRunResult(progress.result);
    }
    if (lines.length === 0) {
        return "_Starting workflow..._";
    }
    return lines.join("\n");
}

// ---- Action handler ----

async function executeWorkflowAction(
    action: { actionName: string; parameters?: Record<string, unknown> },
    context: ActionContext<WorkflowAgentContext>,
): Promise<ActionResult | undefined> {
    const ctx = context.sessionContext.agentContext;
    const ir = ctx.workflows.get(action.actionName);
    if (!ir) {
        return {
            error: `Unknown workflow '${action.actionName}'. Available: ${[...ctx.workflows.keys()].join(", ")}`,
            fallbackToReasoning: true,
        };
    }

    // Create progress tracker
    const displayId = `wf-${Date.now()}`;
    const progress: RunProgress = { events: [], done: false };
    ctx.activeRuns.set(displayId, progress);

    // Event listener for progress
    const listener = (event: WorkflowEvent) => {
        switch (event.type) {
            case "nodeStarted":
                progress.events.push(`⏳ Running: **${event.nodeId}**`);
                break;
            case "nodeCompleted":
                progress.events.push(`✓ Completed: **${event.nodeId}**`);
                break;
            case "nodeFailed":
                progress.events.push(
                    `✗ Error in **${event.nodeId}**: ${event.error.message}`,
                );
                break;
        }
    };
    ctx.engine.on(listener);

    try {
        const runOptions: import("workflow-engine").RunOptions = {
            input: action.parameters ?? {},
            policy: {}, // all side-effecting tasks default to "prompt"
            approve: async (taskName, _resolvedInputs) => {
                const choice = await context.sessionContext.popupQuestion(
                    `Workflow wants to run **${taskName}**. Allow?`,
                    ["Allow", "Deny"],
                );
                return choice === 0;
            },
        };
        if (context.abortSignal) {
            runOptions.signal = context.abortSignal;
        }
        const result = await ctx.engine.run(ir, runOptions);

        progress.done = true;
        progress.result = result;

        return {
            displayContent: {
                type: "markdown",
                content: formatRunResult(result),
            },
            entities: [],
            dynamicDisplayId: displayId,
            dynamicDisplayNextRefreshMs: -1,
        };
    } catch (err: unknown) {
        progress.done = true;
        const msg = err instanceof Error ? err.message : String(err);
        return { error: `Workflow execution failed: ${msg}` };
    } finally {
        ctx.engine.off(listener);
    }
}

// ---- Export: instantiate ----

export function instantiate(): AppAgent {
    return {
        async initializeAgentContext() {
            const registry = new TaskRegistry();
            for (const def of allBuiltinTasks) {
                registry.register(def);
            }
            const engine = new WorkflowEngine(registry);
            agentContext = {
                engine,
                registry,
                workflows: new Map(),
                workflowDir: getWorkflowDir(),
                activeRuns: new Map(),
            };
            return agentContext;
        },

        async updateAgentContext(
            enable: boolean,
            context: SessionContext,
            _schemaName: string,
        ) {
            if (!agentContext) return;
            if (enable) {
                agentContext.workflows = await discoverWorkflows(
                    agentContext.workflowDir,
                    agentContext.registry.all(),
                );
                await context.reloadAgentSchema();
            }
        },

        async getDynamicSchema(_context: SessionContext, _schemaName: string) {
            if (!agentContext) return undefined;
            return {
                format: "ts" as const,
                content: generateDynamicSchemaText(agentContext.workflows),
            };
        },

        async getDynamicDisplay(
            _type: DisplayType,
            displayId: string,
            _context: SessionContext,
        ) {
            const progress = agentContext?.activeRuns.get(displayId);
            if (!progress) {
                return {
                    content: "No active workflow run.",
                    nextRefreshMs: -1,
                };
            }
            return {
                content: {
                    type: "markdown" as const,
                    content: formatProgress(progress),
                },
                nextRefreshMs: progress.done ? -1 : 500,
            };
        },

        executeAction: executeWorkflowAction as AppAgent["executeAction"],
    } as AppAgent;
}
