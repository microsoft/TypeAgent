// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { glob } from "glob";
import { NpmAppAgentInfo } from "dispatcher-node-providers";
import { InstallSourceConfig } from "../installSources/config.js";
import { getPackageFilePath } from "./getPackageFilePath.js";
import fs from "node:fs";
import { McpAppAgentConfig, McpAppAgentInfo } from "../mcpAgentProvider.js";
import path from "node:path";
import { expandPath } from "../installSources/paths.js";

export type ExplainerConfig = {
    constructions?: {
        data: string[];
        file: string;
    };
};

export type AppAgentConfig = {
    agents: { [key: string]: NpmAppAgentInfo };
    mcpServers?: {
        [key: string]: McpAppAgentInfo;
    };
};

export type InstanceConfig = {
    mcpServers?: {
        [key: string]: McpAppAgentConfig;
    };
    // Install sources + resolution order (design §6). Runtime edits via
    // @source / @install land here; absent fields fall back to the shipped
    // seed defaults (see getResolvedInstallSources).
    installSources?: InstallSourcesConfig;
};

// Persisted install-source configuration (design §6). All fields optional; the
// resolver below merges them over the shipped seed defaults.
export type InstallSourcesConfig = {
    installDir?: string;
    // Install sources in resolution priority order (first match wins).
    sources?: InstallSourceConfig[];
};

export type ProviderConfig = AppAgentConfig & {
    explainers: { [key: string]: ExplainerConfig };
    tests: string[];
    promptAppend?: string; // additional instructions injected into the reasoning system prompt
};

let providerConfig: ProviderConfig | undefined;
export function getProviderConfig(configName?: string): ProviderConfig {
    if (providerConfig === undefined) {
        var fileName = configName ? `config.${configName}.json` : "config.json";
        providerConfig = JSON.parse(
            fs.readFileSync(getPackageFilePath(`./data/${fileName}`), "utf8"),
        ) as ProviderConfig;
    }
    return providerConfig;
}

export function getBuiltinConstructionConfig(explainerName: string) {
    const config =
        getProviderConfig()?.explainers?.[explainerName]?.constructions;
    return config
        ? {
              data: config.data.map((f) => getPackageFilePath(f)),
              file: getPackageFilePath(config?.file),
          }
        : undefined;
}

export async function getTestDataFiles(
    extended: boolean = true,
): Promise<string[]> {
    const testDataFiles = getProviderConfig()?.tests;
    if (testDataFiles === undefined) {
        return [];
    }
    const testDataFilePaths = extended
        ? testDataFiles
        : testDataFiles.slice(0, 1);
    return glob(
        testDataFilePaths.map((f) => getPackageFilePath(f)),
        {
            windowsPathsNoEscape: true,
        },
    );
}

export interface InstanceConfigProvider {
    getInstanceDir(): string | undefined;
    getInstanceConfig(): Readonly<InstanceConfig>;
    setInstanceConfig(instanceConfig: InstanceConfig): void;
}

export function getInstanceConfigProvider(
    instanceDir: string | undefined, // undefined for in memory only
): InstanceConfigProvider {
    let instanceConfig: InstanceConfig;
    function getInstanceConfig(): Readonly<InstanceConfig> {
        if (instanceConfig === undefined) {
            if (instanceDir !== undefined) {
                const instanceConfigPath = path.join(
                    instanceDir,
                    "config.json",
                );
                if (fs.existsSync(instanceConfigPath)) {
                    instanceConfig = JSON.parse(
                        fs.readFileSync(instanceConfigPath, "utf8"),
                    );
                } else {
                    instanceConfig = {};
                }
            } else {
                instanceConfig = {};
            }
        }
        return instanceConfig;
    }
    return {
        getInstanceDir: () => instanceDir,
        getInstanceConfig,
        setInstanceConfig: (config: InstanceConfig) => {
            if (instanceDir !== undefined) {
                const filePath = path.join(instanceDir, "config.json");
                fs.writeFileSync(filePath, JSON.stringify(config, null, 4));
            }

            instanceConfig = structuredClone(config);
        },
    };
}

// Path to the optional dev-checkout workspace catalog (design §6). Present only
// in a repo checkout; absent in a shipped build. A sibling of this package
// under ts/packages/agents.
function getWorkspaceCatalogPath(): string {
    return getPackageFilePath("../agents/agents.catalog.json");
}

// Host-driven knobs for resolving install sources (design §6). Remote hosts
// (e.g. the web API server) set `excludePathSources` to drop `path` sources,
// whose refs would otherwise resolve against the server's own filesystem.
export type InstallSourcesResolveOptions = {
    excludePathSources?: boolean;
};

// The shipped seed install sources in resolution priority order (design §6).
// A dev checkout additionally exposes a `workspace` catalog (only when its
// catalog JSON exists), placed ahead of `builtin` so local agents shadow the
// bundled ones. `excludePathSources` omits the leading `path` source for hosts
// without a usable local filesystem.
function getSeedInstallSources(
    options?: InstallSourcesResolveOptions,
): InstallSourceConfig[] {
    const sources: InstallSourceConfig[] = [];
    if (!options?.excludePathSources) {
        sources.push({ kind: "path", name: "path" });
    }
    if (fs.existsSync(getWorkspaceCatalogPath())) {
        sources.push({
            kind: "catalog",
            name: "workspace",
            catalog: getWorkspaceCatalogPath(),
        });
    }
    sources.push({ kind: "catalog", name: "builtin", catalog: "<bundled>" });
    sources.push({ kind: "feed", name: "typeagent" });
    return sources;
}

/**
 * Resolve the effective install-sources configuration (design §6): the shipped
 * seed defaults overlaid with any persisted instance overrides. `installDir`
 * is the shared npm root all feed sources install into, defaulting to
 * `<instanceDir>/installedAgents` and supporting `${ENV}` expansion.
 */
export function getResolvedInstallSources(
    instanceConfigs: InstanceConfigProvider | undefined,
    options?: InstallSourcesResolveOptions,
): { installDir: string; sources: InstallSourceConfig[] } {
    const instanceDir = instanceConfigs?.getInstanceDir();
    const persisted = instanceConfigs?.getInstanceConfig().installSources;
    // Persisted overrides bypass the seed, so apply the same path-source
    // exclusion to them; getSeedInstallSources handles the default case.
    const sources = persisted?.sources
        ? options?.excludePathSources
            ? persisted.sources.filter((source) => source.kind !== "path")
            : persisted.sources
        : getSeedInstallSources(options);
    const installDir = persisted?.installDir
        ? expandPath(persisted.installDir)
        : path.join(instanceDir ?? process.cwd(), "installedAgents");
    return { installDir, sources };
}
