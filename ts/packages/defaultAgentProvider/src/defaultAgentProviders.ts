// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgentProvider,
    AppAgentInstaller,
    InstallSourceConfig,
    InstalledAgentRecord,
    IndexingServiceRegistry,
    DefaultIndexingServiceRegistry,
    DispatcherOptions,
} from "agent-dispatcher";

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
        sources() {
            return registry;
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
