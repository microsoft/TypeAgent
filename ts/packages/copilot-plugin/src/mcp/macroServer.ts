// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AgentServerConnection } from "@typeagent/agent-server-client";
import { connectToAgentServer } from "../shared/typeagent-client.js";
import { getMode, type Mode } from "../shared/plugin-config.js";

export interface MacroServerDependencies {
    connect: () => Promise<AgentServerConnection>;
    getMode: () => Mode;
}

const defaultDependencies: MacroServerDependencies = {
    connect: connectToAgentServer,
    getMode,
};

function result(value: unknown): CallToolResult {
    return {
        content: [
            {
                type: "text",
                text:
                    typeof value === "string"
                        ? value
                        : JSON.stringify(value, undefined, 2),
            },
        ],
    };
}

function errorResult(error: unknown): CallToolResult {
    return {
        isError: true,
        content: [
            {
                type: "text",
                text: error instanceof Error ? error.message : String(error),
            },
        ],
    };
}

export class MacroCatalogAdapter {
    constructor(
        private readonly dependencies: MacroServerDependencies = defaultDependencies,
    ) {}

    listMacros(request: {
        state?: "draft" | "approved" | "disabled" | undefined;
        limit?: number | undefined;
    }) {
        return this.call((connection) =>
            connection.listMacros({
                ...(request.state ? { state: request.state } : {}),
                ...(request.limit !== undefined
                    ? { limit: request.limit }
                    : {}),
            }),
        );
    }

    searchMacros(request: { query: string; limit?: number | undefined }) {
        return this.call((connection) =>
            connection.searchMacros({
                query: request.query,
                ...(request.limit !== undefined
                    ? { limit: request.limit }
                    : {}),
            }),
        );
    }

    inspectMacro(request: { macroId: string; version?: number | undefined }) {
        return this.call((connection) =>
            connection.inspectMacro(this.macroRef(request)),
        );
    }

    getMacroRequirements(request: {
        macroId: string;
        version?: number | undefined;
    }) {
        return this.call((connection) =>
            connection.getMacroRequirements(this.macroRef(request)),
        );
    }

    createMacroFromTrace(request: {
        traceId: string;
        name: string;
        description?: string | undefined;
    }) {
        return this.call((connection) =>
            connection.createMacroFromTrace({
                traceId: request.traceId,
                name: request.name,
                ...(request.description !== undefined
                    ? { description: request.description }
                    : {}),
            }),
        );
    }

    validateMacro(request: { macroId: string; version?: number | undefined }) {
        return this.call((connection) =>
            connection.validateMacro(this.macroRef(request)),
        );
    }

    approveMacro(request: { macroId: string; version?: number | undefined }) {
        return this.call((connection) =>
            connection.approveMacro(this.macroRef(request)),
        );
    }

    disableMacro(request: { macroId: string }) {
        return this.call((connection) => connection.disableMacro(request));
    }

    deleteMacro(request: { macroId: string }) {
        return this.call(async (connection) => {
            await connection.deleteMacro(request);
            return { deleted: true, macroId: request.macroId };
        });
    }

    getMacroRun(request: { runId: string }) {
        return this.call((connection) => connection.getMacroRun(request.runId));
    }

    async runMacro(
        request: {
            macroId: string;
            version?: number | undefined;
            inputs?: Record<string, unknown> | undefined;
            preference?: "replay" | "agent" | "auto" | undefined;
            timeoutMs?: number | undefined;
            dryRun?: boolean | undefined;
        },
        signal?: AbortSignal,
    ): Promise<CallToolResult> {
        if (this.dependencies.getMode() === "bypass") {
            return errorResult(
                "TypeAgent macro tools are disabled in bypass mode.",
            );
        }
        const runId = randomUUID();
        let connection: AgentServerConnection | undefined;
        let removeAbort: (() => void) | undefined;
        try {
            connection = await this.dependencies.connect();
            const activeConnection = connection;
            if (signal) {
                const cancel = () => {
                    void activeConnection.cancelMacroRun(runId);
                };
                signal.addEventListener("abort", cancel, { once: true });
                removeAbort = () => signal.removeEventListener("abort", cancel);
            }
            return result(
                await connection.runMacro({
                    runId,
                    macroId: request.macroId,
                    ...(request.version !== undefined
                        ? { version: request.version }
                        : {}),
                    ...(request.inputs !== undefined
                        ? { inputs: request.inputs }
                        : {}),
                    ...(request.preference !== undefined
                        ? { preference: request.preference }
                        : {}),
                    ...(request.timeoutMs !== undefined
                        ? { timeoutMs: request.timeoutMs }
                        : {}),
                    ...(request.dryRun !== undefined
                        ? { dryRun: request.dryRun }
                        : {}),
                }),
            );
        } catch (error) {
            return errorResult(error);
        } finally {
            removeAbort?.();
            await connection?.close();
        }
    }

