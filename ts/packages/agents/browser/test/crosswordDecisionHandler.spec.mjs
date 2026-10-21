// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    CrosswordDecisionHandler,
    buildCrosswordDecisionRequest,
} from "../dist/agent/crosswordDecisionHandler.mjs";

function request(overrides = {}) {
    return {
        origin: { tabId: 4, frameId: 2, documentId: "document" },
        clueNumber: 1,
        clueDirection: "across",
        snapshot: {
            snapshotId: "snapshot",
            documentToken: "token",
            puzzleId: "puzzle",
            revision: 0,
            modeGeneration: 0,
            createdAt: Date.now(),
            collectorVersion: 1,
            complete: true,
            candidates: [{ id: "c1", text: "1. Clue text", context: "Across" }],
        },
        ...overrides,
    };
}

function answer(choice = "c1", noul = 0.9) {
    return {
        success: true,
        data: {
            answers: {
                target: {
                    type: "choice",
                    choice,
                    probabilities: { [choice]: 1 },
                },
                unique_fit: { type: "noul", noul },
            },
            provider: "azure",
            requestedModel: "native-decision",
        },
    };
}

function setup(decide = async () => answer(), overrides = {}) {
    let creations = 0;
    let generation = 1;
    let calls = 0;
    const telemetry = [];
    const handler = new CrosswordDecisionHandler({
        createModel: () => {
            creations++;
            return {
                success: true,
                data: {
                    provider: "azure",
                    model: "native-decision",
                    configGeneration: generation,
                    decide: (...args) => {
                        calls++;
                        return decide(...args);
                    },
                },
            };
        },
        generation: () => generation,
        now: Date.now,
        timeoutMs: 1000,
        telemetry: (event) => telemetry.push(event),
        ...overrides,
    });
    return {
        handler,
        telemetry,
        creations: () => creations,
        calls: () => calls,
        nextGeneration: () => generation++,
    };
}

test("native questions restrict targets to issued IDs and independent unique-fit evidence", () => {
    const native = buildCrosswordDecisionRequest(request());
    assert.deepEqual(Object.keys(native.questions), ["target", "unique_fit"]);
    assert.deepEqual(Object.keys(native.questions.target.criteria), [
        "c1",
        "no_fit",
        "ambiguous",
    ]);
    assert.equal(native.questions.target.type, "choice");
    assert.equal(native.questions.unique_fit.type, "noul");
    assert.match(native.questions.unique_fit.instructions, /Independently/);
    assert.equal(JSON.stringify(native).includes("selector"), false);
});

test("capability factory performs no inference and reuses model until config generation changes", async () => {
    const s = setup();
    assert.equal(s.handler.capabilities().available, true);
    s.handler.capabilities();
    assert.equal(s.calls(), 0);
    assert.equal(s.creations(), 1);
    const result = await s.handler.resolve("client", "req", request());
    assert.equal(result.status, "resolved");
    assert.equal(result.candidateId, "c1");
    assert.equal(s.creations(), 1);
    s.nextGeneration();
    assert.equal(s.handler.capabilities().configGeneration, "2");
    assert.equal(s.creations(), 2);
    assert.deepEqual(Object.keys(s.telemetry[0]).sort(), [
        "candidates",
        "durationMs",
        "status",
    ]);
    assert.equal(s.telemetry[0].status, "resolved");
});

test("rejects malformed, incomplete, oversized, duplicate and originless snapshots before inference", async () => {
    const base = request();
    const invalid = [
        undefined,
        { ...base, origin: undefined },
        { ...base, origin: { ...base.origin, frameId: -1 } },
        { ...base, clueNumber: 0 },
        { ...base, clueDirection: "sideways" },
        { ...base, questions: {} },
        { ...base, snapshot: { ...base.snapshot, complete: false } },
        { ...base, snapshot: { ...base.snapshot, collectorVersion: 2 } },
        { ...base, snapshot: { ...base.snapshot, revision: NaN } },
        { ...base, snapshot: { ...base.snapshot, candidates: [] } },
        {
            ...base,
            snapshot: {
                ...base.snapshot,
                candidates: [
                    ...base.snapshot.candidates,
                    ...base.snapshot.candidates,
                ],
            },
        },
        {
            ...base,
            snapshot: {
                ...base.snapshot,
                candidates: [
                    { ...base.snapshot.candidates[0], selector: "#unsafe" },
                ],
            },
        },
        {
            ...base,
            snapshot: {
                ...base.snapshot,
                candidates: [
                    { ...base.snapshot.candidates[0], text: "x".repeat(513) },
                ],
            },
        },
        {
            ...base,
            snapshot: {
                ...base.snapshot,
                candidates: Array.from({ length: 65 }, (_, i) => ({
                    id: `c${i}`,
                    text: "clue",
                    context: "Across",
                })),
            },
        },
        {
            ...base,
            snapshot: {
                ...base.snapshot,
                candidates: Array.from({ length: 64 }, (_, i) => ({
                    id: `c${i}`,
                    text: "😀".repeat(256),
                    context: "😀".repeat(256),
                })),
            },
        },
    ];
    for (const input of invalid) {
        const s = setup();
        assert.equal(
            (await s.handler.resolve("client", "req", input)).status,
            "unsupported",
        );
        assert.equal(s.calls(), 0);
    }
});

