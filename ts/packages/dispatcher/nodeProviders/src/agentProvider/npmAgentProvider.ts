// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionManifest, AppAgentManifest } from "@typeagent/agent-sdk";
import { createRequire } from "module";
import path from "node:path";
import {
    AgentProcess,
    createAgentProcess,
} from "./process/agentProcessShim.js";
import { AppAgentProvider } from "agent-dispatcher";

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
    if (manifest.schema) {
        if (typeof manifest.schema.schemaFile === "string") {
            manifest.schema.schemaFile = path.resolve(
                dir,
                manifest.schema.schemaFile,
            );
        }

        if (typeof manifest.schema.grammarFile === "string") {
            manifest.schema.grammarFile = path.resolve(
                dir,
                manifest.schema.grammarFile,
            );
        }
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
    let manifestPath: string;
    let config: AppAgentManifest;

    if (info.path) {
        // For path-based agents, load manifest directly from the file system
        // Resolve path relative to the requirePath directory
        const requireDir = requirePath.startsWith("file://")
            ? path.dirname(new URL(requirePath).pathname)
            : path.dirname(requirePath);
        const resolvedAgentPath = path.resolve(requireDir, info.path);
        const packageJsonPath = path.resolve(resolvedAgentPath, "package.json");
        const packageJson = require(packageJsonPath);

        // Get manifest path from package.json exports
        const manifestExport = packageJson.exports?.["./agent/manifest"];
        if (!manifestExport) {
            throw new Error(`No manifest export found in ${packageJsonPath}`);
        }

        manifestPath = path.resolve(resolvedAgentPath, manifestExport);
        // Use dynamic import for JSON files to avoid require cache issues
        const fs = await import("fs");
        config = JSON.parse(
            fs.readFileSync(manifestPath, "utf-8"),
        ) as AppAgentManifest;
    } else {
        // For npm package agents, use standard resolution
        manifestPath = require.resolve(`${info.name}/agent/manifest`);
        config = require(manifestPath) as AppAgentManifest;
    }

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
    let handlerPath: string;

    if (info.path) {
        // For path-based agents, resolve handler path from package.json exports
        // Resolve path relative to the requirePath directory
        const requireDir = requirePath.startsWith("file://")
            ? path.dirname(new URL(requirePath).pathname)
            : path.dirname(requirePath);
        const resolvedAgentPath = path.resolve(requireDir, info.path);
        const packageJsonPath = path.resolve(resolvedAgentPath, "package.json");
        const packageJson = require(packageJsonPath);

        // Get handler path from package.json exports
        const handlerExport = packageJson.exports?.["./agent/handlers"];
        if (!handlerExport) {
            throw new Error(`No handlers export found in ${packageJsonPath}`);
        }

        handlerPath = `file://${path.resolve(resolvedAgentPath, handlerExport)}`;
    } else {
        // For npm package agents, use standard resolution
        // file:// is require so that on windows the drive name doesn't get confused with the protocol name for `import()`
        handlerPath = `file://${require.resolve(`${info.name}/agent/handlers`)}`;
    }

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
        setTraceNamespaces(namespaces: string) {
            for (const agent of moduleAgents.values()) {
                agent.trace?.(namespaces);
            }
        },
    };
}
