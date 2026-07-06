// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { glob } from "glob";
import { NpmAppAgentInfo } from "dispatcher-node-providers";
import { InstallSourceConfig } from "../installSources/config.js";
import { getPackageFilePath } from "./getPackageFilePath.js";
import fs from "node:fs";
import { McpAppAgentConfig, McpAppAgentInfo } from "../mcpAgentProvider.js";
import path from "node:path";

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
    // Install sources + resolution order. Runtime edits via
    // `@package source` / `@package install` edits land here; absent fields fall back to the shipped
    // seed defaults (see getResolvedInstallSources).
    installSources?: InstallSourcesConfig;
};

// Persisted install-source configuration. All fields optional; the
// resolver below merges them over the shipped seed defaults.
export type InstallSourcesConfig = {
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

// Path to the optional dev-checkout workspace catalog. Present only
// in a repo checkout; absent in a shipped build. A sibling of this package
// under ts/packages/agents.
function getWorkspaceCatalogPath(): string {
    return getPackageFilePath("../agents/agents.catalog.json");
}

// Host-driven knobs for resolving install sources. Remote hosts
// (e.g. the web API server) set `excludePathSources` to skip `path` sources
// during resolution, whose refs would otherwise resolve against the server's
// own filesystem. This only narrows the runtime resolution walk; it never
// changes the persisted or seed source lists.
export type InstallSourcesResolveOptions = {
    excludePathSources?: boolean;
};

// The shipped seed install sources in resolution priority order.
// A dev checkout additionally exposes a `workspace` catalog (only when its
// catalog JSON exists), so local agents can be installed by short name. This is
// the full seed list; runtime-only filtering (e.g. `excludePathSources`) is
// applied later in the registry's resolution walk.
//
// The bundled agents that ship in the app are NOT a source here: they are a
// separate static provider (see createBundledAppAgentProvider) and are always
// present without being installed.
//
// CAVEAT: the `workspace` entry is seeded *conditionally* on the
// local filesystem, and the seed is recomputed every launch until something
// is persisted. So one instance dir launched from a dev checkout vs. a shipped
// build (or two different checkouts) sees a different source list, and the
// first `@package source` edit then freezes the checkout-specific catalog path - which
// goes stale in another context. Sharing an instance dir across dev/shipped
// contexts is unsupported; pin sources explicitly for cross-context use.
function getSeedInstallSources(): InstallSourceConfig[] {
    const sources: InstallSourceConfig[] = [];
    sources.push({ kind: "path", name: "path" });
    if (fs.existsSync(getWorkspaceCatalogPath())) {
        sources.push({
            kind: "catalog",
            name: "workspace",
            catalog: getWorkspaceCatalogPath(),
        });
    }
    sources.push({ kind: "feed", name: "typeagent" });
    return sources;
}

/**
 * Resolve the effective install sources in resolution priority order: the
 * persisted instance overrides when present, otherwise the shipped seed
 * defaults. This returns the full configured list verbatim — it is what seeds
 * the registry and gets persisted back when `@package source` edits the list, so
 * it must never be narrowed here. Runtime-only filtering (e.g.
 * `excludePathSources` for hosts without a usable local filesystem) is applied
 * during the registry's resolution walk, never to this list, so it cannot leak
 * into the persisted config.
 */
export function getResolvedInstallSources(
    instanceConfigs: InstanceConfigProvider | undefined,
): InstallSourceConfig[] {
    const persisted = instanceConfigs?.getInstanceConfig().installSources;
    return persisted?.sources ?? getSeedInstallSources();
}

/**
 * The shared npm root all feed sources install into: always
 * `<instanceDir>/installedAgents`, derived at runtime and never persisted. It
 * is `undefined` for the in-memory case (no instance dir), where nothing is
 * ever installed; it does not fall back to `process.cwd()`, which
 * would silently anchor installs to wherever the process happened to launch
 * (see the same reasoning against an implicit CWD in pathSource.ts).
 */
export function getInstallDir(
    instanceConfigs: InstanceConfigProvider | undefined,
): string | undefined {
    const instanceDir = instanceConfigs?.getInstanceDir();
    return instanceDir !== undefined
        ? path.join(instanceDir, "installedAgents")
        : undefined;
}
