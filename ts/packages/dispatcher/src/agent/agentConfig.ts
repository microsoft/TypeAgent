// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DispatcherAgent,
    HierarchicalTranslatorConfig,
    TopLevelTranslatorConfig,
} from "dispatcher-agent";
import { getDispatcherConfig } from "../utils/config.js";
import { loadInlineAgent } from "./inlineAgentHandlers.js";
import { createRequire } from "module";
import path from "node:path";

export type InlineDispatcherAgentInfo = {
    type?: undefined;
} & TopLevelTranslatorConfig;

export type ModuleDispatcherAgentInfo = {
    type: "module";
    name: string;
};

export type AgentInfo = (
    | InlineDispatcherAgentInfo
    | ModuleDispatcherAgentInfo
) & {
    imports?: string[]; // for @const import
};

function patchPaths(config: HierarchicalTranslatorConfig, dir: string) {
    if (config.schema) {
        config.schema.schemaFile = path.resolve(dir, config.schema.schemaFile);
    }
    if (config.subTranslators) {
        for (const subTranslator of Object.values(config.subTranslators)) {
            patchPaths(subTranslator, dir);
        }
    }
}

async function loadModuleConfig(
    info: ModuleDispatcherAgentInfo,
): Promise<TopLevelTranslatorConfig> {
    const require = createRequire(import.meta.url);
    const manifestPath = require.resolve(`${info.name}/agent/manifest`);
    const config = require(manifestPath) as TopLevelTranslatorConfig;
    patchPaths(config, path.dirname(manifestPath));
    return config;
}

async function loadDispatcherConfigs() {
    const infos = getDispatcherConfig().agents;
    const dispatcherAgents: Map<string, TopLevelTranslatorConfig> = new Map();
    for (const [name, info] of Object.entries(infos)) {
        dispatcherAgents.set(
            name,
            info.type === "module" ? await loadModuleConfig(info) : info,
        );
    }
    return dispatcherAgents;
}

let dispatcherAgentConfigs: Map<string, TopLevelTranslatorConfig> | undefined;
export async function getDispatcherAgentConfigs() {
    if (dispatcherAgentConfigs === undefined) {
        dispatcherAgentConfigs = await loadDispatcherConfigs();
    }
    return dispatcherAgentConfigs;
}

async function loadModuleAgent(
    config: ModuleDispatcherAgentInfo,
): Promise<DispatcherAgent> {
    const module = await import(`${config.name}/agent/handlers`);
    if (typeof module.instantiate !== "function") {
        throw new Error(
            `Failed to load module agent ${config.name}: missing 'instantiate' function.`,
        );
    }
    return module.instantiate();
}

async function loadDispatcherAgents() {
    const configs = getDispatcherConfig().agents;
    const dispatcherAgents: Map<string, DispatcherAgent> = new Map();
    for (const [name, config] of Object.entries(configs)) {
        dispatcherAgents.set(
            name,
            await (config.type === "module"
                ? loadModuleAgent(config)
                : loadInlineAgent(name)),
        );
    }
    return dispatcherAgents;
}

let dispatcherAgents: Map<string, DispatcherAgent> | undefined;
export async function getDispatcherAgents() {
    if (dispatcherAgents === undefined) {
        dispatcherAgents = await loadDispatcherAgents();
    }
    return dispatcherAgents;
}

export async function getDispatcherAgent(dispatcherAgentName: string) {
    const dispatcherAgent = (await getDispatcherAgents()).get(
        dispatcherAgentName,
    );
    if (dispatcherAgent === undefined) {
        throw new Error(
            `Invalid dispatcher agent name: ${dispatcherAgentName}`,
        );
    }
    return dispatcherAgent;
}
