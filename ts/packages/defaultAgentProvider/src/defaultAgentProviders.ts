// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgentProvider,
    AppAgentSource,
    AppAgentConnection,
    AppAgentHost,
    InstallResult,
    InstalledAgentInfo,
    IndexingServiceRegistry,
    DefaultIndexingServiceRegistry,
    DispatcherOptions,
} from "agent-dispatcher";
import {
    InstallSourceConfig,
    InstalledAgentRecord,
} from "./installSources/config.js";
import {
    createPackageAppAgentProvider,
    InstalledAgentSourceApi,
} from "./installSources/packageAgent.js";

import path from "node:path";
import {
    getInstanceConfigProvider,
    getInstallDir,
    getProviderConfig,
    getResolvedInstallSources,
    InstallSourcesResolveOptions,
    InstanceConfig,
    InstanceConfigProvider,
} from "./utils/config.js";
import { getDefaultMcpAppAgentProvider } from "./mcpDefaultAgentProvider.js";
import {
    createBundledAppAgentProvider,
    createInstalledAppAgentProvider,
    getAppBundleRequirePath,
    getBundledAgentNames,
    loadInstalledRecords,
    readAgentsJson,
    writeAgentsJson,
} from "./installSources/installedAgents.js";
import { createInstallSourceRegistry } from "./installSources/registry.js";
import { getSourceCommands } from "./installSources/sourceCommands.js";
import { createLimiter } from "@typeagent/common-utils";

/**
 * Get the default STATIC app agent providers.
 *
 * Returns the static bundled-agent provider (the app's shipped agents, always
 * present) plus the MCP provider when configured. The installed agents
 * (`agents.json`) are NO LONGER returned here — they are vended by the connected
 * {@link getDefaultAppAgentSource} as per-agent providers (design §3.3), so a
 * host injects them via `appAgentSources`, not `appAgentProviders`. The bundled
 * agents are their own static provider and are never installed/uninstalled.
 *
 * @param instanceDirOrConfigProvider - Either the instance directory string or
 *   an InstanceConfigProvider. Undefined builds only the bundled provider.
 * @param configName - Optional config name (e.g. "test" -> config.test.json).
 */
export function getDefaultAppAgentProviders(
    instanceDirOrConfigProvider: string | InstanceConfigProvider | undefined,
    configName?: string,
): AppAgentProvider[] {
    // The bundled agents are always present as their own static provider.
    const providers: AppAgentProvider[] = [
        createBundledAppAgentProvider(configName),
    ];
    const instanceConfigs =
        typeof instanceDirOrConfigProvider === "string"
            ? getInstanceConfigProvider(instanceDirOrConfigProvider)
            : instanceDirOrConfigProvider;
    const mcpProvider = getDefaultMcpAppAgentProvider(instanceConfigs);
    if (mcpProvider !== undefined) {
        providers.push(mcpProvider);
    }
    return providers;
}

/**
 * Build the multi-root installed-agent provider from `agents.json`. Used only
 * for static enumeration (e.g. the indexing-service registry) where the live
 * connection lifecycle is not involved. The dispatcher runtime instead gets
 * installed agents from {@link getDefaultAppAgentSource}. Returns undefined when
 * no instance dir is available.
 */
function getInstalledAppAgentProvider(
    instanceConfigs: InstanceConfigProvider | undefined,
): AppAgentProvider | undefined {
    const instanceDir = instanceConfigs?.getInstanceDir();
    if (instanceDir === undefined) {
        return undefined;
    }
    const installDir = getInstallDir(instanceConfigs);
    const records = loadInstalledRecords(instanceDir);
    return createInstalledAppAgentProvider(records, {
        ...(installDir !== undefined ? { installDir } : {}),
        appBundleRequirePath: getAppBundleRequirePath(),
    });
}

/**
 * Return dispatcher-level options derived from the provider config.json.
 * Spread the result into DispatcherOptions alongside appAgentProviders so
 * config.json fields like `promptAppend` reach the Claude reasoning prompt.
 */
export function getDefaultDispatcherOptions(
    configName?: string,
): Pick<DispatcherOptions, "promptAppend"> {
    const cfg = getProviderConfig(configName);
    const options: Pick<DispatcherOptions, "promptAppend"> = {};
    if (cfg.promptAppend) {
        options.promptAppend = cfg.promptAppend;
    }
    return options;
}

