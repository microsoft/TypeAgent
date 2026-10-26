// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    targetCandidates,
    discoveryRegions,
} from "./crosswordDecisionEvidence.fixture.mjs";
import { CrosswordDecisionHandler } from "../dist/agent/crosswordDecisionHandler.mjs";
import {
    CROSSWORD_DECISION_LIMITS as limits,
    parseCrosswordClueIdentity,
} from "@typeagent/browser-control-rpc/crosswordDecisionTypes";

function request(count = 3) {
    return {
        strategy: "hybrid2",
        origin: { tabId: 1, frameId: 0, documentId: "document" },
        clueNumber: 1,
        clueDirection: "across",
        snapshot: {
            snapshotId: "snapshot",
            documentToken: "token",
            puzzleId: "puzzle",
            revision: 0,
            modeGeneration: 0,
            createdAt: Date.now(),
            collectorVersion: limits.collectorVersion,
            complete: true,
            candidates: [
                {
                    id: "a",
                    text: "1 First Across clue",
                    context: "Across",
                    regionId: "across",
                    scopeId: "puzzle",
                },
                {
                    id: "b",
                    text: "1 First Down clue",
                    context: "Down",
                    regionId: "down",
                    scopeId: "puzzle",
                },
                {
                    id: "c",
                    text: "2 Second Across clue",
                    context: "Across",
                    regionId: "across",
                    scopeId: "puzzle",
                },
                ...Array.from({ length: Math.max(0, count - 3) }, (_, i) => ({
                    id: `news${i}`,
                    text: `Publisher news paragraph ${i}`,
                    context: "",
                    regionId: "news",
                    scopeId: "publisher",
                })),
            ],
        },
    };
}

function answer(native, choose) {
    return {
        success: true,
        data: {
            provider: "azure",
            requestedModel: "test",
            answers: Object.fromEntries(
                Object.entries(native.questions).map(([id, question]) => {
                    const choice = choose(id, question);
                    return [
                        id,
                        {
                            type: "choice",
                            choice,
                            probabilities: Object.fromEntries(
                                Object.keys(question.criteria).map((key) => [
                                    key,
                                    key === choice ? 1 : 0,
                                ]),
                            ),
                        },
                    ];
                }),
            ),
        },
    };
}

function setup(options = {}) {
    let generation = 1;
    const calls = [];
    const handler = new CrosswordDecisionHandler({
        createModel: () => ({
            success: true,
            data: {
                provider: "azure",
                model: "test",
                configGeneration: generation,
                decide: async (native) => {
                    calls.push(native);
                    await options.beforeAnswer?.(native);
                    return answer(native, (id, question) => {
                        assert.notEqual(id, "verification");
                        if (id === "target")
                            return (
                                options.target?.(native) ??
                                targetCandidates(native).find((candidate) => {
                                    const identity = parseCrosswordClueIdentity(
                                        candidate.text,
                                        candidate.context,
                                    );
                                    return (
                                        identity.number ===
                                            native.state.clueNumber &&
                                        identity.direction ===
                                            native.state.clueDirection
                                    );
                                })?.id ??
                                "no_fit"
                            );
                        const region = discoveryRegions(native).find(
                            (region) => region.id === id,
                        );
                        return (
                            options.classification?.(region) ??
                            (region.candidates.some(
                                (candidate) => candidate.context,
                            )
                                ? "clues"
                                : "other")
                        );
                    });
                },
            },
        }),
        generation: () => generation,
        now: () => options.now?.() ?? Date.now(),
        timeoutMs: 1000,
        telemetry: () => {},
    });
    return { handler, calls, nextGeneration: () => generation++ };
}

