// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
    MacroLearningJob,
    RecordedInteractionTrace,
    RecordingToken,
} from "../src/contracts.js";
import {
    MacroAuthoringPending,
    MacroChildAuthoring,
} from "../src/macroChildAuthoring.js";
import { sealMacroChildCapture } from "../src/macroChildCapture.js";

const jest = (import.meta as ImportMeta & { jest: typeof globalThis.jest })
    .jest;

describe("durable scoped Copilot authoring exchange", () => {
    let directory: string;
    let broker: MacroChildAuthoring;
    let job: MacroLearningJob;
    const trace: RecordedInteractionTrace = {
        schemaVersion: 1,
        sessionId: "source",
        cwd: os.tmpdir(),
        prompt: "read file alpha.txt for me",
        response: "original contents",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        toolCalls: [
            {
                toolCallId: "read",
                name: "read",
                mcpServerName: "files",
                arguments: { path: "alpha.txt" },
                result: { body: "original contents" },
                status: "completed",
            },
        ],
    };
    const claim = () => ({
        cwd: directory,
        sessionId: "compatible-host",
        workerId: "worker",
    });
    const active = new Set(["job"]);
    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), "child-authoring-"));
        broker = new MacroChildAuthoring(directory);
        const token: RecordingToken = {
            id: "token",
            status: "claimed",
            sessionId: trace.sessionId,
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
        };
        const envelope = sealMacroChildCapture(
            "capture",
            { ...trace, cwd: directory },
            token,
            {
                taskId: "source:first",
                firstEventId: "first",
                successEventId: "receipt",
                outputEventId: "final",
                recordingTokenId: "token",
            },
            "all",
        );
        await broker.contexts.put(envelope);
        job = {
            jobId: "job",
            traceId: "capture",
            cwd: path.resolve(directory).toLowerCase(),
            sessionId: "source",
            status: "awaitingAuthor",
            mode: "all",
            createdAt: trace.startedAt,
            updatedAt: trace.completedAt,
            authoring: {
                captureId: "capture",
                contextDigest: envelope.digest,
                taskId: "source:first",
                tokenId: "token",
            },
        };
    });
    afterEach(async () => {
        jest.restoreAllMocks();
        await rm(directory, { recursive: true, force: true });
    });
    const signal = () => new AbortController().signal;

    it("persists the exact prompt/context before enqueue returns and never calls a provider", async () => {
        await expect(
            broker.query(job, "author this bounded candidate", signal()),
        ).rejects.toBeInstanceOf(MacroAuthoringPending);
        const restored = new MacroChildAuthoring(directory);
        const request = await restored.claim(claim(), active);
        expect(request).toMatchObject({
            prompt: "author this bounded candidate",
            contextDigest: job.authoring!.contextDigest,
        });
        expect(request!.context.context.capture).toMatchObject({
            origin: "task",
            outcome: "succeeded",
            taskId: "source:first",
        });
        expect(
            request!.context.context.omissions.every((item) => !item.required),
        ).toBe(true);
        expect(
            request!.context.context.messages.map((item) => item.eventId),
        ).toEqual(["first", "capture:tool:read", "receipt", "final"]);
        expect(await restored.claim(claim(), active)).toBeUndefined();
        await restored.submit(
            {
                ...claim(),
                ...request!,
                outcome: {
                    status: "completed",
                    text: '{"source":"checked candidate"}',
                    childId: "actual-child",
                },
            },
            active,
        );
        expect(
            await new MacroChildAuthoring(directory).query(
                job,
                "author this bounded candidate",
                signal(),
            ),
        ).toBe('{"source":"checked candidate"}');
    });

    it("requires the same workspace, session, worker, lease, and prompt digest", async () => {
        await expect(
            broker.query(job, "question", signal()),
        ).rejects.toBeInstanceOf(MacroAuthoringPending);
        expect(
            await broker.claim(
                { ...claim(), cwd: path.dirname(directory) },
                active,
            ),
        ).toBeUndefined();
        expect(await broker.claim(claim(), new Set())).toBeUndefined();
        const request = (await broker.claim(claim(), active))!;
        const submission = {
            ...claim(),
            ...request,
            outcome: {
                status: "completed" as const,
                text: "answer",
                childId: "child",
            },
        };
        for (const changed of [
            { cwd: path.dirname(directory) },
            { sessionId: "wrong" },
            { workerId: "wrong" },
            { leaseId: "wrong" },
            { promptDigest: "wrong" },
        ])
            await expect(
                broker.submit({ ...submission, ...changed }, active),
            ).rejects.toThrow("scoped lease");
        await expect(broker.submit(submission, new Set())).rejects.toThrow(
            "scoped lease",
        );
        await broker.submit(submission, active);
        await broker.submit(submission, active);
        await expect(
            broker.submit(
                {
                    ...submission,
                    outcome: { ...submission.outcome, text: "replacement" },
                },
                active,
            ),
        ).rejects.toThrow("immutable");
    });

    it("recovers an expired lease in a later compatible session and rejects the old child", async () => {
        await expect(
            broker.query(job, "question", signal()),
        ).rejects.toBeInstanceOf(MacroAuthoringPending);
        const first = (await broker.claim(claim(), active))!;
        jest.spyOn(Date, "now").mockReturnValue(Date.now() + 121_000);
        const restarted = new MacroChildAuthoring(directory);
        const nextClaim = {
            ...claim(),
            sessionId: "next-session",
            workerId: "next-worker",
        };
        const next = (await restarted.claim(nextClaim, active))!;
        expect(next.leaseId).not.toBe(first.leaseId);
        await expect(
            restarted.submit(
                {
                    ...claim(),
                    ...first,
                    outcome: {
                        status: "completed",
                        text: "old",
                        childId: "old",
                    },
                },
                active,
            ),
        ).rejects.toThrow("scoped lease");
        await restarted.submit(
            {
                ...nextClaim,
                ...next,
                outcome: { status: "completed", text: "fresh", childId: "new" },
            },
            active,
        );
        expect(await restarted.query(job, "question", signal())).toBe("fresh");
    });

    it("retains failed authoring as an explicit failure, without a model fallback", async () => {
        await expect(
            broker.query(job, "question", signal()),
        ).rejects.toBeInstanceOf(MacroAuthoringPending);
        const request = (await broker.claim(claim(), active))!;
        await broker.submit(
            {
                ...claim(),
                ...request,
                outcome: { status: "failed", error: "Host child unavailable" },
            },
            active,
        );
        await expect(broker.query(job, "question", signal())).rejects.toThrow(
            "Host child unavailable",
        );
    });

    it("rejects corrupted durable prompts and missing context", async () => {
        await expect(
            broker.query(job, "question", signal()),
        ).rejects.toBeInstanceOf(MacroAuthoringPending);
        const file = path.join(directory, "child-authoring.json");
        const saved = JSON.parse(await readFile(file, "utf8"));
        saved[0].prompt = "modified";
        await writeFile(file, JSON.stringify(saved));
        await expect(
            new MacroChildAuthoring(directory).claim(claim(), active),
        ).rejects.toThrow("digest mismatch");
        await expect(
            broker.query(
                {
                    ...job,
                    authoring: { ...job.authoring!, captureId: "missing" },
                },
                "question",
                signal(),
            ),
        ).rejects.toThrow("missing or changed");
    });

    it("rejects cancelled, secret-bearing and oversized requests before dispatch", async () => {
        await expect(
            broker.query(job, "x".repeat(1_048_577), signal()),
        ).rejects.toThrow("oversized");
        const controller = new AbortController();
        controller.abort();
        await expect(
            broker.query(job, "question", controller.signal),
        ).rejects.toThrow();
        expect(await broker.claim(claim(), active)).toBeUndefined();
    });

    it.each(["failed", "denied"] as const)(
        "does not seal a selected task with a %s operation",
        (status) => {
            expect(() =>
                sealMacroChildCapture(
                    "bad",
                    {
                        ...trace,
                        toolCalls: [{ ...trace.toolCalls[0], status }],
                    },
                    {
                        id: "token",
                        status: "claimed",
                        sessionId: "source",
                        expiresAt: new Date(Date.now() + 1000).toISOString(),
                    },
                    {
                        taskId: "source:first",
                        firstEventId: "first",
                        successEventId: "receipt",
                        outputEventId: "final",
                        recordingTokenId: "token",
                    },
                    "all",
                ),
            ).toThrow();
        },
    );
});
