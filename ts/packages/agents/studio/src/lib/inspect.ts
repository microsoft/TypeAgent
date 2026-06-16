// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    RepoRootResolution,
    AgentLocation,
} from "@typeagent/core/runtime";
import type {
    CollisionDetectedEvent,
    StudioEvent,
} from "@typeagent/core/events";

/**
 * Pure Markdown formatters for the Studio agent's read-only Inspect results.
 * Kept separate from the handler (and free of any runtime/dispatcher
 * dependency) so they are trivially unit-testable.
 */

/** Render Studio's environment: repo root + the agent locations it scans. */
export function formatStudioInfo(
    info: RepoRootResolution,
    locations: readonly AgentLocation[],
): string {
    const total = locations.reduce((n, l) => n + l.agentCount, 0);
    const lines = ["## TypeAgent Studio", ""];
    lines.push(`- **Repo root:** \`${info.repoRoot}\``);
    lines.push("- **Agent locations:**");
    for (const loc of locations) {
        const suffix = loc.external ? " _(external)_" : "";
        lines.push(
            loc.exists
                ? `  - ✅ \`${loc.root}\` — ${loc.agentCount} agent(s)${suffix}`
                : `  - ⚠️ \`${loc.root}\` — not found${suffix}`,
        );
    }
    lines.push(`- **Agents discovered:** ${total}`);
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

/** Render recent structured events, newest last. */
export function formatEvents(events: readonly StudioEvent[]): string {
    if (events.length === 0) {
        return ["## Events", "", "No events recorded yet."].join("\n");
    }
    const lines = [`## Events (${events.length})`, ""];
    for (const event of events) {
        const ts = new Date(event.ts).toISOString();
        lines.push(`- \`${ts}\` **${event.type}**`);
    }
    return lines.join("\n");
}
