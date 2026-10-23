// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import git from "isomorphic-git";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    initialTopicNodes,
    queryTopicSnapshot,
    validateTopicSnapshot,
} from "../src/topicSnapshot.js";
import { createTopicSnapshot } from "../src/topicGeneration.js";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import { TypedViewStore } from "../src/viewStore.js";
import { ViewHistory } from "../src/viewHistory.js";
import type { TopicOccurrence, TopicSnapshot } from "../src/topicTypes.js";
import type { ViewBuildSnapshot } from "../src/viewTypes.js";

function occurrence(
    sourceId: string,
    label: string,
    revisionId = "r1",
): TopicOccurrence {
    return indexedTopicOccurrence(
        {
            sourceId,
            revisionId,
            blockOrdinal: 0,
            text: `${label} remains scoped.`,
            score: 1,
        },
        label,
        0,
    );
}
function input(
    occurrences: TopicOccurrence[],
    previous?: TopicSnapshot,
): ViewBuildSnapshot {
    const sources = [
        ...new Map(
            occurrences.map(({ sourceId, revisionId }) => [
                sourceId,
                { sourceId, revisionId },
            ]),
        ).values(),
    ];
    return {
        corpusId: "test",
        actor: "local-owner",
        definition: {
            viewId: "topics",
            kind: "wiki",
            selector: { kind: "sources", sources },
        },
        expectedVersion: previous ? 1 : 0,
        ...(previous ? { targetRevisionId: previous.generation } : {}),
        bounds: {},
        inputs: [],
        influenceSources: sources,
        pipeline: "topics-v1",
        model: "offline",
        fingerprint: randomUUID(),
        topicInput: {
            occurrences,
            indexGeneration: "index1",
            ...(previous
                ? {
                      authoredLabels: previous.nodes
                          .filter((node) => node.authorship === "human")
                          .map(({ id, label, aliases }) => ({
                              id,
                              label,
                              aliases,
                          })),
                  }
                : {}),
        },
    };
}
function snapshot(
    occurrences = [
        occurrence("orders", "key overlap"),
        occurrence("identity", "key overlap"),
        occurrence("orders", "payload compatibility"),
    ],
): TopicSnapshot {
    const value = createTopicSnapshot(input(occurrences), "offline");
    validateTopicSnapshot(value);
    return value;
}

