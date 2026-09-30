// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    MacroManager,
    type RecordedToolCall,
    type ReplayToolHost,
} from "@typeagent/copilot-macros";

async function captureTrace(
    manager: MacroManager,
    options: {
        sessionId?: string;
        toolName?: string;
        mcpServerName?: string;
        status?: "completed" | "failed" | "denied";
        prompt?: string;
        additionalCalls?: RecordedToolCall[];
    } = {},
): Promise<string> {
    const sessionId = options.sessionId ?? "session-1";
    const prompt = options.prompt ?? "Read package";
    manager.armRecording({ sessionId });
    const claimed = manager.claimRecording({
        sessionId,
        cwd: ".",
        promptHash: createHash("sha256").update(prompt).digest("hex"),
    });
    const summary = await manager.finalizeRecording({
        tokenId: claimed!.id,
        trace: {
            schemaVersion: 1,
            sessionId,
            cwd: ".",
            prompt,
            response: "Done",
            startedAt: "2026-08-14T10:00:00.000Z",
            completedAt: "2026-08-14T10:00:01.000Z",
            toolCalls: [
                {
                    toolCallId: "call-1",
                    name: options.toolName ?? "read",
                    ...(options.mcpServerName === undefined
                        ? { mcpServerName: "typeagent-workspace" }
                        : options.mcpServerName
                          ? { mcpServerName: options.mcpServerName }
                          : {}),
                    arguments: { path: "package.json" },
                    result: { content: "{}" },
                    status: options.status ?? "completed",
                },
                ...(options.additionalCalls ?? []),
            ],
        },
    });
    return summary.traceId;
}

