// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { glob } from "glob";
import { AppAgentInfo } from "agent-dispatcher/helpers/npmAgentProvider";
import { getPackageFilePath } from "./getPackageFilePath.js";
import fs from "node:fs";

export type ExplainerConfig = {
    constructions?: {
        data: string[];
        file: string;
    };
};

export type AppAgentConfig = {
    agents: { [key: string]: AppAgentInfo };
};

export type Config = AppAgentConfig & {
    explainers: { [key: string]: ExplainerConfig };
    tests: string[];
};

let config: Config | undefined;
export function getConfig(): Config {
    if (config === undefined) {
        config = JSON.parse(
            fs.readFileSync(getPackageFilePath("./data/config.json"), "utf8"),
        ) as Config;
    }
    return config;
}

export function getBuiltinConstructionConfig(explainerName: string) {
    const config = getConfig()?.explainers?.[explainerName]?.constructions;
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
    const testDataFiles = getConfig()?.tests;
    if (testDataFiles === undefined) {
        return [];
    }
    const testDataFilePaths = extended
        ? testDataFiles
        : testDataFiles.slice(0, 1);
    return glob(testDataFilePaths.map((f) => getPackageFilePath(f)));
}
