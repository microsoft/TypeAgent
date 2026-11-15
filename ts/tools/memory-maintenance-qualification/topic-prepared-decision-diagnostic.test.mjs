// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    preparedControlSchema,
    readPreparedControlAnswers,
    preparedChoices,
    matchedPreparedPackets,
    preparedWindowComparison,
    preparedDiagnosticArguments,
    runPreparedDecisionDiagnostic,
    constructPreparedTopics,
    preparedDiagnosticSummary,
    preparedConstructionSnapshot,
    preparedReviewPackets,
    refinePreparedCanonical,
} from "./topic-prepared-decision-diagnostic.mjs";
import {
    buildTopicDecisionRequest,
    TopicDecisionError,
} from "../../packages/memory/service/dist/topicDecision.js";
import { indexedTopicOccurrence } from "../../packages/memory/service/dist/topicIncidence.js";
import {
    initialTopicNodes,
    validateTopicSnapshot,
} from "../../packages/memory/service/dist/topicSnapshot.js";
import { prepareTopicDecisionGroups } from "../../packages/memory/service/dist/topicPreparedDecision.js";

function task(key = "g0", targets = ["t0", "t1"]) {
    return {
        candidate: {
            key,
            node: { id: `raw:${key}`, label: "Installation", scope: "Service" },
            complete: true,
            grounding: {
                label: "Installation",
                scope: "Service",
                evidence: [],
            },
        },
        targets: targets.map((key) => ({
            key,
            concept: { id: `concept:${key}` },
            complete: true,
            grounding: {
                label: "Installation",
                scope: "Service",
                evidence: [],
            },
        })),
        score: false,
        referenceGroup: true,
    };
}

test("refinement treatment is explicit, validated, and leaves baseline outputs unchanged", async () => {
    const curation = { concepts: [], deferred: [] };
    const result = await refinePreparedCanonical(
        undefined,
        undefined,
        curation,
        {},
    );
    assert.equal(result.curation, curation);
    assert.equal(result.outcome, "complete");
    assert.deepEqual(result.events, []);
    assert.equal(
        preparedDiagnosticArguments(["--treatment", "combined"]).treatment,
        "combined",
    );
    await assert.rejects(
        refinePreparedCanonical(undefined, undefined, curation, {
            treatment: "unknown",
        }),
        /Unknown prepared refinement treatment/,
    );
    await assert.rejects(
        runPreparedDecisionDiagnostic({
            live: true,
            deadline: "2100-01-01T00:00:00.000Z",
            treatment: "unknown",
        }),
        /Unknown prepared refinement treatment/,
    );
});

test("construction prefixes conserve occurrence membership and reset old curation before dispatch", () => {
    const occurrences = Array.from({ length: 3 }, (_, ordinal) =>
        indexedTopicOccurrence(
            {
                sourceId: `source-${ordinal}`,
                revisionId: "r1",
                blockOrdinal: 0,
                text: "Explicit installation approval is required.",
                score: 1,
            },
            "Installation approval",
            0,
        ),
    );
    const snapshot = {
        schemaVersion: 1,
        corpusId: "prefix",
        generation: "test",
        inputFingerprint: "a".repeat(64),
        recipe: "test",
        generatedAt: new Date().toISOString(),
        occurrences,
        nodes: initialTopicNodes("prefix", occurrences),
        influenceSources: occurrences.map(({ sourceId, revisionId }) => ({
            sourceId,
            revisionId,
        })),
        parents: [],
        related: [],
        limits: [],
        curationProgress: { concepts: [], deferred: [] },
    };
    const original = structuredClone(snapshot);
    const prefix = preparedConstructionSnapshot(snapshot, "1");
    assert.equal(prefix.nodes.length, 1);
    assert.equal(
        prefix.occurrences.length,
        prefix.nodes[0].occurrenceIds.length,
    );
    assert(
        prefix.occurrences.every((occurrence) =>
            prefix.nodes[0].occurrenceIds.includes(occurrence.id),
        ),
    );
    assert.equal(prefix.curationProgress, undefined);
    assert(prefix.limits.some((limit) => limit.includes("1 of 3")));
    validateTopicSnapshot(prefix);
    assert.deepEqual(snapshot, original);
    assert.equal(preparedConstructionSnapshot(snapshot).nodes.length, 3);
});