test("expired snapshots and backwards or changed same-revision evidence are stale", async () => {
    const s = setup();
    const input = request();
    assert.equal(
        (
            await s.handler.resolve("client", "expired", {
                ...input,
                snapshot: { ...input.snapshot, createdAt: Date.now() - 120001 },
            })
        ).status,
        "stale",
    );
    assert.equal(s.calls(), 0);
    const newer = { ...input, snapshot: { ...input.snapshot, revision: 2 } };
    assert.equal(
        (await s.handler.resolve("client", "new", newer)).status,
        "resolved",
    );
    assert.equal(
        (await s.handler.resolve("client", "old", input)).status,
        "stale",
    );
    assert.equal(
        (
            await s.handler.resolve("client", "changed", {
                ...newer,
                snapshot: { ...newer.snapshot, snapshotId: "replacement" },
            })
        ).status,
        "stale",
    );
    assert.equal(
        (
            await s.handler.resolve("client", "frame", {
                ...input,
                origin: { ...input.origin, frameId: 3 },
            })
        ).status,
        "resolved",
    );
    assert.equal(
        (await s.handler.resolve("other-client", "req", input)).status,
        "resolved",
    );
    assert.equal(
        (
            await s.handler.resolve("other-client", "reordered", {
                ...input,
                snapshot: Object.fromEntries(
                    Object.entries(input.snapshot).reverse(),
                ),
            })
        ).status,
        "resolved",
    );
});

test("semantic abstentions stay distinct from provider failures and invalid model IDs", async () => {
    for (const [native, expected] of [
        [answer("no_fit"), "no_fit"],
        [answer("ambiguous"), "ambiguous"],
        [answer("c1", 0.79), "ambiguous"],
        [answer("c1", 0.8), "resolved"],
        [answer("invented"), "provider_error"],
        [answer("c1", NaN), "provider_error"],
        [
            { success: false, message: "secret provider error" },
            "provider_error",
        ],
        [{ success: true, data: { answers: {} } }, "provider_error"],
    ]) {
        const s = setup(async () => native);
        const result = await s.handler.resolve("client", "req", request());
        assert.equal(result.status, expected);
        assert.equal("message" in result, false);
        assert.equal(
            result.candidateId,
            expected === "resolved" ? "c1" : undefined,
        );
    }
    const s = setup(async () => {
        throw new Error("secret");
    });
    assert.equal(
        (await s.handler.resolve("client", "req", request())).status,
        "provider_error",
    );
});

test("unconfigured provider reports unavailable without inference or secrets", async () => {
    const s = setup(undefined, {
        createModel: () => ({
            success: false,
            message: "secret configuration",
        }),
    });
    assert.equal(s.handler.capabilities().available, false);
    assert.equal(
        (await s.handler.resolve("client", "req", request())).status,
        "unavailable",
    );
    assert.equal(
        JSON.stringify(s.handler.capabilities()).includes("secret"),
        false,
    );
    assert.equal(s.calls(), 0);
});

test("deadline and origin-scoped cancellation discard ignored-abort provider replies", async () => {
    let complete;
    const s = setup(
        () =>
            new Promise((resolve) => {
                complete = resolve;
            }),
        { timeoutMs: 10 },
    );
    const input = request();
    const pending = s.handler.resolve("client", "req", input);
    s.handler.cancel("other", { requestId: "req", origin: input.origin });
    s.handler.cancel("client", {
        requestId: "req",
        origin: { ...input.origin, frameId: 5 },
    });
    assert.equal((await pending).status, "cancelled");
    complete(answer());
    await Promise.resolve();
    const t = setup(() => new Promise(() => {}));
    const cancelled = t.handler.resolve("client", "req", input);
    t.handler.cancel("client", { requestId: "req", origin: input.origin });
    assert.equal((await cancelled).status, "cancelled");
});

test("superseded revision, config updates and disconnect cannot authorize late results", async () => {
    let complete;
    const s = setup(
        () =>
            new Promise((resolve) => {
                complete = resolve;
            }),
    );
    const input = request();
    const old = s.handler.resolve("client", "old", input);
    const resolveOld = complete;
    const current = s.handler.resolve("client", "current", {
        ...input,
        snapshot: { ...input.snapshot, revision: 1 },
    });
    complete(answer());
    assert.equal((await current).status, "resolved");
    resolveOld(answer());
    assert.equal((await old).status, "stale");
    const update = s.handler.resolve("client", "update", {
        ...input,
        snapshot: { ...input.snapshot, revision: 1 },
    });
    s.nextGeneration();
    complete(answer());
    assert.equal((await update).status, "stale");
    const disconnected = s.handler.resolve(
        "client",
        "disconnect",
        request({
            origin: { ...input.origin, documentId: "new-document" },
        }),
    );
    s.handler.disconnect("client");
    assert.equal((await disconnected).status, "cancelled");
});

test("navigation in one frame supersedes only that frame's old document", async () => {
    let complete;
    const s = setup(
        () =>
            new Promise((resolve) => {
                complete = resolve;
            }),
    );
    const input = request();
    const old = s.handler.resolve("client", "old", input);
    const resolveOld = complete;
    const otherFrame = s.handler.resolve("client", "other-frame", {
        ...input,
        origin: { ...input.origin, frameId: 3 },
    });
    const resolveOtherFrame = complete;
    const current = s.handler.resolve("client", "current", {
        ...input,
        origin: { ...input.origin, documentId: "reloaded-document" },
    });
    complete(answer());
    assert.equal((await current).status, "resolved");
    resolveOtherFrame(answer());
    assert.equal((await otherFrame).status, "resolved");
    resolveOld(answer());
    assert.equal((await old).status, "stale");
});
