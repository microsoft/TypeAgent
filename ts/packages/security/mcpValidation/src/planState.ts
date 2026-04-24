// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// ═══════════════════════════════════════════════════════════════════════════
// planState.ts - Plan execution state management
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import type {
    AgentPlan,
    ExecutionTrace,
    TraceEntry,
    OrgPolicy,
    PlanStep,
    Tool,
} from "validation";

export interface PlanState {
    plan: AgentPlan | null;
    policy: OrgPolicy | null;
    flatSteps: PlanStep[];
    currentStep: number;
    completedSteps: Set<number>;
    bindings: Map<string, unknown>;
    aborted: boolean;
    abortReason?: string;
    trace: ExecutionTrace | null;
}

export function createPlanState(policy?: OrgPolicy): PlanState {
    return {
        plan: null,
        policy: policy ?? null,
        flatSteps: [],
        currentStep: 0,
        completedSteps: new Set(),
        bindings: new Map(),
        aborted: false,
        trace: null,
    };
}

export function resetState(state: PlanState): void {
    state.plan = null;
    state.flatSteps = [];
    state.currentStep = 0;
    state.completedSteps.clear();
    state.bindings.clear();
    state.aborted = false;
    delete state.abortReason;
    state.trace = null;
}

/** Initialize a new trace when a plan is activated. */
export function initTrace(state: PlanState): void {
    if (!state.plan) return;
    state.trace = {
        planId: state.plan.id,
        planVersion: state.plan.version,
        startedAt: Date.now(),
        status: "running",
        entries: [],
        finalBindings: {},
        metrics: {},
    };
}

/** Append a hash-chained trace entry after a step executes. */
export function appendTraceEntry(
    state: PlanState,
    stepIndex: number,
    tool: Tool,
    input: Record<string, unknown>,
    output: unknown,
    durationMs: number,
    status: TraceEntry["status"],
    error?: string,
): void {
    if (!state.trace) return;

    const previousHash =
        state.trace.entries.length > 0
            ? state.trace.entries[state.trace.entries.length - 1].hash
            : "0000000000000000000000000000000000000000000000000000000000000000";

    const entryData = JSON.stringify({
        previousHash,
        stepIndex,
        tool,
        input,
        output: typeof output === "string" ? output.slice(0, 1000) : output,
        durationMs,
        status,
        error,
    });

    const hash = createHash("sha256").update(entryData).digest("hex");

    const entry: TraceEntry = {
        index: state.trace.entries.length,
        timestamp: Date.now(),
        previousHash,
        hash,
        stepIndex,
        nodeType: "step",
        tool,
        input,
        output: typeof output === "string" ? output.slice(0, 500) : output,
        durationMs,
        status,
    };
    if (error !== undefined) entry.error = error;
    state.trace.entries.push(entry);
}

/** Finalize the trace when the plan completes or aborts. */
export function finalizeTrace(state: PlanState): void {
    if (!state.trace) return;
    state.trace.completedAt = Date.now();
    state.trace.status = state.aborted ? "aborted" : "completed";
    state.trace.finalBindings = Object.fromEntries(state.bindings);
    state.trace.metrics = {
        totalSteps: state.trace.entries.length,
        durationMs: state.trace.completedAt - state.trace.startedAt,
        successCount: state.trace.entries.filter((e) => e.status === "success")
            .length,
        failedCount: state.trace.entries.filter((e) => e.status === "failed")
            .length,
    };
}

export function abortPlan(state: PlanState, reason: string): void {
    state.aborted = true;
    state.abortReason = reason;
}

/** Map from MCP tool name to plan Tool name */
export const TOOL_NAME_MAP: Record<string, Tool> = {
    validated_read: "Read",
    validated_write: "Write",
    validated_edit: "Edit",
    validated_glob: "Glob",
    validated_grep: "Grep",
    validated_bash: "Bash",
    validated_npm: "Npm",
    validated_git: "Git",
    validated_node: "Node",
    validated_tsc: "Tsc",
};
