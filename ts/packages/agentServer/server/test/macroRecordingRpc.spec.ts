// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import { createAgentServerConnection } from "@typeagent/agent-server-client";
import { MacroManager, type ReplayToolHost } from "@typeagent/copilot-macros";
import type { LiveSkillCatalog } from "@typeagent/skill-catalog";
import type { ConversationManager } from "../src/conversationManager.js";
import { createAgentServerConnectionHandler } from "../src/connectionHandler.js";

describe("macro recording RPC", () => {
    it("returns the selected learning job with completed recording status", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "macro-rpc-"));
        let clientAdapter: ChannelProviderAdapter | undefined;
        const serverAdapter = createChannelProviderAdapter(
            "macro-rpc:server",
            (message) => clientAdapter?.notifyMessage(message),
        );
        clientAdapter = createChannelProviderAdapter(
            "macro-rpc:client",
            (message) => serverAdapter.notifyMessage(message),
        );
        const { handler } = createAgentServerConnectionHandler({
            conversationManager: {} as ConversationManager,
            macroManager: new MacroManager(instanceDir),
            skillCatalog: {} as LiveSkillCatalog,
            shutdown: () => {},
            getUserIdentity: () => ({
                username: "test",
                displayName: "Test",
                initial: "T",
            }),
        });
        handler(serverAdapter, () => {});
        const connection = createAgentServerConnection(clientAdapter, () => {});
        try {
            await connection.setMacroLearningPreference({
                cwd: instanceDir,
                mode: "prepare",
            });
            const token = await connection.armMacroRecording({
                sessionId: "learning",
                cwd: instanceDir,
                learning: true,
            });
            await connection.claimMacroRecording({
                sessionId: "learning",
                cwd: instanceDir,
                promptHash: createHash("sha256")
                    .update("Read data")
                    .digest("hex"),
            });
            const summary = await connection.finalizeMacroRecording({
                tokenId: token.id,
                trace: {
                    schemaVersion: 1,
                    sessionId: "learning",
                    cwd: instanceDir,
                    prompt: "Read data",
                    response: "Done",
                    startedAt: "2026-08-14T10:00:00.000Z",
                    completedAt: "2026-08-14T10:00:01.000Z",
                    toolCalls: [
                        {
                            toolCallId: "call-1",
                            name: "read",
                            mcpServerName: "typeagent-workspace",
                            arguments: { path: "package.json" },
                            result: { content: "{}" },
                            status: "completed",
                        },
                    ],
                },
            });
            expect(summary.learningJobId).toEqual(expect.any(String));
            await expect(
                connection.getMacroRecordingState("learning"),
            ).resolves.toMatchObject({
                status: "completed",
                trace: summary,
                learningJob: {
                    jobId: summary.learningJobId,
                    status: "queued",
                },
            });
            await connection.cancelMacroLearningJob(summary.learningJobId!);
            await expect(
                connection.getMacroRecordingState("learning"),
            ).resolves.toMatchObject({
                status: "completed",
                learningJob: {
                    jobId: summary.learningJobId,
                    status: "cancelled",
                },
            });
        } finally {
            await connection.close();
            await rm(instanceDir, { recursive: true, force: true });
        }
    });

    it("records a trace without joining a conversation", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "macro-rpc-"));
        let clientAdapter: ChannelProviderAdapter | undefined;
        const serverAdapter = createChannelProviderAdapter(
            "macro-rpc:server",
            (message) => clientAdapter?.notifyMessage(message),
        );
        clientAdapter = createChannelProviderAdapter(
            "macro-rpc:client",
            (message) => serverAdapter.notifyMessage(message),
        );
        const replayHost: ReplayToolHost = {
            inspectTool: async (mcpServerName, toolName) => ({
                ...(mcpServerName ? { mcpServerName } : {}),
                toolName,
                schemaFingerprint: "v1",
            }),
            callTool: async () => ({ content: "{}" }),
        };
        const { handler } = createAgentServerConnectionHandler({
            conversationManager: {} as ConversationManager,
            macroManager: new MacroManager(instanceDir, replayHost),
            skillCatalog: {} as LiveSkillCatalog,
            shutdown: () => {},
            getUserIdentity: () => ({
                username: "test",
                displayName: "Test",
                initial: "T",
            }),
        });
        handler(serverAdapter, () => {});
        const connection = createAgentServerConnection(clientAdapter, () => {});

        const preference = await connection.setMacroLearningPreference({
            cwd: instanceDir,
            mode: "prepare",
        });
        expect(preference).toMatchObject({
            mode: "prepare",
            revision: expect.any(Number),
        });
        await expect(
            connection.getMacroLearningPreference(instanceDir),
        ).resolves.toEqual(preference);
        await expect(
            connection.prepareMacroLearning({ traceId: "missing-source" }),
        ).rejects.toThrow();
        await expect(
            connection.getMacroLearningJob("missing-job"),
        ).rejects.toThrow();
        await expect(
            connection.cancelMacroLearningJob("missing-job"),
        ).rejects.toThrow();

        const token = await connection.armMacroRecording({
            sessionId: "session-1",
        });
        await connection.claimMacroRecording({
            sessionId: "session-1",
            cwd: ".",
            promptHash: createHash("sha256").update("Read data").digest("hex"),
        });
        const summary = await connection.finalizeMacroRecording({
            tokenId: token.id,
            trace: {
                schemaVersion: 1,
                sessionId: "session-1",
                cwd: ".",
                prompt: "Read data",
                response: "Done",
                startedAt: "2026-08-14T10:00:00.000Z",
                completedAt: "2026-08-14T10:00:01.000Z",
                toolCalls: [
                    {
                        toolCallId: "call-1",
                        name: "read",
                        mcpServerName: "typeagent-workspace",
                        arguments: { path: "package.json" },
                        result: { content: "{}" },
                        status: "completed",
                    },
                ],
            },
        });

        await expect(
            connection.getMacroRecordingState("session-1"),
        ).resolves.toEqual({ status: "completed", trace: summary });
        const draft = await connection.createMacroFromTrace({
            traceId: summary.traceId,
            name: "Read package",
            description: "Reads package metadata",
        });
        await expect(connection.validateMacro(draft)).resolves.toMatchObject({
            valid: true,
            executionClass: "replayable",
        });
        const approved = await connection.approveMacro(draft);
        await expect(connection.listMacros()).resolves.toMatchObject([
            { macroId: draft.macroId, version: 2, state: "approved" },
        ]);
        await expect(
            connection.searchMacros({ query: "package" }),
        ).resolves.toMatchObject([
            { macro: { macroId: draft.macroId }, score: 1 },
        ]);
        await expect(connection.inspectMacro(approved)).resolves.toMatchObject({
            macroId: draft.macroId,
            version: 2,
            state: "approved",
        });
        await expect(
            connection.getMacroRequirements(approved),
        ).resolves.toMatchObject({
            executionClass: "replayable",
            tools: [{ toolName: "read" }],
        });
        await expect(
            connection.runMacro({
                runId: "run-1",
                macroId: approved.macroId,
                version: approved.version,
            }),
        ).resolves.toMatchObject({
            status: "completed",
            run: { runId: "run-1", result: { content: "{}" } },
        });
        await expect(connection.getMacroRun("run-1")).resolves.toMatchObject({
            status: "completed",
            macroId: approved.macroId,
        });
        const approvedMacro = await connection.inspectMacro(approved);
        await expect(
            connection.runMacro({
                runId: "agent-run-1",
                macroId: approved.macroId,
                version: approved.version,
                preference: "agent",
            }),
        ).resolves.toMatchObject({
            status: "agentRequired",
            launch: {
                agent: "typeagent-macro-runner",
                candidate: { handoffRunId: "agent-run-1" },
            },
        });
        const candidate = await connection.submitMacroCandidate({
            sourceMacroId: approved.macroId,
            sourceVersion: approved.version,
            handoffRunId: "agent-run-1",
            reason: "Adapted during agent-guided execution.",
            inputs: approvedMacro.inputs,
            steps: approvedMacro.steps,
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
        await expect(connection.inspectMacro(approved)).resolves.toMatchObject({
            state: "approved",
        });
        const selected = await connection.armMacroRecording({
            sessionId: "learning-session",
            learning: true,
            cwd: instanceDir,
        });
        await connection.claimMacroRecording({
            sessionId: "learning-session",
            cwd: instanceDir,
            promptHash: createHash("sha256").update("Read data").digest("hex"),
        });
        const learningTrace = await connection.finalizeMacroRecording({
            tokenId: selected.id,
            trace: {
                schemaVersion: 1,
                sessionId: "learning-session",
                cwd: instanceDir,
                prompt: "Read data",
                response: "Done",
                startedAt: "2026-09-30T10:00:00.000Z",
                completedAt: "2026-09-30T10:00:01.000Z",
                toolCalls: [
                    {
                        toolCallId: "read-learning",
                        name: "read",
                        mcpServerName: "typeagent-workspace",
                        arguments: {},
                        result: {},
                        status: "completed",
                    },
                ],
            },
        });
        const state =
            await connection.getMacroRecordingState("learning-session");
        expect(state.learningJob).toMatchObject({
            jobId: learningTrace.learningJobId,
            status: "queued",
        });
        await connection.cancelMacroLearningJob(state.learningJob!.jobId);
        expect(
            (await connection.getMacroRecordingState("learning-session"))
                .learningJob,
        ).toMatchObject({
            status: "cancelled",
            error: "Learning job was cancelled.",
        });
        await connection.close();
    });
});
