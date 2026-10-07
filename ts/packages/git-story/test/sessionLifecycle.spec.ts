// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
    SessionWatcher,
    type NormalizedSessionUpdate,
    type SessionWatcherDependencies,
    type SessionWatcherStatus,
    type SessionWatchRequest,
} from "../src/sessionWatcher.js";
import {
    captureStatePath,
    loadCaptureState,
} from "../src/sessionCaptureState.js";

let directory: string;
let stateDirectory: string;
let request: SessionWatchRequest;
let watchers: SessionWatcher[];
let updates: NormalizedSessionUpdate[];
let statuses: SessionWatcherStatus[];

beforeEach(async () => {
    directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "git-story-lifecycle-"),
    );
    stateDirectory = path.join(directory, "capture");
    request = {
        projectPath: directory,
        sessionId: "fixture-session",
        transcriptPath: path.join(directory, "events.jsonl"),
        metadata: { clientName: "copilot-cli", models: ["seed"] },
    };
    watchers = [];
    updates = [];
    statuses = [];
    await fs.writeFile(request.transcriptPath, "");
});

afterEach(async () => {
    await Promise.allSettled(watchers.map((watcher) => watcher.stop()));
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

function watcher(options: SessionWatcherDependencies = {}): SessionWatcher {
    const instance = new SessionWatcher({
        capture: { stateDirectory, maxRecords: 2 },
        reconcileIntervalMs: 25,
        // Fixture-only adapters, not a production privacy policy/destination.
        privacyFilter: (update) => update,
        approvedUpdateDestination: (update) => {
            updates.push(update);
        },
        onStatus: (_identity, status) => {
            statuses.push(status);
        },
        ...options,
    });
    watchers.push(instance);
    return instance;
}

function message(text: string, id?: string) {
    return {
        type: "user.message",
        ...(id === undefined ? {} : { id }),
        data: { content: text },
    };
}

async function append(...records: unknown[]) {
    await fs.appendFile(
        request.transcriptPath,
        records.map((record) => JSON.stringify(record) + "\n").join(""),
    );
}

function events() {
    return updates.flatMap((update) => update.events);
}

async function until(assertion: () => void): Promise<void> {
    const deadline = Date.now() + 5000;
    for (;;) {
        try {
            assertion();
            return;
        } catch (error) {
            if (Date.now() >= deadline) throw error;
            await delay(10);
        }
    }
}

async function saved() {
    return loadCaptureState(
        captureStatePath(
            request.sessionId,
            request.transcriptPath,
            stateDirectory,
        ),
    );
}

test("initial watch drains bounded backlog and appends with stable/native IDs", async () => {
    await append(
        ...Array.from({ length: 7 }, (_, i) =>
            message(`line-${i}`, i === 0 ? "" : undefined),
        ),
    );
    const instance = watcher();
    await instance.watch(request);
    expect(events()).toHaveLength(7);
    expect(updates.every((update) => update.events.length <= 2)).toBe(true);
    expect(events()[0]).toMatchObject({ id: "", sourceEventId: "" });
    expect(new Set(events().map((event) => event.id)).size).toBe(7);
    await append(message("new", "native"));
    await until(() => expect(events()).toHaveLength(8));
    expect(events()[7]).toMatchObject({
        id: "native",
        sourceEventId: "native",
    });
    expect(instance.getStatus(request)?.failure).toBeUndefined();
});

test("unchanged sources are stat-reconciled without repeated capture or empty output", async () => {
    const instance = watcher();
    const capture = jest.spyOn(instance, "captureUpdates");
    await instance.watch(request);
    const calls = capture.mock.calls.length;
    const deliveries = updates.length;
    await delay(180);
    expect(capture).toHaveBeenCalledTimes(calls);
    expect(updates).toHaveLength(deliveries);
    await instance.processUpdates(request);
    expect(updates).toHaveLength(deliveries);
});

test("partial UTF8 and newline tails are not consumed or spun on", async () => {
    const bytes = Buffer.from(
        JSON.stringify(message("hello \u{1f680}")) + "\n",
    );
    const split = bytes.indexOf(Buffer.from("\u{1f680}")) + 2;
    await fs.writeFile(request.transcriptPath, bytes.subarray(0, split));
    const instance = watcher();
    const capture = jest.spyOn(instance, "captureUpdates");
    await instance.watch(request);
    expect(events()).toHaveLength(0);
    expect((await saved())?.checkpoint.sourceByteOffset).toBe("0");
    const count = capture.mock.calls.length;
    await delay(120);
    expect(capture).toHaveBeenCalledTimes(count);
    await fs.appendFile(
        request.transcriptPath,
        bytes.subarray(split, bytes.length - 1),
    );
    await delay(80);
    expect(events()).toHaveLength(0);
    await fs.appendFile(request.transcriptPath, "\n");
    await until(() => expect(events()).toHaveLength(1));
    expect(events()[0]).toMatchObject({ text: "hello \u{1f680}" });
});

test("identical registrations are idempotent and keep an immutable seed", async () => {
    await append({
        type: "session.start",
        data: { selectedModel: "observed" },
    });
    const original = structuredClone(request);
    const instance = watcher();
    await Promise.all([
        instance.watch(request),
        instance.watch(structuredClone(request)),
    ]);
    expect(events()).toHaveLength(1);
    expect(request).toEqual(original);
    expect(updates[0].metadata.models).toEqual(["seed", "observed"]);
    await instance.watch(original);
    expect(events()).toHaveLength(1);
    request.metadata.models.push("mutated");
    await expect(instance.watch(request)).rejects.toThrow(
        "registration conflicts",
    );
    expect(instance.getStatus(original)?.failure).toBeUndefined();
});

test("conflicting registration path, metadata and project source ownership reject explicitly", async () => {
    const instance = watcher();
    await instance.watch(request);
    await expect(
        instance.watch({
            ...request,
            transcriptPath: path.join(directory, "other"),
        }),
    ).rejects.toThrow("registration conflicts");
    await expect(
        instance.watch({
            ...request,
            metadata: { ...request.metadata, clientName: "other" },
        }),
    ).rejects.toThrow("registration conflicts");
    await expect(
        instance.watch({
            ...request,
            projectPath: path.join(directory, "other"),
        }),
    ).rejects.toThrow("another project");
});

test("one watcher isolates multiple sessions and equal session IDs in different projects", async () => {
    const instance = watcher();
    const second = {
        ...request,
        projectPath: path.join(directory, "project2"),
        transcriptPath: path.join(directory, "second.jsonl"),
    };
    const third = {
        ...request,
        sessionId: "session3",
        transcriptPath: path.join(directory, "third.jsonl"),
    };
    await append(message("one"));
    await fs.writeFile(
        second.transcriptPath,
        JSON.stringify(message("two")) + "\n",
    );
    await fs.writeFile(
        third.transcriptPath,
        JSON.stringify(message("three")) + "\n",
    );
    await Promise.all([
        instance.watch(request),
        instance.watch(second),
        instance.watch(third),
    ]);
    expect(events()).toHaveLength(3);
    expect(
        updates.map((update) => [update.projectPath, update.sessionId]),
    ).toEqual(
        expect.arrayContaining([
            [request.projectPath, request.sessionId],
            [second.projectPath, second.sessionId],
            [third.projectPath, third.sessionId],
        ]),
    );
});

test("direct processing and notifications serialize while appends arrive during delivery", async () => {
    await append(message("first"));
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
        release = resolve;
    });
    let entered = false;
    const instance = watcher({
        approvedUpdateDestination: async (update) => {
            updates.push(update);
            if (!entered) {
                entered = true;
                await blocked;
            }
        },
    });
    const initial = instance.watch(request);
    await until(() => expect(entered).toBe(true));
    await append(message("second"), message("third"), message("fourth"));
    const direct = Promise.all(
        Array.from({ length: 8 }, () => instance.processUpdates(request)),
    );
    release();
    await Promise.all([initial, direct]);
    expect(events()).toHaveLength(4);
    expect(new Set(events().map((event) => event.id)).size).toBe(4);
    expect(instance.getStatus(request)?.failure).toBeUndefined();
});

