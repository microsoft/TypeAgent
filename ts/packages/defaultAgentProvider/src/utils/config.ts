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

export type Config = AppAgentConfig & {
    explainers: { [key: string]: ExplainerConfig };
    tests: string[];
};

let config: Config | undefined;
export function getProviderConfig(): Config {
    if (config === undefined) {
        config = JSON.parse(
            fs.readFileSync(getPackageFilePath("./data/config.json"), "utf8"),
        ) as Config;
    }
    return config;
}

export function readInstanceConfig(
    instanceDir: string | undefined,
): InstanceConfig | undefined {
    if (instanceDir === undefined) {
        return undefined;
    }
    const instanceConfigPath = path.join(instanceDir, "config.json");
    if (fs.existsSync(instanceConfigPath)) {
        return JSON.parse(fs.readFileSync(instanceConfigPath, "utf8"));
    }
    return undefined;
}

export function writeInstanceConfig(
    instanceDir: string,
    config: InstanceConfig,
): void {
    const instanceConfigPath = path.join(instanceDir, "config.json");
    fs.writeFileSync(instanceConfigPath, JSON.stringify(config, null, 4));
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
