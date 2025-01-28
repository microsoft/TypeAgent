// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionConfig,
    convertToActionConfig,
} from "../translation/actionConfig.js";
import { ActionConfigProvider } from "../translation/actionConfigProvider.js";
import { ActionSchemaFileCache } from "../translation/actionSchemaFileCache.js";
import { AppAgentProvider } from "./agentProvider.js";
import { AppAgentManifest } from "@typeagent/agent-sdk";

async function getAppAgentManifests(
    providers: AppAgentProvider[],
): Promise<Map<string, AppAgentManifest>> {
    const appAgentConfigs = new Map<string, AppAgentManifest>();
    for (const provider of providers) {
        for (const name of provider.getAppAgentNames()) {
            const manifest = await provider.getAppAgentManifest(name);
            appAgentConfigs.set(name, manifest);
        }
    }
    return appAgentConfigs;
}

async function getActionConfigs(
    providers: AppAgentProvider[],
): Promise<Record<string, ActionConfig>> {
    const configs = {};
    const appAgentConfigs = await getAppAgentManifests(providers);
    for (const [name, config] of appAgentConfigs.entries()) {
        convertToActionConfig(name, config, configs);
    }
    return configs;
}

export async function createActionConfigProvider(
    providers: AppAgentProvider[],
): Promise<ActionConfigProvider> {
    const actionConfigs = await getActionConfigs(providers);
    const actionSchemaFileCache = new ActionSchemaFileCache();
    const actionConfigProvider: ActionConfigProvider = {
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

    return actionConfigProvider;
}

export function getSchemaNamesForActionConfigProvider(
    provider: ActionConfigProvider,
): string[] {
    return provider.getActionConfigs().map(([name]) => name);
}
