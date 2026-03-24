// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import {
    parseToolsJsonSchema,
    toJSONParsedActionSchema,
} from "@typeagent/action-schema";
import { AppAgentProvider } from "agent-dispatcher";
import {
    ArgDefinitions,
    ParsedCommandParams,
    ParameterDefinitions,
    ActionContext,
} from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import { InstanceConfig, InstanceConfigProvider } from "./utils/config.js";
import { spawn, ChildProcess } from "child_process";
import net from "net";
import registerDebug from "debug";

const debug = registerDebug("typeagent:mcp");
const debugError = registerDebug("typeagent:mcp:error");

export type McpAppAgentInfo = {
    emojiChar: string;
    description: string;
    defaultEnabled?: boolean;
    schemaDefaultEnabled?: boolean;
    actionDefaultEnabled?: boolean;
    serverScript?: string;
    serverScriptArgs?: string[] | ArgDefinitions;
    serverUrl?: string;
    serverCommand?: string;
    serverCommandArgs?: string[];
};

export type McpAppAgent = {
    manifest: AppAgentManifest;
    agent: AppAgent;
    transport: StdioClientTransport | StreamableHTTPClientTransport | undefined;
    serverProcess?: ChildProcess | undefined;
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

// Check if anything is already listening on the port — raw TCP, no MCP handshake.
// This prevents us from launching a second server when one (even a broken one) is
// already bound to the port, which would cause compilation + bind-failure hangs.
function isPortOccupied(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            const parsed = new URL(url);
            const port = parseInt(
                parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
            );
            const socket = net.createConnection(port, parsed.hostname);
            socket.once("connect", () => {
                socket.destroy();
                resolve(true);
            });
            socket.once("error", () => resolve(false));
            socket.setTimeout(2000, () => {
                socket.destroy();
                resolve(false);
            });
        } catch {
            resolve(false);
        }
    });
}

function launchHttpServer(
    command: string,
    args: string[],
): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let started = false;
        const timeout = setTimeout(() => {
            if (!started) {
                proc.kill();
                reject(
                    new Error(`HTTP MCP server failed to start within 180s`),
                );
            }
        }, 180000);
        const onData = (data: Buffer) => {
            const line = data.toString().trimEnd();
            debug(`[server] ${line}`);
            if (!started && line.includes("Now listening on")) {
                started = true;
                clearTimeout(timeout);
                resolve(proc);
            }
        };
        proc.stdout?.on("data", onData);
        proc.stderr?.on("data", onData);
        proc.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        proc.on("exit", (code) => {
            clearTimeout(timeout);
            if (!started) {
                reject(
                    new Error(
                        `HTTP MCP server exited with code ${code} before starting`,
                    ),
                );
            }
        });
    });
}

