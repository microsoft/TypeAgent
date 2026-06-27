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
    order?: string[];
    installDir?: string;
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

// Azure Artifacts npm registry backing the shipped `typeagent` feed source
// (design §6). Override with TYPEAGENT_FEED_REGISTRY to point at a different
// feed or a local mirror; it is just the seed value for the shipped source.
const TYPEAGENT_FEED_REGISTRY =
    process.env.TYPEAGENT_FEED_REGISTRY ??
    "https://pkgs.dev.azure.com/msctoproj/AI_Systems/_packaging/typeagent/npm/registry/";

const TYPEAGENT_FEED_SCOPES = ["@secretagents", "@typeagent"];

// Path to the optional dev-checkout workspace catalog (design §6). Present only
// in a repo checkout; absent in a shipped build. A sibling of this package
// under ts/packages/agents.
function getWorkspaceCatalogPath(): string {
    return getPackageFilePath("../agents/agents.catalog.json");
}

// The shipped seed install sources (design §6). A dev checkout additionally
// exposes a `workspace` catalog (only when its catalog JSON exists) so local
// agents shadow the feed via the resolution order.
function getSeedInstallSources(): InstallSourceConfig[] {
    const sources: InstallSourceConfig[] = [
        { kind: "path", name: "path" },
        { kind: "catalog", name: "builtin", catalog: "<bundled>" },
    ];
    if (fs.existsSync(getWorkspaceCatalogPath())) {
        sources.push({
            kind: "catalog",
            name: "workspace",
            catalog: getWorkspaceCatalogPath(),
        });
    }
    sources.push({
        kind: "feed",
        name: "typeagent",
        registry: TYPEAGENT_FEED_REGISTRY,
        scopes: TYPEAGENT_FEED_SCOPES,
    });
    return sources;
}

// The shipped seed resolution order (design §6). A dev checkout prepends
// `workspace` so a local agent shadows the feed automatically.
function getSeedOrder(): string[] {
    return fs.existsSync(getWorkspaceCatalogPath())
        ? ["path", "workspace", "builtin", "typeagent"]
        : ["path", "builtin", "typeagent"];
}

/**
 * Resolve the effective install-sources configuration (design §6): the shipped
 * seed defaults overlaid with any persisted instance overrides. `installDir`
 * is the shared npm root all feed sources install into, defaulting to
 * `<instanceDir>/installedAgents` and supporting `${ENV}` expansion.
 */
export function getResolvedInstallSources(
    instanceConfigs: InstanceConfigProvider | undefined,
): { order: string[]; installDir: string; sources: InstallSourceConfig[] } {
    const instanceDir = instanceConfigs?.getInstanceDir();
    const persisted = instanceConfigs?.getInstanceConfig().installSources;
    const sources = persisted?.sources ?? getSeedInstallSources();
    const order = persisted?.order ?? getSeedOrder();
    const installDir = persisted?.installDir
        ? expandPath(persisted.installDir)
        : path.join(instanceDir ?? process.cwd(), "installedAgents");
    return { order, installDir, sources };
}
