// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionManifest, AppAgentManifest } from "@typeagent/agent-sdk";
import { createRequire } from "module";
import path from "node:path";
import {
    AgentProcess,
    createAgentProcess,
} from "./process/agentProcessShim.js";
import { AppAgentProvider } from "./agentProvider.js";

const enum ExecutionMode {
    SeparateProcess = "separate",
    DispatcherProcess = "dispatcher",
}

export type NpmAppAgentInfo = {
    name: string;
    path?: string;
    execMode?: ExecutionMode;
};

function patchPaths(manifest: ActionManifest, dir: string) {
    if (manifest.schema && typeof manifest.schema.schemaFile === "string") {
        manifest.schema.schemaFile = path.resolve(
            dir,
            manifest.schema.schemaFile,
        );
    }
    if (manifest.subActionManifests) {
        for (const subManifest of Object.values(manifest.subActionManifests)) {
            patchPaths(subManifest, dir);
        }
    }
}

function getRequire(info: NpmAppAgentInfo, requirePath: string) {
    // path.sep at the at is necessary for it to work.
    // REVIEW: adding package.json is necessary for jest-resolve to work in tests for some reason.
    const loadPath = `${info.path ? `${path.resolve(info.path)}${path.sep}package.json` : requirePath}`;
    return createRequire(loadPath);
}

async function loadManifest(info: NpmAppAgentInfo, requirePath: string) {
    const require = getRequire(info, requirePath);
    const manifestPath = require.resolve(`${info.name}/agent/manifest`);
    const config = require(manifestPath) as AppAgentManifest;
    patchPaths(config, path.dirname(manifestPath));
    return config;
}

function enableExecutionMode() {
    return process.env.TYPEAGENT_EXECMODE !== "0";
}

async function loadModuleAgent(
    info: NpmAppAgentInfo,
    appAgentName: string,
    requirePath: string,
): Promise<AgentProcess> {
    const require = getRequire(info, requirePath);
    // file:// is require so that on windows the drive name doesn't get confused with the protocol name for `import()`
    const handlerPath = `file://${require.resolve(`${info.name}/agent/handlers`)}`;
    const execMode = info.execMode ?? ExecutionMode.SeparateProcess;
    if (enableExecutionMode() && execMode === ExecutionMode.SeparateProcess) {
        return createAgentProcess(appAgentName, handlerPath);
    }

    const module = await import(handlerPath);
    if (typeof module.instantiate !== "function") {
        throw new Error(
            `Failed to load agent '${appAgentName}' package '${info.name}': missing 'instantiate' function.`,
        );
    }
    return {
        appAgent: module.instantiate(),
        process: undefined,
        count: 1,
    };
}

export function createNpmAppAgentProvider(
    configs: Record<string, NpmAppAgentInfo>,
    requirePath: string,
): AppAgentProvider {
    const moduleAgents = new Map<string, AgentProcess>();
    const manifests = new Map<string, AppAgentManifest>();
    return {
        getAppAgentNames() {
            return Object.keys(configs);
        },
        async getAppAgentManifest(appAgentName: string) {
            const manifest = manifests.get(appAgentName);
            if (manifest !== undefined) {
                return manifest;
            }
            const config = configs[appAgentName];
            if (config === undefined) {
                throw new Error(`Invalid app agent: ${appAgentName}`);
            }
            const newManifests = await loadManifest(config, requirePath);
            manifests.set(appAgentName, newManifests);
            return newManifests;
        },
        async loadAppAgent(appAgentName: string) {
            const existing = moduleAgents.get(appAgentName);
            if (existing) {
                existing.count++;
                return existing.appAgent;
            }
            const config = configs[appAgentName];
            if (config === undefined) {
                throw new Error(`Invalid app agent: ${appAgentName}`);
            }
            // Load on demand
            const agent = await loadModuleAgent(
                config,
                appAgentName,
                requirePath,
            );
            moduleAgents.set(appAgentName, agent);
            return agent.appAgent;
        },
        async unloadAppAgent(appAgentName: string) {
            const agent = moduleAgents.get(appAgentName);
            if (!agent) {
                throw new Error(`Invalid app agent: ${appAgentName}`);
            }
            if (--agent.count === 0) {
                agent.process?.kill();
                moduleAgents.delete(appAgentName);
            }
        },
    };
}
