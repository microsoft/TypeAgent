// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentProvider, AppAgentInstaller } from "agent-dispatcher";
import { createNpmAppAgentProvider } from "agent-dispatcher/helpers/npmAgentProvider";

import path from "node:path";
import fs from "node:fs";
import { getConfig, AppAgentConfig } from "./utils/config.js";

let builtinAppAgentProvider: AppAgentProvider | undefined;
export function getBuiltinAppAgentProvider(): AppAgentProvider {
    if (builtinAppAgentProvider === undefined) {
        builtinAppAgentProvider = createNpmAppAgentProvider(
            getConfig().agents,
            import.meta.url,
        );
    }
    return builtinAppAgentProvider;
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

export function getDefaultAppAgentProviders(
    instanceDir: string | undefined,
): AppAgentProvider[] {
    const providers = [getBuiltinAppAgentProvider()];
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
