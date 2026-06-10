// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { HealthStatus, SandboxStatus } from "@typeagent/core/sandbox";

/**
 * Pure, vscode-free summarization of agent health across running sandboxes
 * into a single status-bar descriptor. The status-bar item is a thin adapter
 * over this descriptor so the aggregation/labelling can be unit-tested without
 * the editor host (mirrors `sandboxTreePresentation.ts`).
 */

export type HealthSummaryLevel =
    | "none"
    | "healthy"
    | "unknown"
    | "warning"
    | "error";

export interface HealthStatusSummary {
    level: HealthSummaryLevel;
    /** Status-bar text (without the leading icon). */
    label: string;
    /** Codicon id (no `$()` wrapper). */
    icon: string;
    tooltip: string;
    agentsTotal: number;
    sandboxesTotal: number;
    counts: Record<HealthStatus, number>;
}

/** Severity ranking; a higher number dominates the summary. */
const HEALTH_RANK: Record<HealthStatus, number> = {
    healthy: 0,
    unknown: 1,
    warning: 2,
    error: 3,
};

const HEALTH_ORDER: HealthStatus[] = ["healthy", "unknown", "warning", "error"];

export function summarizeAgentHealth(
    sandboxes: readonly SandboxStatus[],
): HealthStatusSummary {
    const counts: Record<HealthStatus, number> = {
        healthy: 0,
        warning: 0,
        error: 0,
        unknown: 0,
    };

    let agentsTotal = 0;
    let worst: HealthStatus | undefined;
    for (const sandbox of sandboxes) {
        for (const agent of sandbox.agents) {
            counts[agent.health] += 1;
            agentsTotal += 1;
            if (
                worst === undefined ||
                HEALTH_RANK[agent.health] > HEALTH_RANK[worst]
            ) {
                worst = agent.health;
            }
        }
    }

    if (agentsTotal === 0 || worst === undefined) {
        return {
            level: "none",
            label: "Studio: no agents",
            icon: "circle-slash",
            tooltip: sandboxes.length
                ? "No agents loaded across running sandboxes."
                : "No sandboxes running.",
            agentsTotal: 0,
            sandboxesTotal: sandboxes.length,
            counts,
        };
    }

    return {
        level: levelForHealth(worst),
        label: labelForHealth(worst, counts),
        icon: iconForHealth(worst),
        tooltip: buildTooltip(sandboxes.length, agentsTotal, counts),
        agentsTotal,
        sandboxesTotal: sandboxes.length,
        counts,
    };
}

function levelForHealth(health: HealthStatus): HealthSummaryLevel {
    return health;
}

function labelForHealth(
    health: HealthStatus,
    counts: Record<HealthStatus, number>,
): string {
    switch (health) {
        case "error":
            return `Studio: ${counts.error} error${counts.error === 1 ? "" : "s"}`;
        case "warning":
            return `Studio: ${counts.warning} warning${counts.warning === 1 ? "" : "s"}`;
        case "unknown":
            return "Studio: health unknown";
        case "healthy":
        default:
            return "Studio: healthy";
    }
}

function iconForHealth(health: HealthStatus): string {
    switch (health) {
        case "error":
            return "error";
        case "warning":
            return "warning";
        case "unknown":
            return "question";
        case "healthy":
        default:
            return "pass";
    }
}

function buildTooltip(
    sandboxesTotal: number,
    agentsTotal: number,
    counts: Record<HealthStatus, number>,
): string {
    const lines = [
        `Agent health across ${agentsTotal} agent${
            agentsTotal === 1 ? "" : "s"
        } in ${sandboxesTotal} sandbox${sandboxesTotal === 1 ? "" : "es"}:`,
    ];
    for (const status of HEALTH_ORDER) {
        if (counts[status] > 0) {
            lines.push(`  ${status}: ${counts[status]}`);
        }
    }
    return lines.join("\n");
}
