import { jest } from "@jest/globals";
import type { AgentServerConnection } from "@typeagent/agent-server-client";
import type {
    RunMacroRequest,
    RunMacroResponse,
} from "@typeagent/copilot-macros";
import { MacroCatalogAdapter } from "../src/mcp/macroServer.js";

function connection(overrides: Partial<AgentServerConnection> = {}) {
    return {
        close: jest.fn(async () => {}),
        listMacros: jest.fn(async () => []),
        ...overrides,
    } as unknown as AgentServerConnection;
}

describe("macro MCP catalog adapter", () => {
    it("returns catalog data and closes its agent-server connection", async () => {
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

    it("runs a macro with a preallocated run ID", async () => {
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
            getMode: () => "dev",
        });

        const response = await adapter.runMacro({ macroId: "macro-1" });

        expect(response.isError).toBeUndefined();
        expect(runMacro).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: expect.any(String),
                macroId: "macro-1",
            }),
        );
        expect(client.close).toHaveBeenCalledTimes(1);
    });

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

    it("cancels the preallocated run when the MCP call is aborted", async () => {
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
            getMode: () => "dev",
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
    });
});
