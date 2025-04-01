// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { parseToolsJsonSchema, toJSONParsedActionSchema } from "action-schema";
import { AppAgentProvider } from "agent-dispatcher";
import {
    ArgDefinitions,
    ParsedCommandParams,
    ActionContext,
} from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import { readInstanceConfig, writeInstanceConfig } from "./utils/config.js";

export type McpAppAgentInfo = {
    emojiChar: string;
    description: string;
    defaultEnabled?: boolean;
    schemaDefaultEnabled?: boolean;
    actionDefaultEnabled?: boolean;
    serverScript?: string;
    serverScriptArgs?: string[] | ArgDefinitions;
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
    const serverScriptArgs = Array.isArray(info.serverScriptArgs)
        ? instanceServerScriptArgs
            ? info.serverScriptArgs.concat(instanceServerScriptArgs)
            : info.serverScriptArgs
        : info.serverScriptArgs === undefined
          ? []
          : instanceServerScriptArgs;

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

function getMcpCommandHandlerTable(
    appAgentName: string,
    args: ArgDefinitions,
    instanceDir: string,
): CommandHandlerTable {
    return {
        description: "MCP Command Handler Server Arguments",
        commands: {
            server: {
                description: "Set the server arguments",
                parameters: {
                    args,
                },
                run: async (
                    context: ActionContext<unknown>,
                    params: ParsedCommandParams<{}>,
                ) => {
                    const instanceConfig =
                        readInstanceConfig(instanceDir) ?? {};
                    if (instanceConfig.mcpServers === undefined) {
                        instanceConfig.mcpServers = {};
                    }
                    instanceConfig.mcpServers[appAgentName] = {
                        serverScriptArgs: params.tokens,
                    };
                    writeInstanceConfig(instanceDir, instanceConfig);

                    context.actionIO.appendDisplay(
                        `Server arguments set to ${params.tokens.join(" ")}.  Please restart TypeAgent to reflect the change.`,
                    );
                },
            },
        },
    };
}

function createMcpAppAgentRecord(
    clientName: string,
    version: string,
    appAgentName: string,
    info: McpAppAgentInfo,
    instanceConfig?: McpAppAgentConfig,
    instanceDir?: string,
): McpAppAgentRecord {
    const schemaFile = { format: "pas" as const, content: "" /* invalid */ };
    const manifest: AppAgentManifest = {
        emojiChar: info.emojiChar,
        description: info.description,
        schema: {
            description: info.description,
            schemaType: entryTypeName,
            schemaFile,
        },
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
        let transport: StdioClientTransport | undefined;
        let agent: AppAgent;
        try {
            transport = createMcpAppAgentTransport(
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

            schemaFile.content = convertSchema(tools);

            agent = {
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
        } catch (error: any) {
            if (transport !== undefined) {
                transport.close();
                transport = undefined;
            }
            agent = {
                updateAgentContext() {
                    // Delay throwing error until the agent is used.
                    throw error;
                },
            };
        }
        const handlers =
            instanceDir !== undefined &&
            info.serverScriptArgs !== undefined &&
            !Array.isArray(info.serverScriptArgs)
                ? getMcpCommandHandlerTable(
                      appAgentName,
                      info.serverScriptArgs,
                      instanceDir,
                  )
                : undefined;
        if (handlers !== undefined) {
            Object.assign(agent, getCommandInterface(handlers));
        }
        return {
            manifest,
            transport: undefined,
            agent,
        };
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
    instanceDir?: string,
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
            instanceDir,
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
