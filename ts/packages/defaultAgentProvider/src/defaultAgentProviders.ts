// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgentProvider,
    AppAgentInstaller,
    IndexingServiceRegistry,
    DefaultIndexingServiceRegistry,
    DispatcherOptions,
} from "agent-dispatcher";
import { createNpmAppAgentProvider } from "dispatcher-node-providers";

import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
    AppAgentConfig,
    getInstanceConfigProvider,
    getProviderConfig,
    InstanceConfigProvider,
} from "./utils/config.js";
import { getDefaultMcpAppAgentProvider } from "./mcpDefaultAgentProvider.js";
import { getPackageFilePath } from "./utils/getPackageFilePath.js";

let defaultAppAgentProvider: AppAgentProvider | undefined;
function getDefaultNpmAppAgentProvider(configName?: string): AppAgentProvider {
    if (defaultAppAgentProvider === undefined) {
        defaultAppAgentProvider = createNpmAppAgentProvider(
            getProviderConfig(configName).agents,
            getPackageFilePath("./package.json"),
        );
    }
    return defaultAppAgentProvider;
}

function getExternalAgentsConfigPath(instanceDir: string): string {
    return path.join(instanceDir, "externalAgentsConfig.json");
}

function getExternalAgentsConfig(instanceDir: string): AppAgentConfig {
    const configPath = getExternalAgentsConfigPath(instanceDir);
    return fs.existsSync(configPath)
        ? JSON.parse(fs.readFileSync(configPath, "utf8"))
        : { agents: {} };
}

function getExternalAppAgentProvider(instanceDir: string): AppAgentProvider {
    return createNpmAppAgentProvider(
        getExternalAgentsConfig(instanceDir).agents,
        path.join(instanceDir, "externalagents/package.json"),
    );
}

// Azure Artifacts npm registry backing the `typeagent` feed. Override with
// TYPEAGENT_FEED_REGISTRY (e.g. to point at a different feed or a local mirror).
const TYPEAGENT_FEED_REGISTRY =
    process.env.TYPEAGENT_FEED_REGISTRY ??
    "https://pkgs.dev.azure.com/msctoproj/AI_Systems/_packaging/typeagent/npm/registry/";

const FEED_SCOPES = ["@secretagents", "@typeagent"];

function getExternalAgentsDir(instanceDir: string): string {
    return path.join(instanceDir, "externalagents");
}

// Strip a trailing version/range from an npm specifier to get the module name.
// "@scope/name@1.2.3" -> "@scope/name"; "name@^1" -> "name".
function moduleNameFromSpec(spec: string): string {
    const at = spec.lastIndexOf("@");
    // at <= 0 keeps a leading-@ scope intact and handles unversioned names.
    return at > 0 ? spec.slice(0, at) : spec;
}

// Ensure instanceDir/externalagents is a minimal npm root (package.json +
// scoped-registry .npmrc) that npm installs land in. The external provider
// already resolves agents from this root, so name-based config entries load
// without a path. Feed auth is the ambient user/CI npmrc credential.
function ensureExternalAgentsNpmRoot(instanceDir: string): string {
    const dir = getExternalAgentsDir(instanceDir);
    fs.mkdirSync(dir, { recursive: true });
    const packageJsonPath = path.join(dir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
        fs.writeFileSync(
            packageJsonPath,
            JSON.stringify(
                { name: "typeagent-external-agents", private: true },
                null,
                2,
            ),
        );
    }
    const npmrcLines = [
        ...FEED_SCOPES.map(
            (scope) => `${scope}:registry=${TYPEAGENT_FEED_REGISTRY}`,
        ),
        "always-auth=true",
        "",
    ];
    fs.writeFileSync(path.join(dir, ".npmrc"), npmrcLines.join("\n"));
    return dir;
}

