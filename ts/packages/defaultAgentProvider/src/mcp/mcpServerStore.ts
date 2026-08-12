// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { NormalizedMcpServerConfig } from "./mcpServerConfig.js";

// The single `mcpServers.json` persisted under the instance dir: the store of
// USER-MANAGED MCP server configs only (added via `@package`/import). The
// shipped MCP servers are seeded separately from `data/config.json` at runtime
// (see the seed helper in mcpDefaultAgentProvider) and are not stored here —
// mirroring how `agents.json` holds only user installs, not bundled agents.
export type McpServersJson = {
    servers: Record<string, NormalizedMcpServerConfig>;
};

function mcpServersJsonPath(instanceDir: string): string {
    return path.join(instanceDir, "mcpServers.json");
}

export function readMcpServersJson(
    instanceDir: string,
): McpServersJson | undefined {
    const filePath = mcpServersJsonPath(instanceDir);
    if (!fs.existsSync(filePath)) {
        return undefined;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as McpServersJson;
}

export function writeMcpServersJson(
    instanceDir: string,
    data: McpServersJson,
): void {
    fs.mkdirSync(instanceDir, { recursive: true });
    fs.writeFileSync(
        mcpServersJsonPath(instanceDir),
        JSON.stringify(data, null, 2),
    );
}

/**
 * A small persistent CRUD store over `mcpServers.json`. In-memory state is the
 * source of truth once opened; every mutation writes through to disk so a crash
 * never loses a committed add/remove. `reservedNames` (the shipped server names)
 * are dropped on open, since the seeded provider owns those names and
 * registering the same name from two providers makes the dispatcher throw.
 */
export interface McpServerStore {
    list(): NormalizedMcpServerConfig[];
    get(name: string): NormalizedMcpServerConfig | undefined;
    has(name: string): boolean;
    // Add or replace a server config, writing through to disk. Returns the
    // stored config.
    set(config: NormalizedMcpServerConfig): NormalizedMcpServerConfig;
    // Remove a server config; returns true when a config was removed.
    remove(name: string): boolean;
}

export function openMcpServerStore(
    instanceDir: string,
    reservedNames: ReadonlySet<string> = new Set(),
): McpServerStore {
    const servers = new Map<string, NormalizedMcpServerConfig>();
    const existing = readMcpServersJson(instanceDir);
    if (existing !== undefined) {
        for (const [name, config] of Object.entries(existing.servers)) {
            // Drop any stored server whose name collides with a shipped server
            // (the seeded provider owns it).
            if (!reservedNames.has(name)) {
                servers.set(name, { ...config, name });
            }
        }
    }
    // Normalize the file on open (drop reserved-name collisions, ensure the file
    // exists) so first run leaves a well-formed store on disk.
    flush();

    function flush(): void {
        const out: Record<string, NormalizedMcpServerConfig> = {};
        for (const [name, config] of servers) {
            out[name] = config;
        }
        writeMcpServersJson(instanceDir, { servers: out });
    }

    return {
        list: () => [...servers.values()],
        get: (name) => servers.get(name),
        has: (name) => servers.has(name),
        set(config) {
            if (reservedNames.has(config.name)) {
                throw new Error(
                    `Cannot store MCP server '${config.name}': name is reserved by a shipped server`,
                );
            }
            servers.set(config.name, config);
            flush();
            return config;
        },
        remove(name) {
            const removed = servers.delete(name);
            if (removed) {
                flush();
            }
            return removed;
        },
    };
}
