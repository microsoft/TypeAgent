// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AppAgentProvider,
    AppAgentSource,
    AppAgentConnection,
    AppAgentProviderSetController,
    AppAgentProviderSetMutation,
} from "agent-dispatcher";
import { createLimiter } from "@typeagent/common-utils";
import {
    createMcpServerAppAgentProvider,
    McpClientInfo,
    McpHostServices,
} from "./mcpServerProvider.js";
import {
    NormalizedMcpServerConfig,
    resolveTransportConfig,
} from "./mcpServerConfig.js";
import { McpServerStore } from "./mcpServerStore.js";
import { McpConnection } from "./mcpConnection.js";
import registerDebug from "debug";
import { enforceMcpPolicy } from "./mcpPolicy.js";
import { defaultMcpPolicy } from "./mcpPolicy.js";
import type { McpPolicy } from "./mcpPolicy.js";
import { McpOAuthProvider, getMcpAuthState } from "./mcpOAuth.js";
import { SessionMcpCredentialStore } from "./mcpCredentialStore.js";
import { nullMcpAuditSink } from "./mcpAudit.js";

const debug = registerDebug("typeagent:mcp:source");

// The write surface of the MCP dynamic source, captured by the host (e.g. the
// `@package` facade) — separate from the narrow dispatcher-facing
// {@link AppAgentSource.connect}. Mirrors the installed-agent source's
// InstalledAgentSourceApi but for MCP server configs. Each mutating op fans out
// to every connected session via its controller, applying to the issuing
// session first (awaited) and the rest best-effort.
export interface McpServerSourceApi {
    // Add or replace a user-managed MCP server: persist it, build the shared
    // single-name provider, and fan `addProvider` (or a remove-then-add swap
    // when the name already exists) out to every connected session.
    addServer(
        config: NormalizedMcpServerConfig,
        issuingController?: AppAgentProviderSetController,
    ): Promise<void>;
    // Remove a user-managed MCP server: drop the record and fan `removeProvider`
    // out to every connected session. Returns true when a server was removed.
    removeServer(
        id: string,
        issuingController?: AppAgentProviderSetController,
    ): Promise<boolean>;
    listServers(): NormalizedMcpServerConfig[];
    getServer(id: string): NormalizedMcpServerConfig | undefined;
    setTrust(
        id: string,
        trust: NormalizedMcpServerConfig["trust"],
        issuingController?: AppAgentProviderSetController,
    ): Promise<NormalizedMcpServerConfig>;
    setEnabled(
        id: string,
        enabled: boolean,
        issuingController?: AppAgentProviderSetController,
    ): Promise<NormalizedMcpServerConfig>;
    updateServer(
        id: string,
        update: Partial<
            Omit<
                NormalizedMcpServerConfig,
                "id" | "scope" | "trust" | "enabled"
            >
        >,
        issuingController?: AppAgentProviderSetController,
    ): Promise<NormalizedMcpServerConfig>;
    // Connect and list tools without mutating trust, enabled state, or the
    // persisted config. Untrusted configs require an explicit caller override
    // after user confirmation.
    testServer(
        id: string,
        allowUntrusted?: boolean,
    ): Promise<{
        protocolEra?: string;
        protocolVersion?: string;
        tools: string[];
    }>;
    setCredential?(
        id: string,
        name: string,
        value: string,
        durable?: boolean,
    ): Promise<void>;
    getAuthState?(id: string): Promise<string>;
    getPolicy?(): McpPolicy;
}

export type McpAppAgentSourceForTest = AppAgentSource & {
    /** @internal Test-only handle for driving mutations directly. */
    readonly testApi: McpServerSourceApi;
};

// Fan one mutation out across a set of controllers. The issuing controller (the
// session that ran the command) is applied first and awaited so the command's
// own session reflects the change synchronously; the remaining sessions are
// applied best-effort — a session that fails to apply (e.g. mid-teardown) is
// logged, never fatal.
async function fanOut(
    clients: ReadonlySet<AppAgentProviderSetController>,
    issuing: AppAgentProviderSetController | undefined,
    apply: (mutation: AppAgentProviderSetMutation) => Promise<void>,
): Promise<void> {
    const ordered: AppAgentProviderSetController[] = [];
    if (issuing !== undefined && clients.has(issuing)) {
        ordered.push(issuing);
    }
    for (const client of clients) {
        if (client !== issuing) {
            ordered.push(client);
        }
    }
    for (const controller of ordered) {
        try {
            const result = await controller.runExclusive(apply);
            if (result.status === "closed") {
                debug("skipped mutation for a closed session");
            }
        } catch (e) {
            debug(`fan-out mutation failed for a session: ${e}`);
        }
    }
}