function createMcpAppAgentTransport(
    appAgentName: string,
    info: McpAppAgentInfo,
    instanceConfig?: McpAppAgentConfig,
): StdioClientTransport | StreamableHTTPClientTransport {
    if (info.serverUrl !== undefined) {
        return new StreamableHTTPClientTransport(new URL(info.serverUrl));
    }

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
    configs: InstanceConfigProvider,
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
                    params: ParsedCommandParams<ParameterDefinitions>,
                ) => {
                    const instanceConfig: InstanceConfig = structuredClone(
                        configs.getInstanceConfig(),
                    );
                    if (instanceConfig.mcpServers === undefined) {
                        instanceConfig.mcpServers = {};
                    }
                    const serverScriptArgs = Object.keys(args).map((k) =>
                        String((params.args as Record<string, unknown>)[k]),
                    );
                    instanceConfig.mcpServers[appAgentName] = {
                        serverScriptArgs,
                    };
                    configs.setInstanceConfig(instanceConfig);
                    context.actionIO.appendDisplay(
                        `Server arguments set to ${serverScriptArgs.join(" ")}.  Please restart TypeAgent to reflect the change.`,
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
    configs?: InstanceConfigProvider,
    instanceConfig?: McpAppAgentConfig,
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
        let transport:
            | StdioClientTransport
            | StreamableHTTPClientTransport
            | undefined;
        let serverProcess: ChildProcess | undefined;
        let agent: AppAgent;
        try {
            if (info.serverCommand !== undefined) {
                const occupied =
                    info.serverUrl !== undefined &&
                    (await isPortOccupied(info.serverUrl));
                debug(
                    `[${appAgentName}] serverUrl=${info.serverUrl} port occupied=${occupied}`,
                );
                if (!occupied) {
                    debug(
                        `[${appAgentName}] launching server: ${info.serverCommand} ${(info.serverCommandArgs ?? []).join(" ")}`,
                    );
                    serverProcess = await launchHttpServer(
                        info.serverCommand,
                        info.serverCommandArgs ?? [],
                    );
                    debug(
                        `[${appAgentName}] server process started (pid ${serverProcess.pid})`,
                    );
                } else {
                    debug(
                        `[${appAgentName}] server already running, skipping launch`,
                    );
                }
            }
            const transportUrl =
                info.serverUrl ?? info.serverScript ?? "(stdio)";
            debug(`[${appAgentName}] connecting transport to ${transportUrl}`);
            transport = createMcpAppAgentTransport(
                appAgentName,
                info,
                instanceConfig,
            );
            const client = new Client({ name: clientName, version });
            await client.connect(transport as any);
            debug(`[${appAgentName}] connected, listing tools...`);
            const tools = (await client.listTools()).tools;
            debug(
                `[${appAgentName}] found ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}`,
            );
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
            debugError(
                `[${appAgentName}] failed to connect: ${error?.message ?? error}`,
            );
            if (transport !== undefined) {
                transport.close();
                transport = undefined;
            }
            if (serverProcess !== undefined) {
                serverProcess.kill();
                serverProcess = undefined;
            }
            agent = {
                updateAgentContext() {
                    // Delay throwing error until the agent is used.
                    throw error;
                },
            };
        }
        const handlers =
            configs !== undefined &&
            info.serverScriptArgs !== undefined &&
            !Array.isArray(info.serverScriptArgs)
                ? getMcpCommandHandlerTable(
                      appAgentName,
                      info.serverScriptArgs,
                      configs,
                  )
                : undefined;
        if (handlers !== undefined) {
            Object.assign(agent, getCommandInterface(handlers));
        }
        return {
            manifest,
            transport,
            agent,
            serverProcess,
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
    configs?: InstanceConfigProvider,
): AppAgentProvider {
    const instanceConfig = configs?.getInstanceConfig()?.mcpServers;
    const mcpAppAgents = new Map<string, McpAppAgentRecord>();

    // For server-command agents: background records that start the server eagerly.
    // count is kept at 1 (background ref) so the server process is never killed
    // by a stray unload.  They are moved into mcpAppAgents on first loadAppAgent.
    const backgroundRecords = new Map<string, McpAppAgentRecord>();

    // Callbacks registered via onSchemaReady()
    const schemaReadyCallbacks: ((
        agentName: string,
        manifest: AppAgentManifest,
    ) => void)[] = [];

    // Manifests that are already resolved (so late-registered callbacks fire immediately)
    const resolvedManifests = new Map<string, AppAgentManifest>();

    function startBackgroundAgent(appAgentName: string) {
        if (
            backgroundRecords.has(appAgentName) ||
            mcpAppAgents.has(appAgentName)
        ) {
            return;
        }
        const info = infos[appAgentName];
        if (info === undefined || info.serverCommand === undefined) {
            return;
        }
        const record = createMcpAppAgentRecord(
            name,
            version,
            appAgentName,
            info,
            configs,
            instanceConfig?.[appAgentName],
        );
        backgroundRecords.set(appAgentName, record);

        record.agentP
            .then((agentData) => {
                if (agentData.transport !== undefined) {
                    resolvedManifests.set(appAgentName, agentData.manifest);
                    for (const cb of schemaReadyCallbacks) {
                        cb(appAgentName, agentData.manifest);
                    }
                }
            })
            .catch(() => {
                // errors surface when the agent is actually used
            });
    }

    function getMpcAppAgentRecord(appAgentName: string) {
        const existing = mcpAppAgents.get(appAgentName);
        if (existing !== undefined) {
            existing.count++;
            return existing;
        }
        // Promote a background record (server already loading/loaded)
        const background = backgroundRecords.get(appAgentName);
        if (background !== undefined) {
            background.count++;
            backgroundRecords.delete(appAgentName);
            mcpAppAgents.set(appAgentName, background);
            return background;
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
            configs,
            instanceConfig?.[appAgentName],
        );
        mcpAppAgents.set(appAgentName, record);
        return record;
    }

    return {
        getAppAgentNames() {
            return Object.keys(infos);
        },

        getLoadingAgentNames() {
            return [...backgroundRecords.keys()];
        },

        onSchemaReady(callback) {
            schemaReadyCallbacks.push(callback);
            // Fire immediately for any agents already resolved
            for (const [agentName, manifest] of resolvedManifests) {
                callback(agentName, manifest);
            }
        },

        async getAppAgentManifest(appAgentName: string) {
            const info = infos[appAgentName];
            if (info === undefined) {
                throw new Error(`Invalid app agent: ${appAgentName}`);
            }
            if (info.serverCommand !== undefined) {
                // Non-blocking: kick off background server startup and return a
                // stub manifest immediately.  The real manifest (with schema) is
                // delivered later via the onSchemaReady callback.
                startBackgroundAgent(appAgentName);
                // Include a stub schema so the agent row appears in @config
                // (default view filters by schema names).  The empty content
                // will fail to parse, showing ❌ while loading.  refreshAgentSchema
                // replaces it with the real schema once the server is ready.
                return {
                    emojiChar: info.emojiChar,
                    description: info.description,
                    defaultEnabled: info.defaultEnabled,
                    schema: {
                        description: info.description,
                        schemaType: entryTypeName,
                        schemaFile: {
                            format: "pas" as const,
                            content: "",
                        },
                    },
                } as AppAgentManifest;
            }
            // Stdio agents start fast — keep blocking path.
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
                const agent = await record.agentP;
                const transport = agent.transport;
                if (transport !== undefined) {
                    if (transport instanceof StreamableHTTPClientTransport) {
                        await transport.close();
                    } else {
                        return new Promise<void>((resolve) => {
                            transport.onclose = resolve;
                            transport.close();
                        });
                    }
                }
                agent.serverProcess?.kill();
            }
        },
    };
}
