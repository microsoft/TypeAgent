// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgent,
    TranslatorDefinition,
    AppAgentManifest,
} from "@typeagent/agent-sdk";
import { getDispatcherConfig } from "../utils/config.js";
import { createRequire } from "module";
import path from "node:path";

import { createAgentProcessShim } from "./agentProcessShim.js";
import { AppAgentProvider } from "./agentProvider.js";
import { CommandHandlerContext } from "../handlers/common/commandHandlerContext.js";
import { loadInlineAgent } from "./inlineAgentHandlers.js";

export type InlineAppAgentInfo = {
    type?: undefined;
} & AppAgentManifest;

const enum ExecutionMode {
    SeparateProcess = "separate",
    DispatcherProcess = "dispatcher",
}

export type ModuleAppAgentInfo = {
    type: "module";
    name: string;
    execMode?: ExecutionMode;
};

export type AgentInfo = (InlineAppAgentInfo | ModuleAppAgentInfo) & {
    imports?: string[]; // for @const import
};

function patchPaths(config: TranslatorDefinition, dir: string) {
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
    info: ModuleAppAgentInfo,
): Promise<AppAgentManifest> {
    const require = createRequire(import.meta.url);
    const manifestPath = require.resolve(`${info.name}/agent/manifest`);
    const config = require(manifestPath) as AppAgentManifest;
    patchPaths(config, path.dirname(manifestPath));
    return config;
}

async function loadDispatcherConfigs() {
    const infos = getDispatcherConfig().agents;
    const appAgents: Map<string, AppAgentManifest> = new Map();
    for (const [name, info] of Object.entries(infos)) {
        appAgents.set(
            name,
            info.type === "module" ? await loadModuleConfig(info) : info,
        );
    }
    return appAgents;
}

let appAgentConfigs: Map<string, AppAgentManifest> | undefined;
export async function getBuiltinAppAgentConfigs() {
    if (appAgentConfigs === undefined) {
        appAgentConfigs = await loadDispatcherConfigs();
    }
    return appAgentConfigs;
}

function enableExecutionMode() {
    return process.env.TYPEAGENT_EXECMODE !== "0";
}

async function loadModuleAgent(info: ModuleAppAgentInfo): Promise<AppAgent> {
    const execMode = info.execMode ?? ExecutionMode.SeparateProcess;
    if (enableExecutionMode() && execMode === ExecutionMode.SeparateProcess) {
        return createAgentProcessShim(`${info.name}/agent/handlers`);
    }

    const module = await import(`${info.name}/agent/handlers`);
    if (typeof module.instantiate !== "function") {
        throw new Error(
            `Failed to load module agent ${info.name}: missing 'instantiate' function.`,
        );
    }
    return module.instantiate();
}

// Load on demand, doesn't unload for now
const moduleAgents = new Map<string, AppAgent>();
async function getModuleAgent(appAgentName: string) {
    const existing = moduleAgents.get(appAgentName);
    if (existing) return existing;
    const config = getDispatcherConfig().agents[appAgentName];
    if (config === undefined || config.type !== "module") {
        throw new Error(`Unable to load app agent name: ${appAgentName}`);
    }
    const agent = await loadModuleAgent(config);
    moduleAgents.set(appAgentName, agent);
    return agent;
}

export function getBuiltinAppAgentProvider(
    context: CommandHandlerContext,
): AppAgentProvider {
    return {
        getAppAgentNames() {
            return Object.keys(getDispatcherConfig().agents);
        },
        async getAppAgentManifest(appAgentName: string) {
            const configs = await getBuiltinAppAgentConfigs();
            const config = configs.get(appAgentName);
            if (config === undefined) {
                throw new Error(`Invalid app agent: ${appAgentName}`);
            }
            return config;
        },
        async loadAppAgent(appAgentName: string) {
            const type = getDispatcherConfig().agents[appAgentName].type;
            return type === "module"
                ? await getModuleAgent(appAgentName)
                : loadInlineAgent(appAgentName, context);
        },
    };
}