test("stop drains admitted delivery, is idempotent, terminal and closes notifications", async () => {
    await append(message("one"));
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
        release = resolve;
    });
    let entered = false;
    const instance = watcher({
        approvedUpdateDestination: async (update) => {
            entered = true;
            await blocked;
            updates.push(update);
        },
    });
    const initial = instance.watch(request);
    await until(() => expect(entered).toBe(true));
    let stopped = false;
    const stop = instance.stop().then(() => {
        stopped = true;
    });
    await delay(30);
    expect(stopped).toBe(false);
    release();
    await Promise.all([initial, stop, instance.stop()]);
    expect(instance.getStatus(request)).toMatchObject({
        phase: "stopped",
        monitoring: false,
    });
    const count = updates.length;
    await append(message("not-admitted"));
    await delay(100);
    expect(updates).toHaveLength(count);
    await expect(instance.watch(request)).rejects.toThrow("is stopped");
    await expect(instance.processUpdates(request)).rejects.toThrow(
        "is stopped",
    );
});

test("stop racing initial monitor setup does not leave timers behind", async () => {
    const instance = watcher();
    const start = instance.watch(request);
    await instance.stop();
    await start;
    expect(instance.getStatus(request)).toMatchObject({
        phase: "stopped",
        monitoring: false,
    });
    const count = updates.length;
    await append(message("after-stop"));
    await delay(100);
    expect(updates).toHaveLength(count);
});