test("Hybrid2 discovers even a small page once, then resolves different clues within cached regions", async () => {
    const s = setup();
    const params = request();
    assert.equal(
        (await s.handler.resolve("client", "1", params)).status,
        "resolved",
    );
    assert.equal(s.calls.length, 2);
    assert.equal(
        (
            await s.handler.resolve("client", "2", {
                ...params,
                clueDirection: "down",
            })
        ).status,
        "resolved",
    );
    assert.equal(s.calls.length, 3);
    assert.equal(
        (await s.handler.resolve("client", "3", { ...params, clueNumber: 2 }))
            .status,
        "resolved",
    );
    assert.equal(s.calls.length, 4);
    assert.equal(s.calls.filter((call) => !call.questions.target).length, 1);
    for (const call of s.calls.filter((call) => call.questions.target))
        assert.deepEqual(
            targetCandidates(call).map((candidate) => candidate.id),
            ["a", "b", "c"],
        );
});

test("baseline Hybrid still skips discovery for small catalogs and does not consume Hybrid2 cache", async () => {
    for (const [count, expected] of [
        [3, 1],
        [144, 1],
        [limits.decisionCandidates + 1, 2],
    ]) {
        const s = setup();
        const params = request(count);
        await s.handler.resolve("client", "first", params);
        const before = s.calls.length;
        assert.equal(
            (
                await s.handler.resolve("client", "second", {
                    ...params,
                    strategy: "hybrid",
                    clueDirection: "down",
                })
            ).status,
            "resolved",
        );
        assert.equal(s.calls.length - before, expected);
    }
});

test("Hybrid2 large-page cached target requests exclude news and preserve honest absence", async () => {
    const s = setup();
    const params = request(144);
    await s.handler.resolve("client", "1", params);
    assert.equal(s.calls.length, 2);
    await s.handler.resolve("client", "2", {
        ...params,
        clueDirection: "down",
    });
    assert.equal(s.calls.length, 3);
    assert.equal(
        (
            await s.handler.resolve("client", "3", {
                ...params,
                clueNumber: 9999,
            })
        ).status,
        "unsupported",
    );
    assert.ok(!JSON.stringify(s.calls.at(-1)).includes("Publisher news"));
});

test("generation, revision, mode, document, client and disconnect changes cannot reuse discovery", async () => {
    const changes = [
        (s, p) => {
            s.nextGeneration();
            return p;
        },
        (_s, p) => ({
            ...p,
            snapshot: { ...p.snapshot, revision: 1, snapshotId: "new" },
        }),
        (_s, p) => ({
            ...p,
            snapshot: { ...p.snapshot, modeGeneration: 1, snapshotId: "new" },
        }),
        (_s, p) => ({ ...p, origin: { ...p.origin, documentId: "new" } }),
        (s, p) => {
            s.handler.disconnect("client");
            return p;
        },
    ];
    for (const change of changes) {
        const s = setup();
        const params = request();
        await s.handler.resolve("client", "1", params);
        assert.equal(
            (await s.handler.resolve("client", "2", change(s, params))).status,
            "resolved",
        );
        assert.equal(s.calls.length, 4);
    }
    const s = setup();
    const params = request();
    await s.handler.resolve("client", "1", params);
    await s.handler.resolve("other-client", "2", params);
    assert.equal(s.calls.length, 4);
});

test("model ambiguity does not publish a region cache", async () => {
    let ambiguous = true;
    const s = setup({ target: () => (ambiguous ? "ambiguous" : undefined) });
    const params = request();
    assert.equal(
        (await s.handler.resolve("client", "1", params)).status,
        "ambiguous",
    );
    ambiguous = false;
    assert.equal(
        (await s.handler.resolve("client", "2", params)).status,
        "resolved",
    );
    assert.equal(s.calls.length, 4);
});

test("the model controls region exclusion without a parser-based override", async () => {
    const s = setup({
        classification: (region) =>
            region.candidates.some((candidate) => candidate.id === "a")
                ? "clues"
                : "other",
    });
    const params = request(144);
    assert.equal(
        (await s.handler.resolve("client", "1", params)).status,
        "resolved",
    );
    assert.equal(
        (
            await s.handler.resolve("client", "2", {
                ...params,
                clueDirection: "down",
            })
        ).status,
        "unsupported",
    );
    assert.equal(s.calls.length, 3);
});

