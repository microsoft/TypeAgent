// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import type {
    AvailableInstallRow,
    InstallSource,
    MaterializedInstallRecord,
    RegistrySourceConfig,
    ResolvedCandidate,
    SourceWarning,
} from "./config.js";
import {
    createMcpRegistryClient,
    type McpRegistryClient,
    type RegistryServerEntry,
} from "./mcpRegistryClient.js";
import {
    createRegistryCacheStorage,
    mergeRegistryCache,
    type RegistryCacheData,
    type RegistryCacheStorage,
} from "./mcpRegistryCache.js";
import { registryEntryToCandidate } from "./mcpRegistryDescriptor.js";
import type { RegistryMaterializerDeps } from "./mcpRegistryMaterializer.js";

export interface RegistrySourceDeps extends RegistryMaterializerDeps {
    client?: McpRegistryClient;
    cacheStorage?: RegistryCacheStorage;
    now?: () => number;
}

function parseRef(ref: string): { name: string; version: string } {
    const at = ref.lastIndexOf("@");
    return at > 0
        ? { name: ref.slice(0, at), version: ref.slice(at + 1) }
        : { name: ref, version: "latest" };
}

export function createMcpRegistrySource(
    config: RegistrySourceConfig,
    deps: RegistrySourceDeps,
): InstallSource {
    const now = deps.now ?? Date.now;
    const ttl = config.cacheTtlMs ?? 60 * 60 * 1000;
    const parsedBaseUrl = new URL(config.baseUrl);
    if (!parsedBaseUrl.pathname.endsWith("/")) {
        parsedBaseUrl.pathname += "/";
    }
    const baseUrl = parsedBaseUrl.toString();
    const client =
        deps.client ??
        createMcpRegistryClient(baseUrl, deps.fetchFn, config.maxPages);
    const storage =
        deps.cacheStorage ??
        createRegistryCacheStorage(
            config.cachePath ??
                path.join(
                    deps.installDir,
                    "mcp",
                    `.registry-cache-${config.name.replace(/[^A-Za-z0-9._-]/g, "_")}.json`,
                ),
        );
    let memory: RegistryCacheData | undefined;

    function readCache(): RegistryCacheData | undefined {
        if (memory === undefined) {
            memory = storage.read();
        }
        return memory;
    }

    async function refreshCache(): Promise<RegistryCacheData> {
        const previous = readCache();
        const fetchedAt = now();
        const updatedSince = new Date(fetchedAt).toISOString();
        const pageOptions =
            previous === undefined
                ? {
                      version: "latest",
                      ...(config.maxPages === undefined
                          ? {}
                          : { maxPages: config.maxPages }),
                  }
                : {
                      version: "latest",
                      updatedSince: previous.updatedSince,
                      includeDeleted: true,
                      ...(config.maxPages === undefined
                          ? {}
                          : { maxPages: config.maxPages }),
                  };
        const updates = await client.list(pageOptions);
        const next: RegistryCacheData = {
            fetchedAt,
            updatedSince,
            entries:
                previous === undefined
                    ? updates.filter((entry) => entry.meta.status !== "deleted")
                    : mergeRegistryCache(previous.entries, updates),
        };
        storage.write(next);
        memory = next;
        return next;
    }

    async function cache(): Promise<RegistryCacheData> {
        const current = readCache();
        if (current !== undefined && now() - current.fetchedAt <= ttl) {
            return current;
        }
        try {
            return await refreshCache();
        } catch (error) {
            if (current !== undefined) return current;
            throw error;
        }
    }

    function warnDeprecated(
        entry: RegistryServerEntry,
        onWarn?: SourceWarning,
    ): void {
        if (entry.meta.status === "deprecated") {
            onWarn?.(
                `Registry server '${entry.server.name}@${entry.server.version}' is deprecated${entry.meta.statusMessage ? `: ${entry.meta.statusMessage}` : "."}`,
            );
        }
    }

    return {
        name: config.name,
        kind: "registry",
        describe: () => baseUrl,
        async find(): Promise<ResolvedCandidate | undefined> {
            return undefined;
        },
        async findMcp(ref, onWarn) {
            const { name, version } = parseRef(ref);
            const cached = await cache();
            let entry = cached.entries.find(
                (candidate) =>
                    candidate.server.name === name &&
                    (version === "latest"
                        ? candidate.meta.isLatest
                        : candidate.server.version === version),
            );
            if (entry === undefined) {
                entry = await client.get(name, version);
            }
            if (entry === undefined || entry.meta.status === "deleted") {
                return undefined;
            }
            warnDeprecated(entry, onWarn);
            return registryEntryToCandidate(entry, config.name, baseUrl, deps);
        },
        async listAgents(onWarn): Promise<AvailableInstallRow[]> {
            const rows: AvailableInstallRow[] = [];
            for (const entry of (await cache()).entries) {
                if (entry.meta.status === "deleted") continue;
                try {
                    registryEntryToCandidate(entry, config.name, baseUrl, deps);
                } catch (error) {
                    onWarn?.(
                        `registry source '${config.name}': '${entry.server.name}@${entry.server.version}' unavailable - ${(error as Error).message}`,
                    );
                    continue;
                }
                warnDeprecated(entry, onWarn);
                rows.push({
                    source: config.name,
                    ref: entry.server.name,
                    defaultAgentName: entry.server.name,
                    description:
                        entry.meta.status === "deprecated"
                            ? `[DEPRECATED] ${entry.server.description}`
                            : entry.server.description,
                    extensionKind: "mcp",
                });
            }
            return rows;
        },
        async refresh() {
            await refreshCache();
        },
        async materialize(): Promise<MaterializedInstallRecord> {
            throw new Error(
                `registry source '${config.name}' materializes MCP candidates through the MCP transaction`,
            );
        },
    };
}