test("restart restores metadata once without dropping new records or republishing history", async () => {
    await append(
        {
            type: "session.start",
            timestamp: "2026-10-01T00:00:00Z",
            data: { selectedModel: "old-model", parentSessionId: "parent" },
        },
        message("old"),
    );
    const first = watcher();
    await first.processUpdates(request);
    const oldIds = events().map((event) => event.id);
    await first.stop();
    updates = [];
    await append(message("new"), message("new2"), message("new3"));
    const second = watcher();
    const restore = jest.spyOn(second, "restoreMetadata");
    await second.processUpdates(request);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(events()).toHaveLength(3);
    expect(events().every((event) => !oldIds.includes(event.id))).toBe(true);
    expect(updates[0].metadata).toMatchObject({
        models: ["seed", "old-model"],
        parentSessionId: "parent",
        startedAt: "2026-10-01T00:00:00Z",
    });
});

test("metadata-only timestamp changes deliver once and ignored records do not repeat empty output", async () => {
    const instance = watcher();
    await instance.processUpdates(request);
    expect(updates).toHaveLength(1);
    await append({
        type: "assistant.message_delta",
        timestamp: "2026-10-01T01:00:00Z",
        data: { deltaContent: "private" },
    });
    await instance.processUpdates(request);
    expect(updates).toHaveLength(2);
    expect(updates[1]).toMatchObject({
        events: [],
        metadata: { lastEventTimestamp: "2026-10-01T01:00:00Z" },
    });
    await append({ type: "assistant.message_delta", data: {} });
    await instance.processUpdates(request);
    expect(updates).toHaveLength(2);
});

