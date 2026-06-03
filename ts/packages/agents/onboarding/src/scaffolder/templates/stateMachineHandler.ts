// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: state-machine — multi-phase disk-persisted workflow.
// State is stored in ~/.typeagent/__agentName__/<workflowId>/state.json.
// Each phase must be approved before the next begins.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromMarkdownDisplay } from "@typeagent/agent-sdk/helpers/action";
import { __AgentName__Actions } from "./__agentName__Schema.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

const STATE_ROOT = path.join(os.homedir(), ".typeagent", "__agentName__");

// ---- State types -------------------------------------------------------

type PhaseStatus = "pending" | "in-progress" | "approved";

type WorkflowState = {
    workflowId: string;
    currentPhase: string;
    phases: Record<string, { status: PhaseStatus; updatedAt: string }>;
    config: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};

// ---- State I/O ---------------------------------------------------------

async function loadState(
    workflowId: string,
): Promise<WorkflowState | undefined> {
    const statePath = path.join(STATE_ROOT, workflowId, "state.json");
    try {
        return JSON.parse(
            await fs.readFile(statePath, "utf-8"),
        ) as WorkflowState;
    } catch {
        return undefined;
    }
}

async function saveState(state: WorkflowState): Promise<void> {
    const stateDir = path.join(STATE_ROOT, state.workflowId);
    await fs.mkdir(stateDir, { recursive: true });
    state.updatedAt = new Date().toISOString();
    await fs.writeFile(
        path.join(stateDir, "state.json"),
        JSON.stringify(state, null, 2),
        "utf-8",
    );
}

// ---- Agent lifecycle ---------------------------------------------------

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<unknown> {
    await fs.mkdir(STATE_ROOT, { recursive: true });
    return {};
}

async function executeAction(
    action: TypeAgentAction<__AgentName__Actions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    // TODO: map actions to phase handlers, e.g.:
    // case "startWorkflow":  return handleStart(action.parameters.workflowId);
    // case "runPhaseOne":    return handlePhaseOne(action.parameters.workflowId);
    // case "approvePhase":   return handleApprove(action.parameters.workflowId, action.parameters.phase);
    // case "getStatus":      return handleStatus(action.parameters.workflowId);
    return createActionResultFromMarkdownDisplay(
        `Executing ${action.actionName} — not yet implemented.`,
    );
}
