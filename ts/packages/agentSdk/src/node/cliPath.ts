// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Node-only helpers. Exposed via the "@typeagent/agent-sdk/node" subpath so the
// `node:child_process` dependency is isolated from the package's main entry,
// which is also consumed by browser/renderer bundles.

import { execSync } from "node:child_process";
import registerDebug from "debug";

const debug = registerDebug("typeagent:agent-sdk:cliPath");

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
 * and get the PATH-installed `claude` when present (e.g. on an Agency machine,
 * letting us prune the bundled binary from that artifact) while transparently
 * falling back to the bundled binary in dev/CI where `claude` is not on PATH.
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
        const command =
            process.platform === "win32" ? `where ${name}` : `which ${name}`;
        const out = execSync(command, {
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