/**
 * Options for {@link getDefaultAppAgentSource}. Remote hosts (e.g. the web API
 * server) set `excludePathSources` to skip `path` sources during resolution,
 * whose refs would otherwise resolve against the server's own filesystem.
 */
export type DefaultAppAgentSourceOptions = InstallSourcesResolveOptions;

/**
 * Build the registry-backed {@link AppAgentSource} for the default host (design
 * §3.2, §3.3). It owns the `agents.json` record store + the source registry and:
 *
 * - vends **one single-agent provider per installed record** (shared instances,
 *   refcounted) at `connect()`, plus the host-owned `@package` app agent
 *   (design §3.4) bound to that session's {@link AppAgentHost};
 * - implements install/uninstall/update by mutating the record store and, in
 *   Phase 1 (this milestone), registering/tearing down on the **issuing session
 *   only** — the handler reaches its own `AppAgentHost` off the package agent's
 *   `agentContext`. Cross-session fan-out over the client registry is added in
 *   Milestone 3.
 */
/**
 * Build the registry-backed {@link AppAgentSource} for the default host (design
 * §3.2, §3.3). Thin wrapper over {@link createDefaultInstalledAgentSource} that
 * narrows the return to the dispatcher-facing `connect()` view, so a host can
 * never drive an install through it.
 */
export function getDefaultAppAgentSource(
    instanceDir: string,
    options?: DefaultAppAgentSourceOptions,
): AppAgentSource {
    return createDefaultInstalledAgentSource(instanceDir, options);
}

/**
 * The concrete installed-agent source (design §3.2). Besides the dispatcher-
 * facing `connect()`, it also carries the write/command surface (`api`) the
 * host-owned `@package` agent uses. The dispatcher is handed only the narrow
 * `AppAgentSource` view (see {@link getDefaultAppAgentSource}); `api` is exposed
 * for the host wiring and tests.
 */
