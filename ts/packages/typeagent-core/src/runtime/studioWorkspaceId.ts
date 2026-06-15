// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Canonical per-workspace identity for the Studio service.
 *
 * The Studio runtime is one-per-workspace, so the standalone service, the
 * `studio` agent (which proxies to it), and the extension (which launches /
 * attaches to it) must all agree on a single key for "which workspace is this"
 * — otherwise two of them could disagree and either spin up duplicate services
 * or fail to find an existing one. This module is the *one* place that derives
 * that key, so every participant computes it identically.
 *
 * Lives in `@typeagent/core` because it is the only package shared by the
 * service (`studio-service`), the agent, and the extension. It uses only node
 * `fs`/`path`/`crypto` — no transport dependency — so core stays agent-rpc-free.
 */

import * as path from "node:path";
import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";

/**
 * Canonicalize a repo root into a stable, comparable absolute path:
 * resolve to absolute, follow symlinks where the path exists (so a symlinked
 * checkout and its target map to one workspace), and normalize case on
 * case-insensitive platforms (Windows/macOS) so `C:\Repo` and `c:\repo` match.
 *
 * Best-effort: a non-existent path (e.g. a not-yet-created workspace) is
 * resolved lexically rather than via `realpath`, never throwing.
 */
export function canonicalizeRepoRoot(repoRoot: string): string {
    let resolved = path.resolve(repoRoot);
    try {
        // Resolve symlinks so a symlinked checkout maps to its real location.
        resolved = realpathSync.native(resolved);
    } catch {
        // Path may not exist yet — fall back to the lexical absolute path.
    }
    // Strip trailing separators, but never below the filesystem root (so a drive
    // root like `C:\` or `/` stays intact rather than collapsing to `C:` / ``).
    // Linear scan rather than `/[\\/]+$/`, which backtracks quadratically on a
    // path with many trailing slashes (CodeQL: polynomial-regex ReDoS).
    const rootLen = path.parse(resolved).root.length;
    let end = resolved.length;
    while (
        end > rootLen &&
        (resolved[end - 1] === "\\" || resolved[end - 1] === "/")
    ) {
        end--;
    }
    const normalized = resolved.slice(0, end);
    // Windows and macOS are case-insensitive; lowercasing makes the key stable
    // regardless of how the path was typed. (Linux is case-sensitive — leave it.)
    return process.platform === "win32" || process.platform === "darwin"
        ? normalized.toLowerCase()
        : normalized;
}

/**
 * A short, filename- and wire-safe identity for a workspace, derived from its
 * canonical repo root. Stable across processes and runs for the same workspace.
 */
export function studioWorkspaceKey(repoRoot: string): string {
    const canonical = canonicalizeRepoRoot(repoRoot);
    return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** True when two repo roots denote the same canonical workspace. */
export function sameWorkspace(a: string, b: string): boolean {
    return canonicalizeRepoRoot(a) === canonicalizeRepoRoot(b);
}
