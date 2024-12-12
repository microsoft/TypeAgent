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

const inlineHandlers: Record<string, AppAgent> = {
    dispatcher: dispatcherAgent,
    system: systemAgent,
};

export const inlineAgentManifests: Record<string, AppAgentManifest> = {
    dispatcher: dispatcherManifest,
    system: systemManifest,
};

export function createInlineAppAgentProvider(
    context?: CommandHandlerContext,
): AppAgentProvider {
    return {
        getAppAgentNames() {
            return Object.keys(inlineAgentManifests);
        },
        async getAppAgentManifest(appAgentName: string) {
            const manifest = inlineAgentManifests[appAgentName];
            if (manifest === undefined) {
                throw new Error(`Invalid app agent: ${appAgentName}`);
            }
            return manifest;
        },
        async loadAppAgent(appAgentName: string) {
            if (context === undefined) {
                throw new Error("Context is required to load inline agent");
            }
            const handlers = inlineHandlers[appAgentName];
            if (handlers === undefined) {
                throw new Error(`Invalid app agent: ${appAgentName}`);
            }
            return { ...handlers, initializeAgentContext: async () => context };
        },
        unloadAppAgent(appAgentName: string) {
            // Inline agents are always loaded
            if (inlineAgentManifests[appAgentName] === undefined) {
                throw new Error(`Invalid app agent: ${appAgentName}`);
            }
        },
    };
}
