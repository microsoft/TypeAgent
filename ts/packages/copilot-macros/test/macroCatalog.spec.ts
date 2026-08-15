// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MacroManager, type ReplayToolHost } from "@typeagent/copilot-macros";

async function captureTrace(
    manager: MacroManager,
    options: {
        sessionId?: string;
        toolName?: string;
        mcpServerName?: string;
        status?: "completed" | "failed" | "denied";
    } = {},
): Promise<string> {
    const sessionId = options.sessionId ?? "session-1";
    manager.armRecording({ sessionId });
    const claimed = manager.claimRecording({
        sessionId,
        cwd: ".",
        promptHash: createHash("sha256").update("Read package").digest("hex"),
    });
    const summary = await manager.finalizeRecording({
        tokenId: claimed!.id,
        trace: {
            schemaVersion: 1,
            sessionId,
            cwd: ".",
            prompt: "Read package",
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
            ],
        },
    });
    return summary.traceId;
}

describe("MacroManager draft catalog", () => {
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
            executionClass: "replayable",
        });
        const approved = await manager.approveMacro(draft);
        expect(approved).toMatchObject({ version: 2, state: "approved" });

        const restarted = new MacroManager(instanceDir);
        await expect(
            restarted.inspectMacro({ macroId: draft.macroId }),
        ).resolves.toMatchObject({
            version: 2,
            state: "approved",
            executionClass: "replayable",
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
            executionClass: "replayable",
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
            callTool: async () => ({ text: "x".repeat(300 * 1024) }),
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