test("expanded story evidence survives managed batches, privacy snapshots and metadata restoration", async () => {
    const relationships = {
        messageId: "message",
        originatingMessageId: "origin",
        parentToolCallId: "parent-tool",
        parentAgentTaskId: "parent-task",
        interactionId: "interaction",
        turnId: "turn",
    };
    const attachments = [{ type: "file", path: "PRIVATE.ts" }];
    const toolRequests = [{ toolCallId: "tool", name: "read" }];
    const citations = [{ url: "https://example.test/PRIVATE" }];
    const mcpMeta = { source: "PRIVATE" };
    await append(
        {
            type: "assistant.message",
            id: "answer",
            parentId: "parent-event",
            data: {
                ...relationships,
                content: "PRIVATE",
                attachments,
                toolRequests,
                citations,
                reasoningText: "OMITTED",
            },
        },
        {
            type: "tool.execution_complete",
            id: "complete",
            data: {
                ...relationships,
                toolCallId: "tool",
                success: true,
                mcpMeta,
                result: {
                    content: "PRIVATE",
                    citableSources: citations,
                    mcpMeta,
                },
            },
        },
        {
            type: "session.auto_mode_resolved",
            data: { chosenModel: "chosen" },
        },
        {
            type: "session.fusion_route_failed",
            data: { fallbackModel: "fallback", reason: "PRIVATE" },
        },
    );
    const inspected: NormalizedSessionUpdate[] = [];
    const instance = watcher({
        privacyFilter: (input) => {
            inspected.push(structuredClone(input));
            return {
                ...input,
                events: [],
                metadata: { clientName: "approved", models: [] },
            };
        },
    });
    const publish = jest.spyOn(instance, "publishUpdate");
    await instance.watch(request);
    const evidence = inspected.flatMap((update) => update.events);
    expect(evidence).toHaveLength(4);
    expect(evidence[0]).toMatchObject({
        ...relationships,
        id: "answer",
        sourceEventId: "answer",
        parentId: "parent-event",
        attachments,
        toolRequests,
        citations,
    });
    expect(evidence[1]).toMatchObject({
        ...relationships,
        citableSources: citations,
        mcpMeta,
        resultMcpMeta: mcpMeta,
    });
    expect(inspected[1]!.metadata.models).toEqual([
        "seed",
        "chosen",
        "fallback",
    ]);
    expect(JSON.stringify(inspected)).not.toContain("OMITTED");
    expect(JSON.stringify(updates)).not.toContain("PRIVATE");
    expect(
        publish.mock.calls.every(([handle]) => JSON.stringify(handle) === "{}"),
    ).toBe(true);
    expect(instance.getStatus(request)?.diagnosticCount).toBe(0);
    await instance.stop();
    updates = [];
    await append(message("new", "after-restart"));
    const resumed = watcher();
    await resumed.processUpdates(request);
    expect(events().map((event) => event.id)).toEqual(["after-restart"]);
    expect(updates[0]!.metadata.models).toEqual(["seed", "chosen", "fallback"]);
});

test.each(["truncate", "replace"] as const)(
    "source %s starts a generation and discards old metadata observations",
    async (mode) => {
        await append(
            {
                type: "session.start",
                data: {
                    parentSessionId: "old-parent",
                    selectedModel: "old-model",
                },
            },
            message("old"),
        );
        const instance = watcher();
        await instance.watch(request);
        const generation = instance.getStatus(request)?.generation;
        const replacement = JSON.stringify(message("replacement")) + "\n";
        if (mode === "truncate") {
            await fs.writeFile(request.transcriptPath, replacement);
        } else {
            const temporary = path.join(directory, "replacement.jsonl");
            await fs.writeFile(temporary, replacement);
            await fs.rename(temporary, request.transcriptPath);
        }
        await until(() =>
            expect(instance.getStatus(request)?.generation).not.toBe(
                generation,
            ),
        );
        await until(() => expect(events()).toHaveLength(3));
        expect(updates[updates.length - 1].metadata).toEqual(request.metadata);
        expect(
            statuses.some((status) =>
                status.diagnostics.some((item) => item.code === "source-reset"),
            ),
        ).toBe(true);
    },
);

test("malformed and unsupported diagnostics survive empty-event batches and restore starts before malformed lines", async () => {
    const first = watcher();
    await append({
        type: "session.start",
        data: { selectedModel: "restored" },
    });
    await first.processUpdates(request);
    const boundary = (await saved())!.checkpoint;
    await first.stop();
    updates = [];
    await fs.appendFile(request.transcriptPath, "not-json\n");
    await append(
        { type: "unrecognized.private-type", data: {} },
        { type: "user.message", data: {} },
    );
    const second = watcher();
    const restore = jest.spyOn(second, "restoreMetadata");
    await second.processUpdates(request);
    expect(restore.mock.calls[0][1]).toEqual(boundary);
    expect(events()).toHaveLength(0);
    expect(updates[0].metadata.models).toEqual(["seed", "restored"]);
    expect(
        statuses.flatMap((status) =>
            status.diagnostics.map((item) => item.code),
        ),
    ).toEqual(
        expect.arrayContaining([
            "invalid-json",
            "unsupported-event",
            "malformed-event",
        ]),
    );
    expect(second.getStatus(request)?.diagnosticCount).toBe(3);
    expect(JSON.stringify(statuses)).not.toContain("unrecognized.private-type");
});

