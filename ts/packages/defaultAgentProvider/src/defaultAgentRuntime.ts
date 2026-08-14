// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AppAgentSource } from "agent-dispatcher";
import {
    createDefaultInstalledAgentSource,
    DefaultAppAgentSourceOptions,
} from "./defaultAgentProviders.js";
import { createMcpAppAgentSourceForInstance } from "./mcpDefaultAgentProvider.js";
import { getInstanceConfigProvider } from "./utils/config.js";
import type { InstalledAgentSourceApi } from "./installSources/packageAgent.js";
import type { McpServerSourceApi } from "./mcp/mcpAppAgentSource.js";
import type { McpHostServices } from "./mcp/mcpServerProvider.js";
import { SessionMcpCredentialStore } from "./mcp/mcpCredentialStore.js";
import { defaultMcpPolicy } from "./mcp/mcpPolicy.js";
import { JsonlMcpAuditSink } from "./mcp/mcpAudit.js";

export interface DefaultAgentRuntime {
    readonly appAgentSources: [AppAgentSource, AppAgentSource];
    readonly installedAgentSourceApi: InstalledAgentSourceApi;
    readonly mcpServerSourceApi: McpServerSourceApi;
}

export function createDefaultAgentRuntime(
    instanceDir: string,
    options?: DefaultAppAgentSourceOptions,
    mcpServices?: Partial<McpHostServices>,
): DefaultAgentRuntime {
    const services: McpHostServices = {
        credentialStore:
            mcpServices?.credentialStore ?? new SessionMcpCredentialStore(),
        policy: mcpServices?.policy ?? defaultMcpPolicy,
        audit: mcpServices?.audit ?? new JsonlMcpAuditSink(instanceDir),
        ...(mcpServices?.oauthInteraction === undefined
            ? {}
            : { oauthInteraction: mcpServices.oauthInteraction }),
    };
    const mcp = createMcpAppAgentSourceForInstance(
        getInstanceConfigProvider(instanceDir),
        services,
    );
    const installed = createDefaultInstalledAgentSource(
        instanceDir,
        options,
        undefined,
        undefined,
        mcp.testApi,
    );
    const { testApi: installedAgentSourceApi, ...installedSource } = installed;
    const { testApi: mcpServerSourceApi, ...mcpSource } = mcp;
    return {
        appAgentSources: [installedSource, mcpSource],
        installedAgentSourceApi,
        mcpServerSourceApi,
    };
}

export function getDefaultAppAgentSources(
    instanceDir: string,
    options?: DefaultAppAgentSourceOptions,
): [AppAgentSource, AppAgentSource] {
    return createDefaultAgentRuntime(instanceDir, options).appAgentSources;
}