export function createDefaultInstalledAgentSource(
    instanceDir: string,
    options?: DefaultAppAgentSourceOptions,
): AppAgentSource & { readonly api: InstalledAgentSourceApi } {
    const instanceConfigs = getInstanceConfigProvider(instanceDir);
    const installDir = getInstallDir(instanceConfigs);
    // The installer always has a concrete instanceDir, so installDir is
    // resolved; this invariant guards the registry/provider below (which
    // require a real install root) and turns any future regression into a
    // loud failure rather than a silent CWD-relative write.
    if (installDir === undefined) {
        throw new Error(
            "Internal error: install directory could not be resolved (no instance directory).",
        );
    }
    const sources = getResolvedInstallSources(instanceConfigs);
    // One shared limiter serializes the whole install op (resolve + materialize +
    // record write) and uninstall (design §12 Q5).
    const limiter = createLimiter(1);
    const appBundleRequirePath = getAppBundleRequirePath();

    function persistSources(configs: InstallSourceConfig[]): void {
        const current = instanceConfigs.getInstanceConfig();
        // Reconstruct installSources from the known fields only, dropping any
        // legacy fields (e.g. a stored `order` array or `installDir` override,
        // both no longer used; the source list order is the resolution order
        // and installDir is always derived at runtime).
        const next: InstanceConfig = {
            ...current,
            installSources: {
                sources: configs,
            },
        };
        instanceConfigs.setInstanceConfig(next);
    }

    const registry = createInstallSourceRegistry(sources, {
        installDir,
        limiter,
        persist: persistSources,
        ...(options?.excludePathSources !== undefined
            ? { excludePathSources: options.excludePathSources }
            : {}),
    });

    function buildProviderFor(
        records: Record<string, InstalledAgentRecord>,
    ): AppAgentProvider {
        return createInstalledAppAgentProvider(records, {
            ...(installDir !== undefined ? { installDir } : {}),
            appBundleRequirePath,
        });
    }

    // Builtins are the app's shipped bundled agents (their own static
    // provider), so they can never be installed-over, uninstalled, or updated.
    function isBuiltin(name: string): boolean {
        return getBundledAgentNames().has(name);
    }

    // Shared per-agent provider instances (design §3.3): one single-agent,
    // single-root provider per installed record, seeded from agents.json and
    // vended (the same instance) to every connected session. install/uninstall/
    // update keep this map in sync so later connects see the current set.
    const installedProviders = new Map<string, AppAgentProvider>();
    for (const [name, record] of Object.entries(
        loadInstalledRecords(instanceDir),
    )) {
        installedProviders.set(name, buildProviderFor({ [name]: record }));
    }

    // The client registry of connected AppAgentHosts (design §3.3). Built now;
    // used for cross-session fan-out in Milestone 3. In Phase 1 the issuing
    // session is reached directly via the package agent's own AppAgentHost.
    const clients = new Set<AppAgentHost>();

    const source: InstalledAgentSourceApi = {
        async install(
            name: string,
            ref: string,
            sourceName?: string,
        ): Promise<InstallResult> {
            if (isBuiltin(name)) {
                throw new Error(
                    `Agent '${name}' is built-in and cannot be shadowed by an install`,
                );
            }
            // resolve + materialize is serialized by the registry's limiter
            // (design §4.1). After it returns, we re-take the same shared
            // limiter to write the record (sequential, not nested). Collect any
            // non-fatal source degrade warnings raised during the resolve.
            const warningSet = new Set<string>();
            const resolved = await registry.resolve(ref, sourceName, (m) =>
                warningSet.add(m),
            );
            // The source assigns the authoritative dispatcher name.
            const record: InstalledAgentRecord = { ...resolved, name };
            // Preserve the user-supplied lookup key so `@update` can
            // re-resolve a catalog agent installed under a different name than
            // its catalog key (catalog `materialize` leaves `ref` unset). Feed
            // records already carry their specifier in `ref`; this only fills
            // the gap for catalog/path records.
            if (record.ref === undefined) {
                record.ref = ref;
            }
            // Persist the record under the same serialization domain.
            await limiter(async () => {
                const current = readAgentsJson(instanceDir) ?? { agents: {} };
                if (current.agents[name] !== undefined) {
                    throw new Error(`Agent '${name}' already exists`);
                }
                current.agents[name] = record;
                writeAgentsJson(instanceDir, current);
            });
            // Cache the shared per-agent provider so later connects vend it.
            const provider = buildProviderFor({ [name]: record });
            installedProviders.set(name, provider);
            return {
                provider,
                source: record.source,
                ...(warningSet.size > 0 ? { warnings: [...warningSet] } : {}),
            };
        },
        async uninstall(
            name: string,
        ): Promise<{ provider: AppAgentProvider | undefined }> {
            if (isBuiltin(name)) {
                throw new Error(
                    `Agent '${name}' is built-in and cannot be uninstalled`,
                );
            }
            await limiter(async () => {
                const current = readAgentsJson(instanceDir) ?? { agents: {} };
                if (current.agents[name] === undefined) {
                    throw new Error(`Agent '${name}' not found`);
                }
                delete current.agents[name];
                writeAgentsJson(instanceDir, current);
            });
            // Hand back the shared provider so the caller tears it down in the
            // live session; drop it from the vended set.
            const provider = installedProviders.get(name);
            installedProviders.delete(name);
            return { provider };
        },
        async update(
            name: string,
            range?: string,
        ): Promise<{
            oldProvider: AppAgentProvider | undefined;
            newProvider: AppAgentProvider;
        }> {
            if (isBuiltin(name)) {
                throw new Error(
                    `Agent '${name}' is built-in and cannot be updated`,
                );
            }
            // Look up the recorded provenance and re-resolve against its
            // recorded source (design §5). The whole materialize runs first;
            // the old record is overwritten only after it succeeds, so a failed
            // update leaves the old agent intact (design §4.7, §12 Q13).
            const existing = readAgentsJson(instanceDir)?.agents[name];
            if (existing === undefined) {
                throw new Error(`Agent '${name}' not found`);
            }
            const sourceEntry = registry.get(existing.source);
            if (sourceEntry === undefined) {
                throw new Error(
                    `Source '${existing.source}' for agent '${name}' is no longer configured; ` +
                        `re-add it with '@source add' to update, or '@uninstall ${name}'.`,
                );
            }
            // Build the re-resolution ref from the record, per source kind.
            let ref: string;
            switch (sourceEntry.kind) {
                case "feed": {
                    // Re-resolve the package, optionally constrained by range;
                    // omitting range targets the latest available version.
                    const moduleName = existing.module;
                    if (moduleName === undefined) {
                        throw new Error(
                            `Feed record for '${name}' is missing its 'module' (corrupt record).`,
                        );
                    }
                    ref =
                        range !== undefined
                            ? `${moduleName}@${range}`
                            : moduleName;
                    break;
                }
                case "path": {
                    // Re-materialize from the recorded path (picks up a moved /
                    // rebuilt local agent).
                    if (existing.path === undefined) {
                        throw new Error(
                            `Agent '${name}' has no recorded path to refresh.`,
                        );
                    }
                    ref = existing.path;
                    break;
                }
                case "catalog": {
                    // Re-look-up the catalog key. Prefer the preserved lookup
                    // key (`ref`, set at install) so renamed installs still
                    // re-resolve; fall back to the dispatcher name for older
                    // records (it equals the key for builtins / same-name
                    // installs).
                    ref = existing.ref ?? existing.name;
                    break;
                }
                default: {
                    throw new Error(
                        `unknown source kind for '${name}': ${String(
                            sourceEntry.kind,
                        )}`,
                    );
                }
            }
            // Materialize the new version (serialized by the registry limiter).
            const resolved = await registry.resolve(ref, existing.source);
            const record: InstalledAgentRecord = { ...resolved, name };
            // Preserve the re-resolution key across updates, the same way
            // install does, so repeated `@update`s of a renamed catalog agent
            // keep re-looking-up the original key (catalog `materialize` leaves
            // `ref` unset).
            if (record.ref === undefined) {
                record.ref = ref;
            }
            // Overwrite only after a successful materialize (§12 Q13).
            await limiter(async () => {
                const current = readAgentsJson(instanceDir) ?? { agents: {} };
                current.agents[name] = record;
                writeAgentsJson(instanceDir, current);
            });
            // Swap the shared provider for the freshly materialized one.
            const oldProvider = installedProviders.get(name);
            const newProvider = buildProviderFor({ [name]: record });
            installedProviders.set(name, newProvider);
            return { oldProvider, newProvider };
        },
        sourceCommands() {
            // The host owns the entire `@source` surface (list/order/where/
            // remove/add): the kind taxonomy, typed flags, validation, and any
            // auth UI. The dispatcher core merges this table in as `@source`.
            return getSourceCommands({
                registry,
                recordsUsingSource: (sourceName: string) => {
                    const agents = readAgentsJson(instanceDir)?.agents ?? {};
                    return Object.values(agents)
                        .filter((record) => record.source === sourceName)
                        .map((record) => record.name);
                },
            });
        },
        listInstalled(): InstalledAgentInfo[] {
            // The source owns only mutable install records (`agents.json`).
            // Bundled agents are provided separately by the bundled provider and
            // are intentionally excluded from these install summaries. A record
            // carries exactly one resolution handle (ref / module / path).
            const agents = readAgentsJson(instanceDir)?.agents ?? {};
            return Object.values(agents).map((record) => {
                const handle = record.ref ?? record.module ?? record.path;
                return {
                    name: record.name,
                    source: record.source,
                    ...(handle !== undefined ? { handle } : {}),
                };
            });
        },
        listSources(): string[] {
            // Source names in resolution order, for `@package install --source`
            // completion.
            return registry.list().map((info) => info.name);
        },
        async listAvailable(): Promise<string[]> {
            // Enumerable agent refs across the sources (catalog/feed advertise
            // theirs; path sources don't), de-duplicated, for `@package install`
            // ref completion.
            const lists = await Promise.all(
                registry
                    .list()
                    .map((info) => registry.get(info.name))
                    .map((entry) => entry?.listAgents?.() ?? []),
            );
            return [...new Set(lists.flat())];
        },
    };

    // The dispatcher-facing AppAgentSource surface (design §3.2): connect() is
    // the only view the dispatcher gets, so it can never drive an install. The
    // concrete object also carries `api` (the write/command surface) for the
    // host-owned `@package` agent and tests.
    return {
        api: source,
        connect(host: AppAgentHost): AppAgentConnection {
            clients.add(host);
            // The package agent is per-connection (its agentContext carries this
            // session's AppAgentHost); the installed providers are shared.
            const packageProvider = createPackageAppAgentProvider({
                appAgentHost: host,
                source,
            });
            const providers: AppAgentProvider[] = [
                packageProvider,
                ...installedProviders.values(),
            ];
            return {
                providers,
                dispose() {
                    // Deregister this host from the fan-out registry (design §6).
                    // Does NOT tear down the shared providers — other sessions
                    // still hold them; the dispatcher unregisters them from its
                    // own manager at teardown.
                    clients.delete(host);
                },
            };
        },
    };
}