/**
 * Build the MCP dynamic {@link AppAgentSource}. Vends one shared, refcounted,
 * single-name {@link AppAgentProvider} per active MCP server (shipped seed +
 * user store), and fans add/remove/update out to every connected session via
 * the controller — mirroring the installed-agent source, but without the
 * version-scoped-storage swap barrier: an MCP server carries no name-keyed
 * persistent storage, so a config update is a serialized remove-then-add rather
 * than a quiesced verify-0 replacement.
 *
 * @param store       user-managed server store (writes persist here).
 * @param seed        shipped server configs, always present, never removable.
 * @param clientInfo  MCP client identity used for the handshake.
 */
export function createMcpAppAgentSource(
    store: McpServerStore,
    seed: Record<string, NormalizedMcpServerConfig>,
    clientInfo: McpClientInfo,
    services: McpHostServices = {
        credentialStore: new SessionMcpCredentialStore(),
        policy: defaultMcpPolicy,
        audit: nullMcpAuditSink,
    },
): McpAppAgentSourceForTest {
    // One shared provider per active config id (seed + store).
    const providers = new Map<string, AppAgentProvider>();
    const configs = new Map<string, NormalizedMcpServerConfig>();
    const seedIds = new Set<string>();
    // Connected sessions, for cross-session fan-out.
    const clients = new Set<AppAgentProviderSetController>();
    // Serialize writes so a connect() snapshot never races a half-applied swap.
    const limiter = createLimiter(1);

    function buildProvider(
        config: NormalizedMcpServerConfig,
    ): AppAgentProvider {
        return createMcpServerAppAgentProvider(
            config.name,
            config,
            clientInfo,
            services,
        );
    }

    function isActive(config: NormalizedMcpServerConfig): boolean {
        return config.enabled && config.trust === "trusted";
    }

    // Seed the always-present shipped servers, then the user store on top.
    for (const config of Object.values(seed)) {
        configs.set(config.id, config);
        seedIds.add(config.id);
        if (isActive(config)) {
            providers.set(config.id, buildProvider(config));
        }
    }
    for (const config of store.list()) {
        configs.set(config.id, config);
        if (isActive(config)) {
            providers.set(config.id, buildProvider(config));
        }
    }

    async function replaceUserConfig(
        config: NormalizedMcpServerConfig,
        issuingController?: AppAgentProviderSetController,
    ): Promise<NormalizedMcpServerConfig> {
        if (seedIds.has(config.id) || config.scope === "shipped") {
            throw new Error(
                `Cannot update shipped MCP server config '${config.id}'`,
            );
        }
        const previousProvider = providers.get(config.id);
        store.set(config);
        configs.set(config.id, config);
        const nextProvider = isActive(config)
            ? buildProvider(config)
            : undefined;
        if (nextProvider === undefined) {
            providers.delete(config.id);
        } else {
            providers.set(config.id, nextProvider);
        }
        if (previousProvider !== undefined || nextProvider !== undefined) {
            await fanOut(clients, issuingController, async (mutation) => {
                if (previousProvider !== undefined) {
                    await mutation.removeProvider(previousProvider, {
                        dropConfig: false,
                    });
                }
                if (nextProvider !== undefined) {
                    await mutation.addProvider(nextProvider);
                }
            });
        }
        return config;
    }

    function requireUserConfig(id: string): NormalizedMcpServerConfig {
        const config = configs.get(id);
        if (config === undefined) {
            throw new Error(`Unknown MCP server config '${id}'`);
        }
        if (seedIds.has(id) || config.scope === "shipped") {
            throw new Error(`Cannot update shipped MCP server config '${id}'`);
        }
        return config;
    }

    const testApi: McpServerSourceApi = {
        async addServer(config, issuingController) {
            await limiter(async () => {
                enforceMcpPolicy(services.policy, "install", config);
                if (seedIds.has(config.id)) {
                    throw new Error(
                        `Cannot add MCP server config '${config.id}': id is reserved by a shipped server`,
                    );
                }
                await replaceUserConfig(config, issuingController);
                await services.audit.write({
                    timestamp: new Date().toISOString(),
                    operation: "install",
                    configId: config.id,
                    configName: config.name,
                    transport: config.transport.kind,
                    source: config.provenance.source,
                    status: "success",
                });
            });
        },
        async removeServer(id, issuingController) {
            return limiter(async () => {
                if (seedIds.has(id)) {
                    throw new Error(`Cannot remove shipped MCP server '${id}'`);
                }
                const config = configs.get(id);
                if (config === undefined) {
                    return false;
                }
                const existing = providers.get(id);
                store.remove(id);
                configs.delete(id);
                providers.delete(id);
                if (existing !== undefined) {
                    await fanOut(
                        clients,
                        issuingController,
                        async (mutation) => {
                            await mutation.removeProvider(existing, {
                                dropConfig: true,
                            });
                        },
                    );
                }
                await services.audit.write({
                    timestamp: new Date().toISOString(),
                    operation: "uninstall",
                    configId: config.id,
                    configName: config.name,
                    transport: config.transport.kind,
                    source: config.provenance.source,
                    status: "success",
                });
                return true;
            });
        },
        listServers: () => [...configs.values()],
        getServer: (id) => configs.get(id),
        async setTrust(id, trust, issuingController) {
            return limiter(async () => {
                const config = requireUserConfig(id);
                if (trust === "trusted") {
                    enforceMcpPolicy(services.policy, "trust", config);
                }
                const updated = await replaceUserConfig(
                    { ...config, trust },
                    issuingController,
                );
                await services.audit.write({
                    timestamp: new Date().toISOString(),
                    operation: "trust",
                    configId: config.id,
                    configName: config.name,
                    decision: trust,
                    status: "success",
                });
                return updated;
            });
        },
        async setEnabled(id, enabled, issuingController) {
            return limiter(async () => {
                const config = requireUserConfig(id);
                if (enabled) {
                    enforceMcpPolicy(services.policy, "enable", config);
                }
                const updated = await replaceUserConfig(
                    { ...config, enabled },
                    issuingController,
                );
                await services.audit.write({
                    timestamp: new Date().toISOString(),
                    operation: enabled ? "enable" : "disable",
                    configId: config.id,
                    configName: config.name,
                    status: "success",
                });
                return updated;
            });
        },
        async updateServer(id, update, issuingController) {
            return limiter(async () => {
                const config = requireUserConfig(id);
                const updated = { ...config, ...update };
                enforceMcpPolicy(services.policy, "update", updated);
                const result = await replaceUserConfig(
                    updated,
                    issuingController,
                );
                await services.audit.write({
                    timestamp: new Date().toISOString(),
                    operation: "update",
                    configId: config.id,
                    configName: updated.name,
                    status: "success",
                });
                return result;
            });
        },
        async testServer(id, allowUntrusted = false) {
            const config = configs.get(id);
            if (config === undefined) {
                throw new Error(`Unknown MCP server config '${id}'`);
            }
            if (config.trust !== "trusted" && !allowUntrusted) {
                throw new Error(
                    `MCP server '${config.name}' is untrusted; confirm an explicit test before connecting.`,
                );
            }
            enforceMcpPolicy(services.policy, "connect", config);
            const transport = await resolveTransportConfig(
                config,
                services.credentialStore,
            );
            if (transport.kind === "http" && config.oauth?.enabled === true) {
                transport.authProvider = new McpOAuthProvider(
                    config,
                    services.credentialStore,
                    services.oauthInteraction,
                );
            }
            const connection = await McpConnection.create(
                clientInfo,
                transport,
            );
            try {
                const tools = await connection.listTools();
                if (config.oauth?.enabled === true) {
                    await services.audit.write({
                        timestamp: new Date().toISOString(),
                        operation: "auth",
                        configId: config.id,
                        configName: config.name,
                        transport: "http",
                        source: config.provenance.source,
                        status: "success",
                    });
                }
                return {
                    ...(connection.protocolEra === undefined
                        ? {}
                        : { protocolEra: connection.protocolEra }),
                    ...(connection.protocolVersion === undefined
                        ? {}
                        : { protocolVersion: connection.protocolVersion }),
                    tools: tools.map((tool) => tool.name),
                };
            } finally {
                await connection.close();
            }
        },
        async setCredential(id, name, value, durable = false) {
            const config = configs.get(id);
            if (config === undefined) {
                throw new Error(`Unknown MCP server config '${id}'`);
            }
            await services.credentialStore.set(name, value, { durable });
        },
        async getAuthState(id) {
            const config = configs.get(id);
            if (config === undefined) {
                throw new Error(`Unknown MCP server config '${id}'`);
            }
            return getMcpAuthState(config, services.credentialStore);
        },
        getPolicy: () => structuredClone(services.policy),
    };

    const source: McpAppAgentSourceForTest = {
        testApi,
        connect(controller: AppAgentProviderSetController): AppAgentConnection {
            let disposed = false;
            // Synchronously join the fan-out set and snapshot the active
            // providers. Writes are serialized (limiter), so this snapshot is
            // consistent with whatever set is currently committed; a write that
            // lands after we join reaches this session via fan-out.
            clients.add(controller);
            const snapshot = [...providers.values()];
            return {
                providers: Promise.resolve().then(() =>
                    disposed ? [] : snapshot,
                ),
                dispose() {
                    disposed = true;
                    clients.delete(controller);
                },
            };
        },
    };
    return source;
}
