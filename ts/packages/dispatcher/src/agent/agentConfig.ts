// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgent,
    ActionManifest,
    AppAgentManifest,
} from "@typeagent/agent-sdk";
import {
    getDispatcherConfig,
    getExternalAgentsConfig,
} from "../utils/config.js";
import { createRequire } from "module";
import path from "node:path";

import { AgentProcess, createAgentProcess } from "./agentProcessShim.js";
import { AppAgentProvider } from "./agentProvider.js";
import { CommandHandlerContext } from "../handlers/common/commandHandlerContext.js";
import { loadInlineAgent } from "./inlineAgentHandlers.js";
import { getUserProfileDir } from "../utils/userData.js";

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
    path?: string;
    execMode?: ExecutionMode;
};

export type AgentInfo = (InlineAppAgentInfo | ModuleAppAgentInfo) & {
    imports?: string[]; // for @const import
};

function patchPaths(manifest: ActionManifest, dir: string) {
    if (manifest.schema) {
        manifest.schema.schemaFile = path.resolve(
            dir,
            manifest.schema.schemaFile,
        );
    }
    if (manifest.subActionManifests) {
        for (const subManfiest of Object.values(manifest.subActionManifests)) {
            patchPaths(subManfiest, dir);
        }
    }
}

async function loadModuleConfig(
    info: ModuleAppAgentInfo,
): Promise<AppAgentManifest> {
    const require = createRequire(import.meta.url);
    let modulePath = `${info.name}/agent/manifest`;

    const manifestPath = require.resolve(modulePath);
    const config = require(manifestPath) as AppAgentManifest;
    patchPaths(config, path.dirname(manifestPath));
    return config;
}

async function loadModuleConfigFromParentPkg(
    info: ModuleAppAgentInfo,
): Promise<AppAgentManifest> {
    const pkgpath = path.join(
        getUserProfileDir(),
        "externalagents/package.json",
    );
    const require = createRequire(pkgpath);

    let modulePath = `${info.name}/agent/manifest`;
    const agentManifestPath = require.resolve(modulePath);

    const config = require(agentManifestPath) as AppAgentManifest;
    patchPaths(config, path.dirname(agentManifestPath));
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

async function loadExternalAgentConfigs() {
    const infos = getExternalAgentsConfig().agents;
    const externalAgents: Map<string, AppAgentManifest> = new Map();
    for (const [name, info] of Object.entries(infos)) {
        externalAgents.set(
            name,
            info.type === "module"
                ? await loadModuleConfigFromParentPkg(info)
                : info,
        );
    }
    return externalAgents;
}

let externalAgentConfigs: Map<string, AppAgentManifest> | undefined;
export async function getExternalAppAgentConfigs() {
    if (externalAgentConfigs === undefined) {
        externalAgentConfigs = await loadExternalAgentConfigs();
    }
    return externalAgentConfigs;
}

function enableExecutionMode() {
    return process.env.TYPEAGENT_EXECMODE !== "0";
}

async function loadModuleAgent(
    info: ModuleAppAgentInfo,
): Promise<AgentProcess> {
    const execMode = info.execMode ?? ExecutionMode.SeparateProcess;
    if (enableExecutionMode() && execMode === ExecutionMode.SeparateProcess) {
        return createAgentProcess(`${info.name}/agent/handlers`);
    }

    const module = await import(`${info.name}/agent/handlers`);
    if (typeof module.instantiate !== "function") {
        throw new Error(
            `Failed to load module agent ${info.name}: missing 'instantiate' function.`,
        );
    }
    return {
        appAgent: module.instantiate(),
        process: undefined,
        count: 1,
    };
}

async function loadExternalModuleAgent(
    info: ModuleAppAgentInfo,
): Promise<AgentProcess> {
    const pkgpath = path.join(
        getUserProfileDir(),
        "externalagents/package.json",
    );
    const require = createRequire(pkgpath);
    const handlerPath = require.resolve(`${info.name}/agent/handlers`);

    const execMode = info.execMode ?? ExecutionMode.SeparateProcess;
    if (enableExecutionMode() && execMode === ExecutionMode.SeparateProcess) {
        return createAgentProcess(`file://${handlerPath}`);
    }

    const module = await import(`${handlerPath}`);
    if (typeof module.instantiate !== "function") {
        throw new Error(
            `Failed to load module agent ${info.name}: missing 'instantiate' function.`,
        );
    }
    return {
        appAgent: module.instantiate(),
        process: undefined,
        count: 1,
    };
}

// Load on demand, doesn't unload for now
const moduleAgents = new Map<string, AgentProcess>();
async function getModuleAgent(appAgentName: string) {
    const existing = moduleAgents.get(appAgentName);
    if (existing) {
        existing.count++;
        return existing.appAgent;
    }
    const config = getDispatcherConfig().agents[appAgentName];
    if (config === undefined || config.type !== "module") {
        throw new Error(`Unable to load app agent name: ${appAgentName}`);
    }
    const agent = await loadModuleAgent(config);
    moduleAgents.set(appAgentName, agent);
    return agent.appAgent;
}

const externalAgents = new Map<string, AgentProcess>();
export function getExternalAppAgentProvider(
    context: CommandHandlerContext,
): AppAgentProvider {
    return {
        getAppAgentNames() {
            return Object.keys(getExternalAgentsConfig().agents);
        },
        async getAppAgentManifest(appAgentName: string) {
            const configs = await getExternalAppAgentConfigs();
            const config = configs.get(appAgentName);
            if (config === undefined) {
                throw new Error(`Invalid app agent: ${appAgentName}`);
            }
            return config;
        },
        async loadAppAgent(appAgentName: string) {
            const type = getExternalAgentsConfig().agents[appAgentName].type;
            return type === "module"
                ? await getExternalModuleAgent(appAgentName)
                : loadInlineAgent(appAgentName, context);
        },
        unloadAppAgent(appAgentName: string) {
            const agent = externalAgents.get(appAgentName);
            if (agent) {
                if (--agent.count === 0) {
                    agent.process?.kill();
                    externalAgents.delete(appAgentName);
                }
            }
        },
    };
}

async function getExternalModuleAgent(appAgentName: string): Promise<AppAgent> {
    const existing = moduleAgents.get(appAgentName);
    if (existing) {
        existing.count++;
        return existing.appAgent;
    }
    const config = getExternalAgentsConfig().agents[appAgentName];
    if (config === undefined || config.type !== "module") {
        throw new Error(`Unable to load app agent name: ${appAgentName}`);
    }
    const agent = await loadExternalModuleAgent(config);
    moduleAgents.set(appAgentName, agent);
    return agent.appAgent;
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
        unloadAppAgent(appAgentName: string) {
            const agent = moduleAgents.get(appAgentName);
            if (agent) {
                if (--agent.count === 0) {
                    agent.process?.kill();
                    externalAgents.delete(appAgentName);
                }
            }
        },
    };
}
