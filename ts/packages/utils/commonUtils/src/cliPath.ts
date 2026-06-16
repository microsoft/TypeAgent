// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Node-only helpers for resolving a CLI executable on PATH. Hosted here as the
// single shared implementation so the various Claude-backed callers (agent-sdk,
// action-grammar, kp, ...) don't each duplicate it. Exported from the package's
// node entry only, since it depends on `node:child_process`.

import { execFileSync } from "node:child_process";
import registerDebug from "debug";

const debug = registerDebug("typeagent:common-utils:cliPath");

const cache = new Map<string, string | undefined>();

/**
 * Resolve a CLI executable on PATH.
 *
 * Returns the resolved absolute path when the command is found on PATH, or
 * `undefined` when it is not. The `undefined` case lets callers fall back to a
 * tool's *bundled* binary: the Claude and GitHub Copilot agent SDKs each ship a
 * native CLI as an optional dependency and use it when no executable path is
 * supplied. So a caller can do:
 *
 *   query({ prompt, options: { ...claudeExecutableOption() } })
 *
 * and get the PATH-installed `claude` when present (e.g. where the CLI has been
 * provisioned, letting us prune the bundled binary from that artifact) while
 * transparently falling back to the bundled binary in dev/CI where `claude` is
 * not on PATH.
 * No configuration is involved — the executable name is install-invariant.
 *
 * Result is cached per name for the life of the process.
 */
export function resolveCliOnPath(name: string): string | undefined {
    const cached = cache.get(name);
    if (cached !== undefined || cache.has(name)) {
        return cached;
    }
    let resolved: string | undefined;
    try {
        // Pass `name` as a separate argv entry (no shell) so it can never be
        // interpreted as a shell command, regardless of its contents.
        const lookup = process.platform === "win32" ? "where" : "which";
        const out = execFileSync(lookup, [name], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        const first = out.split("\n")[0]?.trim();
        resolved = first ? first : undefined;
        debug(
            resolved
                ? `resolved '${name}' -> ${resolved}`
                : `'${name}' not found on PATH`,
        );
    } catch {
        debug(`'${name}' not found on PATH`);
        resolved = undefined;
    }
    cache.set(name, resolved);
    return resolved;
}

/**
 * Spreadable options fragment for the Claude Agent SDK `query()` call:
 * contributes `pathToClaudeCodeExecutable` (a PATH-installed `claude`) when one
 * is found, and nothing otherwise — so the SDK uses its bundled binary in dev/CI.
 * Spreading (rather than assigning `undefined`) keeps it valid under
 * `exactOptionalPropertyTypes`:
 *
 *   query({ prompt, options: { model, ...claudeExecutableOption() } })
 */
export function claudeExecutableOption(): {
    pathToClaudeCodeExecutable?: string;
} {
    const resolved = resolveCliOnPath("claude");
    return resolved ? { pathToClaudeCodeExecutable: resolved } : {};
}
