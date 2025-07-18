// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { 
    AppAgentProvider, 
    AppAgentInstaller, 
    IndexingServiceRegistry,
    DefaultIndexingServiceRegistry 
} from "agent-dispatcher";
import { createNpmAppAgentProvider } from "agent-dispatcher/helpers/npmAgentProvider";

import path from "node:path";
import fs from "node:fs";
import {
    AppAgentConfig,
    getInstanceConfigProvider,
    getProviderConfig,
    InstanceConfigProvider,
} from "./utils/config.js";
import { getDefaultMcpAppAgentProvider } from "./mcpDefaultAgentProvider.js";

let defaultAppAgentProvider: AppAgentProvider | undefined;
function getDefaultNpmAppAgentProvider(): AppAgentProvider {
    if (defaultAppAgentProvider === undefined) {
        defaultAppAgentProvider = createNpmAppAgentProvider(
            getProviderConfig().agents,
            import.meta.url,
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

/**
 * Get the default app agent providers.
 * If instanceDirOrConfigProvider is provided it will load the external app agent provider as well.
 * @param instanceDirOrConfigProvider - Either a string pointing to the instance directory where external agent config is stored, or a InstanceConfigProvider.
 * @returns an array containing the default app agent providers and the external app agent provider if instanceDirOrConfigProvider is provided.
 */
export function getDefaultAppAgentProviders(
    instanceDirOrConfigProvider: string | InstanceConfigProvider | undefined,
): AppAgentProvider[] {
    const instanceConfigs =
        typeof instanceDirOrConfigProvider === "string"
            ? getInstanceConfigProvider(instanceDirOrConfigProvider)
            : instanceDirOrConfigProvider;
    const providers = [getDefaultNpmAppAgentProvider()];
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
 * @returns IndexingServiceRegistry containing all registered indexing services
 */
export async function getIndexingServiceRegistry(
    instanceDirOrConfigProvider?: string | InstanceConfigProvider,
): Promise<IndexingServiceRegistry> {
    const providers = getDefaultAppAgentProviders(instanceDirOrConfigProvider);
    const registry = new DefaultIndexingServiceRegistry();
    
    for (const provider of providers) {
        const agentNames = provider.getAppAgentNames();
        
        for (const agentName of agentNames) {
            try {
                const manifest = await provider.getAppAgentManifest(agentName);
                
                if (manifest.indexingServices) {
                    for (const [indexSource, serviceConfig] of Object.entries(manifest.indexingServices)) {
                        // Resolve the absolute path to the service script
                        let resolvedServicePath: string;
                        try {
                            // Get the agent package info to resolve paths correctly
                            const agentConfigs = getProviderConfig().agents;
                            const agentConfig = agentConfigs[agentName];
                            
                            if (agentConfig) {
                                const { createRequire } = await import("module");
                                const requirePath = agentConfig.path 
                                    ? `${path.resolve(agentConfig.path)}${path.sep}package.json`
                                    : import.meta.url;
                                const require = createRequire(requirePath);
                                
                                // Try to resolve the service script directly using the package exports
                                // For browser agent, this will resolve "./agent/indexing" export
                                try {
                                    resolvedServicePath = require.resolve(`${agentConfig.name}/agent/indexing`);
                                } catch (exportError) {
                                    // Fallback: resolve relative to the agent's main module
                                    const agentMainPath = require.resolve(agentConfig.name);
                                    const agentPackageDir = path.dirname(agentMainPath);
                                    resolvedServicePath = path.resolve(agentPackageDir, serviceConfig.serviceScript);
                                }
                            } else {
                                throw new Error(`Agent config not found for ${agentName}`);
                            }
                        } catch (pathError) {
                            console.warn(`Failed to resolve service path for ${agentName}/${indexSource}: ${pathError}`);
                            continue;
                        }
                        
                        const serviceInfo = {
                            agentName,
                            serviceScript: resolvedServicePath, // Now an absolute path
                            ...(serviceConfig.description && { description: serviceConfig.description }),
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