describe("complete scoped topic snapshots", () => {
    test("same-name nominations within one original block do not prove equivalence", () => {
        const block = {
            sourceId: "source",
            revisionId: "r1",
            blockOrdinal: 0,
            text: "Two distinct keys are called resource.",
            score: 1,
        };
        const occurrences = [0, 1].map((ordinal) =>
            indexedTopicOccurrence(block, "resource", ordinal),
        );
        const value = createTopicSnapshot(input(occurrences), "offline");
        validateTopicSnapshot(value);
        expect(value.nodes).toHaveLength(2);
        expect(value.nodes[0].id).not.toBe(value.nodes[1].id);
        const replacement = [0, 1].map((ordinal) =>
            indexedTopicOccurrence(
                { ...block, revisionId: "r2" },
                "resource",
                ordinal,
            ),
        );
        expect(
            initialTopicNodes("test", replacement).map((node) => node.id),
        ).toEqual(value.nodes.map((node) => node.id));
        value.nodes[0].occurrenceIds.push(value.nodes[1].occurrenceIds[0]);
        value.nodes.splice(1, 1);
        expect(() => validateTopicSnapshot(value)).toThrow(/cannot merge/);
    });
    test("same labels in different scopes remain distinct; stable IDs survive source replacement", () => {
        const first = snapshot();
        expect(first.nodes).toHaveLength(3);
        const second = snapshot(
            first.occurrences.map((entry) => ({
                ...entry,
                revisionId: "r2",
                id: `${entry.id}:r2`,
                citations: entry.citations.map((citation) => ({
                    ...citation,
                    revisionId: "r2",
                })),
            })),
        );
        expect(second.nodes.map((entry) => entry.id)).toEqual(
            first.nodes.map((entry) => entry.id),
        );
        expect(
            second.occurrences.every((entry) => entry.revisionId === "r2"),
        ).toBe(true);
    });
    test("aliases and overlap cannot authorize concept union or incidence truncation", () => {
        const value = snapshot();
        value.nodes[0].occurrenceIds.push(value.nodes[1].occurrenceIds[0]);
        expect(() => validateTopicSnapshot(value)).toThrow(
            /distinct scoped|duplicate/,
        );
        const missing = snapshot();
        missing.nodes.pop();
        expect(() => validateTopicSnapshot(missing)).toThrow(/truncated/);
    });
    test("same labels in distinct original structural scopes are nominations, not equivalence", () => {
        const a = indexedTopicOccurrence(
            {
                sourceId: "handoff",
                revisionId: "r1",
                blockOrdinal: 0,
                text: "Identity key overlap remains open.",
                score: 1,
            },
            "overlap",
            0,
        );
        const b = indexedTopicOccurrence(
            {
                sourceId: "handoff",
                revisionId: "r1",
                blockOrdinal: 1,
                text: "Orders local payload overlap is complete; rollout is not.",
                score: 1,
            },
            "overlap",
            0,
        );
        expect(snapshot([a, b]).nodes).toHaveLength(2);
    });
    test("multi-parent DAG is organizational; related cycles are separate", () => {
        const value = snapshot();
        const [a, b, c] = value.nodes.map((entry) => entry.id);
        value.parents = [
            { parentId: a, childId: c },
            { parentId: b, childId: c },
        ];
        value.related = [
            { fromId: a, toId: b, kind: "related" },
            { fromId: b, toId: a, kind: "related" },
        ];
        expect(() => validateTopicSnapshot(value)).not.toThrow();
        value.parents.push({ parentId: c, childId: a });
        expect(() => validateTopicSnapshot(value)).toThrow(/DAG/);
    });
    test("summary citations must be original incidence, not a synopsis or unrelated source", () => {
        const value = snapshot();
        value.nodes[0].summary = "Grounded summary";
        value.nodes[0].citations = [
            {
                sourceId: "synopsis",
                revisionId: "generated",
                locator: "summary",
                excerpt: "Claim",
            },
        ];
        expect(() => validateTopicSnapshot(value)).toThrow(/unsupplied/);
    });
    test("human labels and scoped aliases remain protected; summaries stay generated", () => {
        const prior = snapshot([occurrence("orders", "review")]);
        prior.nodes[0].authorship = "human";
        prior.nodes[0].label = "Orders local review";
        prior.nodes[0].aliases = [{ label: "Payload review", scope: "orders" }];
        const revised = createTopicSnapshot(
            input([occurrence("orders", "review", "r2")], prior),
            "offline",
        );
        expect(revised.nodes[0].id).toBe(prior.nodes[0].id);
        expect(revised.nodes[0].label).toBe("Orders local review");
        expect(revised.nodes[0].aliases).toEqual(prior.nodes[0].aliases);
        expect(revised.nodes[0].authorship).toBe("human");
        expect(revised.nodes[0].summaryAuthorship).toBe("generated");
        validateTopicSnapshot(revised);
    });
    test("display bounds never truncate membership; continuations pin generation and selection", () => {
        const value = snapshot(
            Array.from({ length: 250 }, (_, index) =>
                occurrence(`source${index}`, `topic ${index}`),
            ),
        );
        const seen = new Set<string>();
        let page = queryTopicSnapshot(value, {
            corpusId: "test",
            pageSize: 17,
        });
        expect(page.totalNodes).toBe(250);
        expect(page.omittedNodes).toBe(233);
        for (;;) {
            page.nodes.forEach((node) => seen.add(node.id));
            if (!page.nextContinuationToken) break;
            page = queryTopicSnapshot(value, {
                corpusId: "test",
                pageSize: 17,
                continuationToken: page.nextContinuationToken,
            });
        }
        expect(seen.size).toBe(250);
        expect(value.occurrences).toHaveLength(250);
        const token = queryTopicSnapshot(value, {
            corpusId: "test",
            pageSize: 1,
        }).nextContinuationToken!;
        expect(() =>
            queryTopicSnapshot(
                { ...value, generation: randomUUID() },
                { corpusId: "test", pageSize: 1, continuationToken: token },
            ),
        ).toThrow(/stale/);
        expect(() =>
            queryTopicSnapshot(value, {
                corpusId: "test",
                pageSize: 2,
                continuationToken: token,
            }),
        ).toThrow(/another query/);
    });
    test("neighborhoods come from incidence, not name similarity", () => {
        const value = snapshot();
        const node = value.nodes.find(
            (entry) =>
                entry.scope === "orders" && entry.label === "key overlap",
        )!;
        const page = queryTopicSnapshot(value, {
            corpusId: "test",
            topicId: node.id,
            depth: 0,
        });
        expect(page.nodes).toHaveLength(1);
        expect(page.neighborhoods).toHaveLength(1);
        expect(page.neighborhoods[0].topicId).toBe(
            value.nodes.find(
                (entry) => entry.label === "payload compatibility",
            )!.id,
        );
    });
});

