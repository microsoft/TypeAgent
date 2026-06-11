// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AvailableAgent,
    RepoRootResolution,
    AgentSources,
} from "@typeagent/core/runtime";
import type {
    CollisionDetectedEvent,
    StudioEvent,
} from "@typeagent/core/events";
import type { HealthFinding } from "@typeagent/core/health";
import type { CorpusEntry } from "@typeagent/core/corpus";
import type { FeedbackRow } from "@typeagent/core/feedback";

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

/** Collisions an agent participates in (filtered from the full list). */
export function collisionsForAgent(
    collisions: readonly CollisionDetectedEvent[],
    agent: string,
): CollisionDetectedEvent[] {
    return collisions.filter((c) =>
        c.participants.some((p) => p.agent === agent),
    );
}

/** Render a one-agent overview: emoji, health, corpus size, collisions, feedback. */
export function formatAgentDescription(
    agent: string,
    data: {
        emoji?: string;
        health: readonly HealthFinding[];
        corpusCount: number;
        collisions: readonly CollisionDetectedEvent[];
        feedback: readonly FeedbackRow[];
    },
): string {
    const emoji = data.emoji ?? "🔌";
    const errors = data.health.filter((f) => f.severity === "error").length;
    const warnings = data.health.filter((f) => f.severity === "warning").length;
    const healthLine =
        data.health.length === 0
            ? "✅ no findings"
            : `${errors} error(s), ${warnings} warning(s)`;
    const lines = [
        `## ${emoji} ${agent}`,
        "",
        `- **Health:** ${healthLine}`,
        `- **Corpus utterances:** ${data.corpusCount}`,
        `- **Collisions:** ${data.collisions.length}`,
        `- **Feedback rows:** ${data.feedback.length}`,
    ];
    if (data.health.length > 0) {
        lines.push("", "### Health findings", "");
        for (const f of data.health) {
            const icon =
                f.severity === "error"
                    ? "❌"
                    : f.severity === "warning"
                      ? "⚠️"
                      : "ℹ️";
            lines.push(`- ${icon} \`${f.ruleId}\` — ${f.evidence.message}`);
        }
    }
    return lines.join("\n");
}

const MAX_SOURCE_CHARS = 6000;

/** Render an agent's source artifacts (schema or grammar) as fenced blocks. */
export function formatAgentSources(
    agent: string,
    kind: "schema" | "grammar",
    sources: AgentSources,
): string {
    const files = kind === "schema" ? sources.schema : sources.grammar;
    const lang = kind === "schema" ? "typescript" : "";
    if (files.length === 0) {
        return [
            `## ${agent} — ${kind}`,
            "",
            `No ${kind} source files found for \`${agent}\`. (It may not exist, or may be schema-only / unbuilt.)`,
        ].join("\n");
    }
    const lines = [`## ${agent} — ${kind}`, ""];
    for (const file of files) {
        const truncated = file.text.length > MAX_SOURCE_CHARS;
        const body = truncated
            ? `${file.text.slice(0, MAX_SOURCE_CHARS)}\n… (truncated)`
            : file.text;
        lines.push(`**\`${file.path}\`**`, "", "```" + lang, body, "```", "");
    }
    return lines.join("\n").trimEnd();
}

/** Render an agent's corpus, optionally filtered by a substring query. */
export function formatCorpusSearch(
    agent: string,
    entries: readonly CorpusEntry[],
    query?: string,
): string {
    const q = query?.trim().toLowerCase();
    const matched =
        q !== undefined && q.length > 0
            ? entries.filter((e) => e.utterance.toLowerCase().includes(q))
            : entries;
    const header =
        q !== undefined && q.length > 0
            ? `## ${agent} — corpus matching "${query}" (${matched.length}/${entries.length})`
            : `## ${agent} — corpus (${matched.length})`;
    if (matched.length === 0) {
        return [
            header,
            "",
            entries.length === 0
                ? "No corpus utterances for this agent yet."
                : "No utterances matched the query.",
        ].join("\n");
    }
    const lines = [header, ""];
    for (const entry of matched.slice(0, 50)) {
        const rating =
            entry.feedback?.rating === "up"
                ? " 👍"
                : entry.feedback?.rating === "down"
                  ? " 👎"
                  : "";
        lines.push(`- _(${entry.source})_ ${entry.utterance}${rating}`);
    }
    if (matched.length > 50) {
        lines.push("", `… and ${matched.length - 50} more`);
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
