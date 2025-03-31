// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "./commandHandlerContext.js";
import {
    dispatcherAgent,
    dispatcherManifest,
} from "./dispatcher/dispatcherAgent.js";
import { AppAgentProvider } from "../agentProvider/agentProvider.js";
import { systemAgent, systemManifest } from "./system/systemAgent.js";
import {
    createActionConfigProvider,
    getSchemaNamesForAppAgentManifests,
} from "../agentProvider/agentProviderUtils.js";
import { ActionConfigProvider } from "../translation/actionConfigProvider.js";

const builtinAgents: Record<string, AppAgent> = {
    dispatcher: dispatcherAgent,
    system: systemAgent,
};

const builtinAgentManifest: Record<string, AppAgentManifest> = {
    dispatcher: dispatcherManifest,
    system: systemManifest,
};

export function createBuiltinAppAgentProvider(
    context: CommandHandlerContext,
): AppAgentProvider {
    return {
        getAppAgentNames() {
            return Object.keys(builtinAgentManifest);
        },
        async getAppAgentManifest(appAgentName: string) {
            const manifest = builtinAgentManifest[appAgentName];
            if (manifest === undefined) {
                throw new Error(`Invalid app agent: ${appAgentName}`);
            }
            return manifest;
        },
        async loadAppAgent(appAgentName: string) {
            if (context === undefined) {
                throw new Error("Context is required to load inline agent");
            }
            const agent = builtinAgents[appAgentName];
            if (agent === undefined) {
                throw new Error(`Invalid app agent: ${appAgentName}`);
            }
            return { ...agent, initializeAgentContext: async () => context };
        },
        async unloadAppAgent(appAgentName: string) {
            // Inline agents are always loaded
            if (builtinAgentManifest[appAgentName] === undefined) {
                throw new Error(`Invalid app agent: ${appAgentName}`);
            }
        },
    };
}

const builtinSchemaNames =
    getSchemaNamesForAppAgentManifests(builtinAgentManifest);

export function getAllSchemaNames(provider: ActionConfigProvider): string[] {
    return [
        ...builtinSchemaNames,
        ...provider
            .getActionConfigs()
            .map((actionConfig) => actionConfig.schemaName),
    ];
}

export function getAllActionConfigProvider(providers: AppAgentProvider[]) {
    return createActionConfigProvider(providers, builtinAgentManifest);
}