describe("MacroManager draft catalog", () => {
    it("replays a captured workflow with a different prompt-derived input", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "catalog-"));
        const calls: unknown[] = [];
        const manager = new MacroManager(instanceDir, {
            inspectTool: async (mcpServerName, toolName) => ({
                ...(mcpServerName ? { mcpServerName } : {}),
                toolName,
                schemaFingerprint: "v1",
            }),
            callTool: async (_server, _tool, argumentsValue) => {
                calls.push(argumentsValue);
                return { content: "{}" };
            },
        });
        const traceId = await captureTrace(manager, {
            prompt: "Read package.json",
        });
        const draft = await manager.createMacroFromTrace({
            traceId,
            name: "Read package",
        });
        const definition = await manager.inspectMacro(draft);
        const approved = await manager.approveMacro(draft);

        await expect(
            manager.runMacro({
                runId: "run-reused-input",
                macroId: approved.macroId,
                inputs: { step_1_path: "src/package.json" },
            }),
        ).resolves.toMatchObject({ status: "completed" });
        expect(definition.inputs).toEqual([
            expect.objectContaining({
                name: "step_1_path",
                valueType: "string",
            }),
        ]);
        expect(calls).toEqual([{ path: "src/package.json" }]);
    });

    it("persists and approves immutable macro versions across restart", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "catalog-"));
        const manager = new MacroManager(instanceDir);
        const traceId = await captureTrace(manager);
        const draft = await manager.createMacroFromTrace({
            traceId,
            name: "Read package",
            description: "Reads package metadata",
        });

        await expect(manager.validateMacro(draft)).resolves.toMatchObject({
            valid: true,
            executionClass: "agentRequired",
        });
        const approved = await manager.approveMacro(draft);
        expect(approved).toMatchObject({ version: 2, state: "approved" });

        const restarted = new MacroManager(instanceDir);
        await expect(
            restarted.inspectMacro({ macroId: draft.macroId }),
        ).resolves.toMatchObject({
            version: 2,
            state: "approved",
            executionClass: "agentRequired",
        });
        await expect(
            restarted.inspectMacro({ macroId: draft.macroId, version: 1 }),
        ).resolves.toMatchObject({ version: 1, state: "draft" });
        expect(
            await readFile(
                path.join(
                    instanceDir,
                    "copilot-macros",
                    "macros",
                    draft.macroId,
                    "versions",
                    "1.json",
                ),
                "utf8",
            ),
        ).toContain('"state": "draft"');
    });

    it("lists, searches, disables, and deletes catalog entries", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "catalog-"));
        const manager = new MacroManager(instanceDir);
        const traceId = await captureTrace(manager);
        const draft = await manager.createMacroFromTrace({
            traceId,
            name: "Read package",
            description: "Reads package metadata",
        });
        await manager.approveMacro(draft);

        await expect(manager.listMacros()).resolves.toHaveLength(1);
        await expect(
            manager.searchMacros({ query: "package metadata" }),
        ).resolves.toMatchObject([{ score: 0.75 }]);
        await expect(
            manager.getMacroRequirements({ macroId: draft.macroId }),
        ).resolves.toMatchObject({
            executionClass: "agentRequired",
            tools: [{ toolName: "read" }],
        });
        await expect(
            manager.disableMacro({ macroId: draft.macroId }),
        ).resolves.toMatchObject({ version: 3, state: "disabled" });
        await manager.deleteMacro({ macroId: draft.macroId });
        await expect(manager.listMacros()).resolves.toEqual([]);
    });

    it("rejects concurrent duplicate approvals", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "catalog-"));
        const manager = new MacroManager(instanceDir);
        const traceId = await captureTrace(manager);
        const draft = await manager.createMacroFromTrace({
            traceId,
            name: "Read package",
        });

        const results = await Promise.allSettled([
            manager.approveMacro(draft),
            manager.approveMacro(draft),
        ]);
        expect(
            results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
            results.filter((result) => result.status === "rejected"),
        ).toHaveLength(1);
    });

    it.each([false, true])(
        "hands Copilot-only MCP tools to the agent without replaying a prefix (mixed: %s)",
        async (mixed) => {
            const instanceDir = await mkdtemp(
                path.join(os.tmpdir(), "catalog-"),
            );
            let calls = 0;
            const manager = new MacroManager(instanceDir, {
                inspectTool: async (mcpServerName, toolName) =>
                    mcpServerName === "typeagent-workspace"
                        ? {
                              mcpServerName,
                              toolName,
                              schemaFingerprint: "v1",
                          }
                        : undefined,
                callTool: async () => {
                    calls++;
                    return {};
                },
            });
            const searchCall = {
                toolCallId: "call-2",
                name: "web_search",
                mcpServerName: "github-mcp-server",
                arguments: { query: "Seattle weather" },
                result: { content: "Dry" },
                status: "completed",
            } satisfies RecordedToolCall;
            const traceId = await captureTrace(
                manager,
                mixed
                    ? { additionalCalls: [searchCall] }
                    : {
                          toolName: searchCall.name,
                          mcpServerName: searchCall.mcpServerName,
                      },
            );
            const draft = await manager.createMacroFromTrace({
                traceId,
                name: "Think about going outside",
            });
            const definition = await manager.inspectMacro(draft);
            expect(definition.executionClass).toBe("agentRequired");
            expect(definition.steps.map((step) => step.executionClass)).toEqual(
                mixed ? ["replayable", "agentRequired"] : ["agentRequired"],
            );
            expect(definition.steps.at(-1)).toMatchObject({
                toolName: "web_search",
                mcpServerName: "github-mcp-server",
            });
            await expect(manager.validateMacro(draft)).resolves.toMatchObject({
                valid: true,
                executionClass: "agentRequired",
            });
            const approved = await manager.approveMacro(draft);
            await expect(
                manager.runMacro({
                    ...approved,
                    runId: "copilot-only-run",
                    preference: "auto",
                }),
            ).resolves.toMatchObject({
                status: "agentRequired",
                launch: {
                    agent: "typeagent-macro-runner",
                    macro: {
                        ...definition,
                        version: 2,
                        state: "approved",
                        createdAt: expect.any(String),
                    },
                    reason: { stepIds: [mixed ? "step-2" : "step-1"] },
                },
            });
            await expect(
                manager.runMacro({
                    ...approved,
                    runId: "forced-replay",
                    preference: "replay",
                }),
            ).rejects.toThrow("agent");
            expect(calls).toBe(0);
        },
    );

    it("does not persist a draft when replay tool inspection fails", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "catalog-"));
        const manager = new MacroManager(instanceDir, {
            inspectTool: async () => {
                throw new Error("Connection failed");
            },
            callTool: async () => {
                throw new Error("Must not execute");
            },
        });
        const traceId = await captureTrace(manager);
        await expect(
            manager.createMacroFromTrace({
                traceId,
                name: "Read package",
            }),
        ).rejects.toThrow("Connection failed");
        await expect(manager.listMacros()).resolves.toEqual([]);
    });

    it("rejects tools removed after draft creation without changing execution class", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "catalog-"));
        let available = true;
        const manager = new MacroManager(instanceDir, {
            inspectTool: async (mcpServerName, toolName) =>
                available
                    ? {
                          ...(mcpServerName ? { mcpServerName } : {}),
                          toolName,
                          schemaFingerprint: "v1",
                      }
                    : undefined,
            callTool: async () => {
                throw new Error("Must not execute");
            },
        });
        const traceId = await captureTrace(manager);
        const draft = await manager.createMacroFromTrace({
            traceId,
            name: "Read package",
        });
        available = false;
        await expect(manager.approveMacro(draft)).rejects.toThrow(
            "Replay tool is unavailable",
        );
        await expect(manager.inspectMacro(draft)).resolves.toMatchObject({
            state: "draft",
            executionClass: "replayable",
        });
    });

    it("approves agent-required drafts but rejects unsuccessful source calls", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "catalog-"));
        const manager = new MacroManager(instanceDir);
        const agentTraceId = await captureTrace(manager, {
            sessionId: "agent-session",
            toolName: "native-tool",
            mcpServerName: "",
        });
        const agentDraft = await manager.createMacroFromTrace({
            traceId: agentTraceId,
            name: "Native operation",
        });

        await expect(manager.approveMacro(agentDraft)).resolves.toMatchObject({
            version: 2,
            state: "approved",
        });
        const handoff = await manager.runMacro({
            runId: "agent-run-1",
            macroId: agentDraft.macroId,
        });
        expect(handoff).toMatchObject({
            status: "agentRequired",
            launch: {
                agent: "typeagent-macro-runner",
                macro: { macroId: agentDraft.macroId, version: 2 },
                reason: { stepIds: ["step-1"] },
                candidate: { handoffRunId: "agent-run-1" },
            },
        });
        const approved = await manager.inspectMacro({
            macroId: agentDraft.macroId,
            version: 2,
        });
        await expect(
            manager.submitMacroCandidate({
                sourceMacroId: approved.macroId,
                sourceVersion: approved.version,
                handoffRunId: "agent-run-1",
                reason: "Permission was denied.",
                inputs: approved.inputs,
                steps: approved.steps,
                executionEvidence: {
                    outcome: "completed",
                    toolCalls: 1,
                    retries: 0,
                    durationMs: 100,
                    tokensUsed: 100,
                    steps: [{ stepId: "step-1", status: "denied" }],
                },
            }),
        ).rejects.toThrow("execution evidence");
        const candidate = await manager.submitMacroCandidate({
            sourceMacroId: approved.macroId,
            sourceVersion: approved.version,
            handoffRunId: "agent-run-1",
            reason: "Adapted the native tool arguments.",
            inputs: approved.inputs,
            steps: approved.steps,
            executionEvidence: {
                outcome: "completed",
                toolCalls: 1,
                retries: 0,
                durationMs: 100,
                tokensUsed: 100,
                steps: [{ stepId: "step-1", status: "completed" }],
            },
        });
        expect(candidate).toMatchObject({ version: 3, state: "draft" });
        await expect(
            manager.inspectMacro({
                macroId: approved.macroId,
                version: approved.version,
            }),
        ).resolves.toMatchObject({ state: "approved" });
        await expect(manager.inspectMacro(candidate)).resolves.toMatchObject({
            state: "draft",
            candidateProvenance: {
                sourceVersion: 2,
                handoffRunId: "agent-run-1",
            },
        });
        await expect(
            manager.submitMacroCandidate({
                sourceMacroId: approved.macroId,
                sourceVersion: approved.version,
                handoffRunId: "unknown-run",
                reason: "This content must not become telemetry.",
                inputs: approved.inputs,
                steps: approved.steps,
                executionEvidence: {
                    outcome: "completed",
                    toolCalls: 1,
                    retries: 0,
                    durationMs: 100,
                    tokensUsed: 100,
                    steps: [{ stepId: "step-1", status: "completed" }],
                },
            }),
        ).rejects.toThrow("Agent handoff not found");
        const metrics = await readFile(
            path.join(instanceDir, "copilot-macros", "metrics.jsonl"),
            "utf8",
        );
        expect(metrics).toContain('"operation":"agentHandoff"');
        expect(metrics).toContain('"operation":"candidate"');
        expect(metrics).not.toContain("Adapted the native tool arguments");
        await expect(
            manager.inspectMacro({ macroId: agentDraft.macroId }),
        ).resolves.toMatchObject({
            executionClass: "agentRequired",
        });

        const failedTraceId = await captureTrace(manager, {
            sessionId: "failed-session",
            status: "failed",
        });
        const failedDraft = await manager.createMacroFromTrace({
            traceId: failedTraceId,
            name: "Failed operation",
        });
        await expect(manager.approveMacro(failedDraft)).rejects.toThrow(
            "Macro validation failed",
        );
    });

    it("persists deterministic run records across restart", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "catalog-"));
        const replayHost: ReplayToolHost = {
            inspectTool: async (mcpServerName, toolName) => ({
                ...(mcpServerName ? { mcpServerName } : {}),
                toolName,
                schemaFingerprint: "v1",
            }),
            callTool: async () => ({ content: "package" }),
        };
        const manager = new MacroManager(instanceDir, replayHost);
        const traceId = await captureTrace(manager);
        const draft = await manager.createMacroFromTrace({
            traceId,
            name: "Read package",
        });
        const approved = await manager.approveMacro(draft);

        await expect(
            manager.runMacro({
                runId: "run-1",
                macroId: approved.macroId,
                version: approved.version,
            }),
        ).resolves.toMatchObject({
            status: "completed",
            run: { runId: "run-1", result: { content: "package" } },
        });
        await expect(
            new MacroManager(instanceDir).getMacroRun("run-1"),
        ).resolves.toMatchObject({ status: "completed" });
    });

    it("rejects schema drift before executing step one", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "catalog-"));
        let fingerprint = "v1";
        let calls = 0;
        const replayHost: ReplayToolHost = {
            inspectTool: async (mcpServerName, toolName) => ({
                ...(mcpServerName ? { mcpServerName } : {}),
                toolName,
                schemaFingerprint: fingerprint,
            }),
            callTool: async () => {
                calls++;
                return {};
            },
        };
        const manager = new MacroManager(instanceDir, replayHost);
        const traceId = await captureTrace(manager);
        const draft = await manager.createMacroFromTrace({
            traceId,
            name: "Read package",
        });
        const approved = await manager.approveMacro(draft);
        fingerprint = "v2";

        await expect(
            manager.runMacro({
                runId: "run-drift",
                macroId: approved.macroId,
                version: approved.version,
            }),
        ).resolves.toMatchObject({
            status: "failed",
            run: { error: { code: "schemaDrift" }, steps: [] },
        });
        expect(calls).toBe(0);
    });

    it("dry-runs preflight without invoking or persisting a run", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "catalog-"));
        let calls = 0;
        const manager = new MacroManager(instanceDir, {
            inspectTool: async (mcpServerName, toolName) => ({
                ...(mcpServerName ? { mcpServerName } : {}),
                toolName,
                schemaFingerprint: "v1",
            }),
            callTool: async () => {
                calls++;
                return {};
            },
        });
        const traceId = await captureTrace(manager);
        const draft = await manager.createMacroFromTrace({
            traceId,
            name: "Read package",
        });
        const approved = await manager.approveMacro(draft);

        await expect(
            manager.runMacro({
                runId: "run-dry",
                macroId: approved.macroId,
                dryRun: true,
            }),
        ).resolves.toMatchObject({ status: "validated", runId: "run-dry" });
        expect(calls).toBe(0);
        await expect(manager.getMacroRun("run-dry")).rejects.toThrow(
            "Macro run not found",
        );
    });

    it("cancels active replay and persists a sanitized run", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "catalog-"));
        let started: (() => void) | undefined;
        const callStarted = new Promise<void>((resolve) => {
            started = resolve;
        });
        const manager = new MacroManager(instanceDir, {
            inspectTool: async (mcpServerName, toolName) => ({
                ...(mcpServerName ? { mcpServerName } : {}),
                toolName,
                schemaFingerprint: "v1",
            }),
            callTool: async (_server, _tool, _arguments, signal) => {
                started?.();
                await new Promise<void>((_resolve, reject) => {
                    signal.addEventListener(
                        "abort",
                        () =>
                            reject(new DOMException("Cancelled", "AbortError")),
                        { once: true },
                    );
                });
                return {};
            },
        });
        const traceId = await captureTrace(manager);
        const draft = await manager.createMacroFromTrace({
            traceId,
            name: "Read package",
        });
        const approved = await manager.approveMacro(draft);

        const running = manager.runMacro({
            runId: "run-cancel",
            macroId: approved.macroId,
            inputs: { token: "secret-token", note: "keep" },
        });
        await callStarted;
        manager.cancelMacroRun("run-cancel");

        await expect(running).resolves.toMatchObject({
            status: "cancelled",
            run: {
                inputs: { token: "[REDACTED]", note: "keep" },
                error: { code: "cancelled" },
            },
        });
        await expect(manager.getMacroRun("run-cancel")).resolves.toMatchObject({
            inputs: { token: "[REDACTED]", note: "keep" },
        });
    });

    it("records deadline expiry as a timeout failure", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "catalog-"));
        const manager = new MacroManager(instanceDir, {
            inspectTool: async (mcpServerName, toolName) => ({
                ...(mcpServerName ? { mcpServerName } : {}),
                toolName,
                schemaFingerprint: "v1",
            }),
            callTool: async (_server, _tool, _arguments, signal) => {
                await new Promise<void>((_resolve, reject) => {
                    signal.addEventListener(
                        "abort",
                        () =>
                            reject(new DOMException("Timed out", "AbortError")),
                        { once: true },
                    );
                });
                return {};
            },
        });
        const traceId = await captureTrace(manager);
        const draft = await manager.createMacroFromTrace({
            traceId,
            name: "Read package",
        });
        const approved = await manager.approveMacro(draft);

        await expect(
            manager.runMacro({
                runId: "run-timeout",
                macroId: approved.macroId,
                timeoutMs: 1,
            }),
        ).resolves.toMatchObject({
            status: "failed",
            run: { status: "failed", error: { code: "timeout" } },
        });
    });

    it("bounds persisted results without changing replay completion", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "catalog-"));
        const manager = new MacroManager(instanceDir, {
            inspectTool: async (mcpServerName, toolName) => ({
                ...(mcpServerName ? { mcpServerName } : {}),
                toolName,
                schemaFingerprint: "v1",
            }),
            callTool: async () => ({ content: "x".repeat(300 * 1024) }),
        });
        const traceId = await captureTrace(manager);
        const draft = await manager.createMacroFromTrace({
            traceId,
            name: "Read package",
        });
        const approved = await manager.approveMacro(draft);

        await expect(
            manager.runMacro({
                runId: "run-large",
                macroId: approved.macroId,
            }),
        ).resolves.toMatchObject({
            status: "completed",
            run: {
                result: { truncated: true, originalBytes: expect.any(Number) },
            },
        });
    });
});
