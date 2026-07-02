// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    HealthStatus,
    SandboxAgentInfo,
    SandboxStatus,
} from "@typeagent/core/sandbox";
import type { SandboxState } from "@typeagent/core/events";
import {
    noteTooltip,
    type TooltipField,
    type TooltipModel,
} from "./tooltipModel.js";

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
    tooltip?: TooltipModel;
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
                tooltip: noteTooltip(
                    "Use \u201cTypeAgent Studio: Start sandbox\u201d to create one.",
                ),
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
    return {
        kind: "agent",
        id: `agent:${sandboxId}:${agent.name}`,
        label: agent.name,
        // Health is conveyed by the row icon's colour, so the description carries
        // just the schema fingerprint (when the agent has one on disk).
        description: fingerprint,
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

function buildSandboxTooltip(sandbox: SandboxStatus): TooltipModel {
    const fields: TooltipField[] = [
        { label: "Sandbox", value: sandbox.id, mono: true },
        { label: "Mode", value: sandbox.mode },
        { label: "State", value: formatSandboxState(sandbox.state) },
        { label: "Agents", value: String(sandbox.agents.length) },
    ];
    if (sandbox.pid !== undefined) {
        fields.push({ label: "PID", value: String(sandbox.pid), mono: true });
    }
    if (sandbox.startedAt !== undefined) {
        fields.push({
            label: "Started",
            value: new Date(sandbox.startedAt).toISOString(),
        });
    }
    return { fields };
}

function buildAgentTooltip(agent: SandboxAgentInfo): TooltipModel {
    const fields: TooltipField[] = [
        { label: "Agent", value: agent.name },
        { label: "Health", value: formatHealth(agent.health) },
        {
            label: "Schema",
            value: formatHashFull(agent.schemaHash),
            mono: true,
        },
        {
            label: "Grammar",
            value: formatHashFull(agent.grammarHash),
            mono: true,
        },
    ];
    if (agent.sourcePath) {
        fields.push({ label: "Source", value: agent.sourcePath, mono: true });
    }
    if (agent.loadedAt !== undefined) {
        fields.push({
            label: "Loaded",
            value: new Date(agent.loadedAt).toISOString(),
        });
    }
    return { fields };
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
