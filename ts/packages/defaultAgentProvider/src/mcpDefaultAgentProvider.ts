// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentProvider } from "agent-dispatcher";
import { getPackageFilePath } from "./utils/getPackageFilePath.js";
import { InstanceConfigProvider, getProviderConfig } from "./utils/config.js";
import { createMcpAppAgentProvider } from "./mcpAgentProvider.js";

let mcpAppAgentProvider: AppAgentProvider | undefined;

function initializeMcpAppAgentProvider(
    instanceConfigs?: InstanceConfigProvider,
) {
    const servers = structuredClone(getProviderConfig().mcpServers);
    if (servers === undefined) {
        return undefined;
    }

    for (const entry of Object.values(servers)) {
        if (entry.serverScript !== undefined) {
            entry.serverScript = getPackageFilePath(entry.serverScript);
        }
    }
    return createMcpAppAgentProvider(
        "typeagent",
        "0.0.1",
        servers,
        instanceConfigs,
    );
}

export function getDefaultMcpAppAgentProvider(
    instanceConfigs?: InstanceConfigProvider,
): AppAgentProvider | undefined {
    if (instanceConfigs !== undefined) {
        return initializeMcpAppAgentProvider(instanceConfigs);
    }

    // Only reuse if there is no instanceConfigs provided
    if (mcpAppAgentProvider === undefined) {
        mcpAppAgentProvider = initializeMcpAppAgentProvider();
    }
    return mcpAppAgentProvider;
}