test.each(["privacyFilter", "approvedUpdateDestination"] as const)(
    "missing %s fails before consuming capture",
    async (dependency) => {
        await append(message("private"));
        const instance = watcher({ [dependency]: undefined });
        await expect(instance.watch(request)).rejects.toThrow(
            "configuration failed",
        );
        expect(await saved()).toBeUndefined();
        expect(instance.getStatus(request)).toMatchObject({
            phase: "failed",
            failure: { stage: "configuration", captureMayHaveAdvanced: false },
        });
    },
);

test("intentional exclusion advances read progress without delivery or failure", async () => {
    await append(message("private"), message("private2"), message("private3"));
    const instance = watcher({ privacyFilter: () => null });
    await instance.watch(request);
    expect(updates).toHaveLength(0);
    expect(instance.getStatus(request)).toMatchObject({ phase: "idle" });
    expect(Number((await saved())!.checkpoint.sourceByteOffset)).toBe(
        (await fs.stat(request.transcriptPath)).size,
    );
});

test("entire outgoing evidence and metadata use the real privacy method and opaque publication", async () => {
    await append(message("SECRET"), {
        type: "tool.execution_complete",
        data: {
            toolCallId: "call",
            success: false,
            result: {
                content: "SECRET",
                detailedContent: "SECRET",
                contents: [{ text: "SECRET" }],
                structuredContent: { value: "SECRET" },
                diff: "SECRET",
            },
            error: { message: "SECRET" },
        },
    });
    const instance = watcher({
        privacyFilter: (input) => {
            expect(JSON.stringify(input)).toContain("SECRET");
            return {
                projectPath: "redacted",
                sessionId: "redacted",
                events: [],
                metadata: { clientName: "redacted", models: [] },
            };
        },
    });
    const filter = jest.spyOn(instance, "filterForPrivacy");
    const publish = jest.spyOn(instance, "publishUpdate");
    await instance.processUpdates(request);
    expect(filter).toHaveBeenCalledTimes(1);
    expect(filter.mock.calls[0][0].events[1]).toMatchObject({
        output: "SECRET",
        detailedContent: "SECRET",
        contents: [{ text: "SECRET" }],
        structuredContent: { value: "SECRET" },
        diff: "SECRET",
        error: { message: "SECRET" },
    });
    expect(JSON.stringify(publish.mock.calls[0][0])).toBe("{}");
    expect(JSON.stringify(updates)).not.toContain("SECRET");
});

test.each(["privacy", "delivery"] as const)(
    "%s failure halts a source and retains explicit failure after stop",
    async (stage) => {
        await append(message("first"));
        const first = watcher();
        await first.processUpdates(request);
        await first.stop();
        updates = [];
        await append(
            message("failed-SECRET"),
            message("failed2"),
            message("later"),
        );
        const failing = watcher(
            stage === "privacy"
                ? {
                      privacyFilter: () => {
                          throw new Error("SECRET");
                      },
                  }
                : {
                      approvedUpdateDestination: () => {
                          throw new Error("SECRET");
                      },
                  },
        );
        await expect(failing.processUpdates(request)).rejects.toThrow(
            `${stage} failed`,
        );
        const failure = failing.getStatus(request)!.failure!;
        expect(failure).toMatchObject({
            stage,
            captureMayHaveAdvanced: true,
        });
        expect(
            Number(
                failing.getStatus(request)!.readCheckpoint!.sourceByteOffset,
            ),
        ).toBeLessThan((await fs.stat(request.transcriptPath)).size);
        const highWater = (await saved())!.checkpoint;
        await expect(failing.processUpdates(request)).rejects.toThrow(
            `${stage} failed`,
        );
        expect((await saved())!.checkpoint).toEqual(highWater);
        await failing.stop();
        expect(failing.getStatus(request)?.failure).toEqual(failure);
        expect(failing.getStatus(request)?.phase).toBe("failed");
        expect(JSON.stringify(failing.getStatus(request))).not.toContain(
            "SECRET",
        );
        expect(events()).toHaveLength(0);
    },
);

test("background delivery errors are retained/reported and do not silently advance on later notifications", async () => {
    const instance = watcher({
        approvedUpdateDestination: (update) => {
            if (update.events.length) throw new Error("SECRET");
        },
    });
    await instance.watch(request);
    await append(message("bad"));
    await until(() =>
        expect(instance.getStatus(request)?.phase).toBe("failed"),
    );
    const checkpoint = (await saved())!.checkpoint;
    await append(message("later"));
    await delay(100);
    expect((await saved())!.checkpoint).toEqual(checkpoint);
    expect(
        statuses.some((status) => status.failure?.stage === "delivery"),
    ).toBe(true);
    expect(instance.getStatus(request)?.monitoring).toBe(false);
});

