// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { EventStream } from "../events/eventStream.js";
import type { ReasoningStepEvent, StudioEvent } from "../events/types.js";

export interface ReasoningTraceRow {
    ts: number;
    requestId?: string;
    runId?: string;
    sandboxId: string;
    stepName: string;
    payload?: unknown;
}

export interface WorkflowNode {
    id: string;
    label: string;
    status?: string;
}

export interface WorkflowEdge {
    from: string;
    to: string;
}

export interface WorkflowViewModel {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
}

export async function loadReasoningTrace(
    stream: EventStream,
    requestId: string,
): Promise<ReasoningTraceRow[]> {
    const out: ReasoningTraceRow[] = [];
    for await (const event of stream.query({
        filter: { types: ["reasoning.step"], requestIds: [requestId] },
    })) {
        const step = event as ReasoningStepEvent;
        out.push({
            ts: step.ts,
            sandboxId: step.sandboxId,
            stepName: step.stepName,
            ...(step.requestId !== undefined
                ? { requestId: step.requestId }
                : {}),
            ...(step.runId !== undefined ? { runId: step.runId } : {}),
            ...(step.payload !== undefined ? { payload: step.payload } : {}),
        });
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
}

/**
 * F0.9/F0.10 read-only renderer model.
 *
 * If payloads include explicit workflow metadata (`workflow.stepId`,
 * `workflow.parentStepId`), use that graph. Otherwise derive a simple linear
 * chain from reasoning step order.
 */
export function buildWorkflowViewModel(
    steps: ReasoningTraceRow[],
): WorkflowViewModel {
    const nodes: WorkflowNode[] = [];
    const edges: WorkflowEdge[] = [];
    const byId = new Map<string, WorkflowNode>();

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const wf = extractWorkflow(step.payload);
        const id = wf?.stepId ?? `step-${i + 1}`;
        if (!byId.has(id)) {
            const node: WorkflowNode = {
                id,
                label: wf?.title ?? step.stepName,
                ...(wf?.status !== undefined ? { status: wf.status } : {}),
            };
            byId.set(id, node);
            nodes.push(node);
        }
        const parent = wf?.parentStepId;
        if (parent) {
            edges.push({ from: parent, to: id });
        } else if (!wf && i > 0) {
            edges.push({ from: `step-${i}`, to: id });
        }
    }

    return { nodes, edges };
}

function extractWorkflow(payload: unknown):
    | {
          stepId: string;
          parentStepId?: string;
          title?: string;
          status?: string;
      }
    | undefined {
    if (!payload || typeof payload !== "object") {
        return undefined;
    }
    const obj = payload as {
        workflow?: {
            stepId?: unknown;
            parentStepId?: unknown;
            title?: unknown;
            status?: unknown;
        };
    };
    const w = obj.workflow;
    if (!w || typeof w.stepId !== "string") {
        return undefined;
    }
    return {
        stepId: w.stepId,
        ...(typeof w.parentStepId === "string"
            ? { parentStepId: w.parentStepId }
            : {}),
        ...(typeof w.title === "string" ? { title: w.title } : {}),
        ...(typeof w.status === "string" ? { status: w.status } : {}),
    };
}

export function isReasoningStepEvent(
    event: StudioEvent,
): event is ReasoningStepEvent {
    return event.type === "reasoning.step";
}
