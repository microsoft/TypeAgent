// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Client,
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import type { StdioServerParameters } from "@modelcontextprotocol/client/stdio";
import type {
    CallToolResult,
    ProtocolEra,
    Tool,
} from "@modelcontextprotocol/client";
import registerDebug from "debug";

const debug = registerDebug("typeagent:mcp:connection");

// How to reach an MCP server. The provider resolves the higher-level agent
// config (script paths, argument definitions, instance overrides) down to one
// of these before handing it to the connection.
export type McpTransportConfig =
    | {
          kind: "stdio";
          command: string;
          args: string[];
          env?: Record<string, string>;
          cwd?: string;
      }
    | { kind: "http"; url: string };

type McpTransport = StdioClientTransport | StreamableHTTPClientTransport;

function createTransport(config: McpTransportConfig): McpTransport {
    if (config.kind === "http") {
        return new StreamableHTTPClientTransport(new URL(config.url));
    }
    const params: StdioServerParameters = {
        command: config.command,
        args: config.args,
        stderr: "pipe",
    };
    if (config.env !== undefined) {
        // Merge over the SDK's default-inherited env subset so a caller-supplied
        // env augments rather than replaces the safe defaults.
        params.env = { ...getDefaultEnvironment(), ...config.env };
    }
    if (config.cwd !== undefined) {
        params.cwd = config.cwd;
    }
    return new StdioClientTransport(params);
}

// Owns a single MCP server connection: the v2 client, its transport, and their
// shared lifecycle. Connecting with `versionNegotiation: { mode: "auto" }` lets
// one client talk to both legacy (pre-negotiation) and modern servers; the
// v2 default is `legacy`, so the mode must be set explicitly here.
export class McpConnection {
    private constructor(
        private readonly client: Client,
        private readonly transport: McpTransport,
    ) {}

    static async create(
        clientInfo: { name: string; version: string },
        config: McpTransportConfig,
    ): Promise<McpConnection> {
        const transport = createTransport(config);
        const client = new Client(clientInfo, {
            versionNegotiation: { mode: "auto" },
            capabilities: {},
        });
        try {
            await client.connect(transport);
        } catch (e) {
            // connect() may leave the transport partially open; make sure the
            // child process / socket is torn down before the error propagates.
            try {
                await transport.close();
            } catch {}
            throw e;
        }
        debug(
            `connected: era=${client.getProtocolEra()} version=${client.getNegotiatedProtocolVersion()}`,
        );
        return new McpConnection(client, transport);
    }

    // The negotiated era ('legacy' | 'modern') and wire protocol version, for
    // diagnostics. Undefined until the connection handshake completes.
    get protocolEra(): ProtocolEra | undefined {
        return this.client.getProtocolEra();
    }

    get protocolVersion(): string | undefined {
        return this.client.getNegotiatedProtocolVersion();
    }

    // True for HTTP transports, false for stdio. Callers that need to reason
    // about process lifecycle (e.g. whether a child process must be killed)
    // use this instead of an `instanceof` check against the transport.
    get isHttp(): boolean {
        return this.transport instanceof StreamableHTTPClientTransport;
    }

    async listTools(): Promise<Tool[]> {
        return (await this.client.listTools()).tools;
    }

    async callTool(
        name: string,
        args: Record<string, unknown> | undefined,
    ): Promise<CallToolResult> {
        return this.client.callTool({ name, arguments: args });
    }

    async close(): Promise<void> {
        if (this.transport instanceof StreamableHTTPClientTransport) {
            await this.transport.close();
            return;
        }
        // The stdio transport resolves `close()` synchronously but only fires
        // `onclose` once the child process has actually exited; wait for that so
        // callers can rely on the process being gone when close() resolves.
        await new Promise<void>((resolve) => {
            this.transport.onclose = resolve;
            void this.transport.close();
        });
    }
}
