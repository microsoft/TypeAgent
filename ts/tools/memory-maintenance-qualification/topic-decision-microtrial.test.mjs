// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    main,
    replayTopicDecisionFixture,
    validateTopicDecisionFixture,
    captureTopicClusterPackets,
    captureTopicClusterCompletion,
} from "./topic-decision-microtrial.mjs";

test("private cluster capture retains exact requests/results and preserves model binding and signals", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "cluster-capture-"));
    try {
        const file = path.join(directory, "packets.jsonl");
        const signal = new AbortController().signal;
        const result = { success: false, code: "rate_limit", httpStatus: 429 };
        const model = {
            provider: "azure",
            providerSource: "factory",
            model: "offline",
            configGeneration: 1,
            checkRequest(request) {
                assert.equal(this, model);
                assert.ok(request.questions);
            },
            async decide(_request, options) {
                assert.equal(this, model);
                assert.equal(options.signal, signal);
                return result;
            },
        };
        const captured = captureTopicClusterPackets(model, file);
        const request = {
            state: {
                cluster: { phase: "publication" },
                original: "exact evidence",
            },
            questions: {},
        };
        captured.checkRequest(request);
        assert.equal(await captured.decide(request, { signal }), result);
        await captured.decide({ state: {}, questions: {} }, { signal });
        const rows = (await readFile(file, "utf8"))
            .trim()
            .split("\n")
            .map(JSON.parse);
        assert.equal(rows.length, 2);
        assert.deepEqual(rows[0].request, request);
        assert.deepEqual(rows[1].result, result);
        assert.equal(
            rows[0].serializedRequestHash,
            rows[1].serializedRequestHash,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("private generative capture preserves complete review scope and completion arguments without capturing metadata authoring", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "cluster-review-capture-"),
    );
    try {
        const file = path.join(directory, "packets.jsonl");
        const signal = new AbortController().signal;
        const schema = { name: "offline", strict: true, schema: {} };
        const payload = {
            memberKeys: ["n1"],
            state: { evidence: "Exact private grounding" },
        };
        const expected = { members: [{ key: "n1", disposition: "uncertain" }] };
        const captured = captureTopicClusterCompletion(async (...args) => {
            assert.equal(args[2], signal);
            assert.equal(args[3], "offline-review");
            assert.equal(args[5], schema);
            return expected;
        }, file);
        assert.equal(
            await captured(
                "fixed rules",
                payload,
                signal,
                "offline-review",
                undefined,
                schema,
            ),
            expected,
        );
        await captured(
            "metadata",
            { clusters: [] },
            signal,
            "offline-review",
            undefined,
            schema,
        );
        const rows = (await readFile(file, "utf8"))
            .trim()
            .split("\n")
            .map(JSON.parse);
        assert.equal(rows.length, 2);
        assert.equal(rows[0].kind, "generative-request");
        assert.deepEqual(rows[0].request, {
            instructions: "fixed rules",
            payload,
            schema,
        });
        assert.equal(rows[1].kind, "generative-result");
        assert.deepEqual(rows[1].result, expected);
        assert.equal(
            rows[0].serializedRequestHash,
            rows[1].serializedRequestHash,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

function inputs() {
    return {
        fixture: {
            workload: "historical-state-conditioned-topic-microtrial",
            preexistingCuration: {
                concepts: [{ memberIds: ["n0"] }],
                deferred: [],
            },
            selectedFocalIds: ["n1", "n2"],
            stopAfterNewNodes: 2,
        },
        snapshot: {
            nodes: ["n0", "n1", "n2", "n3"],
            occurrences: ["all original evidence"],
        },
        identity: "frozen-treatment",
        pendingIds: ["n1", "n2", "n3"],
        signal: new AbortController().signal,
        validate: () => {},
    };
}

test("conditioned replay retains full raw context and returns only a diagnostic prefix", async () => {
    const input = inputs(),
        original = structuredClone(input.snapshot);
    const result = await replayTopicDecisionFixture({
        ...input,
        curate: async (snapshot, prior, limit, _signal, receipt) => {
            assert.deepEqual(snapshot.occurrences, original.occurrences);
            assert.equal(snapshot.nodes.length, 4);
            assert.equal(limit, 2);
            receipt({
                stage: "decision",
                answers: { disposition_n0: "standalone_new" },
            });
            return {
                concepts: [...prior.concepts, { memberIds: ["n1", "n2"] }],
                deferred: [],
            };
        },
    });
    assert.equal(result.state, "diagnostic-prefix-complete");
    assert.equal(result.accuracy, null);
    assert.equal(result.nativeReadinessQualified, false);
    assert.equal(result.receipts.length, 1);
    assert.deepEqual(input.snapshot, original);
});

test("diagnostic scope counts explicit pending assignments and supports pending retries", async () => {
    const input = inputs();
    input.fixture.preexistingCuration.pending = [
        { nodeId: "n1", reason: "uncertain" },
    ];
    const result = await replayTopicDecisionFixture({
        ...input,
        curate: async () => ({
            concepts: [{ memberIds: ["n0", "n1"] }],
            deferred: [],
            pending: [{ nodeId: "n2", reason: "uncertain" }],
        }),
    });
    assert.equal(result.curation.pending.length, 1);
    assert.equal(result.semanticQualityQualified, false);
});

test("fixtures reject nonprefix, duplicate, gold-shaped and from-scratch reused scope before inference", () => {
    for (const patch of [
        { selectedFocalIds: ["n2", "n3"] },
        { selectedFocalIds: ["n1", "n1"] },
        { stopAfterNewNodes: 0 },
        { answer: "gold" },
        { workload: "frozen-extraction-from-scratch-prefix" },
    ]) {
        const input = inputs();
        assert.throws(() =>
            validateTopicDecisionFixture(
                { ...input.fixture, ...patch },
                input.snapshot,
                input.pendingIds,
            ),
        );
    }
});

test("replay rejects overshoot, missing assignments, input mutation, cancellation and model errors", async () => {
    for (const members of [
        ["n0", "n1", "n2", "n3"],
        ["n0", "n1"],
    ]) {
        await assert.rejects(
            replayTopicDecisionFixture({
                ...inputs(),
                curate: async () => ({
                    concepts: [{ memberIds: members }],
                    deferred: [],
                }),
            }),
            /assigned scope/,
        );
    }
    const changed = inputs();
    await assert.rejects(
        replayTopicDecisionFixture({
            ...changed,
            curate: async () => {
                changed.snapshot.occurrences.push("changed");
                return {
                    concepts: [{ memberIds: ["n0", "n1", "n2"] }],
                    deferred: [],
                };
            },
        }),
        /mutated/,
    );
    const controller = new AbortController();
    await assert.rejects(
        replayTopicDecisionFixture({
            ...inputs(),
            signal: controller.signal,
            curate: async () => {
                controller.abort();
                return {
                    concepts: [{ memberIds: ["n0", "n1", "n2"] }],
                    deferred: [],
                };
            },
        }),
        { name: "AbortError" },
    );
    await assert.rejects(
        replayTopicDecisionFixture({
            ...inputs(),
            curate: async () => {
                throw new Error("Native failure");
            },
        }),
        /Native failure/,
    );
});

test("CLI requires authorization before loading models or fixtures", async () => {
    await assert.rejects(main([]), /explicit authorization/);
});
