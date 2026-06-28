// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgentProvider,
    AppAgentInstaller,
    IndexingServiceRegistry,
    DefaultIndexingServiceRegistry,
    DispatcherOptions,
} from "agent-dispatcher";
import {
    InstallSourceConfig,
    InstalledAgentRecord,
} from "./installSources/config.js";

import path from "node:path";
import {
    getInstanceConfigProvider,
    getProviderConfig,
    getResolvedInstallSources,
    InstanceConfig,
    InstanceConfigProvider,
} from "./utils/config.js";
import { getDefaultMcpAppAgentProvider } from "./mcpDefaultAgentProvider.js";
import {
    createInstalledAppAgentProvider,
    getAppBundleRequirePath,
    loadInstalledRecords,
    readAgentsJson,
    writeAgentsJson,
} from "./installSources/installedAgents.js";
import { createInstallSourceRegistry } from "./installSources/registry.js";
import { getSourceCommands } from "./installSources/sourceCommands.js";
import { AsyncMutex } from "./installSources/mutex.js";

/**
 * Get the default app agent providers.
 *
 * Returns the single installed-agent provider (built from `agents.json` /
 * pre-installed builtins, design §4.4) plus the MCP provider when configured.
 * The legacy `defaultNpm` + `external` providers are collapsed into the one
 * installed-agent provider (design §8).
 *
 * @param instanceDirOrConfigProvider - Either the instance directory string or
 *   an InstanceConfigProvider. Undefined builds an in-memory provider over the
 *   bundled builtins (no agents.json).
 * @param configName - Optional config name (e.g. "test" -> config.test.json).
 *   Named configs select a fixed agent set in-memory (no agents.json).
 */
export function getDefaultAppAgentProviders(
    instanceDirOrConfigProvider: string | InstanceConfigProvider | undefined,
    configName?: string,
): AppAgentProvider[] {
    const instanceConfigs =
        typeof instanceDirOrConfigProvider === "string"
            ? getInstanceConfigProvider(instanceDirOrConfigProvider)
            : instanceDirOrConfigProvider;
    const instanceDir = instanceConfigs?.getInstanceDir();
    const { installDir } = getResolvedInstallSources(instanceConfigs);
    const records = loadInstalledRecords(instanceDir, configName);
    const installedProvider = createInstalledAppAgentProvider(records, {
        installDir,
        appBundleRequirePath: getAppBundleRequirePath(),
    });
    const providers = [installedProvider];
    const mcpProvider = getDefaultMcpAppAgentProvider(instanceConfigs);
    if (mcpProvider !== undefined) {
        providers.push(mcpProvider);
    }
    return providers;
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
 * Build the registry-backed installer for the default host (design §4.3, §4.5).
 * A thin wrapper over `registry.resolve(ref, sourceName)` plus writing the
 * resulting record to `agents.json`. The registry (path / catalog / feed
 * sources) hangs off the installer so `@source` is available wherever
 * `@install` is.
 */
export function getDefaultAppAgentInstaller(
    instanceDir: string,
): AppAgentInstaller {
    const instanceConfigs = getInstanceConfigProvider(instanceDir);
    const { order, installDir, sources } =
        getResolvedInstallSources(instanceConfigs);
    // One shared mutex serializes the whole install op (resolve + materialize +
    // record write) and uninstall (design §12 Q5).
    const mutex = new AsyncMutex();
    const appBundleRequirePath = getAppBundleRequirePath();

    function persistSources(
        configs: InstallSourceConfig[],
        orderNames: string[],
    ): void {
        const current = instanceConfigs.getInstanceConfig();
        const next: InstanceConfig = {
            ...current,
            installSources: {
                ...current.installSources,
                sources: configs,
                order: orderNames,
            },
        };
        instanceConfigs.setInstanceConfig(next);
    }

    const registry = createInstallSourceRegistry(sources, order, {
        installDir,
        mutex,
        persist: persistSources,
    });

    function buildProviderFor(
        records: Record<string, InstalledAgentRecord>,
    ): AppAgentProvider {
        return createInstalledAppAgentProvider(records, {
            installDir,
            appBundleRequirePath,
        });
    }

    return {
        async install(
            name: string,
            ref: string,
            sourceName?: string,
        ): Promise<AppAgentProvider> {
            // resolve + materialize is serialized by the registry's mutex
            // (design §4.1). After it returns, the installer re-takes the same
            // shared mutex to write the record (sequential, not nested).
            const resolved = await registry.resolve(ref, sourceName);
            // The installer assigns the authoritative dispatcher name.
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
            await mutex.runExclusive(async () => {
                const current = readAgentsJson(instanceDir) ?? { agents: {} };
                if (current.agents[name] !== undefined) {
                    throw new Error(`Agent '${name}' already exists`);
                }
                current.agents[name] = record;
                writeAgentsJson(instanceDir, current);
            });
            return buildProviderFor({ [name]: record });
        },
        async uninstall(name: string): Promise<void> {
            await mutex.runExclusive(async () => {
                const current = readAgentsJson(instanceDir) ?? { agents: {} };
                if (current.agents[name] === undefined) {
                    throw new Error(`Agent '${name}' not found`);
                }
                delete current.agents[name];
                writeAgentsJson(instanceDir, current);
            });
        },
        async update(name: string, range?: string): Promise<AppAgentProvider> {
            // Look up the recorded provenance and re-resolve against its
            // recorded source (design §5). The whole materialize runs first;
            // the old record is overwritten only after it succeeds, so a failed
            // update leaves the old agent intact (design §4.7, §12 Q13).
            const existing = readAgentsJson(instanceDir)?.agents[name];
            if (existing === undefined) {
                throw new Error(`Agent '${name}' not found`);
            }
            const source = registry.get(existing.source);
            if (source === undefined) {
                throw new Error(
                    `Source '${existing.source}' for agent '${name}' is no longer configured; ` +
                        `re-add it with '@source add' to update, or '@uninstall ${name}'.`,
                );
            }
            // Build the re-resolution ref from the record, per source kind.
            let ref: string;
            switch (source.kind) {
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
                            source.kind,
                        )}`,
                    );
                }
            }
            // Materialize the new version (serialized by the registry mutex).
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
            await mutex.runExclusive(async () => {
                const current = readAgentsJson(instanceDir) ?? { agents: {} };
                current.agents[name] = record;
                writeAgentsJson(instanceDir, current);
            });
            return buildProviderFor({ [name]: record });
        },
        sourceCommands() {
            // The host owns the entire `@source` surface (list/order/where/
            // remove/add): the kind taxonomy, typed flags, validation, and any
            // auth UI. The dispatcher core merges this table in as `@source`.
            return getSourceCommands({
                registry,
                recordsUsingSource: (sourceName: string) => {
                    const agents =
                        readAgentsJson(instanceDir)?.agents ?? {};
                    return Object.values(agents)
                        .filter((record) => record.source === sourceName)
                        .map((record) => record.name);
                },
            });
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
