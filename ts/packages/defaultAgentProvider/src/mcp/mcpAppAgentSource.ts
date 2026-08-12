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
} from "./mcpServerProvider.js";
import { NormalizedMcpServerConfig } from "./mcpServerConfig.js";
import { McpServerStore } from "./mcpServerStore.js";
import registerDebug from "debug";

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
        name: string,
        issuingController?: AppAgentProviderSetController,
    ): Promise<boolean>;
    // Names of the currently-active MCP servers (shipped seed + user store).
    listServers(): string[];
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
): McpAppAgentSourceForTest {
    // One shared provider per active server name (seed + store).
    const providers = new Map<string, AppAgentProvider>();
    const seedNames = new Set(Object.keys(seed));
    // Connected sessions, for cross-session fan-out.
    const clients = new Set<AppAgentProviderSetController>();
    // Serialize writes so a connect() snapshot never races a half-applied swap.
    const limiter = createLimiter(1);

    function buildProvider(
        name: string,
        config: NormalizedMcpServerConfig,
    ): AppAgentProvider {
        return createMcpServerAppAgentProvider(name, config, clientInfo);
    }

    // Seed the always-present shipped servers, then the user store on top.
    for (const [name, config] of Object.entries(seed)) {
        providers.set(name, buildProvider(name, { ...config, name }));
    }
    for (const config of store.list()) {
        if (!seedNames.has(config.name)) {
            providers.set(config.name, buildProvider(config.name, config));
        }
    }

    const testApi: McpServerSourceApi = {
        async addServer(config, issuingController) {
            await limiter(async () => {
                if (seedNames.has(config.name)) {
                    throw new Error(
                        `Cannot add MCP server '${config.name}': name is reserved by a shipped server`,
                    );
                }
                store.set(config);
                const existing = providers.get(config.name);
                const next = buildProvider(config.name, config);
                providers.set(config.name, next);
                await fanOut(clients, issuingController, async (mutation) => {
                    // Replace in place: remove the old provider before adding the
                    // new one so the name is never registered twice.
                    if (existing !== undefined) {
                        await mutation.removeProvider(existing, {
                            dropConfig: false,
                        });
                    }
                    await mutation.addProvider(next);
                });
            });
        },
        async removeServer(name, issuingController) {
            return limiter(async () => {
                if (seedNames.has(name)) {
                    throw new Error(
                        `Cannot remove shipped MCP server '${name}'`,
                    );
                }
                const existing = providers.get(name);
                if (existing === undefined) {
                    return false;
                }
                store.remove(name);
                providers.delete(name);
                await fanOut(clients, issuingController, async (mutation) => {
                    await mutation.removeProvider(existing, {
                        dropConfig: true,
                    });
                });
                return true;
            });
        },
        listServers: () => [...providers.keys()],
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
                providers: Promise.resolve(disposed ? [] : snapshot),
                dispose() {
                    disposed = true;
                    clients.delete(controller);
                },
            };
        },
    };
    return source;
}