function npmInstallAgent(instanceDir: string, spec: string): string {
    const dir = ensureExternalAgentsNpmRoot(instanceDir);
    const moduleName = moduleNameFromSpec(spec);
    try {
        execFileSync("npm", ["install", spec, "--save=false"], {
            cwd: dir,
            stdio: "pipe",
            shell: process.platform === "win32",
        });
    } catch (e: any) {
        const detail = e?.stderr?.toString?.() ?? e?.message ?? String(e);
        throw new Error(
            `npm install of '${spec}' failed. Ensure the '${TYPEAGENT_FEED_REGISTRY}' feed is authenticated (azureauth / vsts-npm-auth) and the package exists.\n${detail}`,
        );
    }
    const installedPackageJson = path.join(
        dir,
        "node_modules",
        ...moduleName.split("/"),
        "package.json",
    );
    if (!fs.existsSync(installedPackageJson)) {
        throw new Error(
            `npm install of '${spec}' did not produce '${moduleName}' under ${path.join(dir, "node_modules")}.`,
        );
    }
    return moduleName;
}

/**
 * Get the default app agent providers.
 * If instanceDirOrConfigProvider is provided it will load the external app agent provider as well.
 * @param instanceDirOrConfigProvider - Either a string pointing to the instance directory where external agent config is stored, or a InstanceConfigProvider.
 * @param configName - Optional config name to load specific configuration file (e.g. "test" to load "config.test.json"). If not provided, it will load "config.json".
 * @returns an array containing the default app agent providers and the external app agent provider if instanceDirOrConfigProvider is provided.
 */
export function getDefaultAppAgentProviders(
    instanceDirOrConfigProvider: string | InstanceConfigProvider | undefined,
    configName?: string,
): AppAgentProvider[] {
    const instanceConfigs =
        typeof instanceDirOrConfigProvider === "string"
            ? getInstanceConfigProvider(instanceDirOrConfigProvider)
            : instanceDirOrConfigProvider;
    const providers = [getDefaultNpmAppAgentProvider(configName)];
    const mcpProvider = getDefaultMcpAppAgentProvider(instanceConfigs);
    if (mcpProvider !== undefined) {
        providers.push(mcpProvider);
    }
    const instanceDir = instanceConfigs?.getInstanceDir();
    if (instanceDir !== undefined) {
        providers.push(getExternalAppAgentProvider(instanceDir));
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

// Return installer for external app agent provider
export function getDefaultAppAgentInstaller(
    instanceDir: string,
): AppAgentInstaller {
    return {
        install: (name: string, moduleName: string, packagePath: string) => {
            const config = getExternalAgentsConfig(instanceDir);
            if (config.agents[name] !== undefined) {
                throw new Error(`Agent '${name}' already exists`);
            }
            config.agents[name] = {
                name: moduleName,
                path: packagePath,
            };
            fs.writeFileSync(
                getExternalAgentsConfigPath(instanceDir),
                JSON.stringify(config, null, 2),
            );

            return createNpmAppAgentProvider(
                {
                    [name]: { name: moduleName, path: packagePath },
                },
                path.join(instanceDir, "externalagents/package.json"),
            );
        },
        installNpm: async (name: string, spec: string) => {
            const config = getExternalAgentsConfig(instanceDir);
            if (config.agents[name] !== undefined) {
                throw new Error(`Agent '${name}' already exists`);
            }
            const moduleName = npmInstallAgent(instanceDir, spec);
            // No `path`: the agent resolves by module name from the
            // externalagents npm root, where npm just installed it.
            config.agents[name] = { name: moduleName };
            fs.writeFileSync(
                getExternalAgentsConfigPath(instanceDir),
                JSON.stringify(config, null, 2),
            );

            return createNpmAppAgentProvider(
                {
                    [name]: { name: moduleName },
                },
                path.join(instanceDir, "externalagents/package.json"),
            );
        },
        uninstall: (name: string) => {
            const config = getExternalAgentsConfig(instanceDir);
            if (config.agents[name] === undefined) {
                throw new Error(`Agent '${name}' not found`);
            }
            delete config.agents[name];
            fs.writeFileSync(
                getExternalAgentsConfigPath(instanceDir),
                JSON.stringify(config, null, 2),
            );
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
                            // Get the agent package info to resolve paths correctly
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