test("cancellation after discovery cannot publish a late region selection", async () => {
    let started;
    const ready = new Promise((resolve) => {
        started = resolve;
    });
    let release;
    const held = new Promise((resolve) => {
        release = resolve;
    });
    let block = true;
    const s = setup({
        beforeAnswer: async (native) => {
            if (native.questions.target && block) {
                started();
                await held;
            }
        },
    });
    const params = request();
    const pending = s.handler.resolve("client", "1", params);
    await ready;
    s.handler.cancel("client", { requestId: "1", origin: params.origin });
    assert.equal((await pending).status, "cancelled");
    block = false;
    release();
    assert.equal(
        (await s.handler.resolve("client", "2", params)).status,
        "resolved",
    );
    assert.equal(s.calls.length, 4);
});

test("a changed catalog is rediscovered and its competing clues are decided by the model", async () => {
    const s = setup({
        target: (native) =>
            targetCandidates(native).some(
                (candidate) => candidate.id === "rival",
            )
                ? "ambiguous"
                : undefined,
    });
    const params = request(144);
    await s.handler.resolve("client", "1", params);
    const changed = structuredClone(params);
    changed.snapshot.revision++;
    changed.snapshot.snapshotId = "changed";
    changed.snapshot.candidates.push({
        ...changed.snapshot.candidates[1],
        id: "rival",
        regionId: "news",
        scopeId: "other-puzzle",
    });
    const result = await s.handler.resolve("client", "2", {
        ...changed,
        clueDirection: "down",
    });
    assert.equal(result.status, "ambiguous");
    assert.ok(s.calls.length > 3);
    assert.equal(s.calls.filter((call) => !call.questions.target).length, 2);
});

test("Hybrid2 passes grid numbers, partial labels and every retained clue to the model without a host identity veto", async () => {
    const s = setup({ classification: () => "uncertain" });
    const params = request();
    params.snapshot.candidates.push({
        id: "grid",
        text: "1",
        context: "",
        regionId: "grid",
        scopeId: "puzzle",
    });
    assert.equal(
        (await s.handler.resolve("client", "first", params)).status,
        "resolved",
    );
    assert.equal(
        (
            await s.handler.resolve("client", "next", {
                ...params,
                clueDirection: "down",
            })
        ).candidateId,
        "b",
    );
    const targets = s.calls.filter((call) => call.questions.target);
    assert.equal(targets.length, 2);
    for (const call of targets)
        assert.deepEqual(
            targetCandidates(call).map((candidate) => candidate.id),
            ["a", "b", "c", "grid"],
        );
    assert.equal(s.calls.filter((call) => !call.questions.target).length, 1);
});

test("model selection can accept identities the host parser cannot recognize", async () => {
    const s = setup({
        target: (native) => (native.state.clueNumber === 1 ? "a" : "c"),
    });
    const params = request();
    params.snapshot.candidates[0].text = "One. First clue";
    params.snapshot.candidates[2].text = "Two. Second clue";
    assert.equal(
        (await s.handler.resolve("client", "one", params)).candidateId,
        "a",
    );
    assert.equal(
        (await s.handler.resolve("client", "two", { ...params, clueNumber: 2 }))
            .candidateId,
        "c",
    );
    assert.equal(s.calls.length, 3);
});

test("expired snapshots and invalid strategy cannot use cached regions", async () => {
    const params = request();
    let now = params.snapshot.createdAt;
    const s = setup({ now: () => now });
    await s.handler.resolve("client", "1", params);
    now += limits.snapshotLifetimeMs;
    assert.equal(
        (await s.handler.resolve("client", "2", params)).status,
        "stale",
    );
    assert.equal(
        (
            await s.handler.resolve("client", "3", {
                ...params,
                strategy: "invalid",
            })
        ).status,
        "unsupported",
    );
    assert.equal(s.calls.length, 2);
});
