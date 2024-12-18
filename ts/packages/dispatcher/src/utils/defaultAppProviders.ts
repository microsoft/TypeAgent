// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentManifest } from "@typeagent/agent-sdk";
import { AppAgentProvider } from "../agentProvider/agentProvider.js";
import {
    ActionConfig,
    ActionConfigProvider,
    convertToActionConfig,
} from "../translation/agentTranslators.js";
import {
    AgentInfo,
    createNpmAppAgentProvider,
} from "../agentProvider/npmAgentProvider.js";
import { getDispatcherConfig } from "./config.js";
import path from "node:path";
import fs from "node:fs";
import {
    ActionSchemaFileCache,
    createSchemaInfoProvider,
} from "../translation/actionSchemaFileCache.js";

let builtinAppAgentProvider: AppAgentProvider | undefined;
export function getBuiltinAppAgentProvider(): AppAgentProvider {
    if (builtinAppAgentProvider === undefined) {
        builtinAppAgentProvider = createNpmAppAgentProvider(
            getDispatcherConfig().agents,
            import.meta.url,
        );
    }
    return builtinAppAgentProvider;
}

type ExternalConfig = {
    agents: { [key: string]: AgentInfo };
};
let externalAppAgentsConfig: ExternalConfig | undefined;
function getExternalAgentsConfig(instanceDir: string): ExternalConfig {
    if (externalAppAgentsConfig === undefined) {
        if (
            fs.existsSync(path.join(instanceDir, "externalAgentsConfig.json"))
        ) {
            externalAppAgentsConfig = JSON.parse(
                fs.readFileSync(
                    path.join(instanceDir, "externalAgentsConfig.json"),
                    "utf8",
                ),
            ) as ExternalConfig;
        } else {
            externalAppAgentsConfig = { agents: {} };
        }
    }
    return externalAppAgentsConfig;
}

let externalAppAgentProvider: AppAgentProvider | undefined;
function getExternalAppAgentProvider(instanceDir: string): AppAgentProvider {
    if (externalAppAgentProvider === undefined) {
        externalAppAgentProvider = createNpmAppAgentProvider(
            getExternalAgentsConfig(instanceDir).agents,
            path.join(instanceDir, "externalagents/package.json"),
        );
    }
    return externalAppAgentProvider;
}

export function getDefaultAppAgentProviders(
    instanceDir?: string,
): AppAgentProvider[] {
    const providers = [getBuiltinAppAgentProvider()];
    if (instanceDir) {
        providers.push(getExternalAppAgentProvider(instanceDir));
    }
    return providers;
}

let appAgentConfigs: Map<string, AppAgentManifest> | undefined;
async function getDefaultAppAgentManifests() {
    if (appAgentConfigs === undefined) {
        appAgentConfigs = new Map();
        const appAgentProviders = getDefaultAppAgentProviders();
        for (const provider of appAgentProviders) {
            for (const name of provider.getAppAgentNames()) {
                const manifest = await provider.getAppAgentManifest(name);
                appAgentConfigs.set(name, manifest);
            }
        }
    }
    return appAgentConfigs;
}

const actionConfigs: { [key: string]: ActionConfig } = await (async () => {
    const configs = {};
    const appAgentConfigs = await getDefaultAppAgentManifests();
    for (const [name, config] of appAgentConfigs.entries()) {
        convertToActionConfig(name, config, configs);
    }
    return configs;
})();

export function getSchemaNamesFromDefaultAppAgentProviders() {
    return Object.keys(actionConfigs);
}

let actionConfigProvider: ActionConfigProvider | undefined;
export function getActionConfigProviderFromDefaultAppAgentProviders(): ActionConfigProvider {
    if (actionConfigProvider === undefined) {
        const actionSchemaFileCache = new ActionSchemaFileCache();
        actionConfigProvider = {
            tryGetActionConfig(schemaName: string) {
                return actionConfigs[schemaName];
            },
            getActionConfig(schemaName: string) {
                const config = actionConfigs[schemaName];
                if (!config) {
                    throw new Error(`Unknown schema name: ${schemaName}`);
                }
                return config;
            },
            getActionConfigs() {
                return Object.entries(actionConfigs);
            },
            getActionSchemaFileForConfig(actionConfig: ActionConfig) {
                return actionSchemaFileCache.getActionSchemaFile(actionConfig);
            },
        };
    }
    return actionConfigProvider;
}

export function createSchemaInfoProviderFromDefaultAppAgentProviders() {
    return createSchemaInfoProvider(
        getActionConfigProviderFromDefaultAppAgentProviders(),
    );
}
