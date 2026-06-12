// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// CLI-path resolution for kp's Claude-backed answer generation / enrichment.
// Local copy (kp depends on neither @typeagent/agent-sdk nor action-grammar);
// mirrors @typeagent/agent-sdk/node's helper. Imported only by the node-only
// answerGenerator/llmEnrichment modules, so it is never pulled into a web bundle.

import { execSync } from "node:child_process";
import registerDebug from "debug";

const debug = registerDebug("typeagent:kp:cliPath");

const cache = new Map<string, string | undefined>();

/**
 * Resolve a CLI executable on PATH; returns the resolved path or `undefined`
 * (so the Claude SDK falls back to its bundled binary in dev/CI). Cached per name.
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
 * Spreadable Claude Agent SDK `query()` options fragment: sets
 * `pathToClaudeCodeExecutable` to a PATH-installed `claude` when present, and
 * contributes nothing otherwise (bundled-binary fallback). Spread-safe under
 * `exactOptionalPropertyTypes`.
 */
export function claudeExecutableOption(): {
    pathToClaudeCodeExecutable?: string;
} {
    const resolved = resolveCliOnPath("claude");
    return resolved ? { pathToClaudeCodeExecutable: resolved } : {};
}