    private macroRef(request: {
        macroId: string;
        version?: number | undefined;
    }) {
        return {
            macroId: request.macroId,
            ...(request.version !== undefined
                ? { version: request.version }
                : {}),
        };
    }

    private async call(
        operation: (connection: AgentServerConnection) => Promise<unknown>,
    ): Promise<CallToolResult> {
        if (this.dependencies.getMode() === "bypass") {
            return errorResult(
                "TypeAgent macro tools are disabled in bypass mode.",
            );
        }
        let connection: AgentServerConnection | undefined;
        try {
            connection = await this.dependencies.connect();
            return result(await operation(connection));
        } catch (error) {
            return errorResult(error);
        } finally {
            await connection?.close();
        }
    }
}

const macroRefSchema = {
    macroId: z.string().min(1),
    version: z.number().int().positive().optional(),
};

export class TypeAgentMacroMcpServer {
    private readonly server = new McpServer({
        name: "typeagent-macros",
        version: "0.1.0",
    });

    constructor(adapter = new MacroCatalogAdapter()) {
        this.server.tool(
            "list_macros",
            "List macro catalog entries. This does not execute macros.",
            {
                state: z.enum(["draft", "approved", "disabled"]).optional(),
                limit: z.number().int().positive().max(500).optional(),
            },
            (request) => adapter.listMacros(request),
        );
        this.server.tool(
            "search_macros",
            "Search macros by name and description.",
            {
                query: z.string().min(1),
                limit: z.number().int().positive().max(100).optional(),
            },
            (request) => adapter.searchMacros(request),
        );
        this.server.tool(
            "inspect_macro",
            "Inspect one immutable macro version.",
            macroRefSchema,
            (request) => adapter.inspectMacro(request),
        );
        this.server.tool(
            "get_macro_requirements",
            "Get a macro's required inputs, tools, and execution class.",
            macroRefSchema,
            (request) => adapter.getMacroRequirements(request),
        );
        this.server.tool(
            "create_macro_from_trace",
            "Create a non-executable draft macro from an explicit trace.",
            {
                traceId: z.string().min(1),
                name: z.string().min(1),
                description: z.string().optional(),
            },
            (request) => adapter.createMacroFromTrace(request),
        );
        this.server.tool(
            "validate_macro",
            "Validate a draft macro and return errors, warnings, and execution class.",
            macroRefSchema,
            (request) => adapter.validateMacro(request),
        );
        this.server.tool(
            "approve_macro",
            "Create an approved immutable version after successful validation.",
            macroRefSchema,
            (request) => adapter.approveMacro(request),
        );
        this.server.tool(
            "disable_macro",
            "Disable an approved macro without deleting its version history.",
            { macroId: z.string().min(1) },
            (request) => adapter.disableMacro(request),
        );
        this.server.tool(
            "delete_macro",
            "Delete a macro and its version history.",
            { macroId: z.string().min(1) },
            (request) => adapter.deleteMacro(request),
        );
        this.server.tool(
            "run_macro",
            "Run an approved macro by replaying its captured MCP tool calls.",
            {
                macroId: z.string().min(1),
                version: z.number().int().positive().optional(),
                inputs: z.record(z.unknown()).optional(),
                preference: z.enum(["replay", "agent", "auto"]).optional(),
                timeoutMs: z.number().int().positive().max(600_000).optional(),
                dryRun: z.boolean().optional(),
            },
            (request, extra) => adapter.runMacro(request, extra.signal),
        );
        this.server.tool(
            "get_macro_run",
            "Inspect a sanitized macro run record.",
            { runId: z.string().min(1) },
            (request) => adapter.getMacroRun(request),
        );
    }

    async start(): Promise<void> {
        await this.server.connect(new StdioServerTransport());
    }
}
