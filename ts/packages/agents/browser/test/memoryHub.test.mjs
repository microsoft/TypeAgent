// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryHubFunctions } from "../dist/agent/memoryHub.mjs";

function corpus(corpusId) {
    return {
        corpusId,
        name: `Corpus ${corpusId}`,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
        status: "ready",
        documentCount: 0,
    };
}

function candidate(corpusId, id, state = "detected") {
    return {
        corpusId,
        candidateId: id,
        state,
        title: `How-to ${id}`,
        steps: ["First", "Second"],
        citations: [{ sourceId: "source", revisionId: "revision" }],
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
    };
}

function procedure(corpusId, state = "stale") {
    return {
        corpusId,
        procedureId: "procedure",
        title: "Restart worker",
        state,
        latestVersion: 2,
        updatedAt: "2026-10-02T00:00:00Z",
    };
}

function job(corpusId, jobId, state) {
    return {
        corpusId,
        jobId,
        sourceId: "source",
        revisionId: "revision",
        state,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
        progress: { completed: 1, total: 2 },
        warnings: [],
    };
}

function source(corpusId, id) {
    return {
        corpusId,
        sourceId: id,
        title: id,
        sourceType: "markdown",
        activeRevisionId: "revision",
        revisions: [],
    };
}

function fixture(overrides = {}) {
    return {
        memoryListCorpora: async () => [corpus("b"), corpus("a")],
        memoryListProcedureCandidates: async () => [],
        memoryListProcedures: async () => [],
        memoryListJobs: async () => ({ items: [], total: 0 }),
        memoryListSources: async () => ({ items: [], total: 0 }),
        ...overrides,
    };
}

test("snapshot derives all attention kinds and deterministic corpus-qualified identities", async () => {
    const calls = [];
    const hub = createMemoryHubFunctions(
        fixture({
            memoryListProcedureCandidates: async (request) => {
                calls.push(request);
                return [candidate(request.corpusId, "same-id")];
            },
            memoryListProcedures: async ({ corpusId }) => [
                procedure(corpusId),
                { ...procedure(corpusId, "saved"), procedureId: "saved" },
            ],
            memoryListJobs: async () => ({
                items: [
                    job("b", "failed", "failed"),
                    job("a", "partial", "partial"),
                    job("a", "complete", "complete"),
                ],
                total: 3,
            }),
        }),
    );
    const result = await hub.memoryHubSnapshot({});
    assert.deepEqual(
        result.corpora.map((c) => c.corpusId),
        ["a", "b"],
    );
    assert.equal(result.inbox.length, 6);
    assert.equal(result.procedures.length, 4);
    assert.equal(new Set(result.inbox.map((item) => item.id)).size, 6);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(
        result.inbox.map((item) => item.kind),
        [
            "job",
            "job",
            "staleProcedure",
            "staleProcedure",
            "candidate",
            "candidate",
        ],
    );
    assert.equal(
        result.inbox.filter((item) => item.jobState === "failed").length,
        1,
    );
    assert.deepEqual(
        calls.map((c) => c.states),
        [
            ["detected", "draft"],
            ["detected", "draft"],
        ],
    );
});

test("failed jobs beyond the first page still appear and repeated page tokens report errors", async () => {
    const requests = [];
    const hub = createMemoryHubFunctions(
        fixture({
            memoryListJobs: async (request) => {
                requests.push(request);
                return request.continuationToken
                    ? { items: [job("a", "last", "failed")], total: 1001 }
                    : {
                          items: Array.from({ length: 1000 }, (_, index) =>
                              job("a", String(index), "complete"),
                          ),
                          total: 1001,
                          nextContinuationToken: "last",
                      };
            },
        }),
    );
    const result = await hub.memoryHubSnapshot({});
    assert.equal(result.inbox.length, 1);
    assert.equal(result.inbox[0].objectId, "last");
    assert.equal(requests.length, 2);
    assert.equal(requests[0].corpusId, undefined);

    const broken = createMemoryHubFunctions(
        fixture({
            memoryListJobs: async () => ({
                items: [],
                total: 1,
                nextContinuationToken: "same",
            }),
        }),
    );
    const partial = await broken.memoryHubSnapshot({});
    assert.match(partial.errors[0].message, /repeated page token/);
    assert.equal(partial.errors[0].operation, "jobs");
});

test("a later jobs page failure preserves known failures and marks the result incomplete", async () => {
    const hub = createMemoryHubFunctions(
        fixture({
            memoryListJobs: async ({ continuationToken }) => {
                if (continuationToken) throw new Error("Job page unavailable");
                return {
                    items: [job("a", "known-failure", "failed")],
                    total: 2,
                    nextContinuationToken: "next",
                };
            },
        }),
    );
    const result = await hub.memoryHubSnapshot({});
    assert.equal(result.inbox[0].objectId, "known-failure");
    assert.equal(result.errors[0].operation, "jobs");
    assert.equal(result.errors[0].message, "Job page unavailable");
});

