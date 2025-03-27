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
): Promise<Record<string, AppAgentManifest>> {
    const appAgentManifests: Record<string, AppAgentManifest> = {};
    for (const provider of providers) {
        for (const name of provider.getAppAgentNames()) {
            const manifest = await provider.getAppAgentManifest(name);
            appAgentManifests[name] = manifest;
        }
    }
    return appAgentManifests;
}

function getActionConfigs(
    appAgentManifests: Record<string, AppAgentManifest>,
): Record<string, ActionConfig> {
    const configs = {};
    for (const [name, manifest] of Object.entries(appAgentManifests)) {
        convertToActionConfig(name, manifest, configs);
    }
    return configs;
}

export async function createActionConfigProvider(
    providers: AppAgentProvider[],
    additionalManifests?: Record<string, AppAgentManifest>,
): Promise<ActionConfigProvider> {
    const appAgentManifests = {
        ...(await getAppAgentManifests(providers)),
        ...additionalManifests,
    };

    const actionConfigs = getActionConfigs(appAgentManifests);
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
            return Object.values(actionConfigs);
        },
        getActionSchemaFileForConfig(actionConfig: ActionConfig) {
            return actionSchemaFileCache.getActionSchemaFile(actionConfig);
        },
    };

    return actionConfigProvider;
}

export function getSchemaNamesForAppAgentManifests(
    appAgentManifests: Record<string, AppAgentManifest>,
): string[] {
    return Object.keys(getActionConfigs(appAgentManifests));
}