function pair(piece, native = "standalone_new", control = native) {
    const key = `disposition_${piece.candidate.key}`;
    return {
        packet: { tasks: [piece], request: buildTopicDecisionRequest([piece]) },
        native: { answers: { [key]: native } },
        control: { answers: { [key]: control } },
    };
}

test("bounded generative schema offers exactly the native criteria, without probabilities", () => {
    const request = buildTopicDecisionRequest([task()], "factored-best-fit");
    const schema = preparedControlSchema(request);
    assert.deepEqual(
        schema.schema.properties.answers.required,
        Object.keys(request.questions),
    );
    for (const [key, question] of Object.entries(request.questions))
        assert.deepEqual(
            schema.schema.properties.answers.properties[key].enum,
            Object.keys(question.criteria),
        );
    assert(!JSON.stringify(schema).includes("confidence"));
    assert(!JSON.stringify(schema).includes("probabilities"));
});

test("control parser preserves valid siblings but reports missing, invalid and extra questions", () => {
    const request = buildTopicDecisionRequest([task(), task("g1")]);
    const parsed = readPreparedControlAnswers(request, {
        answers: {
            disposition_g0: "t0",
            disposition_g1: "unoffered",
            extra: "t1",
        },
    });
    assert.deepEqual(parsed.answers, { disposition_g0: "t0" });
    assert.equal(parsed.errors.length, 2);
    assert.equal(readPreparedControlAnswers(request, null).errors.length, 2);
});

test("all nominated targets and all effective partitions must be answered", () => {
    const original = task();
    const subset = { ...original, targets: [original.targets[0]] };
    const selected = preparedChoices(
        [original],
        [pair(subset, "t0")],
        "native",
    );
    assert.equal(selected.rows[0].completeExposure, false);
    assert.equal(selected.choices.get("g0"), "uncertain_needs_synthesis");
    const missing = pair({ ...original, targets: [original.targets[1]] });
    missing.native.answers = {};
    assert.equal(
        preparedChoices([original], [pair(subset, "t0"), missing], "native")
            .rows[0].completeExposure,
        false,
    );
});

test("complete target plus standalone votes preserve native partition semantics", () => {
    const original = task();
    const pairs = [
        pair({ ...original, targets: [original.targets[0]] }, "t0"),
        pair({ ...original, targets: [original.targets[1]] }),
    ];
    assert.equal(
        preparedChoices([original], pairs, "native").choices.get("g0"),
        "t0",
    );
    pairs[1].native.answers.disposition_g0 = "t1";
    const conflict = preparedChoices([original], pairs, "native");
    assert.equal(conflict.choices.get("g0"), "uncertain_needs_synthesis");
    assert.equal(conflict.rows[0].conflict, true);
});

test("unoffered selections cannot be installed and incomplete grounding remains uncertain", () => {
    const original = task();
    assert.throws(
        () => preparedChoices([original], [pair(original, "alien")], "native"),
        /unoffered/,
    );
    original.candidate.complete = false;
    assert.equal(
        preparedChoices(
            [original],
            [pair(original, "t0")],
            "native",
        ).choices.get("g0"),
        "uncertain_needs_synthesis",
    );
});

test("matched controls receive the exact native effective request and partition options", async () => {
    const original = task();
    const nativeRequests = [];
    const controlRequests = [];
    const native = { provider: "azure", model: "decision-1" };
    const result = await matchedPreparedPackets(
        [original],
        native,
        async (_rules, request, schema) => {
            controlRequests.push(structuredClone(request));
            assert.deepEqual(schema, preparedControlSchema(request));
            return { answers: { disposition_g0: "t0" } };
        },
        new AbortController().signal,
        {
            native: async (packet) => {
                nativeRequests.push(structuredClone(packet.request));
                return { answers: { disposition_g0: "t0" } };
            },
        },
    );
    assert.deepEqual(nativeRequests, controlRequests);
    assert.equal(result.pairs.length, 1);
    assert.equal(result.repacked, false);
});

