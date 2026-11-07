// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { runWithSearchTiming } from "@typeagent/knowpro";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateTopicTarget } from "../src/topicBuilds.js";
import { ViewBuildRunner } from "../src/viewBuilds.js";
import {
    createConfiguredTopicGenerator,
    createTopicSnapshot,
} from "../src/topicGeneration.js";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import { TypedViewStore } from "../src/viewStore.js";
import type {
    ViewBuildSnapshot,
    ViewSynthesisAdapter,
} from "../src/viewTypes.js";

function input(): ViewBuildSnapshot {
    const occurrence = indexedTopicOccurrence(
        {
            sourceId: "source",
            revisionId: "r1",
            blockOrdinal: 0,
            text: "Command lifetime differs from held lease lifetime.",
            score: 1,
        },
        "held lease",
        0,
    );
    return {
        corpusId: "test",
        actor: "local-owner",
        definition: {
            viewId: "topic-snapshot",
            kind: "wiki",
            selector: {
                kind: "sources",
                sources: [{ sourceId: "source", revisionId: "r1" }],
            },
        },
        expectedVersion: 0,
        bounds: {},
        inputs: [],
        influenceSources: [{ sourceId: "source", revisionId: "r1" }],
        pipeline: "topics-v1",
        model: "offline",
        fingerprint: randomUUID(),
        topicInput: { occurrences: [occurrence] },
    };
}
function adapter(
    generateTopics: NonNullable<ViewSynthesisAdapter["generateTopics"]>,
): ViewSynthesisAdapter {
    return {
        identity: "offline",
        generateTopics,
        generate: async () => {
            throw new Error("Topic builds must not produce an article");
        },
        validate: async () => {
            throw new Error("Topic builds must not use guide inventory");
        },
    };
}

test("topic model timers retain node ordinals without logging labels or evidence", async () => {
    const originalFlag = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
    const originalWarn = console.warn;
    const logs: string[] = [];
    const captured = input();
    const generator = createConfiguredTopicGenerator({
        model: {
            completionSettings: {},
            complete: async () => ({
                success: true,
                data: JSON.stringify({
                    summary: "Recorded topic context.",
                    evidenceIds: [0],
                }),
            }),
        },
    });
    try {
        console.warn = (line: unknown) => logs.push(String(line));
        delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        const disabled = await generator(
            captured,
            new AbortController().signal,
        );
        expect(logs).toEqual([]);
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        const enabled = await runWithSearchTiming(
            "job-test",
            "memory.build.topics-v1",
            () => generator(captured, new AbortController().signal),
            { corpusId: "test" },
        );
        expect(enabled.nodes).toEqual(disabled.nodes);
        const entries = logs.map((line) =>
            JSON.parse(line.replace("[memory-search-timing] ", "")),
        );
        expect(
            entries.some(
                (entry) =>
                    entry.stage === "topic.summary.model" &&
                    entry.metadata.ordinal === 1,
            ),
        ).toBe(true);
        expect(
            entries.some(
                (entry) =>
                    entry.stage === "topic.snapshot.counts" &&
                    entry.metadata.nodes === 1,
            ),
        ).toBe(true);
        expect(
            entries.every(
                (entry) =>
                    entry.traceId === "job-test" &&
                    Number.isFinite(entry.elapsedMs),
            ),
        ).toBe(true);
        expect(logs.join("\n")).not.toContain("held lease");
        expect(logs.join("\n")).not.toContain("Command lifetime differs");
    } finally {
        console.warn = originalWarn;
        if (originalFlag === undefined)
            delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = originalFlag;
    }
});

test("topic generation cannot truncate captured membership or read-but-not-cited influence", async () => {
    const captured = input();
    await expect(
        generateTopicTarget(
            adapter(async (input) => {
                const value = createTopicSnapshot(input, "offline");
                value.influenceSources.push({
                    sourceId: "unknown",
                    revisionId: "r1",
                });
                return value;
            }),
            captured,
            new AbortController().signal,
        ),
    ).rejects.toThrow(/captured incidence or influence/);
    await expect(
        generateTopicTarget(
            adapter(async (input) => {
                const value = createTopicSnapshot(input, "offline");
                value.occurrences = [];
                value.nodes = [];
                return value;
            }),
            captured,
            new AbortController().signal,
        ),
    ).rejects.toThrow(/captured incidence or influence/);
});

test("topic generation abort prevents late write even when the injected provider ignores signal", async () => {
    const controller = new AbortController();
    await expect(
        generateTopicTarget(
            adapter(async (input) => {
                controller.abort(new Error("forgotten"));
                return createTopicSnapshot(input, "offline");
            }),
            input(),
            controller.signal,
        ),
    ).rejects.toThrow("forgotten");
});

test("agent topic writes cannot masquerade as human-protected edits", async () => {
    await expect(
        generateTopicTarget(
            adapter(async (input) => {
                const value = createTopicSnapshot(input, "offline");
                value.nodes[0].authorship = "human";
                return value;
            }),
            input(),
            new AbortController().signal,
        ),
    ).rejects.toThrow(/cannot become human-protected/);
});

