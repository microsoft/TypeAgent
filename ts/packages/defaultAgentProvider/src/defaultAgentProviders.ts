// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentProvider } from "agent-dispatcher";
import { createNpmAppAgentProvider } from "agent-dispatcher/helpers/npmAgentProvider";

import path from "node:path";
import fs from "node:fs";
import { getConfig, AppAgentConfig } from "./utils/config.js";

let builtinAppAgentProvider: AppAgentProvider | undefined;
export function getBuiltinAppAgentProvider(): AppAgentProvider {
    if (builtinAppAgentProvider === undefined) {
        builtinAppAgentProvider = createNpmAppAgentProvider(
            getConfig().agents,
            import.meta.url,
        );
    }
    return builtinAppAgentProvider;
}

let externalAppAgentsConfig: AppAgentConfig | undefined;
function getExternalAgentsConfig(instanceDir: string): AppAgentConfig {
    if (externalAppAgentsConfig === undefined) {
        if (
            fs.existsSync(path.join(instanceDir, "externalAgentsConfig.json"))
        ) {
            externalAppAgentsConfig = JSON.parse(
                fs.readFileSync(
                    path.join(instanceDir, "externalAgentsConfig.json"),
                    "utf8",
                ),
            ) as AppAgentConfig;
        } else {
            externalAppAgentsConfig = { agents: {} };
        }
    }
    return externalAppAgentsConfig;
}

function getExternalAppAgentProvider(instanceDir: string): AppAgentProvider {
    return createNpmAppAgentProvider(
        getExternalAgentsConfig(instanceDir).agents,
        path.join(instanceDir, "externalagents/package.json"),
    );
}

export function getDefaultAppAgentProviders(
    instanceDir: string | undefined,
): AppAgentProvider[] {
    const providers = [getBuiltinAppAgentProvider()];
    if (instanceDir !== undefined) {
        providers.push(getExternalAppAgentProvider(instanceDir));
    }
    return providers;
}
