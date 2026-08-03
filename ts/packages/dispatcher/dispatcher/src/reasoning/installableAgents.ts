// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import type { InstallableAgentSummary } from "../agentProvider/agentProvider.js";
import type { CommandHandlerContext } from "../context/commandHandlerContext.js";

const debug = registerDebug("typeagent:dispatcher:reasoning:installable");

/**
 * Enumerate agents installable from the session's dynamic agent sources that
 * are NOT already installed, so the reasoning engine can suggest one when no
 * active agent can fulfill a request. Deduplicates across sources by install
 * name (case-insensitively) and swallows per-source failures — discovery is
 * best-effort (a feed may be offline or unauthenticated) and must never break
 * the reasoning turn. Discovery itself is cache-backed by the source.
 */
export async function findInstallableAgents(
    systemContext: CommandHandlerContext,
): Promise<InstallableAgentSummary[]> {
    const sources = systemContext.appAgentSources;
    if (sources.length === 0) {
        return [];
    }
    const installed = new Set(
        systemContext.agents.getSchemaNames().map((name) => name.toLowerCase()),
    );
    const perSource = await Promise.all(
        sources.map(async (source) => {
            if (source.listAvailableAgents === undefined) {
                return [];
            }
            try {
                return await source.listAvailableAgents();
            } catch (e) {
                debug(`listAvailableAgents failed: ${e}`);
                return [];
            }
        }),
    );
    const byName = new Map<string, InstallableAgentSummary>();
    for (const summary of perSource.flat()) {
        const key = summary.installName.toLowerCase();
        // Skip agents already installed in this session and duplicate names
        // vended by more than one source (first source wins).
        if (installed.has(key) || byName.has(key)) {
            continue;
        }
        byName.set(key, summary);
    }
    return [...byName.values()];
}

/**
 * Render the installable-agent list as a compact text block for a reasoning
 * tool result, including the exact `@package install` command for each.
 */
export function formatInstallableAgents(
    agents: InstallableAgentSummary[],
): string {
    if (agents.length === 0) {
        return "No additional agents are available to install from the configured sources.";
    }
    const lines = agents.map((agent) => {
        const description = agent.description ? ` — ${agent.description}` : "";
        return `- ${agent.installName}${description}\n  install with: ${agent.installCommand}`;
    });
    return [
        `${agents.length} installable agent(s) not currently installed:`,
        ...lines,
        "",
        "Only suggest one to the user if it clearly matches their request. Tell them the exact install command; do not install it yourself.",
    ].join("\n");
}