test.each(["resume", "cancel", "forget", "deadline", "close"] as const)(
    "a yielded native continuation preserves checkpoint ownership and recovery: %s",
    async (action) => {
        const directory = await mkdtemp(path.join(os.tmpdir(), "topic-yield-"));
        const store = new TypedViewStore(directory);
        const captured = input();
        const shortInput: ViewBuildSnapshot = {
            ...input(),
            corpusId: "short",
            pipeline: "timeline-v1",
            definition: {
                viewId: "empty-timeline",
                kind: "timeline",
                selector: { kind: "sources", sources: [] },
            },
        };
        const admit = async (value: ViewBuildSnapshot) =>
            (
                await store.admitViewBuild(
                    {
                        corpusId: value.corpusId,
                        expectedHead: null,
                        targets: [
                            {
                                definition: value.definition,
                                expectedVersion: 0,
                            },
                        ],
                    },
                    [value],
                )
            ).job;
        const native = await admit(captured);
        const short = await admit(shortInput);
        let checkpointEntered!: () => void;
        const checkpoint = new Promise<void>((resolve) => {
            checkpointEntered = resolve;
        });
        let allowCheckpoint!: () => void;
        const checkpointGate = new Promise<void>((resolve) => {
            allowCheckpoint = resolve;
        });
        let shortEntered!: () => void;
        const entered = new Promise<void>((resolve) => {
            shortEntered = resolve;
        });
        let releaseShort!: () => void;
        const shortGate = new Promise<void>((resolve) => {
            releaseShort = resolve;
        });
        let calls = 0;
        let finalWrites = 0;
        let nativeUpdates = 0;
        let durable = "";
        let closing: Promise<void> | undefined;
        const runner = new ViewBuildRunner(
            adapter(async (value) => {
                calls++;
                return createTopicSnapshot(value, "offline");
            }),
            {
                update: async (corpus, id, update) => {
                    if (id === short.jobId) {
                        shortEntered();
                        await shortGate;
                    } else nativeUpdates++;
                    return store.updateViewBuild(corpus, id, update);
                },
                current: async () => undefined,
                materialize: async () => {
                    throw new Error("No article output");
                },
                materializeTopicIncidence: async (
                    job,
                    _result,
                    value,
                    signal,
                ) => {
                    checkpointEntered();
                    await checkpointGate;
                    signal.throwIfAborted();
                    await store.materializeTopicBuild(
                        job.corpusId,
                        job.jobId,
                        value,
                        false,
                    );
                    durable = JSON.stringify(
                        (
                            await new TypedViewStore(directory).getTopicState(
                                job.corpusId,
                            )
                        ).snapshot,
                    );
                },
                materializeTopics: async (job, _result, value, signal) => {
                    signal.throwIfAborted();
                    finalWrites++;
                    await store.materializeTopicBuild(
                        job.corpusId,
                        job.jobId,
                        value,
                    );
                },
            },
            undefined,
            undefined,
            action === "deadline" ? 2500 : undefined,
            1,
            false,
            1,
            true,
        );
        try {
            runner.start(native);
            await checkpoint;
            runner.start(short);
            allowCheckpoint();
            await entered;
            expect(calls).toBe(0);
            expect(durable).not.toBe("");
            expect(
                JSON.stringify(
                    (
                        await new TypedViewStore(directory).getTopicState(
                            native.corpusId,
                        )
                    ).snapshot,
                ),
            ).toBe(durable);
            const before = nativeUpdates;
            if (action === "resume") releaseShort();
            if (action === "cancel") runner.cancel(native.jobId);
            if (action === "forget") runner.forget(native.corpusId);
            if (action === "close") closing = runner.close();
            await runner.wait(native.jobId, AbortSignal.timeout(10000));
            const saved = (await store.listViewBuilds(native.corpusId))[0];
            if (action === "resume") {
                expect(saved.state).toBe("complete");
                expect(calls).toBe(1);
                expect(finalWrites).toBe(1);
            } else {
                expect(calls).toBe(0);
                expect(finalWrites).toBe(0);
                expect(
                    JSON.stringify(
                        (
                            await new TypedViewStore(directory).getTopicState(
                                native.corpusId,
                            )
                        ).snapshot,
                    ),
                ).toBe(durable);
                if (action === "forget") expect(nativeUpdates).toBe(before);
                else
                    expect(saved.results[0].reason).toContain(
                        action === "deadline"
                            ? "2.5 second limit"
                            : action === "close"
                              ? "Service closing"
                              : "cancellation",
                    );
            }
        } finally {
            allowCheckpoint();
            releaseShort();
            await runner.close();
            await closing;
            await rm(directory, { recursive: true, force: true });
        }
    },
);

test("existing runner jobs/results persist a complete topic snapshot without article side effects", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "topic-runner-"));
    const store = new TypedViewStore(directory);
    const captured = input();
    const { job } = await store.admitViewBuild(
        {
            corpusId: "test",
            expectedHead: null,
            targets: [{ definition: captured.definition, expectedVersion: 0 }],
        },
        [captured],
    );
    const runner = new ViewBuildRunner(
        adapter(async (input) => createTopicSnapshot(input, "offline")),
        {
            update: (corpusId, jobId, update) =>
                store.updateViewBuild(corpusId, jobId, update),
            current: async () => undefined,
            materialize: async () => {
                throw new Error("Topic builds must not create a Wiki article");
            },
            materializeTopicIncidence: async (
                job,
                _result,
                snapshot,
                signal,
            ) => {
                signal.throwIfAborted();
                await store.materializeTopicBuild(
                    job.corpusId,
                    job.jobId,
                    snapshot,
                    false,
                );
            },
            materializeTopics: async (job, _result, snapshot, signal) => {
                signal.throwIfAborted();
                await store.materializeTopicBuild(
                    job.corpusId,
                    job.jobId,
                    snapshot,
                );
            },
        },
    );
    try {
        runner.start(job);
        for (let attempt = 0; attempt < 200; attempt++) {
            const current = await store.getViewBuild("test", job.jobId);
            if (current?.state !== "running") break;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect((await store.getViewBuild("test", job.jobId))?.state).toBe(
            "complete",
        );
        expect(
            (await store.getTopicState("test")).snapshot?.occurrences,
        ).toHaveLength(1);
        expect((await store.listViews("test")).views).toHaveLength(0);
    } finally {
        await runner.close();
        await rm(directory, { recursive: true, force: true });
    }
});
