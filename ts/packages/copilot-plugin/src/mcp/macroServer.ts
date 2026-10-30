// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
    getBypassMacroToolsEnabled,
    getMode,
    type Mode,
} from "../shared/plugin-config.js";
import {
    connectToMacroOwner,
    type MacroOwnerConnection,
} from "../shared/macro-owner.js";

export interface MacroServerDependencies {
    connect: () => Promise<MacroOwnerConnection>;
    getMode: () => Mode;
    getBypassMacroToolsEnabled?: () => boolean;
}

const defaultDependencies: MacroServerDependencies = {
    connect: connectToMacroOwner,
    getMode,
    getBypassMacroToolsEnabled,
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
        return this.call(
            (connection) =>
                connection.listMacros({
                    ...(request.state ? { state: request.state } : {}),
                    ...(request.limit !== undefined
                        ? { limit: request.limit }
                        : {}),
                }),
            true,
        );
    }

    searchMacros(request: { query: string; limit?: number | undefined }) {
        return this.call(
            (connection) =>
                connection.searchMacros({
                    query: request.query,
                    ...(request.limit !== undefined
                        ? { limit: request.limit }
                        : {}),
                }),
            true,
        );
    }

    inspectMacro(request: { macroId: string; version?: number | undefined }) {
        return this.call(
            (connection) => connection.inspectMacro(this.macroRef(request)),
            true,
        );
    }

    getMacroRequirements(request: {
        macroId: string;
        version?: number | undefined;
    }) {
        return this.call(
            (connection) =>
                connection.getMacroRequirements(this.macroRef(request)),
            true,
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

    reviseMacro(request: {
        macroId: string;
        version: number;
        feedback: string;
    }) {
        return this.call((connection) => connection.reviseMacro(request));
    }

    getMacroLearningJob(request: { jobId: string }) {
        return this.call((connection) =>
            connection.getMacroLearningJob(request.jobId),
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
        return this.call(
            (connection) => connection.getMacroRun(request.runId),
            true,
        );
    }

    async runMacro(
        request: {
            macroId: string;
            version?: number | undefined;
            inputs?: Record<string, unknown> | undefined;
            timeoutMs?: number | undefined;
            dryRun?: boolean | undefined;
        },
        signal?: AbortSignal,
    ): Promise<CallToolResult> {
        let connection: MacroOwnerConnection | undefined;
        let removeAbort: (() => void) | undefined;
        try {
            this.assertAccess(true);
            signal?.throwIfAborted();
            const runId = randomUUID();
            connection = await this.dependencies.connect();
            signal?.throwIfAborted();
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
        operation: (connection: MacroOwnerConnection) => Promise<unknown>,
        allowInBypass = false,
    ): Promise<CallToolResult> {
        let connection: MacroOwnerConnection | undefined;
        try {
            this.assertAccess(allowInBypass);
            connection = await this.dependencies.connect();
            return result(await operation(connection));
        } catch (error) {
            return errorResult(error);
        } finally {
            await connection?.close();
        }
    }

    private assertAccess(allowInBypass: boolean): void {
        if (this.dependencies.getMode() !== "bypass") return;
        if (
            allowInBypass &&
            this.dependencies.getBypassMacroToolsEnabled?.() === true
        )
            return;
        throw new Error(
            allowInBypass
                ? "TypeAgent macro tools are disabled in bypass mode. Opt in with bypassMacroTools or TYPEAGENT_BYPASS_MACRO_TOOLS."
                : "TypeAgent macro management tools are disabled in bypass mode.",
        );
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
            "Inspect one immutable macro version for catalog or draft review. Running a macro does not require this tool.",
            macroRefSchema,
            {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            (request) => adapter.inspectMacro(request),
        );
        this.server.tool(
            "get_macro_requirements",
            "Get a macro's required inputs, tools, and execution class.",
            macroRefSchema,
            (request) => adapter.getMacroRequirements(request),
        );
        this.server.tool(
            "validate_macro",
            "Validate a draft macro and return errors, warnings, and execution class.",
            macroRefSchema,
            (request) => adapter.validateMacro(request),
        );
        this.server.tool(
            "revise_macro",
            "Request changes to the current review draft using plain-language feedback. Returns a learning job, not a published macro. Regenerates and checks a new immutable draft; explicit approval is still required. Does not execute task tools.",
            {
                macroId: z.string().min(1),
                version: z.number().int().positive(),
                feedback: z.string().trim().min(1).max(16_384),
            },
            (request) => adapter.reviseMacro(request),
        );
        this.server.tool(
            "get_macro_learning_job",
            "Check a macro learning or revision job. Wait for needsReview, then inspect and approve the returned draft version. Failed, cancelled and awaitingAuthor jobs are not ready to publish.",
            { jobId: z.string().min(1) },
            {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            (request) => adapter.getMacroLearningJob(request),
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
            "Run the current approved program macro and return its actual output. No planning agent or legacy step execution is used.",
            {
                macroId: z.string().min(1),
                version: z.number().int().positive().optional(),
                inputs: z.record(z.unknown()).optional(),
                timeoutMs: z.number().int().positive().max(60_000).optional(),
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
