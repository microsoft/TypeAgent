// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AgentInfo } from "../internal.js";
import { getPackageFilePath } from "./getPackageFilePath.js";
import fs from "node:fs";

export type ExplainerConfig = {
    constructions?: {
        data: string[];
        file: string;
    };
};

export type Config = {
    agents: { [key: string]: AgentInfo };
    explainers: { [key: string]: ExplainerConfig };
    tests: string[];
};

let config: Config | undefined;
export function getDispatcherConfig(): Config {
    if (config === undefined) {
        config = JSON.parse(
            fs.readFileSync(getPackageFilePath("./data/config.json"), "utf8"),
        ) as Config;
    }
    return config;
}

export function getBuiltinConstructionConfig(explainerName: string) {
    const config =
        getDispatcherConfig()?.explainers?.[explainerName]?.constructions;
    return config
        ? {
              data: config.data.map((f) => getPackageFilePath(f)),
              file: getPackageFilePath(config?.file),
          }
        : undefined;
}
