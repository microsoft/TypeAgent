// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    discoverAgentFiles,
    FileHealthService,
    hashFileContents,
    type HealthFinding,
    type HealthService,
} from "../health/index.js";
import type { AgentLoader, HealthStatus, SandboxAgentInfo } from "./types.js";

export interface RepoAgentLoaderOptions {
    /** Repository root that contains `packages/agents/<name>`. */
    repoRoot: string;
    /**
     * Health service used to assess a loaded agent. Defaults to a
     * `FileHealthService` rooted at `repoRoot`. Injectable for tests.
     */
    healthService?: HealthService;
}

const NO_FILES_HASH = "none";

/**
 * Resolve an agent reference (a bare name, a `packages/agents/<name>` path, or
 * an arbitrary directory/file path) to the agent's package name.
 */
export function resolveAgentName(agentRef: string): string {
    const normalized = agentRef.replace(/\\/g, "/").replace(/\/+$/, "");
    const marker = "packages/agents/";
    const markerAt = normalized.lastIndexOf(marker);
    if (markerAt >= 0) {
        const rest = normalized.slice(markerAt + marker.length);
        const name = rest.split("/")[0];
        if (name) {
            return name;
        }
    }
    const tail = normalized.split("/").pop() ?? agentRef;
    return tail.replace(/\.[^.]+$/, "") || agentRef;
}

/**
 * Map a set of health findings to the coarse badge used by sandbox status.
 * `unknown` is reserved for agents that could not be located on disk.
 */
export function summarizeFindingsToHealth(
    findings: HealthFinding[],
): Exclude<HealthStatus, "unknown"> {
    if (findings.some((f) => f.severity === "error")) {
        return "error";
    }
    if (findings.some((f) => f.severity === "warning")) {
        return "warning";
    }
    return "healthy";
}

/**
 * Filesystem-backed `AgentLoader` that derives real schema/grammar content
 * hashes and a real health badge from the agent's source under
 * `packages/agents/<name>`. Replaces the placeholder loader so the Studio
 * surfaces reflect the actual agent on disk rather than `"stub"` values.
 */
export function createRepoAgentLoader(
    options: RepoAgentLoaderOptions,
): AgentLoader {
    const { repoRoot } = options;
    const healthService =
        options.healthService ?? new FileHealthService({ repoRoot });

    return async (
        _sandboxId: string,
        agentRef: string,
    ): Promise<Omit<SandboxAgentInfo, "loadedAt">> => {
        const name = resolveAgentName(agentRef);
        const files = await discoverAgentFiles(repoRoot, name);

        const located =
            files.manifestFile !== undefined ||
            files.schemaFiles.length > 0 ||
            files.grammarFiles.length > 0;

        const schemaHash =
            (await hashFileContents(files.schemaFiles)) ?? NO_FILES_HASH;
        const grammarHash =
            (await hashFileContents(files.grammarFiles)) ?? NO_FILES_HASH;

        const health: HealthStatus = located
            ? summarizeFindingsToHealth(await healthService.check(name))
            : "unknown";

        return {
            name,
            schemaHash,
            grammarHash,
            health,
            sourcePath: agentRef,
        };
    };
}