test("failed session does not block another session in the same watcher", async () => {
    await append(message("failure"));
    const healthy = {
        ...request,
        sessionId: "healthy",
        transcriptPath: path.join(directory, "healthy.jsonl"),
    };
    await fs.writeFile(
        healthy.transcriptPath,
        JSON.stringify(message("healthy", "healthy-id")) + "\n",
    );
    const instance = watcher({
        approvedUpdateDestination: (update) => {
            if (update.sessionId === request.sessionId)
                throw new Error("PRIVATE");
            updates.push(update);
        },
    });
    await expect(instance.watch(request)).rejects.toThrow("delivery failed");
    await instance.watch(healthy);
    expect(events().map((event) => event.id)).toEqual(["healthy-id"]);
    expect(instance.getStatus(healthy)).toMatchObject({
        phase: "idle",
        monitoring: true,
    });
    expect(instance.getStatus(request)).toMatchObject({
        phase: "failed",
        monitoring: false,
    });
});

test.each(["throw", "reject"] as const)(
    "onStatus %s fails closed without raw exception or stranded work",
    async (mode) => {
        const instance = watcher({
            onStatus: () => {
                if (mode === "throw") throw new Error("SECRET");
                return Promise.reject(new Error("SECRET"));
            },
        });
        await expect(instance.watch(request)).rejects.toThrow(
            "reporting failed",
        );
        expect(await saved()).toBeUndefined();
        expect(instance.getStatus(request)).toMatchObject({
            phase: "failed",
            reportingFailed: true,
            failure: { stage: "reporting" },
        });
        expect(JSON.stringify(instance.getStatus(request))).not.toContain(
            "SECRET",
        );
        await instance.stop();
    },
);

test("status callback failure while reporting delivery preserves original failure", async () => {
    await append(message("bad"));
    const instance = watcher({
        approvedUpdateDestination: () => {
            throw new Error("PRIVATE delivery");
        },
        onStatus: (_request, status) => {
            if (status.failure) throw new Error("PRIVATE callback");
        },
    });
    await expect(instance.watch(request)).rejects.toThrow("delivery failed");
    expect(instance.getStatus(request)).toMatchObject({
        phase: "failed",
        reportingFailed: true,
        failure: { stage: "delivery" },
    });
    await instance.stop();
});

test("absent transcript/parents establish explicit waiting then reconcile new source", async () => {
    request.transcriptPath = path.join(
        directory,
        "not-yet",
        "session",
        "events.jsonl",
    );
    const instance = watcher();
    await instance.watch(request);
    expect(instance.getStatus(request)).toMatchObject({
        phase: "waiting",
        monitoring: true,
    });
    expect(await saved()).toBeUndefined();
    await fs.mkdir(path.dirname(request.transcriptPath), { recursive: true });
    await append(message("created"));
    await until(() => expect(events()).toHaveLength(1));
    expect(instance.getStatus(request)?.failure).toBeUndefined();
});

test("recreated parent is recovered by stat reconciliation even if its old watch is detached", async () => {
    const parent = path.join(directory, "parent");
    await fs.mkdir(parent);
    request.transcriptPath = path.join(parent, "events.jsonl");
    await append(message("old"));
    const instance = watcher();
    await instance.watch(request);
    await fs.rename(parent, path.join(directory, "old-parent"));
    await fs.mkdir(parent);
    await append(message("new"));
    await until(() => expect(events()).toHaveLength(2));
    expect(instance.getStatus(request)?.failure).toBeUndefined();
});

test("non-file and permission failures are not mistaken for waiting", async () => {
    const instance = watcher();
    const stat = jest
        .spyOn(fs, "stat")
        .mockRejectedValueOnce(
            Object.assign(new Error("PRIVATE path"), { code: "EACCES" }),
        );
    await expect(instance.watch(request)).rejects.toThrow("monitoring failed");
    expect(instance.getStatus(request)?.phase).toBe("failed");
    stat.mockRestore();
    const second = watcher();
    await expect(
        second.watch({ ...request, transcriptPath: directory }),
    ).rejects.toThrow("monitoring failed");
});

