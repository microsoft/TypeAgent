// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as os from "node:os";
import * as path from "node:path";
import { existsSync, copyFileSync } from "node:fs";
import {
    createStudioRuntimeCore,
    resolveRepoRoot,
    canonicalizeRepoRoot,
    type StudioRuntime,
} from "@typeagent/core/runtime";
import {
    FileWorkspaceState,
    studioWorkspaceStateFile,
} from "./fileWorkspaceState.js";

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
 * One-time migration to the canonical workspace-state key. Earlier builds keyed
 * the per-workspace state file by the *raw* repoRoot string a caller passed, so
 * the same workspace produced different files across path spellings (notably VS
 * Code lowercases the Windows drive letter, and explicit-vs-env callers differ).
 * When the canonical file doesn't exist yet, recover an existing snapshot by
 * copying the first legacy-spelling file we find — so persisted sandboxes survive
 * the switch to canonical keying. Best-effort and safe: only reads/writes files
 * whose names derive from *this* workspace's path, and never overwrites an
 * existing canonical file.
 */
function migrateLegacyWorkspaceState(
    canonicalFile: string,
    resolvedRoot: string,
): void {
    if (existsSync(canonicalFile)) {
        return;
    }
    const dir = studioProfileDir();
    const spellings = new Set<string>([
        resolvedRoot,
        resolvedRoot.toLowerCase(),
    ]);
    // Drive-letter casing is the common divergence on Windows.
    if (/^[A-Za-z]:/.test(resolvedRoot)) {
        spellings.add(
            resolvedRoot.charAt(0).toLowerCase() + resolvedRoot.slice(1),
        );
        spellings.add(
            resolvedRoot.charAt(0).toUpperCase() + resolvedRoot.slice(1),
        );
    }
    for (const spelling of spellings) {
        const legacy = studioWorkspaceStateFile(dir, spelling);
        if (legacy !== canonicalFile && existsSync(legacy)) {
            try {
                copyFileSync(legacy, canonicalFile);
            } catch {
                // Best-effort — a failed copy just means a fresh (empty) state.
            }
            return;
        }
    }
}

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
        repoRoot != null && repoRoot.trim().length > 0
            ? [repoRoot]
            : resolveStudioRepoRootCandidates();
    // Key the runtime cache by the CANONICAL resolved workspace so every caller
    // for the same workspace shares ONE runtime instance — and thus one
    // in-memory event stream. Without this, the extension (which passes an
    // explicit repoRoot) and the `@studio` agent proxy (which passes none, so
    // the service resolves from env/cwd) land on different raw-string keys and
    // get separate event ring buffers: collisions/corpus persist to shared
    // globalStorage and look fine, but the Event Log subscribes to one stream
    // while activity is emitted on the other — so it appears empty.
    const resolved = resolveRepoRoot(candidates, studioProfileDir()).repoRoot;
    const key = canonicalizeRepoRoot(resolved);
    let runtime = runtimeCache.get(key);
    if (runtime === undefined) {
        const stateFile = studioWorkspaceStateFile(studioProfileDir(), key);
        // Recover a pre-canonical snapshot for this workspace, if any, before
        // the runtime reads its persisted state.
        migrateLegacyWorkspaceState(stateFile, resolved);
        runtime = createStudioRuntimeCore({
            workspaceState: new FileWorkspaceState(stateFile),
            globalStorageFsPath: studioProfileDir(),
            workspaceFolderFsPaths: candidates,
        });
        runtimeCache.set(key, runtime);
    }
    return runtime;
}
