// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { MacroOwnerConnection } from "../src/shared/macro-owner.js";
import type {
    RunMacroRequest,
    RunMacroResponse,
} from "@typeagent/copilot-macros";
import { MacroCatalogAdapter } from "../src/mcp/macroServer.js";

function connection(overrides: Partial<MacroOwnerConnection> = {}) {
    return {
        close: jest.fn(async () => {}),
        listMacros: jest.fn(async () => []),
        ...overrides,
    } as MacroOwnerConnection;
}

const operations: {
    name: string;
    allowInBypass: boolean;
    invoke: (adapter: MacroCatalogAdapter) => Promise<CallToolResult>;
}[] = [
    {
        name: "list",
        allowInBypass: true,
        invoke: (adapter) => adapter.listMacros({}),
    },
    {
        name: "search",
        allowInBypass: true,
        invoke: (adapter) => adapter.searchMacros({ query: "read" }),
    },
    {
        name: "inspect",
        allowInBypass: true,
        invoke: (adapter) => adapter.inspectMacro({ macroId: "macro-1" }),
    },
    {
        name: "requirements",
        allowInBypass: true,
        invoke: (adapter) =>
            adapter.getMacroRequirements({ macroId: "macro-1" }),
    },
    {
        name: "run",
        allowInBypass: true,
        invoke: (adapter) => adapter.runMacro({ macroId: "macro-1" }),
    },
    {
        name: "run status",
        allowInBypass: true,
        invoke: (adapter) => adapter.getMacroRun({ runId: "run-1" }),
    },
    {
        name: "validate",
        allowInBypass: false,
        invoke: (adapter) => adapter.validateMacro({ macroId: "macro-1" }),
    },
    {
        name: "approve",
        allowInBypass: false,
        invoke: (adapter) => adapter.approveMacro({ macroId: "macro-1" }),
    },
    {
        name: "disable",
        allowInBypass: false,
        invoke: (adapter) => adapter.disableMacro({ macroId: "macro-1" }),
    },
    {
        name: "delete",
        allowInBypass: false,
        invoke: (adapter) => adapter.deleteMacro({ macroId: "macro-1" }),
    },
];

