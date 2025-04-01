// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { glob } from "glob";
import { NpmAppAgentInfo } from "agent-dispatcher/helpers/npmAgentProvider";
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
};

export type ProviderConfig = AppAgentConfig & {
    explainers: { [key: string]: ExplainerConfig };
    tests: string[];
};

let providerConfig: ProviderConfig | undefined;
export function getProviderConfig(): ProviderConfig {
    if (providerConfig === undefined) {
        providerConfig = JSON.parse(
            fs.readFileSync(getPackageFilePath("./data/config.json"), "utf8"),
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
