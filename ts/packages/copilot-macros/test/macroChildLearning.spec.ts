// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type {
    MacroLearningJob,
    MacroLearningRuntime,
    RecordedInteractionTrace,
} from "../src/contracts.js";
import { MacroManager } from "../src/macroManager.js";
import { macroProgramArtifact } from "./recipeCatalogFixtures.js";

describe.each(["typeagent", "copilot-local"])(
    "%s scoped Copilot-authored learning/publication",
    (profileId) => {
        let directory: string;
        let manager: MacroManager;
        let fallbackCalls: number;
        function runtime(
            query?: (prompt: string, signal: AbortSignal) => Promise<string>,
        ): MacroLearningRuntime {
            const ask = async (prompt: string, signal: AbortSignal) => {
                if (!query) {
                    fallbackCalls++;
                    throw new Error(
                        "The default TypeAgent author must not run for this job.",
                    );
                }
                await query(prompt, signal);
            };
            return {
                withAuthorQuery: (override) => runtime(override),
                extract: async (trace, traceId, signal) => {
                    await ask(`extract:${traceId}`, signal);
                    return {
                        schemaVersion: 1,
                        traceId,
                        request: trace.prompt,
                        toolCallIds: trace.toolCalls.map(
                            (call) => call.toolCallId,
                        ),
                        description: "Return current file contents",
                        uncertainties: [],
                    };
                },
                build: async (_recipe, _trace, baseline, signal) => {
                    await ask(`build:${baseline.macroId}`, signal);
                    return {
                        name: "Read file",
                        description: baseline.description,
                        inputs: baseline.inputs,
                        steps: baseline.steps,
                        exampleInputs: Object.fromEntries(
                            baseline.inputs.map((input) => [
                                input.name,
                                "alpha.txt",
                            ]),
                        ),
                        requests: [
                            "read file alpha.txt for me",
                            "show file alpha.txt for me",
                            "get file alpha.txt for me",
                            "display file alpha.txt for me",
                        ],
                    };
                },
                generateGrammar: async (macro, _inputs, _requests, signal) => {
                    await ask(`grammar:${macro.macroId}`, signal);
                    return [
                        `<Start> = read file $(step_1_path:string) for me -> { actionName: "run_${macro.macroId}_v${macro.version}", parameters: { step_1_path } };`,
                    ];
                },
                buildProgram: async (macro, _trace, signal) => {
                    await ask(`program:${macro.macroId}`, signal);
                    return macroProgramArtifact(macro);
                },
                validateGrammar: () => {},
            };
        }
        beforeEach(async () => {
            directory = await mkdtemp(
                path.join(process.cwd(), ".child-learning-"),
            );
            fallbackCalls = 0;
            manager = new MacroManager(
                directory,
                {
                    inspectTool: async () => ({
                        toolName: "read",
                        schemaFingerprint: "read-v1",
                        readOnly: true,
                    }),
                    callTool: async () => {
                        throw new Error(
                            "Learning must not execute business tools.",
                        );
                    },
                },
                profileId,
            );
            await manager.configureLearning(runtime());
            await manager.setMacroLearningPreference({
                cwd: directory,
                mode: "all",
            });
        });
        afterEach(async () => {
            await manager.close();
            await rm(directory, { recursive: true, force: true });
        });
        async function recorded(receiptTokenId?: string) {
            const trace: RecordedInteractionTrace = {
                schemaVersion: 1,
                sessionId: "source",
                cwd: directory,
                prompt: "read file alpha.txt for me",
                response: "Current contents",
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                toolCalls: [
                    {
                        toolCallId: "read",
                        name: "read",
                        mcpServerName: "files",
                        arguments: { path: "alpha.txt" },
                        result: { body: "Current contents" },
                        status: "completed",
                    },
                ],
            };
            const token = manager.armRecording({
                sessionId: "source",
                cwd: directory,
                learning: true,
            });
            manager.claimRecording({
                sessionId: "source",
                cwd: directory,
                promptHash: createHash("sha256")
                    .update(trace.prompt)
                    .digest("hex"),
            });
            return manager.finalizeRecording({
                tokenId: token.id,
                trace,
                childAuthoring: {
                    taskId: "source:first",
                    firstEventId: "first",
                    successEventId: "receipt",
                    outputEventId: "final",
                    recordingTokenId: receiptTokenId ?? token.id,
                },
            });
        }
        async function waiting(
            jobId: string,
            status: MacroLearningJob["status"],
        ) {
            const deadline = Date.now() + 5000;
            let job;
            do {
                job = await manager.getMacroLearningJob(jobId);
                if (job.status === status) return job;
                if (job.status === "failed" || job.status === "cancelled")
                    throw new Error(JSON.stringify(job));
                await new Promise((resolve) => setTimeout(resolve, 10));
            } while (Date.now() < deadline);
            throw new Error(`Expected ${status}: ${JSON.stringify(job)}`);
        }
        const claim = () => ({
            sessionId: "host",
            workerId: "worker",
            cwd: directory,
        });

        it("wakes bounded IPC waits on durable changes and reconciles missed hints after reconnect", async () => {
            const waitingForChange = manager.claimMacroAuthoringRequest({
                ...claim(),
                observeOnly: true,
                waitMs: 30_000,
            });
            const summary = await recorded();
            await waitingForChange;
            await waiting(summary.learningJobId!, "awaitingAuthor");
            // No subscriber is present for this persisted request.
            await manager.close();
            manager = new MacroManager(directory, undefined, profileId);
            await manager.configureLearning(runtime());
            await waiting(summary.learningJobId!, "awaitingAuthor");
            const request = await manager.claimMacroAuthoringRequest({
                ...claim(),
                waitMs: 30_000,
            });
            expect(request?.jobId).toBe(summary.learningJobId);
            const cancellation = manager.claimMacroAuthoringRequest({
                ...claim(),
                observeOnly: true,
                waitMs: 30_000,
            });
            await manager.cancelMacroLearningJob(summary.learningJobId!);
            await cancellation;
            expect(
                (await manager.getMacroLearningJob(summary.learningJobId!))
                    .status,
            ).toBe("cancelled");
            expect(
                await manager.claimMacroAuthoringRequest(claim()),
            ).toBeUndefined();
        });

        it("reports a mismatched receipt as failed learning, not a completed recording or default-author fallback", async () => {
            await expect(recorded("another-recording")).rejects.toThrow(
                "does not correlate",
            );
            expect(await manager.getRecordingState("source")).toMatchObject({
                status: "failed",
                error: expect.stringContaining(
                    "could not be queued for learning",
                ),
            });
            expect(
                await manager.claimMacroAuthoringRequest(claim()),
            ).toBeUndefined();
            expect(fallbackCalls).toBe(0);
        });

        it("returns original recording immediately, durably pauses, resumes across restart and publishes once", async () => {
            const summary = await recorded();
            expect(summary.learningJobId).toBeDefined();
            expect(
                (await manager.getRecordingState("source")).trace?.traceId,
            ).toBe(summary.traceId);
            const jobId = summary.learningJobId!;
            await waiting(jobId, "awaitingAuthor");
            await manager.close();
            manager = new MacroManager(directory, undefined, profileId);
            await manager.configureLearning(runtime());
            for (let index = 0; index < 4; index++) {
                await waiting(jobId, "awaitingAuthor");
                const request =
                    await manager.claimMacroAuthoringRequest(claim());
                expect(request).toBeDefined();
                await manager.submitMacroAuthoringResponse({
                    ...claim(),
                    requestId: request!.requestId,
                    leaseId: request!.leaseId,
                    promptDigest: request!.promptDigest,
                    outcome: {
                        status: "completed",
                        text: "accepted",
                        childId: `child-${index}`,
                    },
                });
            }
            const job = await waiting(jobId, "ready");
            expect(job.macro?.version).toBe(2);
            expect(
                (await manager.getApprovedMacros()).map(
                    (macro) => macro.macroId,
                ),
            ).toEqual([jobId]);
            expect(fallbackCalls).toBe(0);
            expect(
                await manager.claimMacroAuthoringRequest(claim()),
            ).toBeUndefined();
            const duplicate = await manager.prepareMacroLearning({
                traceId: summary.traceId,
            });
            expect(duplicate.jobId).toBe(jobId);
            expect(duplicate.status).toBe("ready");
            expect(await manager.listMacros()).toHaveLength(1);
        });

        it("cancels pending child work when learning is turned off and rejects stale submissions", async () => {
            const summary = await recorded();
            await waiting(summary.learningJobId!, "awaitingAuthor");
            const request =
                (await manager.claimMacroAuthoringRequest(claim()))!;
            await manager.setMacroLearningPreference({
                cwd: directory,
                mode: "off",
            });
            expect(
                (await manager.getMacroLearningJob(summary.learningJobId!))
                    .status,
            ).toBe("cancelled");
            await expect(
                manager.submitMacroAuthoringResponse({
                    ...claim(),
                    requestId: request.requestId,
                    leaseId: request.leaseId,
                    promptDigest: request.promptDigest,
                    outcome: {
                        status: "completed",
                        text: "late",
                        childId: "late",
                    },
                }),
            ).rejects.toThrow();
            expect(await manager.getApprovedMacros()).toEqual([]);
            expect(fallbackCalls).toBe(0);
        });
    },
);
