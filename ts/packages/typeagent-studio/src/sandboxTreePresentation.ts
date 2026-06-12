// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    HealthStatus,
    SandboxAgentInfo,
    SandboxStatus,
} from "@typeagent/core/sandbox";
import type { SandboxState } from "@typeagent/core/events";

/**
 * Pure, vscode-free mapping from sandbox status to tree-node descriptors.
 *
 * The VS Code `TreeDataProvider` is a thin adapter over these descriptors so
 * the labelling/structuring logic can be unit-tested without the editor host
 * (mirrors the `onboardingPresentation.ts` pattern).
 */

export type SandboxTreeNodeKind = "sandbox" | "agent" | "empty";

export interface SandboxTreeNode {
    kind: SandboxTreeNodeKind;
    /** Stable identifier, unique across the whole tree. */
    id: string;
    label: string;
    description?: string;
    tooltip?: string;
    /** Drives `when` clauses for context-menu contributions. */
    contextValue?: string;
    /** Present on `sandbox` and `agent` nodes. */
    sandboxId?: string;
    /** Present on `agent` nodes. */
    agentName?: string;
    state?: SandboxState;
    health?: HealthStatus;
    /** Whether the node should render as expandable. */
    hasChildren: boolean;
}

const EMPTY_ROOT_ID = "sandbox:empty";
const DISCONNECTED_ROOT_ID = "sandbox:disconnected";

/**
 * The Sandbox view reads only through the studio service channel (no in-process
 * fallback). When disconnected, show a single explanatory row instead of an
 * empty/“no sandboxes” state (which would wrongly imply none exist).
 */
export function buildSandboxDisconnectedNodes(): SandboxTreeNode[] {
    return [
        {
            kind: "empty",
            id: DISCONNECTED_ROOT_ID,
            label: "Studio service not connected",
            description: "start the agent-server",
            tooltip:
                "Sandboxes run in the studio agent. Start an agent-server with the studio agent enabled; the view connects automatically.",
            hasChildren: false,
        },
    ];
}

/** Build the top-level rows: one node per sandbox, or a single placeholder. */
export function buildSandboxRootNodes(
    sandboxes: readonly SandboxStatus[],
): SandboxTreeNode[] {
    if (sandboxes.length === 0) {
        return [
            {
                kind: "empty",
                id: EMPTY_ROOT_ID,
                label: "No sandboxes running",
                description: "Start one to begin",
                tooltip: "Use “TypeAgent Studio: Start sandbox” to create one.",
                hasChildren: false,
            },
        ];
    }

    return [...sandboxes]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(toSandboxNode);
}

/** Build the agent rows beneath a single sandbox. */
export function buildSandboxAgentNodes(
    sandbox: SandboxStatus,
): SandboxTreeNode[] {
    if (sandbox.agents.length === 0) {
        return [
            {
                kind: "empty",
                id: `${sandbox.id}:agents:empty`,
                label: "No agents loaded",
                sandboxId: sandbox.id,
                hasChildren: false,
            },
        ];
    }

    return [...sandbox.agents]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((agent) => toAgentNode(sandbox.id, agent));
}

function toSandboxNode(sandbox: SandboxStatus): SandboxTreeNode {
    const agentCount = sandbox.agents.length;
    const descriptionParts = [
        formatSandboxState(sandbox.state),
        `${agentCount} agent${agentCount === 1 ? "" : "s"}`,
    ];
    if (sandbox.mode !== "inmemory") {
        descriptionParts.push(sandbox.mode);
    }

    return {
        kind: "sandbox",
        id: `sandbox:${sandbox.id}`,
        label: sandbox.id,
        description: descriptionParts.join(" · "),
        tooltip: buildSandboxTooltip(sandbox),
        contextValue: `sandbox.${sandbox.state}`,
        sandboxId: sandbox.id,
        state: sandbox.state,
        hasChildren: true,
    };
}

function toAgentNode(
    sandboxId: string,
    agent: SandboxAgentInfo,
): SandboxTreeNode {
    const fingerprint = formatHashFingerprint(agent.schemaHash);
    const health = formatHealth(agent.health);
    return {
        kind: "agent",
        id: `agent:${sandboxId}:${agent.name}`,
        label: agent.name,
        description: fingerprint ? `${health} \u00b7 ${fingerprint}` : health,
        tooltip: buildAgentTooltip(agent),
        contextValue: "sandboxAgent",
        sandboxId,
        agentName: agent.name,
        health: agent.health,
        hasChildren: false,
    };
}

export function formatSandboxState(state: SandboxState): string {
    switch (state) {
        case "starting":
            return "Starting";
        case "running":
            return "Running";
        case "stopping":
            return "Stopping";
        case "stopped":
            return "Stopped";
        case "crashed":
            return "Crashed";
        default:
            return state;
    }
}

export function formatHealth(health: HealthStatus): string {
    switch (health) {
        case "healthy":
            return "healthy";
        case "warning":
            return "warning";
        case "error":
            return "error";
        case "unknown":
        default:
            return "unknown";
    }
}

function buildSandboxTooltip(sandbox: SandboxStatus): string {
    const lines = [
        `Sandbox: ${sandbox.id}`,
        `Mode: ${sandbox.mode}`,
        `State: ${formatSandboxState(sandbox.state)}`,
        `Agents: ${sandbox.agents.length}`,
    ];
    if (sandbox.pid !== undefined) {
        lines.push(`PID: ${sandbox.pid}`);
    }
    if (sandbox.startedAt !== undefined) {
        lines.push(`Started: ${new Date(sandbox.startedAt).toISOString()}`);
    }
    return lines.join("\n");
}

function buildAgentTooltip(agent: SandboxAgentInfo): string {
    const lines = [
        `Agent: ${agent.name}`,
        `Health: ${formatHealth(agent.health)}`,
        `Schema: ${formatHashFull(agent.schemaHash)}`,
        `Grammar: ${formatHashFull(agent.grammarHash)}`,
    ];
    if (agent.sourcePath) {
        lines.push(`Source: ${agent.sourcePath}`);
    }
    if (agent.loadedAt !== undefined) {
        lines.push(`Loaded: ${new Date(agent.loadedAt).toISOString()}`);
    }
    return lines.join("\n");
}

/**
 * Short, glanceable fingerprint for a content hash, shown next to health in the
 * agent row. Returns `undefined` for the sentinel/empty values used when an
 * agent has no schema/grammar on disk, so callers can omit the suffix.
 */
export function formatHashFingerprint(hash: string): string | undefined {
    if (!isRealHash(hash)) {
        return undefined;
    }
    return hash.length > 12 ? hash.slice(0, 12) : hash;
}

/** Tooltip rendering of a hash: full value, or a readable sentinel label. */
function formatHashFull(hash: string): string {
    if (hash === "none") {
        return "(none on disk)";
    }
    if (hash === "stub" || hash.trim().length === 0) {
        return "(unavailable)";
    }
    return hash;
}

function isRealHash(hash: string): boolean {
    return hash !== "none" && hash !== "stub" && hash.trim().length > 0;
}
