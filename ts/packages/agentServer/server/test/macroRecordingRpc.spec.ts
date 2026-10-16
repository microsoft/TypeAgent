// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import { createAgentServerConnection } from "@typeagent/agent-server-client";
import {
    MacroManager,
    type ReplayToolHost,
    type MacroLearningRuntime,
} from "@typeagent/copilot-macros";
import type { LiveSkillCatalog } from "@typeagent/skill-catalog";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentServerConnectionHandler } from "../src/connectionHandler.js";
import type { ConversationManager } from "../src/conversationManager.js";

describe("macro recording RPC", () => {
    it.each(["typeagent", "copilot"] as const)(
        "returns selected %s learning and scopes durable authoring RPC",
        async (author) => {
            const instanceDir = await mkdtemp(
                path.join(os.tmpdir(), "macro-rpc-"),
            );
            let clientAdapter: ChannelProviderAdapter | undefined;
            const serverAdapter = createChannelProviderAdapter(
                "macro-rpc:server",
                (message) => clientAdapter?.notifyMessage(message),
            );
            clientAdapter = createChannelProviderAdapter(
                "macro-rpc:client",
                (message) => serverAdapter.notifyMessage(message),
            );
            const manager = new MacroManager(instanceDir);
            if (author === "copilot") {
                const unused = async (): Promise<never> => {
                    throw new Error(
                        "Unexpected authoring stage in transport test.",
                    );
                };
                const runtime: MacroLearningRuntime = {
                    extract: unused,
                    build: unused,
                    generateGrammar: unused,
                    buildProgram: unused,
                    validateGrammar: () => {},
                    withAuthorQuery: (query) => ({
                        ...runtime,
                        extract: async (_trace, _id, signal) => {
                            await query("Scoped extraction", signal);
                            await query("Next scoped phase", signal);
                            return unused();
                        },
                    }),
                };
                await manager.configureLearning(runtime);
            }
            const { handler } = createAgentServerConnectionHandler({
                conversationManager: {} as ConversationManager,
                macroManager: manager,
                skillCatalog: {} as LiveSkillCatalog,
                shutdown: () => {},
                getUserIdentity: () => ({
                    username: "test",
                    displayName: "Test",
                    initial: "T",
                }),
            });
            handler(serverAdapter, () => {});
            const connection = createAgentServerConnection(
                clientAdapter,
                () => {},
            );
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
                    ...(author === "copilot"
                        ? {
                              childAuthoring: {
                                  taskId: "learning:first",
                                  firstEventId: "first",
                                  successEventId: "receipt",
                                  outputEventId: "final",
                                  recordingTokenId: token.id,
                              },
                          }
                        : {}),
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
                if (author === "copilot") {
                    for (let attempt = 0; attempt < 100; attempt++) {
                        const job = await connection.getMacroLearningJob(
                            summary.learningJobId!,
                        );
                        if (job.status === "awaitingAuthor") break;
                        await new Promise((resolve) => setTimeout(resolve, 10));
                    }
                }
                await expect(
                    connection.getMacroRecordingState("learning"),
                ).resolves.toMatchObject({
                    status: "completed",
                    trace: summary,
                    learningJob: {
                        jobId: summary.learningJobId,
                        status:
                            author === "copilot" ? "awaitingAuthor" : "queued",
                    },
                });
                if (author === "copilot") {
                    const claim = {
                        cwd: instanceDir,
                        sessionId: "host",
                        workerId: "worker",
                    };
                    expect(
                        await connection.claimMacroAuthoringRequest({
                            ...claim,
                            cwd: path.dirname(instanceDir),
                        }),
                    ).toBeUndefined();
                    const request =
                        await connection.claimMacroAuthoringRequest(claim);
                    expect(request).toMatchObject({
                        prompt: "Scoped extraction",
                        context: {
                            context: { capture: { tokenId: token.id } },
                        },
                    });
                    const submission = {
                        ...claim,
                        requestId: request!.requestId,
                        leaseId: request!.leaseId,
                        promptDigest: request!.promptDigest,
                        outcome: {
                            status: "completed" as const,
                            text: "exact response",
                            childId: "native-child",
                        },
                    };
                    await expect(
                        connection.submitMacroAuthoringResponse({
                            ...submission,
                            sessionId: "other-host",
                        }),
                    ).rejects.toThrow("scoped lease");
                    await connection.submitMacroAuthoringResponse(submission);
                }
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
        },
    );

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
