// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    cancelMacroWork,
    parseLearningMode,
} from "../src/shared/macro-learning.js";
import {
    MacroManager,
    type MacroLearningJob,
    type MacroLearningRuntime,
} from "@typeagent/copilot-macros";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("workspace macro learning preference", () => {
    it.each(["off", "prepare", "read-only", "all"] as const)(
        "accepts %s",
        (mode) => {
            expect(parseLearningMode(` ${mode.toUpperCase()} `)).toBe(mode);
        },
    );

    it.each(["", "auto", "approve-all", "bypass"])(
        "rejects invalid mode %s",
        (mode) => {
            expect(() => parseLearningMode(mode)).toThrow(
                "off, prepare, read-only, or all",
            );
        },
    );
});

describe("macro work cancellation", () => {
    it("cancels active All learning using the real manager recording status", async () => {
        const directory = await mkdtemp(
            path.join(os.tmpdir(), "plugin-cancel-"),
        );
        let release!: () => void;
        let extracting!: () => void;
        const started = new Promise<void>((resolve) => {
            extracting = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const calls: string[] = [];
        const runtime: MacroLearningRuntime = {
            extract: async (trace, traceId) => {
                extracting();
                await gate;
                return {
                    schemaVersion: 1,
                    traceId,
                    request: trace.prompt,
                    toolCallIds: ["read-1"],
                    description: "Read file",
                    uncertainties: [],
                };
            },
            build: async (_recipe, trace, baseline) => {
                calls.push("build");
                return {
                    name: baseline.name,
                    description: baseline.description,
                    inputs: baseline.inputs,
                    steps: baseline.steps,
                    exampleInputs: { step_1_path: "package.json" },
                    requests: [
                        trace.prompt,
                        "Show package.json",
                        "Open package.json",
                        "Inspect package.json",
                    ],
                };
            },
            generateGrammar: async () => {
                calls.push("grammar");
                return ["grammar"];
            },
            validateGrammar: () => {
                calls.push("approve");
            },
        };
        try {
            const manager = new MacroManager(directory);
            await manager.setMacroLearningPreference({
                cwd: directory,
                mode: "all",
            });
            await manager.configureLearning(runtime);
            const prompt = "Read package.json";
            const token = manager.armRecording({
                sessionId: "session",
                cwd: directory,
                learning: true,
            });
            manager.claimRecording({
                sessionId: "session",
                cwd: directory,
                promptHash: createHash("sha256").update(prompt).digest("hex"),
            });
            const trace = await manager.finalizeRecording({
                tokenId: token.id,
                trace: {
                    schemaVersion: 1,
                    sessionId: "session",
                    cwd: directory,
                    prompt,
                    response: "Empty file",
                    startedAt: "2026-09-30T10:00:00.000Z",
                    completedAt: "2026-09-30T10:00:01.000Z",
                    toolCalls: [
                        {
                            toolCallId: "read-1",
                            name: "read",
                            arguments: { path: "package.json" },
                            result: {},
                            status: "completed",
                        },
                    ],
                },
            });
            await started;
            expect(await manager.getRecordingState("session")).toMatchObject({
                status: "completed",
                trace,
                learningJob: {
                    jobId: trace.learningJobId,
                    status: "extracting",
                },
            });
            await cancelMacroWork("session", async () => ({
                getMacroRecordingState: (sessionId) =>
                    manager.getRecordingState(sessionId),
                cancelMacroLearningJob: async (jobId) => {
                    calls.push("cancel");
                    return manager.cancelMacroLearningJob(jobId);
                },
                cancelMacroRecording: async (sessionId) =>
                    manager.cancelRecording(sessionId),
                close: async () => {},
            }));
            release();
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(
                (await manager.getMacroLearningJob(trace.learningJobId!))
                    .status,
            ).toBe("cancelled");
            expect(await manager.getRecordingState("session")).toEqual({
                status: "idle",
            });
            expect(await manager.getApprovedMacros()).toEqual([]);
            expect(calls).toEqual(["cancel"]);
        } finally {
            release();
            await rm(directory, { recursive: true, force: true });
        }
    });

    it.each([
        "queued",
        "building",
        "needsReview",
        "ready",
        "failed",
        "cancelled",
    ] as const)(
        "handles %s without revoking an approved definition",
        async (status) => {
            const job: MacroLearningJob = {
                jobId: "job",
                traceId: "trace",
                cwd: ".",
                sessionId: "session",
                mode: "all",
                status,
                createdAt: "2026-09-30T00:00:00.000Z",
                updatedAt: "2026-09-30T00:00:00.000Z",
            };
            const calls: string[] = [];
            const response = await cancelMacroWork("session", async () => ({
                getMacroRecordingState: async () => ({
                    status: "completed",
                    learningJob: job,
                }),
                cancelMacroLearningJob: async () => {
                    calls.push("job");
                    return { ...job, status: "cancelled" };
                },
                cancelMacroRecording: async () => {
                    calls.push("recording");
                },
                close: async () => {
                    calls.push("close");
                },
            }));
            expect(calls).toEqual([
                ...(["ready", "failed", "cancelled"].includes(status)
                    ? []
                    : ["job"]),
                "recording",
                "close",
            ]);
            expect(response).toContain("Approved macros are unchanged");
        },
    );
});
