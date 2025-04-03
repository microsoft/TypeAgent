// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentProvider } from "agent-dispatcher";
import { getPackageFilePath } from "./utils/getPackageFilePath.js";
import { InstanceConfigProvider, getProviderConfig } from "./utils/config.js";
import { createMcpAppAgentProvider } from "./mcpAgentProvider.js";

let mcpAppAgentProvider: AppAgentProvider | undefined;
export function getDefaultMcpAppAgentProvider(
    instanceConfigs?: InstanceConfigProvider,
): AppAgentProvider | undefined {
    if (mcpAppAgentProvider === undefined) {
        const servers = structuredClone(getProviderConfig().mcpServers);
        if (servers === undefined) {
            return undefined;
        }

        for (const entry of Object.values(servers)) {
            if (entry.serverScript !== undefined) {
                entry.serverScript = getPackageFilePath(entry.serverScript);
            }
        }
        mcpAppAgentProvider = createMcpAppAgentProvider(
            "typeagent",
            "0.0.1",
            servers,
            instanceConfigs,
        );
    }
    return mcpAppAgentProvider;
}
