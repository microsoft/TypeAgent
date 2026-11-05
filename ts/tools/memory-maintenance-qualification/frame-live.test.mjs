// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    collectFramePages,
    frameScorecard,
    percentiles,
    runFrameEvaluation,
    scoreFrameRows,
    validateFrameFixture,
    validateFrameEvidence,
    validateFrameContinuation,
    frameFailure,
    frameSupplementScorecard,
    invalidateDuringLanguage,
} from "./frame-live.mjs";
import { createFrameViewProvider, frameFixture } from "./frame-fixtures.mjs";

const row = {
    ownerKey: "source:one",
    ownerRevisionId: "revision",
    itemKey: "one",
    values: { duration: 30, passed: false },
};
const expected = [
    {
        ownerKey: "source:one",
        itemKey: "one",
        values: { duration: 30, passed: false },
    },
];
const page = (rows, nextCursor, snapshot = "snapshot") => ({
    rows,
    nextCursor,
    snapshot,
    coverage: { ready: 1, pending: 0, failed: 0 },
});

test("frozen fixture has independent 30-case / 60-paraphrase inventory", () => {
    validateFrameFixture(frameFixture);
    const changed = structuredClone(frameFixture);
    changed.cases.pop();
    assert.throws(() => validateFrameFixture(changed));
});

test("authorization fails before paths, stores or model loading", async () => {
    await assert.rejects(
        runFrameEvaluation({ authorizedLiveBenchmark: false }),
        /Explicit benchmark inference authorization/,
    );
});

test("absolute paths are required before opening a run", async () => {
    await assert.rejects(
        runFrameEvaluation({
            authorizedLiveBenchmark: true,
            productRoot: ".",
            outputRoot: ".",
        }),
        /Absolute product/,
    );
});

test("exact scorer preserves false, boundaries and row identities", () => {
    scoreFrameRows(expected, [row]);
    scoreFrameRows([], []);
    assert.throws(() =>
        scoreFrameRows(expected, [{ ...row, values: { duration: 30 } }]),
    );
    assert.throws(() =>
        scoreFrameRows(expected, [
            { ...row, values: { duration: 31, passed: false } },
        ]),
    );
    assert.throws(() =>
        scoreFrameRows(expected, [{ ...row, itemKey: "other" }]),
    );
    assert.throws(() => scoreFrameRows([], [row]));
});

test("scorer rejects duplicate semantic/physical rows rather than deduplicating results", () => {
    assert.throws(
        () => scoreFrameRows([...expected, ...expected], [row, row]),
        /Duplicate row/,
    );
});

test("scorer compares arrays exactly without treating missing as empty", () => {
    scoreFrameRows(
        [{ values: { tags: ["hot", "cold"] } }],
        [{ ...row, values: { tags: ["hot", "cold"] } }],
    );
    assert.throws(() => scoreFrameRows([{ values: { tags: [] } }], [row]));
});

test("pagination drains all pages and retains the original query/scope", async () => {
    const requests = [];
    const client = {
        queryFrame: async (request) => {
            requests.push(request);
            return request.cursor
                ? page([{ ...row, itemKey: "two" }])
                : page([row], "next");
        },
    };
    const result = await collectFramePages(client, {
        query: "duration at least 30 ms",
        sourceIds: ["one"],
        limit: 1,
    });
    assert.equal(result.rows.length, 2);
    assert.deepEqual(requests[1], {
        query: "duration at least 30 ms",
        sourceIds: ["one"],
        limit: 1,
        cursor: "next",
    });
});

test("pagination rejects stale snapshots, repeated cursors, pending and failed coverage", async () => {
    let count = 0;
    await assert.rejects(
        collectFramePages(
            {
                queryFrame: async () =>
                    page([], count++ ? undefined : "next", String(count)),
            },
            {},
        ),
        /Snapshot changed/,
    );
    await assert.rejects(
        collectFramePages({ queryFrame: async () => page([], "next") }, {}),
        /Repeated pagination/,
    );
    for (const field of ["pending", "failed"]) {
        const result = page([]);
        result.coverage[field] = 1;
        await assert.rejects(
            collectFramePages({ queryFrame: async () => result }, {}),
            /projection is not a successful empty result/,
        );
    }
});

test("missing cases remain scheduled rather than becoming successful empty output", () => {
    assert.deepEqual(
        frameScorecard([
            { kind: "query", language: false, passed: true },
            { kind: "query", language: true, passed: false },
        ]),
        {
            structured: { scheduled: 30, completed: 1, passed: 1 },
            language: { scheduled: 60, completed: 1, passed: 0 },
            failures: 1,
        },
    );
});

test("question inventory evidence retains view granularity", async () => {
    const inventory = {
        ...row,
        schemaId: "question.slot",
        schemaRevision: 2,
        origin: "derived",
        granularity: "view",
        evidence: [],
        opposition: [],
    };
    await validateFrameEvidence({}, "corpus", [inventory]);
    await assert.rejects(
        validateFrameEvidence({}, "corpus", [
            { ...inventory, granularity: "section" },
        ]),
    );
});

