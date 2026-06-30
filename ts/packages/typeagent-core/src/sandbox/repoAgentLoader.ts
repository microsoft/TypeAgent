// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type AgentRootsInput,
    discoverAgentFiles,
    FileHealthService,
    hashFileContents,
    resolveAgentRoots,
    type HealthFinding,
    type HealthService,
} from "../health/index.js";
import { resolveAgentName } from "./agentRef.js";
import type { AgentLoader, HealthStatus, SandboxAgentInfo } from "./types.js";

export { resolveAgentName };

export interface RepoAgentLoaderOptions {
    /** Repository root that contains `packages/agents/<name>`. */
    repoRoot: string;
    /**
     * Ordered directories that contain agent subdirectories (each peer to
     * `packages/agents`). Defaults to `[<repoRoot>/packages/agents]`. May be a
     * provider so configuration changes are picked up without reconstruction.
     * An agent reference is resolved by probing each root.
     */
    agentRoots?: AgentRootsInput;
    /**
     * Health service used to assess a loaded agent. Defaults to a
     * `FileHealthService` rooted at `repoRoot`. Injectable for tests.
     */
    healthService?: HealthService;
}

const NO_FILES_HASH = "none";

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
        options.healthService ??
        new FileHealthService({
            repoRoot,
            ...(options.agentRoots !== undefined
                ? { agentRoots: options.agentRoots }
                : {}),
        });

    return async (
        _sandboxId: string,
        agentRef: string,
    ): Promise<Omit<SandboxAgentInfo, "loadedAt">> => {
        const agentRoots = resolveAgentRoots(options.agentRoots, repoRoot);
        const name = resolveAgentName(agentRef, agentRoots);
        const files = await discoverAgentFiles(agentRoots, name);

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