describe("topic persistence in existing view history", () => {
    test("Topic reads reuse commit byte sizes across queries, publication and restart", async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), "topic-byte-sizes-"));
        try {
            const history = new ViewHistory(
                path.join(root, "test", "views"),
                () => ({
                    views: {},
                    topics: undefined as TopicSnapshot | undefined,
                }),
            );
            const state = {
                views: {},
                topics: createTopicSnapshot(
                    input([occurrence("orders", "résumé review")]),
                    "offline",
                ),
            };
            const head = await history.commit(
                null,
                state,
                {},
                "fixture",
                "Initial",
            );
            const expectedStateBytes = Buffer.byteLength(JSON.stringify(state));
            const expectedSnapshotBytes = Buffer.byteLength(
                JSON.stringify(state.topics),
            );
            for (const store of [
                new TypedViewStore(root),
                new TypedViewStore(root),
            ]) {
                const stringify = import.meta.jest.spyOn(JSON, "stringify");
                try {
                    for (let i = 0; i < 2; i++) {
                        const page = await store.queryTopics({
                            corpusId: "test",
                        });
                        expect(page.io.stateBytes).toBe(expectedStateBytes);
                        expect(page.io.snapshotBytes).toBe(
                            expectedSnapshotBytes,
                        );
                    }
                    expect(
                        stringify.mock.calls.filter(
                            ([value]) =>
                                value &&
                                typeof value === "object" &&
                                "views" in value,
                        ),
                    ).toHaveLength(0);
                    expect(
                        stringify.mock.calls.filter(
                            ([value]) =>
                                value &&
                                typeof value === "object" &&
                                "occurrences" in value,
                        ),
                    ).toHaveLength(1);
                } finally {
                    stringify.mockRestore();
                }
            }
            const store = new TypedViewStore(root);
            await store.queryTopics({ corpusId: "test" });
            const changed = { ...state, topics: undefined };
            await history.commit(head, changed, {}, "fixture", "Clear topics");
            const page = await store.queryTopics({ corpusId: "test" });
            expect(page.io.stateBytes).toBe(
                Buffer.byteLength(JSON.stringify(changed)),
            );
            expect(page.io.snapshotBytes).toBe(4);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    let directory: string;
    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), "memory-topics-"));
    });
    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
    });
    test("existing job result commits one snapshot; restart and no-op preserve history; privacy purges influence", async () => {
        const store = new TypedViewStore(directory);
        const captured = input([
            occurrence("orders", "review"),
            occurrence("private", "routing"),
        ]);
        captured.influenceSources!.push({
            sourceId: "read-not-cited",
            revisionId: "r1",
        });
        const { job } = await store.admitViewBuild(
            {
                corpusId: "test",
                expectedHead: null,
                targets: [
                    { definition: captured.definition, expectedVersion: 0 },
                ],
            },
            [captured],
        );
        const generated = createTopicSnapshot(captured, "offline");
        await store.materializeTopicBuild("test", job.jobId, generated);
        const restored = new TypedViewStore(directory);
        const first = await restored.getTopicState("test");
        expect(first.snapshot?.generation).toBe(generated.generation);
        await restored.saveTopicFamily("test", first.family);
        expect((await restored.getTopicState("test")).head).toBe(first.head);
        const page = await restored.queryTopics({
            corpusId: "test",
            pageSize: 1,
        });
        expect(page.nodes).toHaveLength(1);
        expect(page.io.snapshotBytes).toBeGreaterThan(100);
        expect(page.io.stateBytes).toBeGreaterThan(page.io.snapshotBytes);
        const files = await readdir(directory, { recursive: true });
        const configuration = files.find((file) =>
            file.endsWith(path.join("view-history.git", "config")),
        );
        if (!configuration || !first.head)
            throw new Error("Persisted topic history is missing");
        const blob = await git.readBlob({
            fs,
            gitdir: path.dirname(path.join(directory, configuration)),
            oid: first.head,
            filepath: "state.json",
        });
        expect(page.io.stateBytes).toBe(blob.blob.byteLength);
        let historyBytes = 0;
        let historyFiles = 0;
        for (const file of files) {
            const info = await stat(path.join(directory, file));
            if (info.isFile()) {
                historyBytes += info.size;
                historyFiles++;
            }
        }
        expect(historyBytes).toBeGreaterThan(0);
        process.stdout.write(
            `P4 snapshot/history IO receipt ${JSON.stringify({ ...page.io, stateBlobBytes: blob.blob.byteLength, historyBytes, historyFiles })}\n`,
        );
        await restored.forgetSource("test", "read-not-cited");
        expect((await restored.getTopicState("test")).snapshot).toBeUndefined();
        expect(await restored.getViewBuild("test", job.jobId)).toBeUndefined();
    });
    test("late materialization cannot overwrite a newer generation", async () => {
        const store = new TypedViewStore(directory);
        const captured = input([occurrence("orders", "review")]);
        const { job } = await store.admitViewBuild(
            {
                corpusId: "test",
                expectedHead: null,
                targets: [
                    { definition: captured.definition, expectedVersion: 0 },
                ],
            },
            [captured],
        );
        await store.materializeTopicBuild(
            "test",
            job.jobId,
            createTopicSnapshot(captured, "offline"),
        );
        await expect(
            store.materializeTopicBuild(
                "test",
                job.jobId,
                createTopicSnapshot(captured, "offline"),
            ),
        ).rejects.toThrow(/generation changed/);
    });
    test("complete scoped identities do not depend on article creation", () => {
        expect(
            initialTopicNodes("test", [
                occurrence("source", "connection pool"),
                occurrence("source", "connection failure"),
            ]),
        ).toHaveLength(2);
    });
});