test("percentiles report sample counts and retain outliers", () => {
    assert.deepEqual(percentiles([100, 1, 3, 2, 4]), {
        samples: 5,
        p50: 3,
        p95: 100,
        minimum: 1,
        maximum: 100,
    });
    assert.throws(() => percentiles([]));
});

test("continuation rejects incomplete, foreign, modified-gold and changed-checkpoint runs", () => {
    const parent = {
        accepted: true,
        outcome: "FRAME_PILOT_LIFECYCLE_PERFORMANCE_COMPLETED",
        receiptId: "owner",
        runDirectory: "run",
        fixtureSha256: "gold",
        checkpoint: { file: "hash" },
        corpusId: "corpus",
    };
    const owner = { receiptId: "owner", runDirectory: "run" };
    validateFrameContinuation(parent, owner, { file: "hash" }, "gold");
    for (const change of [
        { accepted: false },
        { outcome: "IN_PROGRESS" },
        { outcome: "EXECUTION_FAILED" },
        { receiptId: "foreign" },
        { runDirectory: "other" },
        { fixtureSha256: "other" },
        { checkpoint: { file: "changed" } },
    ])
        assert.throws(() =>
            validateFrameContinuation(
                { ...parent, ...change },
                owner,
                { file: "hash" },
                "gold",
            ),
        );
});

test("deterministic provider derives a real retained value and preserves opposition", async () => {
    const fixture = createFrameViewProvider(() => "hash");
    const input = {
        inputs: [
            {
                sourceId: "measurements",
                revisionId: "one",
                content: '{"items":[{"id":"m3","duration":73}]}',
            },
            {
                sourceId: "provider-qualification",
                revisionId: "two",
                content: "This is not independent performance verification.",
            },
            {
                sourceId: "scope-b",
                revisionId: "three",
                content: "Unrelated retained context.",
            },
        ],
    };
    const prepared = await fixture.installed.prepare(input);
    const content = await fixture.installed.generate(input, prepared);
    assert.equal(content.payload.items[0].duration, 73);
    assert.equal(content.evidence[0].support[0].sourceId, "measurements");
    assert.equal(
        content.evidence[0].opposition[0].sourceId,
        "provider-qualification",
    );
    fixture.revoke();
    assert.equal(await fixture.installed.authorize(), false);
    fixture.restore();
    assert.equal(await fixture.installed.authorize(), true);
    await assert.rejects(
        fixture.installed.prepare({ inputs: [] }),
        /requires numeric source/,
    );
});

test("failure diagnostics expose local validation without provider response messages", () => {
    const failure = new Error("Untrusted provider message");
    assert.equal(frameFailure(failure).serviceValidation, undefined);
    assert.equal(frameFailure(failure).productMessage, undefined);
    failure.stack =
        "Error: Local validation\n    at buildViews (file:///product/fileMemoryService.js:100:2)\n    at main (file:///product/frame-live.mjs:5:6)";
    assert.equal(frameFailure(failure).serviceValidation, failure.message);
    assert.deepEqual(frameFailure(failure).harnessFrames, [
        "frame-live.mjs:5:6",
    ]);
    assert.equal(frameFailure(null).serviceValidation, undefined);
});

test("the product directory itself cannot be the output archive", async () => {
    await assert.rejects(
        runFrameEvaluation({
            authorizedLiveBenchmark: true,
            productRoot: process.cwd(),
            outputRoot: process.cwd(),
        }),
        /outside the product tree/,
    );
});

test("supplement scores preserve failed, blocked and missing checks", () => {
    assert.deepEqual(
        frameSupplementScorecard([
            { kind: "supplement", passed: true },
            { kind: "supplement", passed: false },
            { kind: "supplement", passed: false, blocked: ["dependency"] },
            { kind: "paired-performance", passed: true },
        ]),
        {
            lifecycle: {
                scheduled: 9,
                attempted: 2,
                passed: 1,
                failed: 1,
                blocked: 1,
                missing: 6,
            },
            pairedPerformance: {
                scheduled: 3,
                attempted: 1,
                passed: 1,
                failed: 0,
                blocked: 0,
                missing: 2,
            },
        },
    );
});

test("language-race evidence requires a chat request, not just background embeddings", async () => {
    for (const type of ["embedding", "chat"]) {
        let reject;
        const state = { providerRequests: [] };
        const service = {
            queryFrame: () =>
                new Promise((_resolve, fail) => {
                    reject = fail;
                }),
        };
        const pending = invalidateDuringLanguage(
            service,
            state,
            {},
            async () => {
                state.providerRequests.push({ type });
                reject(
                    new Error(
                        "Frame provider authorization changed during the read",
                    ),
                );
            },
        );
        if (type === "chat") assert.equal((await pending).chatRequests, 1);
        else
            await assert.rejects(
                pending,
                /did not exercise a real chat request/,
            );
    }
});
