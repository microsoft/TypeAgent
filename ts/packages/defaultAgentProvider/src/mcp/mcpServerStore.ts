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

type PersistedMcpServerConfig = Partial<NormalizedMcpServerConfig> &
    Pick<NormalizedMcpServerConfig, "transport">;

function mcpServersJsonPath(instanceDir: string): string {
    return path.join(instanceDir, "mcpServers.json");
}

function assertNoPlaintextCredentials(config: NormalizedMcpServerConfig): void {
    const values =
        config.transport.kind === "http"
            ? config.transport.headers
            : config.transport.env;
    for (const [name, value] of Object.entries(values ?? {})) {
        if (
            /authorization|cookie|password|secret|token|api[-_]?key/i.test(
                name,
            ) &&
            typeof value === "string"
        ) {
            throw new Error(
                `MCP server '${config.name}' cannot persist plaintext credential '${name}'. Use an env or secure credential reference.`,
            );
        }
    }
}

export function readMcpServersJson(
    instanceDir: string,
): { servers: Record<string, PersistedMcpServerConfig> } | undefined {
    const filePath = mcpServersJsonPath(instanceDir);
    if (!fs.existsSync(filePath)) {
        return undefined;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as {
        servers: Record<string, PersistedMcpServerConfig>;
    };
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
    get(id: string): NormalizedMcpServerConfig | undefined;
    has(id: string): boolean;
    // Add or replace a server config, writing through to disk. Returns the
    // stored config.
    set(config: NormalizedMcpServerConfig): NormalizedMcpServerConfig;
    // Remove a server config; returns true when a config was removed.
    remove(id: string): boolean;
}

function migrateConfig(
    persistedId: string,
    config: PersistedMcpServerConfig,
): NormalizedMcpServerConfig {
    const id = config.id ?? persistedId;
    const name = config.name ?? persistedId;
    return {
        ...config,
        id,
        name,
        enabled: config.enabled ?? true,
        trust: config.trust ?? "untrusted",
        scope: config.scope ?? "user",
        provenance: config.provenance ?? {
            source: "legacy-mcpServers.json",
            sourceKind: "legacy",
            ref: persistedId,
        },
    };
}

export function openMcpServerStore(
    instanceDir: string,
    reservedNames: ReadonlySet<string> = new Set(),
    reservedIds: ReadonlySet<string> = new Set(),
): McpServerStore {
    const servers = new Map<string, NormalizedMcpServerConfig>();
    const existing = readMcpServersJson(instanceDir);
    if (existing !== undefined) {
        for (const [persistedId, rawConfig] of Object.entries(
            existing.servers ?? {},
        )) {
            const config = migrateConfig(persistedId, rawConfig);
            // Drop any stored server whose name collides with a shipped server
            // (the seeded provider owns it).
            if (
                !reservedNames.has(config.name) &&
                !reservedIds.has(config.id) &&
                ![...servers.values()].some(
                    (existingConfig) => existingConfig.name === config.name,
                )
            ) {
                servers.set(config.id, config);
            }
        }
    }
    // Normalize the file on open (drop reserved-name collisions, ensure the file
    // exists) so first run leaves a well-formed store on disk.
    flush();

    function flush(): void {
        const out: Record<string, NormalizedMcpServerConfig> = {};
        for (const [id, config] of servers) {
            out[id] = config;
        }
        writeMcpServersJson(instanceDir, { servers: out });
    }

    return {
        list: () => [...servers.values()],
        get: (id) => servers.get(id),
        has: (id) => servers.has(id),
        set(config) {
            assertNoPlaintextCredentials(config);
            if (reservedIds.has(config.id)) {
                throw new Error(
                    `Cannot store MCP server config '${config.id}': id is reserved by a shipped server`,
                );
            }
            if (reservedNames.has(config.name)) {
                throw new Error(
                    `Cannot store MCP server '${config.name}': name is reserved by a shipped server`,
                );
            }
            for (const existing of servers.values()) {
                if (
                    existing.id !== config.id &&
                    existing.name === config.name
                ) {
                    throw new Error(
                        `Cannot store MCP server '${config.name}': name is already used by config '${existing.id}'`,
                    );
                }
            }
            servers.set(config.id, config);
            flush();
            return config;
        },
        remove(id) {
            const removed = servers.delete(id);
            if (removed) {
                flush();
            }
            return removed;
        },
    };
}
