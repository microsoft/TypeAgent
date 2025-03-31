// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { parseToolsJsonSchema, toJSONParsedActionSchema } from "action-schema";
import { AppAgentProvider } from "agent-dispatcher";

export type McpAppAgentInfo = {
    emojiChar: string;
    description: string;
    defaultEnabled?: boolean;
    schemaDefaultEnabled?: boolean;
    actionDefaultEnabled?: boolean;
    serverScript?: string;
    serverScriptArgs?: string[] | boolean;
};

export type McpAppAgent = {
    manifest: AppAgentManifest;
    agent: AppAgent;
    transport: StdioClientTransport | undefined;
};
export type McpAppAgentRecord = {
    agentP: Promise<McpAppAgent>;
    count: number;
};

export type McpAppAgentConfig = {
    serverScriptArgs?: string[];
};

const entryTypeName = "AgentActions";
function convertSchema(tools: any) {
    const pas = parseToolsJsonSchema(tools, entryTypeName);
    return JSON.stringify(toJSONParsedActionSchema(pas));
}

function createMcpAppAgentTransport(
    appAgentName: string,
    info: McpAppAgentInfo,
    instanceConfig?: McpAppAgentConfig,
) {
    const serverScriptPath = info.serverScript;
    if (serverScriptPath === undefined) {
        throw new Error(`Invalid app agent: ${appAgentName}`);
    }

    const instanceServerScriptArgs = instanceConfig?.serverScriptArgs;
    const serverScriptArgs =
        info.serverScriptArgs === true
            ? instanceConfig?.serverScriptArgs
            : Array.isArray(info.serverScriptArgs)
              ? instanceServerScriptArgs
                  ? info.serverScriptArgs.concat(instanceServerScriptArgs)
                  : info.serverScriptArgs
              : []; //  info.serverScriptArgs is false or undefined;
    if (serverScriptArgs === undefined) {
        throw new Error(
            `Invalid app agent config ${appAgentName}: Missing required server script args in instance config`,
        );
    }
    const isJs = serverScriptPath.endsWith(".js");
    const isPy = serverScriptPath.endsWith(".py");
    if (!isJs && !isPy) {
        throw new Error(
            `Invalid app agent config ${appAgentName}: Server script must be a .js or .py file`,
        );
    }
    const command = isPy
        ? process.platform === "win32"
            ? "python"
            : "python3"
        : "node";
    return new StdioClientTransport({
        command,
        args: [serverScriptPath, ...serverScriptArgs],
        stderr: "pipe",
    });
}

function createMcpAppAgentRecord(
    clientName: string,
    version: string,
    appAgentName: string,
    info: McpAppAgentInfo,
    instanceConfig?: McpAppAgentConfig,
): McpAppAgentRecord {
    const manifest: AppAgentManifest = {
        emojiChar: info.emojiChar,
        description: info.description,
    };
    if (info.defaultEnabled) {
        manifest.defaultEnabled = info.defaultEnabled;
    }
    if (info.schemaDefaultEnabled) {
        manifest.schemaDefaultEnabled = info.schemaDefaultEnabled;
    }
    if (info.actionDefaultEnabled) {
        manifest.actionDefaultEnabled = info.actionDefaultEnabled;
    }

    const createMcpAppAgent = async (): Promise<McpAppAgent> => {
        try {
            const transport = createMcpAppAgentTransport(
                appAgentName,
                info,
                instanceConfig,
            );
            const client = new Client({ name: clientName, version });
            await client.connect(transport);
            const tools = (await client.listTools()).tools;
            if (tools.length === 0) {
                throw new Error(
                    `Invalid app agent config ${appAgentName}: No tools found`,
                );
            }

            manifest.schema = {
                description: info.description,
                schemaType: entryTypeName,
                schemaFile: { format: "pas", content: convertSchema(tools) },
            };

            const agent: AppAgent = {
                executeAction: async (action, context) => {
                    const result = await client.callTool({
                        name: action.actionName,
                        arguments: action.parameters,
                    });

                    const content: any = result.content;
                    const text: string[] = [];
                    for (const item of content) {
                        switch (item.type) {
                            case "text":
                                text.push(item.text);
                                break;
                            default:
                                throw new Error(
                                    `Action ${action.actionName} return an unsupported content type ${item.type}`,
                                );
                        }
                    }
                    return createActionResult(text.join("\n"));
                },
            };
            return {
                manifest,
                transport,
                agent,
            };
        } catch (error: any) {
            return {
                manifest,
                transport: undefined,
                agent: {
                    initializeAgentContext() {
                        // Delay throwing error until the agent is used.
                        throw error;
                    },
                    executeCommand() {
                        // Since we don't have any schema, use a fake command handler to have it show up in the list of agents.
                        throw error;
                    },
                },
            };
        }
    };
    return {
        agentP: createMcpAppAgent(),
        count: 1,
    };
}

export function createMcpAppAgentProvider(
    name: string,
    version: string,
    infos: Record<string, McpAppAgentInfo>,
    instanceConfig?: Record<string, McpAppAgentConfig>,
): AppAgentProvider {
    const mcpAppAgents = new Map<string, McpAppAgentRecord>();
    function getMpcAppAgentRecord(appAgentName: string) {
        const existing = mcpAppAgents.get(appAgentName);
        if (existing !== undefined) {
            existing.count++;
            return existing;
        }
        const info = infos[appAgentName];
        if (info === undefined) {
            throw new Error(`Invalid app agent: ${appAgentName}`);
        }
        const record = createMcpAppAgentRecord(
            name,
            version,
            appAgentName,
            info,
            instanceConfig?.[appAgentName],
        );
        mcpAppAgents.set(appAgentName, record);
        return record;
    }
    return {
        getAppAgentNames() {
            return Object.keys(infos);
        },
        async getAppAgentManifest(appAgentName: string) {
            const record = getMpcAppAgentRecord(appAgentName);
            const manifest = (await record.agentP).manifest;
            await this.unloadAppAgent(appAgentName);
            return manifest;
        },
        async loadAppAgent(appAgentName: string) {
            return (await getMpcAppAgentRecord(appAgentName).agentP).agent;
        },
        async unloadAppAgent(appAgentName: string) {
            const record = mcpAppAgents.get(appAgentName);
            if (!record || record.count === 0) {
                throw new Error(`Invalid app agent: ${appAgentName}`);
            }
            if (--record.count === 0) {
                mcpAppAgents.delete(appAgentName);
                (await record.agentP).transport?.close();
            }
        },
    };
}