test("one 422 recovery preserves the final matched options and records the failed attempt separately", async () => {
    let attempts = 0;
    const requests = [];
    const result = await matchedPreparedPackets(
        [task()],
        { provider: "azure", model: "decision-1" },
        async (_rules, request) => {
            requests.push(request);
            return { answers: { disposition_g0: "standalone_new" } };
        },
        new AbortController().signal,
        {
            native: async (packet) => {
                if (++attempts === 1)
                    throw new TopicDecisionError({
                        success: false,
                        code: "invalid_request",
                        httpStatus: 422,
                        message: "bounded failure",
                        errorCategory: "validation",
                        retryable: false,
                    });
                return {
                    answers: { disposition_g0: "standalone_new" },
                    request: packet.request,
                };
            },
        },
    );
    assert.equal(attempts, 2);
    assert.equal(result.repacked, true);
    assert.equal(result.pairs[0].tokenLimit, 16384);
    assert.deepEqual(requests[0], result.pairs[0].packet.request);
});

test("parallel native windows drain the original wave before one complete frozen repack", async () => {
    const tasks = Array.from({ length: 65 }, (_, index) =>
        task(`g${index}`, []),
    );
    let active = 0,
        maximum = 0,
        attempts = 0;
    let release;
    const together = new Promise((resolve) => {
        release = resolve;
    });
    const attempted = [];
    const result = await matchedPreparedPackets(
        tasks,
        { provider: "azure", model: "decision-1" },
        async () => {
            throw new Error("Unexpected control dispatch");
        },
        new AbortController().signal,
        {
            arm: "native",
            concurrency: 2,
            native: async (packet) => {
                const ordinal = attempts++;
                active++;
                maximum = Math.max(maximum, active);
                if (active === 2) release();
                await together;
                active--;
                if (ordinal === 0)
                    throw new TopicDecisionError({
                        success: false,
                        code: "invalid_request",
                        httpStatus: 422,
                        message: "bounded failure",
                        errorCategory: "validation",
                        retryable: false,
                    });
                return {
                    answers: Object.fromEntries(
                        Object.keys(packet.request.questions).map((key) => [
                            key,
                            "standalone_new",
                        ]),
                    ),
                };
            },
            onPair: async (pair) => attempted.push(pair),
        },
    );
    assert.equal(maximum, 2);
    assert.equal(active, 0);
    assert.equal(attempts, result.plannedPackets + result.pairs.length);
    assert.equal(result.repacked, true);
    assert(result.pairs.length >= 2);
    assert.equal(attempted.length, attempts - 1);
    assert(result.pairs.every((pair) => pair.tokenLimit === 16384));
    assert(
        preparedChoices(tasks, result.pairs, "native").rows.every(
            (row) => row.completeExposure,
        ),
    );
});

test("semantic review bounds concurrency and preserves packet order", async () => {
    const packets = [task("g0"), task("g1"), task("g2")].map((value) => ({
        tasks: [value],
        request: buildTopicDecisionRequest([value]),
    }));
    let active = 0,
        maximum = 0;
    const result = await preparedReviewPackets(
        packets,
        "native",
        async () => {
            throw new Error("Unexpected control");
        },
        new AbortController().signal,
        async (packet) => {
            active++;
            maximum = Math.max(maximum, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active--;
            const key = Object.keys(packet.request.questions)[0];
            return { answers: { [key]: "standalone_new" } };
        },
        2,
    );
    assert.equal(maximum, 2);
    assert.equal(active, 0);
    assert.deepEqual(
        result.map((answer) => Object.keys(answer)[0]),
        ["disposition_g0", "disposition_g1", "disposition_g2"],
    );
});

test("semantic control review rejects missing answers after draining sibling work", async () => {
    const packets = [task("g0"), task("g1")].map((value) => ({
        tasks: [value],
        request: buildTopicDecisionRequest([value]),
    }));
    let completed = 0;
    await assert.rejects(
        preparedReviewPackets(
            packets,
            "control",
            async (_rules, request) => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                completed++;
                const key = Object.keys(request.questions)[0];
                return {
                    answers: key.endsWith("g0")
                        ? {}
                        : { [key]: "standalone_new" },
                };
            },
            new AbortController().signal,
            async () => {
                throw new Error("Unexpected native");
            },
            2,
        ),
        /requires every bounded answer/,
    );
    assert.equal(completed, 2);
});

