// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import type { AppAgentProvider } from "agent-dispatcher";
import { McpConnection } from "./mcpConnection.js";
import { convertToolResult } from "./mcpResult.js";
import { convertToolsSchema } from "./mcpSchema.js";
import {
    NormalizedMcpServerConfig,
    toTransportConfig,
} from "./mcpServerConfig.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:mcp:server");
const debugError = registerDebug("typeagent:mcp:server:error");

const entryTypeName = "AgentActions";

export type McpClientInfo = { name: string; version: string };

// One connected MCP server plus the loaded agent it backs. Shared across
// sessions; `connection` is undefined until (and after a failed) connect.
type McpServerAgent = {
    manifest: AppAgentManifest;
    agent: AppAgent;
    connection: McpConnection | undefined;
};

// A single normalized MCP server config lowered to a live connection, its
// generated action schema, and an executeAction that round-trips through the
// server. Composes the Phase 1-3 primitives (McpConnection, convertToolsSchema,
// convertToolResult, toTransportConfig) instead of the legacy script-only path,
// so it supports generic stdio (command/args/env/cwd) and resolves credential
// references at launch.
async function connectServerAgent(
    name: string,
    config: NormalizedMcpServerConfig,
    clientInfo: McpClientInfo,
    schemaFile: { format: "pas"; content: string },
    inputs?: Record<string, string>,
): Promise<McpServerAgent> {
    const manifest: AppAgentManifest = {
        emojiChar: config.emojiChar ?? "🔌",
        description: config.description ?? name,
        schema: {
            description: config.description ?? name,
            schemaType: entryTypeName,
            schemaFile,
        },
    };

    let connection: McpConnection | undefined;
    let agent: AppAgent;
    try {
        connection = await McpConnection.create(
            clientInfo,
            toTransportConfig(config, inputs),
        );
        debug(
            `[${name}] connected (era=${connection.protocolEra}, version=${connection.protocolVersion})`,
        );
        let tools = await connection.listTools();
        // An explicit allowlist hides every other advertised tool.
        if (config.enabledTools !== undefined) {
            const allow = new Set(config.enabledTools);
            tools = tools.filter((t) => allow.has(t.name));
        }
        if (tools.length === 0) {
            throw new Error(`No tools found for MCP server '${name}'`);
        }
        const schema = convertToolsSchema(tools, entryTypeName);
        if (schema.skipped.length > 0) {
            debugError(
                `[${name}] ${schema.skipped.length} tool(s) skipped: ${schema.skipped
                    .map((s) => `${s.name} (${s.reason})`)
                    .join("; ")}`,
            );
        }
        schemaFile.content = schema.content;

        const activeConnection = connection;
        agent = {
            executeAction: async (action) => {
                const result = await activeConnection.callTool(
                    action.actionName,
                    action.parameters as Record<string, unknown> | undefined,
                );
                return convertToolResult(action.actionName, result);
            },
        };
    } catch (error: any) {
        debugError(`[${name}] failed to connect: ${error?.message ?? error}`);
        if (connection !== undefined) {
            await connection.close().catch(() => {});
            connection = undefined;
        }
        // Defer surfacing the failure until the agent is actually used, matching
        // the legacy provider's behavior so one broken server does not abort the
        // whole session's agent registration.
        agent = {
            updateAgentContext() {
                throw error;
            },
        };
    }
    return { manifest, agent, connection };
}

/**
 * Build a single-name {@link AppAgentProvider} for one normalized MCP server
 * config. This is the runtime unit the dynamic MCP source vends — one shared,
 * refcounted provider per configured server (mirroring
 * `createInstalledAppAgentProvider` for npm agents). The connection is
 * established lazily on first `loadAppAgent`/`getAppAgentManifest` and torn down
 * once the refcount returns to zero.
 */
export function createMcpServerAppAgentProvider(
    name: string,
    config: NormalizedMcpServerConfig,
    clientInfo: McpClientInfo,
    inputs?: Record<string, string>,
): AppAgentProvider {
    const schemaFile = { format: "pas" as const, content: "" };
    let agentP: Promise<McpServerAgent> | undefined;
    let count = 0;

    function ensureAgent(): Promise<McpServerAgent> {
        if (agentP === undefined) {
            agentP = connectServerAgent(
                name,
                config,
                clientInfo,
                schemaFile,
                inputs,
            );
        }
        return agentP;
    }

    return {
        getAppAgentNames: () => [name],
        getLoadingAgentNames: () => [],
        isLoaded: (n: string) => n === name && count > 0,
        async getAppAgentManifest(n: string) {
            if (n !== name) {
                throw new Error(`Unknown MCP agent '${n}'`);
            }
            // Probe the manifest without holding a refcount: connect, read the
            // manifest (with its generated schema), then, if nobody loaded the
            // agent while we awaited, tear the probe connection down so an idle
            // manifest fetch never leaks a live connection.
            const agentData = await ensureAgent();
            if (count === 0 && agentP !== undefined) {
                agentP = undefined;
                if (agentData.connection !== undefined) {
                    await agentData.connection.close().catch(() => {});
                }
            }
            return agentData.manifest;
        },
        async loadAppAgent(n: string) {
            if (n !== name) {
                throw new Error(`Unknown MCP agent '${n}'`);
            }
            count++;
            return (await ensureAgent()).agent;
        },
        async unloadAppAgent(n: string) {
            if (n !== name) {
                throw new Error(`Unknown MCP agent '${n}'`);
            }
            if (count === 0) {
                return;
            }
            if (--count === 0 && agentP !== undefined) {
                const agentData = await agentP;
                agentP = undefined;
                schemaFile.content = "";
                if (agentData.connection !== undefined) {
                    await agentData.connection.close().catch(() => {});
                }
            }
        },
    };
}
