// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentManifest } from "@typeagent/agent-sdk";
import { AppAgentProvider } from "../agent/agentProvider.js";
import {
    ActionConfig,
    ActionConfigProvider,
    convertToActionConfig,
} from "../translation/agentTranslators.js";
import {
    AgentInfo,
    createNpmAppAgentProvider,
} from "../agent/npmAgentProvider.js";
import { getDispatcherConfig } from "./config.js";
import { getUserProfileDir } from "./userData.js";
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
function getExternalAgentsConfig(): ExternalConfig {
    if (externalAppAgentsConfig === undefined) {
        if (
            fs.existsSync(
                path.join(getUserProfileDir(), "externalAgentsConfig.json"),
            )
        ) {
            externalAppAgentsConfig = JSON.parse(
                fs.readFileSync(
                    path.join(getUserProfileDir(), "externalAgentsConfig.json"),
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
function getExternalAppAgentProvider(): AppAgentProvider {
    if (externalAppAgentProvider === undefined) {
        externalAppAgentProvider = createNpmAppAgentProvider(
            getExternalAgentsConfig().agents,
            path.join(getUserProfileDir(), "externalagents/package.json"),
        );
    }
    return externalAppAgentProvider;
}

export function getDefaultAppAgentProviders(): AppAgentProvider[] {
    return [getBuiltinAppAgentProvider(), getExternalAppAgentProvider()];
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
                    throw new Error(`Unknown translator: ${schemaName}`);
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
