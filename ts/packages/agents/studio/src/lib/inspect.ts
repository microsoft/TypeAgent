// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AvailableAgent, RepoRootResolution } from "@typeagent/core/runtime";
import type { CollisionDetectedEvent } from "@typeagent/core/events";

/**
 * Pure Markdown formatters for the Studio agent's read-only Inspect results.
 * Kept separate from the handler (and free of any runtime/dispatcher
 * dependency) so they are trivially unit-testable.
 */

/** Render the discoverable-agents list. */
export function formatAgentList(agents: readonly AvailableAgent[]): string {
    if (agents.length === 0) {
        return [
            "## Agents",
            "",
            "No agents discovered. Check `getStudioInfo` — Studio may not be pointed at a folder containing `packages/agents`.",
        ].join("\n");
    }
    const lines = [`## Agents (${agents.length})`, ""];
    for (const agent of agents) {
        const emoji = agent.emoji ?? "🔌";
        lines.push(`- ${emoji} ${agent.name}`);
    }
    return lines.join("\n");
}

/** Render Studio's resolved environment / repo-root info. */
export function formatStudioInfo(
    info: RepoRootResolution,
    agentCount: number,
): string {
    const lines = ["## TypeAgent Studio", ""];
    lines.push(`- **Repo root:** \`${info.repoRoot}\``);
    lines.push(
        `- **\`packages/agents\` found:** ${info.agentsDirFound ? "yes ✅" : "no ⚠️"}`,
    );
    lines.push(`- **Agents discovered:** ${agentCount}`);
    if (!info.agentsDirFound) {
        lines.push("");
        lines.push(
            "> No `packages/agents` directory was found at the resolved root. Open the monorepo's `ts/` directory, or set `TYPEAGENT_STUDIO_REPO_ROOT`, so Studio can discover agents.",
        );
    }
    return lines.join("\n");
}

/** Render the known collisions, newest first. */
export function formatCollisions(
    collisions: readonly CollisionDetectedEvent[],
): string {
    if (collisions.length === 0) {
        return [
            "## Collisions",
            "",
            "No collisions recorded. (Collisions are populated by a scan; none has run yet in this session.)",
        ].join("\n");
    }
    const lines = [`## Collisions (${collisions.length})`, ""];
    for (const collision of collisions) {
        const participants = collision.participants
            .map((p) => `${p.agent}.${p.actionType}`)
            .join(" ↔ ");
        lines.push(
            `- **${collision.kind}** (${collision.detectionPoint}): ${participants}`,
        );
        if (
            collision.exemplarUtterances !== undefined &&
            collision.exemplarUtterances.length > 0
        ) {
            lines.push(
                `  - e.g. ${collision.exemplarUtterances
                    .slice(0, 3)
                    .map((u) => `"${u}"`)
                    .join(", ")}`,
            );
        }
    }
    return lines.join("\n");
}
