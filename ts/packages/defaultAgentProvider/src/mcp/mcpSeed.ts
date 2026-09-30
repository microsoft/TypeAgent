// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import type { McpAppAgentInfo } from "../mcpAgentProvider.js";
import type { NormalizedMcpServerConfig } from "./mcpServerConfig.js";

// The node/python interpreter a script-based stdio server launches under,
// matching the legacy provider's script→command derivation.
function scriptCommand(serverScript: string): string | undefined {
    if (serverScript.endsWith(".js")) {
        return "node";
    }
    if (serverScript.endsWith(".py")) {
        return process.platform === "win32" ? "python" : "python3";
    }
    return undefined;
}

/**
 * Convert a shipped `data/config.json` MCP server entry into a normalized
 * config so shipped servers can be seeded through the dynamic source rather than
 * a separate hard-coded mechanism.
 *
 * Returns `undefined` when the entry cannot be expressed as a normalized
 * config. Interactive `serverScriptArgs` require a runtime resolver; unresolved
 * entries remain on the legacy provider. `resolveScriptPath` resolves a relative
 * `serverScript` to an absolute path (the shipped scripts live under the package).
 */
export function mcpInfoToNormalized(
    name: string,
    info: McpAppAgentInfo,
    resolveScriptPath: (p: string) => string = (p) => p,
    resolveServerArgs?: (
        name: string,
        definitions: Exclude<
            NonNullable<McpAppAgentInfo["serverScriptArgs"]>,
            string[]
        >,
    ) => string[] | undefined,
): NormalizedMcpServerConfig | undefined {
    const base: Pick<
        NormalizedMcpServerConfig,
        | "id"
        | "name"
        | "description"
        | "emojiChar"
        | "scope"
        | "trust"
        | "enabled"
        | "provenance"
    > = {
        id: `shipped:${name}`,
        name,
        scope: "shipped",
        trust: "trusted",
        enabled: true,
        provenance: {
            source: "shipped",
            sourceKind: "shipped",
            ref: name,
        },
    };
    if (info.description !== undefined) {
        base.description = info.description;
    }
    if (info.emojiChar !== undefined) {
        base.emojiChar = info.emojiChar;
    }

    if (info.serverUrl !== undefined) {
        return { ...base, transport: { kind: "http", url: info.serverUrl } };
    }

    if (info.serverScript === undefined) {
        return undefined;
    }
    const serverScriptArgs = Array.isArray(info.serverScriptArgs)
        ? info.serverScriptArgs
        : info.serverScriptArgs === undefined
          ? []
          : resolveServerArgs?.(name, info.serverScriptArgs);
    if (serverScriptArgs === undefined) {
        return undefined;
    }
    const command = scriptCommand(info.serverScript);
    if (command === undefined) {
        return undefined;
    }
    const scriptPath = resolveScriptPath(info.serverScript);
    const args = [scriptPath, ...serverScriptArgs];
    return { ...base, transport: { kind: "stdio", command, args } };
}

/**
 * Build the seed map of normalized shipped-server configs from the provider
 * config's `mcpServers`. Entries that cannot be seeded, including unresolved
 * interactive argument definitions, are left to the legacy provider.
 */
export function buildMcpSeed(
    servers: Record<string, McpAppAgentInfo> | undefined,
    resolveScriptPath: (p: string) => string = (p) => p,
    resolveServerArgs?: (
        name: string,
        definitions: Exclude<
            NonNullable<McpAppAgentInfo["serverScriptArgs"]>,
            string[]
        >,
    ) => string[] | undefined,
): Record<string, NormalizedMcpServerConfig> {
    const seed: Record<string, NormalizedMcpServerConfig> = {};
    if (servers === undefined) {
        return seed;
    }
    for (const [name, info] of Object.entries(servers)) {
        const normalized = mcpInfoToNormalized(
            name,
            info,
            resolveScriptPath,
            resolveServerArgs,
        );
        if (normalized !== undefined) {
            seed[name] = normalized;
        }
    }
    return seed;
}

// Convenience: resolve a shipped server script path relative to a base dir
// (the package root), leaving absolute paths untouched.
export function makeScriptPathResolver(baseDir: string): (p: string) => string {
    return (p) => (path.isAbsolute(p) ? p : path.resolve(baseDir, p));
}
