// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    cancelMacroWork,
    parseLearningMode,
} from "../src/shared/macro-learning.js";
import type { MacroLearningJob } from "@typeagent/copilot-macros";

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
