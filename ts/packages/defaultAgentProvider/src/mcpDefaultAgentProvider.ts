// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentProvider, AppAgentSource } from "agent-dispatcher";
import { getPackageFilePath } from "./utils/getPackageFilePath.js";
import {
    InstanceConfigProvider,
    getInstanceConfigProvider,
    getProviderConfig,
} from "./utils/config.js";
import { createMcpAppAgentProvider } from "./mcpAgentProvider.js";
import { buildMcpSeed } from "./mcp/mcpSeed.js";
import { openMcpServerStore } from "./mcp/mcpServerStore.js";
import {
    createMcpAppAgentSource,
    McpAppAgentSourceForTest,
} from "./mcp/mcpAppAgentSource.js";
import type { NormalizedMcpServerConfig } from "./mcp/mcpServerConfig.js";
import type { McpHostServices } from "./mcp/mcpServerProvider.js";
import type { McpConfigDiscoveryResult } from "./mcp/mcpConfigDiscovery.js";
import registerDebug from "debug";

const MCP_CLIENT_INFO = { name: "typeagent", version: "0.0.1" };
const debug = registerDebug("typeagent:mcp:discovery");

let mcpAppAgentProvider: AppAgentProvider | undefined;

// The shipped-server seed the dynamic MCP source vends: every `data/config.json`
// mcpServers entry that can be expressed as a static normalized config. Entries
// with interactive arg definitions (e.g. the filesystem server) are NOT here —
// they stay on the legacy provider. Script paths resolve against the package.
function getShippedSeed(): Record<string, NormalizedMcpServerConfig> {
    return buildMcpSeed(getProviderConfig().mcpServers, getPackageFilePath);
}

function initializeMcpAppAgentProvider(
    instanceConfigs?: InstanceConfigProvider,
) {
    const servers = structuredClone(getProviderConfig().mcpServers);
    if (servers === undefined) {
        return undefined;
    }

    // Hand every statically-convertible shipped server to the dynamic MCP
    // source (see getMcpAppAgentSource); the legacy provider keeps only the ones
    // that cannot be seeded (interactive arg definitions), so no name is
    // registered by two providers.
    const seeded = new Set(Object.keys(getShippedSeed()));
    for (const name of Object.keys(servers)) {
        if (seeded.has(name)) {
            delete servers[name];
        }
    }
    if (Object.keys(servers).length === 0) {
        return undefined;
    }

    for (const entry of Object.values(servers)) {
        if (entry.serverScript !== undefined) {
            entry.serverScript = getPackageFilePath(entry.serverScript);
        }
    }
    return createMcpAppAgentProvider(
        "typeagent",
        "0.0.1",
        servers,
        instanceConfigs,
    );
}

export function getDefaultMcpAppAgentProvider(
    instanceConfigs?: InstanceConfigProvider,
): AppAgentProvider | undefined {
    if (instanceConfigs !== undefined) {
        return initializeMcpAppAgentProvider(instanceConfigs);
    }

    // Only reuse if there is no instanceConfigs provided
    if (mcpAppAgentProvider === undefined) {
        mcpAppAgentProvider = initializeMcpAppAgentProvider();
    }
    return mcpAppAgentProvider;
}

/**
 * Build the dynamic MCP {@link AppAgentSource} for user-managed servers plus the
 * statically-seeded shipped servers, keyed off an instance directory (matching
 * {@link getDefaultAppAgentSource}). The store reserves every shipped server
 * name so a user config can never shadow a shipped one. The test-only handle is
 * stripped before the source is handed to hosts.
 */
export function getMcpAppAgentSource(instanceDir: string): AppAgentSource {
    const { testApi, ...source } = createMcpAppAgentSourceForInstance(
        getInstanceConfigProvider(instanceDir),
    );
    void testApi;
    return source;
}

/**
 * @internal Exported for focused unit tests only. Runtime callers must use
 * {@link getMcpAppAgentSource}, which strips the test-only handle.
 */
export function createMcpAppAgentSourceForInstance(
    instanceConfigs: InstanceConfigProvider,
    services?: McpHostServices,
    discovery?: McpConfigDiscoveryResult,
): McpAppAgentSourceForTest {
    const instanceDir = instanceConfigs.getInstanceDir();
    if (instanceDir === undefined) {
        throw new Error(
            "Internal error: MCP app agent source requires an instance directory.",
        );
    }
    const seed = getShippedSeed();
    // Reserve ALL shipped server names (both seeded and legacy) so the user
    // store can never register a name owned by another provider.
    const reserved = new Set(Object.keys(getProviderConfig().mcpServers ?? {}));
    const store = openMcpServerStore(
        instanceDir,
        reserved,
        new Set(Object.values(seed).map((config) => config.id)),
    );
    if (discovery !== undefined) {
        for (const diagnostic of discovery.diagnostics) {
            debug(diagnostic.message);
        }
        const existingByName = new Map(
            store.list().map((config) => [config.name, config]),
        );
        for (const discovered of discovery.configs) {
            const config = discovered.config;
            if (reserved.has(config.name)) {
                const message = `Skipped discovered MCP server '${config.name}': name is reserved by a shipped server.`;
                discovery.diagnostics.push({
                    kind: "duplicate",
                    filePath: discovered.filePath,
                    serverName: config.name,
                    message,
                });
                debug(message);
                continue;
            }
            const existing = existingByName.get(config.name);
            if (
                existing !== undefined &&
                !existing.provenance.sourceKind?.startsWith("workspace-") &&
                existing.provenance.sourceKind !== "copilot-user"
            ) {
                const message = `Skipped discovered MCP server '${config.name}': a managed server with that name already exists.`;
                discovery.diagnostics.push({
                    kind: "duplicate",
                    filePath: discovered.filePath,
                    serverName: config.name,
                    replacedFilePath: existing.provenance.source,
                    message,
                });
                debug(message);
                continue;
            }
            const next =
                existing === undefined
                    ? config
                    : {
                          ...config,
                          id: existing.id,
                          trust: existing.trust,
                          enabled: existing.enabled,
                      };
            try {
                store.set(next);
            } catch (error) {
                const message = `Skipped discovered MCP server '${config.name}': ${error instanceof Error ? error.message : String(error)}`;
                discovery.diagnostics.push({
                    kind: "invalid",
                    filePath: discovered.filePath,
                    serverName: config.name,
                    message,
                });
                debug(message);
                continue;
            }
            existingByName.set(next.name, next);
        }
    }
    return createMcpAppAgentSource(
        store,
        seed,
        MCP_CLIENT_INFO,
        services,
        discovery,
    );
}