test("permanent failures leave answers missing instead of creating successful defaults", async () => {
    const result = await matchedPreparedPackets(
        [task()],
        { provider: "azure", model: "decision-1" },
        async () => ({ answers: { disposition_g0: "standalone_new" } }),
        new AbortController().signal,
        {
            native: async () => {
                throw new Error("Permanent native failure");
            },
        },
    );
    assert.equal(
        preparedChoices([task()], result.pairs, "native").rows[0]
            .completeExposure,
        false,
    );
    assert.equal(
        preparedChoices([task()], result.pairs, "control").rows[0]
            .completeExposure,
        true,
    );
});

test("expired authorization and missing explicit live consent dispatch no inference", async () => {
    await assert.rejects(runPreparedDecisionDiagnostic({}), /Explicit --live/);
    await assert.rejects(
        runPreparedDecisionDiagnostic({
            live: true,
            deadline: "2020-01-01T00:00:00Z",
        }),
        /deadline/,
    );
    const directory = await mkdtemp(path.join(os.tmpdir(), "topic-prepared-"));
    try {
        await mkdir(path.join(directory, "input"));
        await assert.rejects(
            runPreparedDecisionDiagnostic({
                live: true,
                deadline: new Date(Date.now() + 60000).toISOString(),
                output: path.join(directory, "case"),
                snapshot: path.join(directory, "input", "missing.json"),
                prepared: path.join(directory, "input", "windows.json"),
            }),
            /ENOENT/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("comparison keeps every original raw and reports failed canonical outputs as unresolved", () => {
    const original = task();
    const selected = preparedChoices([original], [pair(original)], "native");
    const comparison = preparedWindowComparison(
        {
            curation: {
                concepts: [{ memberIds: ["r0"] }],
                deferred: [{ nodeId: "r1" }],
            },
        },
        [{ task: original, memberIds: ["r0", "r1"] }],
        selected,
        selected,
        undefined,
        { concepts: [{ memberIds: ["r0", "r1"] }], deferred: [] },
    );
    assert.equal(comparison[0].rawAssignments.length, 2);
    assert(
        comparison[0].rawAssignments.every(
            (row) => row.native === "unresolved",
        ),
    );
    assert.equal(comparison[0].rawAssignments[1].g0, "defer");
});

test("runner has no hidden logical-call cap and rejects unknown CLI switches", () => {
    const values = preparedDiagnosticArguments([
        "--live",
        "--deadline",
        "2026-11-14T08:39:40.285Z",
    ]);
    assert.equal(values.live, true);
    assert(!Object.hasOwn(values, "max-calls"));
    assert.throws(
        () => preparedDiagnosticArguments(["--max-calls", "60"]),
        /Unknown option/,
    );
});

test("full construction uses its own frozen preparations and serial validated priors without control-call overhead", async () => {
    const occurrences = Array.from({ length: 60 }, (_, ordinal) =>
        indexedTopicOccurrence(
            {
                sourceId: `source-${ordinal}`,
                revisionId: "r1",
                blockOrdinal: 0,
                text: "Installation requires explicit approval.",
                score: 1,
            },
            "Installation approval",
            0,
        ),
    );
    const snapshot = {
        schemaVersion: 1,
        corpusId: "construction",
        generation: "test",
        inputFingerprint: "a".repeat(64),
        recipe: "test",
        generatedAt: new Date().toISOString(),
        occurrences,
        nodes: initialTopicNodes("construction", occurrences),
        influenceSources: [],
        parents: [],
        related: [],
        limits: [],
    };
    const original = structuredClone(snapshot);
    const commits = [];
    let controlCalls = 0;
    const complete = async (_rules, payload) => {
        if (payload.questions) {
            controlCalls++;
            return {
                answers: Object.fromEntries(
                    Object.keys(payload.questions).map((key) => [
                        key,
                        "standalone_new",
                    ]),
                ),
            };
        }
        return {
            concepts: payload.nodes.map((node) => ({
                label: node.label,
                scope: node.scope,
                purpose: "Explain installation approval.",
                memberIds: [node.id],
                evidenceIds: node.evidenceIds,
                salience: 5,
            })),
            deferred: [],
        };
    };
    const result = await constructPreparedTopics(
        snapshot,
        complete,
        { provider: "azure", model: "decision-1" },
        new AbortController().signal,
        {
            arm: "native",
            native: async (packet) => ({
                answers: Object.fromEntries(
                    Object.keys(packet.request.questions).map((key) => [
                        key,
                        "standalone_new",
                    ]),
                ),
            }),
            onCommit: async (curation) =>
                commits.push(structuredClone(curation)),
        },
    );
    assert.equal(controlCalls, 0);
    assert.equal(
        result.curation.concepts.flatMap((concept) => concept.memberIds).length,
        60,
    );
    assert.equal(result.windows.length, 2);
    assert(result.windows[1].window.current.concepts.length > 0);
    assert.equal(commits.length, 2);
    assert.deepEqual(snapshot, original);
});

test("control-only construction packets never dispatch the native provider", async () => {
    let nativeCalls = 0;
    const result = await matchedPreparedPackets(
        [task()],
        { provider: "azure", model: "decision-1" },
        async () => ({ answers: { disposition_g0: "standalone_new" } }),
        new AbortController().signal,
        {
            arm: "control",
            native: async () => {
                nativeCalls++;
            },
        },
    );
    assert.equal(nativeCalls, 0);
    assert.equal(
        preparedChoices([task()], result.pairs, "control").choices.get("g0"),
        "standalone_new",
    );
});

test("one oversized group does not prevent independent groups from being classified", async () => {
    const oversized = task("g0", []);
    oversized.candidate.grounding.extra = "Installation approval. ".repeat(
        20000,
    );
    const other = task("g1", []);
    const result = await matchedPreparedPackets(
        [oversized, other],
        { provider: "azure", model: "decision-1" },
        async () => ({ answers: { disposition_g1: "standalone_new" } }),
        new AbortController().signal,
        {
            native: async () => ({
                answers: { disposition_g1: "standalone_new" },
            }),
        },
    );
    assert.equal(result.capacityFailures.length, 1);
    const selected = preparedChoices(
        [oversized, other],
        result.pairs,
        "native",
    );
    assert.equal(selected.rows.length, 2);
    assert.equal(selected.rows[0].completeExposure, false);
    assert.equal(selected.rows[1].completeExposure, true);
});

test("counterbalanced order changes dispatch order but not the semantic packets", async () => {
    const order = [];
    await matchedPreparedPackets(
        [task()],
        { provider: "azure", model: "decision-1" },
        async () => {
            order.push("control");
            return { answers: { disposition_g0: "standalone_new" } };
        },
        new AbortController().signal,
        {
            controlFirst: true,
            native: async () => {
                order.push("native");
                return { answers: { disposition_g0: "standalone_new" } };
            },
        },
    );

    test("unresolved current or prepared assignments cannot be silently omitted", () => {
        const pending = { concepts: [], deferred: [], pending: [{}] };
        const resolved = { concepts: [], deferred: [] };
        assert.throws(
            () =>
                prepareTopicDecisionGroups(
                    {},
                    { current: pending, prepared: [] },
                ),
            /resolved priors/,
        );
        assert.throws(
            () =>
                prepareTopicDecisionGroups(
                    {},
                    { current: resolved, prepared: [pending] },
                ),
            /resolved priors/,
        );
    });

    test("interruption retains the complete expected denominator without successful-looking missing rows", () => {
        const windows = [
            {
                prepared: [
                    {
                        concepts: [{ memberIds: ["r0", "r1"] }],
                        deferred: [{ nodeId: "r2" }],
                    },
                ],
            },
        ];
        const summary = preparedDiagnosticSummary(windows, 1, [], {
            native: [{ outcome: "failed" }],
            control: [],
            nativeFallback: [],
            controlFallback: [],
        });
        assert.equal(summary.outcome, "partial-or-failed");
        assert.equal(summary.expectedGroups, 2);
        assert.equal(summary.expectedRaws, 3);
        assert.equal(summary.unobservedGroups, 2);
        assert.equal(summary.unobservedRaws, 3);
        assert.equal(summary.nativeFailures, 1);
    });
    assert.deepEqual(order, ["control", "native"]);
});
