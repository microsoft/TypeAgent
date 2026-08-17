// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import type {
    ReplayToolDescriptor,
    ReplayToolContext,
    ReplayToolHost,
} from "@typeagent/copilot-macros";
import { JsonlMcpAuditSink, type McpAuditSink } from "./mcpAudit.js";
import { McpConnection } from "./mcpConnection.js";
import { importMcpConfig } from "./mcpConfigImport.js";
import {
    SessionMcpCredentialStore,
    type McpCredentialStore,
} from "./mcpCredentialStore.js";
import {
    resolveTransportConfig,
    type NormalizedMcpServerConfig,
} from "./mcpServerConfig.js";
import { openMcpServerStore } from "./mcpServerStore.js";
import {
    buildMcpToolCatalog,
    getMcpToolIdentity,
    type McpToolCatalog,
    type McpToolCatalogEntry,
} from "./mcpToolCatalog.js";

type ActiveServer = {
    config: NormalizedMcpServerConfig;
    connection: McpReplayConnection;
    catalog: McpToolCatalog;
};

export interface McpReplayConnection {
    listTools(): Promise<Tool[]>;
    callTool(
        name: string,
        args: Record<string, unknown> | undefined,
    ): Promise<CallToolResult>;
    close(): Promise<void>;
}

export interface McpReplayHostOptions {
    credentialStore?: McpCredentialStore;
    audit?: McpAuditSink;
    configs?: NormalizedMcpServerConfig[];
    connectionFactory?: (
        config: NormalizedMcpServerConfig,
    ) => Promise<McpReplayConnection>;
}

export class McpReplayHost implements ReplayToolHost {
    private readonly credentialStore: McpCredentialStore;
    private readonly audit: McpAuditSink;
    private readonly configs: NormalizedMcpServerConfig[];
    private readonly discovered = new Map<
        string,
        Promise<NormalizedMcpServerConfig[]>
    >();
    private readonly connectionFactory: (
        config: NormalizedMcpServerConfig,
    ) => Promise<McpReplayConnection>;
    private readonly active = new Map<string, Promise<ActiveServer>>();

    constructor(instanceDir: string, options: McpReplayHostOptions = {}) {
        this.credentialStore =
            options.credentialStore ?? new SessionMcpCredentialStore();
        this.audit = options.audit ?? new JsonlMcpAuditSink(instanceDir);
        this.configs =
            options.configs ?? openMcpServerStore(instanceDir).list();
        this.connectionFactory =
            options.connectionFactory ??
            (async (config) => {
                const transport = await resolveTransportConfig(
                    config,
                    this.credentialStore,
                );
                return McpConnection.create(
                    { name: "typeagent-macro-replay", version: "0.1.0" },
                    transport,
                );
            });
    }

    async inspectTool(
        mcpServerName: string | undefined,
        toolName: string,
        context: ReplayToolContext = {},
    ): Promise<ReplayToolDescriptor | undefined> {
        const server = await this.getServer(mcpServerName, context);
        const tool = this.getTool(server, toolName);
        if (!tool) return undefined;
        return {
            mcpServerName: server.config.name,
            toolName,
            schemaFingerprint: createHash("sha256")
                .update(
                    JSON.stringify({
                        inputSchema: tool.inputSchema,
                        outputSchema: tool.outputSchema,
                        annotations: tool.annotations,
                    }),
                )
                .digest("hex"),
        };
    }