describe("macro MCP catalog adapter", () => {
    it.each(operations)(
        "rejects $name in bypass without opt-in before connecting",
        async ({ invoke }) => {
            const connect = jest.fn(async () => connection());
            const adapter = new MacroCatalogAdapter({
                connect,
                getMode: () => "bypass",
            });
            expect((await invoke(adapter)).isError).toBe(true);
            expect(connect).not.toHaveBeenCalled();
        },
    );

    it.each(operations)(
        "limits opted-in bypass access for $name",
        async ({ invoke, allowInBypass }) => {
            const connect = jest.fn(async (): Promise<MacroOwnerConnection> => {
                throw new Error("Owner reached");
            });
            const adapter = new MacroCatalogAdapter({
                connect,
                getMode: () => "bypass",
                getBypassMacroToolsEnabled: () => true,
            });
            const response = await invoke(adapter);
            expect(response.isError).toBe(true);
            expect(connect).toHaveBeenCalledTimes(allowInBypass ? 1 : 0);
            expect(response.content[0]).toMatchObject({
                text: expect.stringContaining(
                    allowInBypass ? "Owner reached" : "management",
                ),
            });
        },
    );

    it.each(["direct", "mcp", "dev"] as const)(
        "preserves every macro operation in %s mode",
        async (mode) => {
            const connect = jest.fn(async (): Promise<MacroOwnerConnection> => {
                throw new Error("Owner reached");
            });
            const optIn = jest.fn(() => false);
            const adapter = new MacroCatalogAdapter({
                connect,
                getMode: () => mode,
                getBypassMacroToolsEnabled: optIn,
            });
            for (const { invoke } of operations) {
                const response = await invoke(adapter);
                expect(response.content[0]).toMatchObject({
                    text: "Owner reached",
                });
            }
            expect(connect).toHaveBeenCalledTimes(operations.length);
            expect(optIn).not.toHaveBeenCalled();
        },
    );

    it("fails closed when reading an invalid opt-in", async () => {
        const connect = jest.fn(async () => connection());
        const adapter = new MacroCatalogAdapter({
            connect,
            getMode: () => "bypass",
            getBypassMacroToolsEnabled: () => {
                throw new Error("Invalid opt-in");
            },
        });
        for (const invoke of [
            () => adapter.listMacros({}),
            () => adapter.runMacro({ macroId: "macro-1" }),
        ]) {
            expect((await invoke()).content[0]).toMatchObject({
                text: "Invalid opt-in",
            });
        }
        expect(connect).not.toHaveBeenCalled();
    });

    it("returns catalog data and closes its local owner connection", async () => {
        const client = connection({
            listMacros: jest.fn(async () => [
                {
                    macroId: "macro-1",
                    version: 1,
                    name: "Read package",
                    description: "Reads metadata",
                    state: "draft" as const,
                    executionClass: "replayable" as const,
                    stepCount: 1,
                    updatedAt: "2026-08-14T10:00:00.000Z",
                },
            ]),
        });
        const adapter = new MacroCatalogAdapter({
            connect: jest.fn(async () => client),
            getMode: () => "dev",
        });

        const response = await adapter.listMacros({});

        expect(response.isError).toBeUndefined();
        expect(response.content[0]).toMatchObject({
            type: "text",
            text: expect.stringContaining("Read package"),
        });
        expect(client.close).toHaveBeenCalledTimes(1);
    });

    it("rejects calls in bypass mode without connecting", async () => {
        const connect = jest.fn(async () => connection());
        const adapter = new MacroCatalogAdapter({
            connect,
            getMode: () => "bypass",
        });

        await expect(adapter.listMacros({})).resolves.toMatchObject({
            isError: true,
            content: [
                expect.objectContaining({
                    text: expect.stringContaining("bypass"),
                }),
            ],
        });
        expect(connect).not.toHaveBeenCalled();
    });

    it.each(["dev", "bypass"] as const)(
        "runs a macro with a preallocated run ID in %s",
        async (mode) => {
            const runMacro = jest.fn(async (request: RunMacroRequest) => ({
                status: "completed" as const,
                run: {
                    runId: request.runId,
                    macroId: request.macroId,
                    version: 2,
                    status: "completed" as const,
                    executionClass: "replayable" as const,
                    inputs: {},
                    steps: [],
                    startedAt: "2026-08-14T10:00:00.000Z",
                    completedAt: "2026-08-14T10:00:01.000Z",
                },
            }));
            const client = connection({ runMacro });
            const adapter = new MacroCatalogAdapter({
                connect: jest.fn(async () => client),
                getMode: () => mode,
                getBypassMacroToolsEnabled: () => true,
            });

            const response = await adapter.runMacro({
                macroId: "macro-1",
                version: 2,
                inputs: { name: "alpha" },
                timeoutMs: 5000,
            });

            expect(response.isError).toBeUndefined();
            expect(runMacro).toHaveBeenCalledWith(
                expect.objectContaining({
                    runId: expect.any(String),
                    macroId: "macro-1",
                    version: 2,
                    inputs: { name: "alpha" },
                    timeoutMs: 5000,
                }),
            );
            expect(client.close).toHaveBeenCalledTimes(1);
        },
    );

    it("returns a sanitized macro run record", async () => {
        const getMacroRun = jest.fn(async (runId: string) => ({
            runId,
            macroId: "macro-1",
            version: 2,
            status: "completed" as const,
            executionClass: "replayable" as const,
            inputs: {},
            steps: [],
            startedAt: "2026-08-14T10:00:00.000Z",
            completedAt: "2026-08-14T10:00:01.000Z",
        }));
        const client = connection({ getMacroRun });
        const adapter = new MacroCatalogAdapter({
            connect: jest.fn(async () => client),
            getMode: () => "dev",
        });

        const response = await adapter.getMacroRun({ runId: "run-1" });

        expect(response.isError).toBeUndefined();
        expect(getMacroRun).toHaveBeenCalledWith("run-1");
        expect(response.content[0]).toMatchObject({
            type: "text",
            text: expect.stringContaining("run-1"),
        });
        expect(client.close).toHaveBeenCalledTimes(1);
    });

    it.each(["dev", "bypass"] as const)(
        "cancels the preallocated run when the %s MCP call is aborted",
        async (mode) => {
            let resolveRun: ((response: RunMacroResponse) => void) | undefined;
            let notifyStarted: (() => void) | undefined;
            const started = new Promise<void>((resolve) => {
                notifyStarted = resolve;
            });
            const runMacro = jest.fn(
                async (request: RunMacroRequest): Promise<RunMacroResponse> => {
                    notifyStarted?.();
                    return new Promise((resolve) => {
                        resolveRun = resolve;
                    });
                },
            );
            const cancelMacroRun = jest.fn(async (runId: string) => {
                resolveRun?.({
                    status: "cancelled",
                    run: {
                        runId,
                        macroId: "macro-1",
                        version: 2,
                        status: "cancelled",
                        executionClass: "replayable",
                        inputs: {},
                        steps: [],
                        startedAt: "2026-08-14T10:00:00.000Z",
                        completedAt: "2026-08-14T10:00:01.000Z",
                        error: { code: "cancelled", message: "Cancelled" },
                    },
                });
            });
            const client = connection({ runMacro, cancelMacroRun });
            const adapter = new MacroCatalogAdapter({
                connect: jest.fn(async () => client),
                getMode: () => mode,
                getBypassMacroToolsEnabled: () => true,
            });
            const controller = new AbortController();

            const response = adapter.runMacro(
                { macroId: "macro-1" },
                controller.signal,
            );
            await started;
            controller.abort();

            expect((await response).isError).toBeUndefined();
            const requestedRunId = runMacro.mock.calls[0][0].runId;
            expect(cancelMacroRun).toHaveBeenCalledWith(requestedRunId);
            expect(client.close).toHaveBeenCalledTimes(1);
        },
    );

    it.each(["before connection", "during connection"])(
        "does not dispatch an already aborted run %s",
        async (when) => {
            const controller = new AbortController();
            const runMacro = jest.fn<MacroOwnerConnection["runMacro"]>();
            const client = connection({ runMacro });
            const connect = jest.fn(async () => {
                controller.abort();
                return client;
            });
            if (when === "before connection") controller.abort();
            const adapter = new MacroCatalogAdapter({
                connect,
                getMode: () => "bypass",
                getBypassMacroToolsEnabled: () => true,
            });
            const response = await adapter.runMacro(
                { macroId: "macro-1" },
                controller.signal,
            );
            expect(response.isError).toBe(true);
            expect(connect).toHaveBeenCalledTimes(
                when === "before connection" ? 0 : 1,
            );
            expect(client.close).toHaveBeenCalledTimes(
                when === "before connection" ? 0 : 1,
            );
            expect(runMacro).not.toHaveBeenCalled();
        },
    );

    it("returns backend rejection once without a retry or fallback", async () => {
        const runMacro = jest.fn(async (): Promise<RunMacroResponse> => {
            throw new Error("Backend denied this macro");
        });
        const client = connection({ runMacro });
        const connect = jest.fn(async () => client);
        const adapter = new MacroCatalogAdapter({
            connect,
            getMode: () => "bypass",
            getBypassMacroToolsEnabled: () => true,
        });
        const response = await adapter.runMacro({ macroId: "macro-1" });
        expect(response).toMatchObject({
            isError: true,
            content: [{ type: "text", text: "Backend denied this macro" }],
        });
        expect(connect).toHaveBeenCalledTimes(1);
        expect(runMacro).toHaveBeenCalledTimes(1);
        expect(client.close).toHaveBeenCalledTimes(1);
    });
});
