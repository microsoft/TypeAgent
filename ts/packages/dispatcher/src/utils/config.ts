// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import fs from "node:fs";
import { glob } from "glob";
import type { AgentInfo } from "../agent/agentConfig.js";
import { getUserProfileDir } from "../utils/userData.js";
import { Console } from "node:console";

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

let externalAppAgentsConfig: Config | undefined;
export function getExternalAgentsConfig(): Config {
    if (externalAppAgentsConfig === undefined) {
        if(!fs.existsSync(path.join(getUserProfileDir(), "externalAgentsConfig.json"))){
            externalAppAgentsConfig = JSON.parse(
                fs.readFileSync(path.join(getUserProfileDir(), "externalAgentsConfig.json"), "utf8"),
            ) as Config;
        }
        else {
            externalAppAgentsConfig = { agents: {}, explainers: {}, tests: [] };
        }
    }
    return externalAppAgentsConfig;
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

export async function getTestDataFiles() {
    const config = await getDispatcherConfig();
    return glob(config.tests.map((f) => getPackageFilePath(f)));
}
