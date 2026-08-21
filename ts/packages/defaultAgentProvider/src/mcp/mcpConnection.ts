// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Client,
    StreamableHTTPClientTransport,
    UnauthorizedError,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import type { StdioServerParameters } from "@modelcontextprotocol/client/stdio";
import type {
    CallToolResult,
    ClientOptions,
    ProtocolEra,
    StreamableHTTPClientTransportOptions,
    Tool,
    OAuthClientProvider,
} from "@modelcontextprotocol/client";
import type { McpOAuthProvider } from "./mcpOAuth.js";
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
    | {
          kind: "http";
          url: string;
          headers?: Record<string, string>;
          timeoutMs?: number;
          authProvider?: OAuthClientProvider;
      };

type McpTransport = StdioClientTransport | StreamableHTTPClientTransport;

export interface McpConnectionOptions {
    toolsChanged?: (error: Error | null, tools: Tool[] | null) => void;
    listChangedDebounceMs?: number;
}

function createTimeoutFetch(timeoutMs: number): typeof fetch {
    return (input, init) => {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const signal =
            init?.signal == null
                ? timeoutSignal
                : AbortSignal.any([init.signal, timeoutSignal]);
        return globalThis.fetch(input, { ...init, signal });
    };
}

/** @internal Exported for focused transport configuration tests. */
export function getHttpTransportOptions(
    config: Extract<McpTransportConfig, { kind: "http" }>,
): StreamableHTTPClientTransportOptions | undefined {
    const options: StreamableHTTPClientTransportOptions = {
        ...(config.headers === undefined
            ? {}
            : { requestInit: { headers: config.headers } }),
        ...(config.authProvider === undefined
            ? {}
            : { authProvider: config.authProvider }),
        ...(config.timeoutMs === undefined
            ? {}
            : { fetch: createTimeoutFetch(config.timeoutMs) }),
    };
    return Object.keys(options).length === 0 ? undefined : options;
}

function createTransport(config: McpTransportConfig): McpTransport {
    if (config.kind === "http") {
        return new StreamableHTTPClientTransport(
            new URL(config.url),
            getHttpTransportOptions(config),
        );
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
        private readonly timeoutMs: number | undefined,
    ) {}

    static async create(
        clientInfo: { name: string; version: string },
        config: McpTransportConfig,
        options: McpConnectionOptions = {},
    ): Promise<McpConnection> {
        const transport = createTransport(config);
        const clientOptions: ClientOptions = {
            versionNegotiation: { mode: "auto" },
            capabilities: {},
        };
        if (options.toolsChanged !== undefined) {
            clientOptions.listChanged = {
                tools: {
                    autoRefresh: true,
                    ...(options.listChangedDebounceMs === undefined
                        ? {}
                        : { debounceMs: options.listChangedDebounceMs }),
                    onChanged: options.toolsChanged,
                },
            };
        }
        const client = new Client(clientInfo, clientOptions);
        const connect = () =>
            client.connect(
                transport,
                config.kind === "http" && config.timeoutMs !== undefined
                    ? { timeout: config.timeoutMs }
                    : undefined,
            );
        try {
            try {
                await connect();
            } catch (error) {
                if (
                    config.kind !== "http" ||
                    !(error instanceof UnauthorizedError) ||
                    config.authProvider === undefined ||
                    !(await (
                        config.authProvider as McpOAuthProvider
                    ).finishAuth?.(transport as StreamableHTTPClientTransport))
                ) {
                    throw error;
                }
                await connect();
            }
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
        return new McpConnection(
            client,
            transport,
            config.kind === "http" ? config.timeoutMs : undefined,
        );
    }

    // The negotiated era ('legacy' | 'modern') and wire protocol version, for
    // diagnostics. Undefined until the connection handshake completes.
    get protocolEra(): ProtocolEra | undefined {
        return this.client.getProtocolEra();
    }

    get protocolVersion(): string | undefined {
        return this.client.getNegotiatedProtocolVersion();
    }

    get supportsToolListChanged(): boolean {
        return this.client.getServerCapabilities()?.tools?.listChanged === true;
    }

    // True for HTTP transports, false for stdio. Callers that need to reason
    // about process lifecycle (e.g. whether a child process must be killed)
    // use this instead of an `instanceof` check against the transport.
    get isHttp(): boolean {
        return this.transport instanceof StreamableHTTPClientTransport;
    }

    async listTools(): Promise<Tool[]> {
        return (
            await this.client.listTools(
                undefined,
                this.timeoutMs === undefined
                    ? undefined
                    : { timeout: this.timeoutMs },
            )
        ).tools;
    }

    async callTool(
        name: string,
        args: Record<string, unknown> | undefined,
    ): Promise<CallToolResult> {
        return this.client.callTool(
            { name, arguments: args },
            this.timeoutMs === undefined
                ? undefined
                : { timeout: this.timeoutMs },
        );
    }

    async close(): Promise<void> {
        if (this.transport instanceof StreamableHTTPClientTransport) {
            await this.client.close();
            return;
        }
        // The stdio transport resolves `close()` synchronously but only fires
        // `onclose` once the child process has actually exited; wait for that so
        // callers can rely on the process being gone when close() resolves.
        await new Promise<void>((resolve) => {
            this.transport.onclose = resolve;
            void this.client.close();
        });
    }
}