/**
 * Build indexing service registry from all available app agent providers
 * @param instanceDirOrConfigProvider - Either a string pointing to the instance directory where external agent config is stored, or a InstanceConfigProvider.
 * @param configName - Optional config name to load specific configuration file (e.g. "test" to load "config.test.json"). If not provided, it will load "config.json".
 * @returns IndexingServiceRegistry containing all registered indexing services
 */
export async function getIndexingServiceRegistry(
    instanceDirOrConfigProvider?: string | InstanceConfigProvider,
    configName?: string,
): Promise<IndexingServiceRegistry> {
    const providers = getDefaultAppAgentProviders(
        instanceDirOrConfigProvider,
        configName,
    );
    // Installed agents are vended by the AppAgentSource at runtime, but their
    // indexing services must still be discovered here, so enumerate them from
    // the static multi-root installed provider too (design §3.3).
    const instanceConfigs =
        typeof instanceDirOrConfigProvider === "string"
            ? getInstanceConfigProvider(instanceDirOrConfigProvider)
            : instanceDirOrConfigProvider;
    const installedProvider = getInstalledAppAgentProvider(instanceConfigs);
    if (installedProvider !== undefined) {
        providers.push(installedProvider);
    }
    const registry = new DefaultIndexingServiceRegistry();

    for (const provider of providers) {
        const agentNames = provider.getAppAgentNames();

        for (const agentName of agentNames) {
            try {
                const manifest = await provider.getAppAgentManifest(agentName);

                if (manifest.indexingServices) {
                    for (const [indexSource, serviceConfig] of Object.entries(
                        manifest.indexingServices,
                    )) {
                        // Resolve the absolute path to the service script
                        let resolvedServicePath: string;
                        try {
                            // Resolve via the bundled config.json `agents` map,
                            // which covers the builtins that declare indexing
                            // services (e.g. browser). Non-builtin installs
                            // (feed / path) are absent here and intentionally
                            // skip indexing-service registration (warn-only
                            // below), not a hard failure.
                            const agentConfigs = getProviderConfig().agents;
                            const agentConfig = agentConfigs[agentName];

                            if (agentConfig) {
                                const { createRequire } = await import(
                                    "module"
                                );
                                const requirePath = agentConfig.path
                                    ? `${path.resolve(agentConfig.path)}${path.sep}package.json`
                                    : import.meta.url;
                                const require = createRequire(requirePath);

                                // Try to resolve the service script directly using the package exports
                                // For browser agent, this will resolve "./agent/indexing" export
                                try {
                                    resolvedServicePath = require.resolve(
                                        `${agentConfig.name}/agent/indexing`,
                                    );
                                } catch (exportError) {
                                    // Fallback: resolve relative to the agent's main module
                                    const agentMainPath = require.resolve(
                                        agentConfig.name,
                                    );
                                    const agentPackageDir =
                                        path.dirname(agentMainPath);
                                    resolvedServicePath = path.resolve(
                                        agentPackageDir,
                                        serviceConfig.serviceScript,
                                    );
                                }
                            } else {
                                throw new Error(
                                    `Agent config not found for ${agentName}`,
                                );
                            }
                        } catch (pathError) {
                            console.warn(
                                `Failed to resolve service path for ${agentName}/${indexSource}: ${pathError}`,
                            );
                            continue;
                        }

                        const serviceInfo = {
                            agentName,
                            serviceScript: resolvedServicePath, // Now an absolute path
                            ...(serviceConfig.description && {
                                description: serviceConfig.description,
                            }),
                        };

                        registry.register(indexSource, serviceInfo);
                    }
                }
            } catch (error) {
                // Agent manifest loading failed, skip this agent
                continue;
            }
        }
    }

    return registry;
}
