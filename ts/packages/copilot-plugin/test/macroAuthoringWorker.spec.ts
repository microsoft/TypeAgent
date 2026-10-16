// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type {
    MacroAuthoringRequest,
    MacroAuthoringSubmission,
    MacroLearningJob,
    MacroLearningMode,
} from "@typeagent/copilot-macros";
import { sealRecipeAuthoringContext } from "@typeagent/copilot-macros/recipeAuthoring";
import {
    MacroAuthoringWorker,
    type MacroAuthoringWorkerOptions,
} from "../src/extension/macro-authoring.js";

describe("durable Copilot authoring worker", () => {
    let worker: MacroAuthoringWorker | undefined;
    const cwd = "D:\\workspace";
    const envelope = sealRecipeAuthoringContext(
        {
            capture: {
                captureId: "capture",
                tokenId: "token",
                sessionId: "source",
                taskId: "task",
                boundary: { firstEventId: "user", lastEventId: "final" },
                origin: "task",
                outcome: "succeeded",
                scope: { workspaceId: cwd, profileId: "typeagent" },
                mode: "all",
                request: "read alpha",
                decisionSummary: "Read the requested file.",
                contextArtifacts: [],
                omissions: [],
                outputEvidenceIds: ["output"],
                calls: [],
            },
            constraints: ["No business effects."],
            messages: [
                { eventId: "user", role: "user", content: "read alpha" },
                { eventId: "final", role: "assistant", content: "contents" },
            ],
            workingCode: [],
            capabilities: [],
            outputs: [
                {
                    id: "output",
                    eventId: "final",
                    evidence: { modelVisible: "contents" },
                },
            ],
            omissions: [],
        },
        {
            token: {
                id: "token",
                sessionId: "source",
                status: "claimed",
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
            },
            taskId: "task",
            selectedTaskId: "task",
            sessionId: "source",
            origin: "task",
            outcome: "succeeded",
            successEventId: "final",
            now: new Date().toISOString(),
        },
    );
    function request(id: string): MacroAuthoringRequest {
        return {
            requestId: id,
            jobId: "job",
            captureId: "capture",
            contextDigest: envelope.digest,
            promptDigest: `digest-${id}`,
            prompt: `phase-${id}`,
            leaseId: `lease-${id}`,
            leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
            context: envelope,
        };
    }
    function setup(
        launch?: MacroAuthoringWorkerOptions["launch"],
        requests = [request("first")],
    ) {
        let mode: MacroLearningMode = "all";
        let status: MacroLearningJob["status"] = "awaitingAuthor";
        const job = (): MacroLearningJob => ({
            jobId: "job",
            traceId: "capture",
            cwd,
            sessionId: "source",
            mode,
            status,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        const connection = {
            claimMacroAuthoringRequest: jest.fn(async () => requests.shift()),
            submitMacroAuthoringResponse: jest.fn(
                async (_submission: MacroAuthoringSubmission) => {},
            ),
            getMacroLearningPreference: jest.fn(async () => ({
                cwd,
                mode,
                revision: 1,
            })),
            getMacroLearningJob: jest.fn(async () => job()),
            close: jest.fn(async () => {}),
        };
        const start = jest.fn<MacroAuthoringWorkerOptions["launch"]>(
            launch ??
                (async () => ({
                    text: '{"source":"candidate"}',
                    childId: "child",
                })),
        );
        const report = jest.fn<(message: string) => void>();
        worker = new MacroAuthoringWorker({
            cwd,
            sessionId: "host",
            connect: async () => connection,
            launch: start,
            report,
        });
        return {
            connection,
            start,
            report,
            setOff: () => {
                mode = "off";
            },
            cancel: () => {
                status = "cancelled";
            },
        };
    }
    async function settle() {
        for (let i = 0; i < 30; i++) await Promise.resolve();
    }
    function awaitAbort(
        _prompt: string,
        signal: AbortSignal,
    ): Promise<{ text: string; childId: string }> {
        return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
            });
            if (signal.aborted) reject(signal.reason);
        });
    }
    afterEach(async () => {
        await worker?.close();
        jest.useRealTimers();
    });
    it("launches each phase separately with exact context and correlated immutable response, without waiting in kick", async () => {
        const { start, connection } = setup(undefined, [
            request("first"),
            request("second"),
        ]);
        expect(worker!.kick()).toBeUndefined();
        await settle();
        expect(start).toHaveBeenCalledTimes(2);
        expect(start.mock.calls[0][0]).toContain(JSON.stringify(envelope));
        expect(start.mock.calls[0][0]).toContain("phase-first");
        expect(start.mock.calls[1][0]).toContain("phase-second");
        expect(connection.submitMacroAuthoringResponse).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                requestId: "first",
                leaseId: "lease-first",
                promptDigest: "digest-first",
                cwd,
                sessionId: "host",
                outcome: {
                    status: "completed",
                    text: '{"source":"candidate"}',
                    childId: "child",
                },
            }),
        );
    });
    it.each(["off", "cancel"])(
        "cancels only the active child on %s and never submits it",
        async (action) => {
            jest.useFakeTimers();
            const fixture = setup(awaitAbort);
            worker!.kick();
            await settle();
            if (action === "off") fixture.setOff();
            else fixture.cancel();
            await jest.advanceTimersByTimeAsync(1000);
            expect(fixture.start.mock.calls[0][1].aborted).toBe(true);
            expect(
                fixture.connection.submitMacroAuthoringResponse,
            ).not.toHaveBeenCalled();
            expect(fixture.connection.close).toHaveBeenCalledTimes(1);
        },
    );
    it("preempts a child for new user work, leaves its lease recoverable, and closes the connection", async () => {
        const { start, connection, report } = setup(awaitAbort);
        worker!.kick();
        await settle();
        worker!.pause();
        await worker!.close();
        expect(start.mock.calls[0][1].aborted).toBe(true);
        expect(connection.submitMacroAuthoringResponse).not.toHaveBeenCalled();
        expect(connection.close).toHaveBeenCalledTimes(1);
        expect(report).not.toHaveBeenCalled();
    });
    it("can close while a backend cancellation-status read is unresponsive", async () => {
        const { connection, start } = setup(awaitAbort);
        connection.getMacroLearningJob.mockImplementationOnce(
            () => new Promise(() => {}),
        );
        worker!.kick();
        await settle();
        await worker!.close();
        expect(start.mock.calls[0][1].aborted).toBe(true);
        expect(connection.submitMacroAuthoringResponse).not.toHaveBeenCalled();
        expect(connection.close).toHaveBeenCalledTimes(1);
    });
    it("can close while claiming a request from an unresponsive backend", async () => {
        const { connection, start } = setup();
        connection.claimMacroAuthoringRequest.mockImplementationOnce(
            () => new Promise(() => {}),
        );
        worker!.kick();
        await settle();
        await worker!.close();
        expect(start).not.toHaveBeenCalled();
        expect(connection.close).toHaveBeenCalledTimes(1);
    });
    it("persists explicit child failure rather than calling a TypeAgent authoring fallback", async () => {
        const { connection } = setup(async () => {
            throw new Error("unsupported child host");
        });
        worker!.kick();
        await settle();
        expect(connection.submitMacroAuthoringResponse).toHaveBeenCalledWith(
            expect.objectContaining({
                outcome: { status: "failed", error: "unsupported child host" },
            }),
        );
    });
});
