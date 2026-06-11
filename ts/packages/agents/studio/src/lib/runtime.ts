// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as os from "node:os";
import * as path from "node:path";
import {
    createStudioRuntimeCore,
    type StudioRuntime,
    type StudioWorkspaceState,
} from "@typeagent/core/runtime";

/**
 * In-memory key/value store backing the headless runtime's workspace state.
 *
 * The S1 Inspect surface is read-only and does not persist sandboxes, so an
 * ephemeral store is sufficient. When the agent gains mutating/run actions
 * (S2+), this should be replaced with a durable store under the Studio profile
 * directory.
 */
class MemoryWorkspaceState implements StudioWorkspaceState {
    private readonly store = new Map<string, unknown>();

    get<T>(key: string): T | undefined {
        return this.store.get(key) as T | undefined;
    }

    async update(key: string, value: unknown): Promise<void> {
        this.store.set(key, value);
    }
}

/**
 * Candidate repository roots for Studio to inspect, most-specific first. The
 * runtime's `resolveRepoRoot` probes each candidate, its `ts/` subdirectory,
 * and ancestors for a `packages/agents` directory.
 *
 * - `TYPEAGENT_STUDIO_REPO_ROOT` — explicit override (set this when the agent
 *   runs outside the repository it should inspect).
 * - `process.cwd()` — the dispatcher's working directory, which is inside the
 *   repository in the common in-repo case.
 */
export function resolveStudioRepoRootCandidates(
    env: NodeJS.ProcessEnv = process.env,
    cwd: string = process.cwd(),
): string[] {
    const candidates: string[] = [];
    const override = env.TYPEAGENT_STUDIO_REPO_ROOT;
    if (override !== undefined && override.trim().length > 0) {
        candidates.push(override);
    }
    candidates.push(cwd);
    return candidates;
}

/** Profile directory for Studio agent state (mirrors onboarding's convention). */
function studioProfileDir(): string {
    return path.join(os.homedir(), ".typeagent", "studio");
}

const runtimeCache = new Map<string, StudioRuntime>();

/**
 * Get the Studio runtime for a target repository, constructing (and caching) one
 * per resolved root. The agent does not silently bind to a single guessed root:
 *
 * - `repoRoot` (when provided by the caller — e.g. an orchestrator or the VS
 *   Code client that knows the workspace) is used directly. This is the
 *   preferred path; the agent shouldn't have to guess.
 * - Otherwise it falls back to `resolveStudioRepoRootCandidates()`
 *   (`TYPEAGENT_STUDIO_REPO_ROOT` → cwd).
 *
 * The runtime itself resolves the actual root from these candidates via
 * `resolveRepoRoot`; `getStudioInfo` surfaces what it landed on.
 */
export function getStudioRuntime(repoRoot?: string): StudioRuntime {
    const candidates =
        repoRoot !== undefined && repoRoot.trim().length > 0
            ? [repoRoot]
            : resolveStudioRepoRootCandidates();
    const key = candidates.join(path.delimiter);
    let runtime = runtimeCache.get(key);
    if (runtime === undefined) {
        runtime = createStudioRuntimeCore({
            workspaceState: new MemoryWorkspaceState(),
            globalStorageFsPath: studioProfileDir(),
            workspaceFolderFsPaths: candidates,
        });
        runtimeCache.set(key, runtime);
    }
    return runtime;
}
