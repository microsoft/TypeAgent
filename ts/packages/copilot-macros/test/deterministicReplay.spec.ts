// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    replayMacro,
    type CopilotToolMacro,
    type ReplayToolHost,
} from "@typeagent/copilot-macros";

function macro(): CopilotToolMacro {
    return {
        schemaVersion: 1,
        macroId: "macro-1",
        version: 2,
        name: "Read then inspect",
        description: "",
        state: "approved",
        executionClass: "replayable",
        inputs: [],
        steps: [
            {
                id: "step-1",
                toolName: "read",
                mcpServerName: "typeagent-workspace",
                arguments: { kind: "input", name: "path" },
                executionClass: "replayable",
                sourceToolCallId: "call-1",
            },
            {
                id: "step-2",
                toolName: "grep",
                mcpServerName: "typeagent-workspace",
                arguments: {
                    kind: "stepResult",
                    stepId: "step-1",
                    path: ["query"],
                },
                executionClass: "replayable",
                sourceToolCallId: "call-2",
            },
        ],
        sourceTraceId: "trace-1",
        createdAt: "2026-08-14T10:00:00.000Z",
        warnings: [],
    };
}

function host(overrides: Partial<ReplayToolHost> = {}) {
    const calls: Array<{ toolName: string; argumentsValue: unknown }> = [];
    const value: ReplayToolHost = {
        inspectTool: async (mcpServerName, toolName) => ({
            ...(mcpServerName ? { mcpServerName } : {}),
            toolName,
            schemaFingerprint: `${mcpServerName}/${toolName}/v1`,
        }),
        callTool: async (_server, toolName, argumentsValue) => {
            calls.push({ toolName, argumentsValue });
            return toolName === "read" ? { query: "needle" } : { matches: 1 };
        },
        ...overrides,
    };
    return { calls, value };
}

describe("deterministic macro replay", () => {
    it("executes ordered read-only steps with input and result bindings", async () => {
        const replayHost = host();
        const run = await replayMacro(
            macro(),
            "run-1",
            { path: "package.json" },
            replayHost.value,
            new AbortController().signal,
        );

        expect(run.status).toBe("completed");
        expect(run.result).toEqual({ matches: 1 });
        expect(replayHost.calls).toEqual([
            { toolName: "read", argumentsValue: "package.json" },
            { toolName: "grep", argumentsValue: "needle" },
        ]);
    });

    it("preflights every tool before executing step one", async () => {
        const replayHost = host({
            inspectTool: async (_server, toolName) =>
                toolName === "grep"
                    ? undefined
                    : {
                          toolName,
                          schemaFingerprint: "v1",
                      },
        });

        await expect(
            replayMacro(
                macro(),
                "run-1",
                { path: "package.json" },
                replayHost.value,
                new AbortController().signal,
            ),
        ).rejects.toMatchObject({ code: "toolUnavailable" });
        expect(replayHost.calls).toEqual([]);
    });

    it("rejects missing inputs before executing step one", async () => {
        const replayHost = host();

        await expect(
            replayMacro(
                macro(),
                "run-1",
                {},
                replayHost.value,
                new AbortController().signal,
            ),
        ).rejects.toMatchObject({ code: "missingInput" });
        expect(replayHost.calls).toEqual([]);
    });

    it("records cancellation without starting later steps", async () => {
        const controller = new AbortController();
        const replayHost = host({
            callTool: async () => {
                controller.abort();
                throw new DOMException("Cancelled", "AbortError");
            },
        });

        const run = await replayMacro(
            macro(),
            "run-1",
            { path: "package.json" },
            replayHost.value,
            controller.signal,
        );

        expect(run).toMatchObject({
            status: "cancelled",
            steps: [{ stepId: "step-1", status: "cancelled" }],
            error: { code: "cancelled" },
        });
    });
});