test("a changed candidate keeps its identity but invalidates local dismissal", async () => {
    let state = "detected";
    const hub = createMemoryHubFunctions(
        fixture({
            memoryListProcedureCandidates: async ({ corpusId }) => [
                candidate(corpusId, "candidate", state),
            ],
        }),
    );
    const before = await hub.memoryHubSnapshot({ corpusId: "a" });
    state = "draft";
    const after = await hub.memoryHubSnapshot({ corpusId: "a" });
    assert.equal(before.inbox[0].id, after.inbox[0].id);
    assert.notEqual(before.inbox[0].fingerprint, after.inbox[0].fingerprint);
    assert.equal(after.corpora.length, 1);
});

test("partial failures remain explicit while successful corpora retain their items", async () => {
    const hub = createMemoryHubFunctions(
        fixture({
            memoryListProcedureCandidates: async ({ corpusId }) => {
                if (corpusId === "b") throw new Error("Corpus index offline");
                return [candidate(corpusId, "candidate")];
            },
            memoryListProcedures: async ({ corpusId }) => [procedure(corpusId)],
        }),
    );
    const result = await hub.memoryHubSnapshot({});
    assert.equal(result.inbox.length, 3);
    assert.deepEqual(result.errors, [
        {
            corpusId: "b",
            operation: "candidates",
            message: "Corpus index offline",
        },
    ]);
    await assert.rejects(
        hub.memoryHubSnapshot({ corpusId: "missing" }),
        /was not found/,
    );
    await assert.rejects(
        createMemoryHubFunctions(
            fixture({
                memoryListCorpora: async () => {
                    throw new Error("Service disconnected");
                },
            }),
        ).memoryHubSnapshot({}),
        /Service disconnected/,
    );
});

function sourceFixture() {
    const sources = {
        a: [source("a", "a1"), source("a", "a2"), source("a", "a3")],
        b: [source("b", "b1"), source("b", "b2")],
    };
    return fixture({
        memoryListSources: async ({
            corpusId,
            pageSize,
            continuationToken,
            query,
            sourceTypes,
        }) => {
            const filtered = sources[corpusId].filter(
                (item) =>
                    (!query || item.title.includes(query)) &&
                    (!sourceTypes || sourceTypes.includes(item.sourceType)),
            );
            const offset = Number(continuationToken ?? 0);
            const items = filtered.slice(offset, offset + pageSize);
            const next = offset + items.length;
            return {
                items,
                total: filtered.length,
                ...(next < filtered.length
                    ? { nextContinuationToken: String(next) }
                    : {}),
            };
        },
    });
}

test("all-corpus source paging crosses corpus boundaries without losing or repeating sources", async () => {
    const hub = createMemoryHubFunctions(sourceFixture());
    const ids = [];
    let continuationToken;
    do {
        const page = await hub.memoryHubSources({
            pageSize: 2,
            continuationToken,
        });
        assert.equal(page.total, 5);
        assert.equal(page.errors.length, 0);
        assert.ok(page.items.length <= 2);
        ids.push(...page.items.map((item) => item.sourceId));
        continuationToken = page.nextContinuationToken;
    } while (continuationToken);
    assert.deepEqual(ids, ["a1", "a2", "a3", "b1", "b2"]);
});

test("source cursors are scope-bound and invalid input is reported, not an empty success", async () => {
    const hub = createMemoryHubFunctions(sourceFixture());
    const first = await hub.memoryHubSources({ pageSize: 2 });
    for (const params of [
        { query: "a", continuationToken: first.nextContinuationToken },
        { corpusId: "a", continuationToken: first.nextContinuationToken },
        {
            sourceTypes: ["web"],
            continuationToken: first.nextContinuationToken,
        },
        { continuationToken: "not-a-cursor" },
        { pageSize: 0 },
        { pageSize: 1001 },
        { corpusId: "missing" },
    ]) {
        await assert.rejects(hub.memoryHubSources(params));
    }
    const filtered = await hub.memoryHubSources({ query: "b" });
    assert.equal(filtered.total, 2);
    assert.deepEqual(
        filtered.items.map((item) => item.sourceId),
        ["b1", "b2"],
    );
});

test("source listing exposes corpus failures and empty corpora correctly", async () => {
    const hub = createMemoryHubFunctions(
        fixture({
            memoryListSources: async ({ corpusId }) => {
                if (corpusId === "a") throw new Error("Sources unavailable");
                return { items: [source("b", "b1")], total: 1 };
            },
        }),
    );
    const result = await hub.memoryHubSources({});
    assert.equal(result.total, 1);
    assert.equal(result.items[0].corpusId, "b");
    assert.equal(result.errors[0].message, "Sources unavailable");
    const empty = createMemoryHubFunctions(
        fixture({ memoryListCorpora: async () => [] }),
    );
    assert.deepEqual(await empty.memoryHubSources({}), {
        items: [],
        total: 0,
        errors: [],
    });
    assert.deepEqual(await empty.memoryHubSnapshot({}), {
        corpora: [],
        inbox: [],
        procedures: [],
        errors: [],
    });
});