test("capture errors fail explicitly without publishing", async () => {
    await append(message("private"));
    const instance = watcher();
    jest.spyOn(instance, "captureUpdates").mockRejectedValue(
        new Error("PRIVATE capture error"),
    );
    await expect(instance.processUpdates(request)).rejects.toThrow(
        "capture failed",
    );
    expect(events()).toHaveLength(0);
    expect(await saved()).toBeUndefined();
    expect(instance.getStatus(request)).toMatchObject({
        failure: { stage: "capture", captureMayHaveAdvanced: true },
    });
});

test("status snapshots cannot mutate internal failure/cursor state", async () => {
    const instance = watcher();
    await instance.processUpdates(request);
    const status = instance.getStatus(request)!;
    status.phase = "failed";
    status.readCheckpoint!.sourceByteOffset = "100";
    expect(instance.getStatus(request)).toMatchObject({
        phase: "idle",
        readCheckpoint: { sourceByteOffset: "0" },
    });
});

test("no-argument construction still supports independent helpers and idempotent stop", async () => {
    const instance = new SessionWatcher();
    await instance.stop();
    await instance.stop();
});

test("stop awaits every source reporter even if another reporter fails", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
        release = resolve;
    });
    const second = {
        ...request,
        sessionId: "second",
        transcriptPath: path.join(directory, "second.jsonl"),
    };
    await fs.writeFile(second.transcriptPath, "");
    let entered = false;
    const instance = watcher({
        onStatus: async (identity, status) => {
            if (status.phase !== "stopped") return;
            if (identity.sessionId === request.sessionId)
                throw new Error("PRIVATE");
            entered = true;
            await blocked;
        },
    });
    await Promise.all([instance.watch(request), instance.watch(second)]);
    let settled = false;
    const stopping = instance.stop().then(
        () => {
            settled = true;
        },
        (error: unknown) => {
            settled = true;
            throw error;
        },
    );
    const rejection = expect(stopping).rejects.toThrow("reporting failed");
    await until(() => expect(entered).toBe(true));
    await delay(30);
    expect(settled).toBe(false);
    release();
    await rejection;
    expect(instance.getStatus(request)).toMatchObject({
        phase: "failed",
        reportingFailed: true,
    });
    expect(instance.getStatus(second)).toMatchObject({
        phase: "stopped",
        monitoring: false,
    });
});

test.each(["restoreMetadata", "normalizeEvents", "collectMetadata"] as const)(
    "%s failure after capture reports read progress and blocks later batches",
    async (method) => {
        await append(message("one"), message("two"), message("later"));
        const instance = watcher();
        jest.spyOn(instance, method).mockImplementation(() => {
            throw new Error("PRIVATE");
        });
        await expect(instance.processUpdates(request)).rejects.toThrow(
            "failed; inspect source status",
        );
        expect(instance.getStatus(request)).toMatchObject({
            phase: "failed",
            readCheckpoint: (await saved())!.checkpoint,
            generation: (await saved())!.generation,
            failure: {
                captureMayHaveAdvanced: true,
            },
        });
        expect(events()).toHaveLength(0);
        const checkpoint = (await saved())!.checkpoint;
        await expect(instance.processUpdates(request)).rejects.toThrow(
            "failed; inspect source status",
        );
        expect((await saved())!.checkpoint).toEqual(checkpoint);
        expect(JSON.stringify(instance.getStatus(request))).not.toContain(
            "PRIVATE",
        );
    },
);

test.each([0, -1, Infinity, 1.5])(
    "invalid batch limit %s rejects before starting resources",
    (maxRecords) => {
        expect(() =>
            watcher({ capture: { stateDirectory, maxRecords } }),
        ).toThrow("lifecycle options are invalid");
    },
);

test.each([0, -1, Infinity, 2 ** 31, 1.5])(
    "invalid timer interval %s rejects before starting resources",
    (reconcileIntervalMs) => {
        expect(() => watcher({ reconcileIntervalMs })).toThrow(
            "lifecycle options are invalid",
        );
    },
);