    async callTool(
        mcpServerName: string | undefined,
        toolName: string,
        argumentsValue: unknown,
        signal: AbortSignal,
        context: ReplayToolContext = {},
    ): Promise<unknown> {
        const server = await this.getServer(mcpServerName, context);
        const tool = this.getTool(server, toolName);
        if (!tool) {
            throw new Error(
                `MCP replay tool is unavailable: ${mcpServerName}/${toolName}`,
            );
        }
        const parameters = this.asArguments(argumentsValue);
        const validation = tool.validateArguments(parameters);
        if (!validation.valid) {
            throw new Error(
                `MCP tool '${toolName}' rejected its arguments: ${validation.errorMessage}`,
            );
        }
        signal.throwIfAborted();
        const started = Date.now();
        try {
            await this.audit.write({
                timestamp: new Date().toISOString(),
                operation: "tool-invocation",
                configId: server.config.id,
                configName: server.config.name,
                tool: toolName,
                arguments: parameters,
            });
            const result = await this.callWithAbort(
                server,
                toolName,
                parameters,
                signal,
            );
            this.validateResult(server.config, tool, result);
            await this.audit.write({
                timestamp: new Date().toISOString(),
                operation: "tool-result",
                configId: server.config.id,
                configName: server.config.name,
                tool: toolName,
                status: "success",
                durationMs: Date.now() - started,
            });
            return result.structuredContent ?? result.content;
        } catch (error) {
            await this.audit.write({
                timestamp: new Date().toISOString(),
                operation: "tool-result",
                configId: server.config.id,
                configName: server.config.name,
                tool: toolName,
                status: "failure",
                durationMs: Date.now() - started,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    async close(): Promise<void> {
        const servers = await Promise.allSettled(this.active.values());
        this.active.clear();
        await Promise.allSettled(
            servers.flatMap((server) =>
                server.status === "fulfilled"
                    ? [server.value.connection.close()]
                    : [],
            ),
        );
    }

    private async getServer(
        serverName: string | undefined,
        context: ReplayToolContext,
    ): Promise<ActiveServer> {
        if (!serverName || serverName === "typeagent-macros") {
            throw new Error(
                `MCP server is not replayable: ${serverName ?? "native"}`,
            );
        }
        const configs = await this.getConfigs(context.cwd);
        const config = configs.find(
            (candidate) =>
                candidate.name === serverName || candidate.id === serverName,
        );
        if (!config) {
            throw new Error(
                `MCP server '${serverName}' is Copilot-only or not configured in TypeAgent.`,
            );
        }
        let active = this.active.get(config.id);
        if (!active) {
            active = this.connect(config);
            this.active.set(config.id, active);
            active.catch(() => this.active.delete(config.id));
        }
        return active;
    }

    private async getConfigs(
        cwd: string | undefined,
    ): Promise<NormalizedMcpServerConfig[]> {
        if (!cwd) return this.configs;
        const resolvedCwd = path.resolve(cwd);
        let configs = this.discovered.get(resolvedCwd);
        if (!configs) {
            configs = this.discoverConfigs(resolvedCwd);
            this.discovered.set(resolvedCwd, configs);
        }
        return [...(await configs), ...this.configs];
    }

    private async discoverConfigs(
        cwd: string,
    ): Promise<NormalizedMcpServerConfig[]> {
        const sources = [
            { filePath: path.join(cwd, ".mcp.json"), source: "workspace" },
            {
                filePath: path.join(cwd, ".github", "mcp.json"),
                source: "github-workspace",
            },
            {
                filePath: path.join(cwd, ".vscode", "mcp.json"),
                source: "vscode-workspace",
            },
            {
                filePath: path.join(
                    os.homedir(),
                    ".copilot",
                    "mcp-config.json",
                ),
                source: "copilot-user",
            },
        ];
        const configs: NormalizedMcpServerConfig[] = [];
        for (const source of sources) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(await readFile(source.filePath, "utf8"));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT")
                    continue;
                throw new Error(
                    `Unable to read MCP config '${source.filePath}': ${error instanceof Error ? error.message : String(error)}`,
                );
            }
            const imported = importMcpConfig(parsed);
            if (imported.errors.length > 0) {
                throw new Error(
                    `Invalid MCP config '${source.filePath}': ${imported.errors.map((error) => `${error.name}: ${error.reason}`).join("; ")}`,
                );
            }
            for (const importedServer of imported.servers) {
                if (importedServer.name === "typeagent-macros") continue;
                configs.push({
                    ...importedServer.config,
                    id: `${source.source}:${importedServer.name}`,
                    scope:
                        source.source === "copilot-user" ? "user" : "workspace",
                    provenance: {
                        ...importedServer.config.provenance,
                        source: source.filePath,
                        sourceKind: source.source,
                    },
                });
            }
        }
        return configs;
    }

    private async connect(
        config: NormalizedMcpServerConfig,
    ): Promise<ActiveServer> {
        const connection = await this.connectionFactory(config);
        try {
            const catalog = buildMcpToolCatalog(
                config.id,
                await connection.listTools(),
                "McpReplayAction",
            );
            return { config, connection, catalog };
        } catch (error) {
            await connection.close();
            throw error;
        }
    }

    private getTool(
        server: ActiveServer,
        toolName: string,
    ): McpToolCatalogEntry | undefined {
        return server.catalog.entries.get(
            getMcpToolIdentity(server.config.id, toolName),
        );
    }

    private asArguments(value: unknown): Record<string, unknown> {
        if (
            value === null ||
            typeof value !== "object" ||
            Array.isArray(value)
        ) {
            throw new Error("MCP tool arguments must resolve to an object.");
        }
        return value as Record<string, unknown>;
    }

    private validateResult(
        config: NormalizedMcpServerConfig,
        tool: McpToolCatalogEntry,
        result: CallToolResult,
    ): void {
        if (result.isError) {
            throw new Error(
                `MCP tool '${tool.name}' on '${config.name}' returned an error.`,
            );
        }
        if (tool.validateOutput) {
            const validation = tool.validateOutput(result.structuredContent);
            if (!validation.valid) {
                throw new Error(
                    `MCP tool '${tool.name}' returned invalid output: ${validation.errorMessage}`,
                );
            }
        }
    }

    private async callWithAbort(
        server: ActiveServer,
        toolName: string,
        parameters: Record<string, unknown>,
        signal: AbortSignal,
    ): Promise<CallToolResult> {
        let removeAbort: (() => void) | undefined;
        const aborted = new Promise<never>((_resolve, reject) => {
            const onAbort = () => {
                this.active.delete(server.config.id);
                void server.connection.close();
                reject(
                    new DOMException("Macro replay cancelled", "AbortError"),
                );
            };
            signal.addEventListener("abort", onAbort, { once: true });
            removeAbort = () => signal.removeEventListener("abort", onAbort);
        });
        try {
            return await Promise.race([
                server.connection.callTool(toolName, parameters),
                aborted,
            ]);
        } finally {
            removeAbort?.();
        }
    }
}
