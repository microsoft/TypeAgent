// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    assertChoiceRequest,
    blindReplayReview,
    compareReplayChoices,
    dispatchReplay,
    nativeShapeSchema,
    openReplayBudget,
    preflightReplayRequests,
    replayMessages,
    replayDecisionResponse,
    replaySchedule,
    replaySummary,
    selectReplayManifest,
    validateReplayAnswers,
} from "./topic-decision-interface-replay.mjs";

function request() {
    return {
        state: {
            subjects: [
                {
                    label: "Installation",
                    subjectEvidence: [
                        { sourceId: "a", revisionId: "1", locator: "turn:1" },
                    ],
                },
                {
                    label: "Installation",
                    subjectEvidence: [
                        { sourceId: "a", revisionId: "1", locator: "turn:3" },
                    ],
                },
            ],
        },
        questions: {
            q: {
                type: "choice",
                instructions: "Keep original scope.",
                criteria: { keep: "Supported", uncertain: "Unresolved" },
            },
        },
    };
}
function answers() {
    return {
        q: {
            type: "choice",
            choice: "keep",
            probabilities: { keep: 0.8, uncertain: 0.2 },
            confidence: 0.7,
        },
    };
}
function inventory() {
    return {
        records: [
            "source-usefulness",
            "owner-selection",
            "membership-validation",
            "repair-routing",
        ].flatMap((taskFamily, family) =>
            Array.from(
                { length: taskFamily === "source-usefulness" ? 5 : 12 },
                (_, ordinal) => ({
                    id: family * 100 + ordinal,
                    ordinal: ordinal % 5,
                    taskFamily,
                    requestOnlyHash: `${taskFamily}-${ordinal}`,
                    questions: 1,
                }),
            ),
        ),
    };
}

test("exact caller content and anchors survive schema/message construction without native answer leakage", () => {
    const original = request(),
        before = structuredClone(original);
    const messages = replayMessages(original);
    const schema = nativeShapeSchema(original);
    assert.deepEqual(JSON.parse(messages[1].content), original);
    assert.deepEqual(original, before);
    assert.notEqual(
        original.state.subjects[0].subjectEvidence[0].locator,
        original.state.subjects[1].subjectEvidence[0].locator,
    );
    const answerSchema = schema.schema.properties.answers.properties.q;
    assert.deepEqual(answerSchema.properties.choice.enum, [
        "keep",
        "uncertain",
    ]);
    assert.deepEqual(answerSchema.properties.probabilities.required, [
        "keep",
        "uncertain",
    ]);
    assert.deepEqual(answerSchema.required, [
        "type",
        "choice",
        "probabilities",
        "confidence",
    ]);
    assert(!messages[1].content.includes("confidence"));
    original.state = "opaque\nstate";
    assert.equal(
        JSON.parse(replayMessages(original)[1].content).state,
        original.state,
    );
});

test("native validation preserves scores without normalization or forcing argmax", () => {
    const raw = answers();
    raw.q.choice = "uncertain";
    assert.deepEqual(validateReplayAnswers(request(), { answers: raw }), raw);
    assert.equal(
        validateReplayAnswers(request(), { answers: raw }).q.confidence,
        0.7,
    );
});

test("contract rejects missing, unknown, unsupported, out-of-range and non-unit distributions", () => {
    const mutations = [
        (r) => {
            delete r.answers.q.confidence;
        },
        (r) => {
            r.answers.q.extra = true;
        },
        (r) => {
            r.answers.other = r.answers.q;
        },
        (r) => {
            delete r.answers.q;
        },
        (r) => {
            r.answers.q.type = "score";
        },
        (r) => {
            r.answers.q.choice = "invented";
        },
        (r) => {
            r.answers.q.probabilities.keep = 0.79;
        },
        (r) => {
            r.answers.q.probabilities.keep = -0.1;
        },
        (r) => {
            r.answers.q.probabilities.extra = 0;
        },
        (r) => {
            r.answers.q.confidence = 1.01;
        },
        (r) => {
            r.answers.q.probabilities = [];
        },
        (r) => {
            r.extra = true;
        },
    ];
    for (const mutate of mutations) {
        const raw = { answers: answers() };
        mutate(raw);
        assert.throws(() => validateReplayAnswers(request(), raw));
    }
    const unsupported = request();
    unsupported.questions.q.type = "noul";
    assert.throws(
        () => assertChoiceRequest(unsupported),
        /Only choice requests supported/,
    );
    assert.throws(
        () => validateReplayAnswers(request(), JSON.parse("null")),
        /Expected a JSON object/,
    );
});

test("choice-only ablation has the same messages and option sets but no fabricated native fields", () => {
    const original = request();
    assert.deepEqual(
        nativeShapeSchema(original, true).schema.properties.answers.properties
            .q,
        {
            type: "string",
            enum: ["keep", "uncertain"],
        },
    );
    assert.deepEqual(
        validateReplayAnswers(original, { answers: { q: "keep" } }, true),
        { q: "keep" },
    );
    assert.throws(
        () => validateReplayAnswers(original, { answers: { q: "bad" } }, true),
        /Unoffered choice/,
    );
});

test("seeded selection is reproducible, window-balanced and fixes 17 primary/8 repeat packets", () => {
    const source = inventory(),
        before = structuredClone(source);
    const a = selectReplayManifest(source);
    const b = selectReplayManifest({ records: [...source.records].reverse() });
    assert.deepEqual(a, b);
    assert.deepEqual(source, before);
    assert.equal(a.packets.length, 17);
    assert.equal(a.repeatIds.length, 8);
    const schedule = replaySchedule(a);
    assert.equal(schedule.length, 57);
    assert.equal(schedule.filter((r) => r.arm === "d1-fresh").length, 16);
    assert.equal(
        schedule.filter((r) => r.arm === "gpt-native-shape").length,
        33,
    );
    assert.equal(schedule.filter((r) => r.arm === "gpt-choice-only").length, 8);
    assert(schedule.every((r) => a.packets.some((p) => p.id === r.packetId)));
    const repeat = schedule.filter(
        (r) => r.packetId === a.repeatIds[0] && r.repeat > 0,
    );
    assert.notEqual(repeat[0].arm, repeat[2].arm);
});

test("blinded review contains only caller content and shuffled choices, not provider scores", () => {
    const first = answers(),
        second = answers();
    second.q.choice = "uncertain";
    const record = { id: 4, request: request() };
    const result = blindReplayReview(record, first, second);
    assert.deepEqual(result.payload.request, record.request);
    assert.deepEqual(Object.values(result.payload.proposedAnswers.q).sort(), [
        "keep",
        "uncertain",
    ]);
    const text = JSON.stringify(result.payload);
    assert(!text.includes("confidence"));
    assert(!text.includes("probabilities"));
    assert(!text.includes("provider"));
});

test("failed packets remain in attempted question coverage and recurring IDs stay packet-scoped", () => {
    const manifest = selectReplayManifest(inventory());
    const originals = manifest.packets.map((p) => ({
        id: p.id,
        request: request(),
        response: { response: { answers: answers() } },
    }));
    const [first, second] = manifest.packets;
    const results = [
        {
            id: 0,
            packetId: first.id,
            arm: "gpt-native-shape",
            repeat: 0,
            outcome: "success",
            answers: answers(),
            methodMs: 10,
        },
        {
            id: 1,
            packetId: second.id,
            arm: "gpt-native-shape",
            repeat: 0,
            outcome: "failed",
            error: "invalid JSON",
            stage: "json-parse",
            methodMs: 20,
        },
    ];
    const summary = replaySummary(manifest, originals, results);
    const row = summary.rollups.find((r) => r.name === "recorded-vs-gpt");
    assert.equal(row.attemptedQuestions, 2);
    assert.equal(row.validQuestions, 1);
    assert.equal(row.agreements, 1);
    assert.equal(
        summary.arms["gpt-native-shape"].failures[0].packetId,
        second.id,
    );
    assert.equal(
        compareReplayChoices(request(), answers(), answers())[0].agree,
        true,
    );
});

test("fresh budget charges failed calls, enforces absolute limits, locks and cannot reset/resume", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "interface-budget-"));
    let now = 1000;
    const authorization = {
        startedAt: new Date(now).toISOString(),
        absoluteDeadline: new Date(2000).toISOString(),
        maximumLogicalCalls: 2,
    };
    try {
        const budget = await openReplayBudget(root, authorization, () => now);
        await assert.rejects(
            () => openReplayBudget(root, authorization),
            /EEXIST/,
        );
        const first = await budget.reserve({ arm: "gpt" });
        await budget.finish(first, { outcome: "failed" });
        await budget.reserve({ arm: "d1" });
        await assert.rejects(
            () => budget.reserve({ arm: "gpt" }),
            /cap exhausted/,
        );
        const saved = JSON.parse(
            await readFile(path.join(root, "budget.json"), "utf8"),
        );
        assert.equal(saved.reservations.length, 2);
        assert.equal(saved.reservations[0].outcome, "failed");
        await budget.close();
        await assert.rejects(
            () => openReplayBudget(root, authorization),
            /EEXIST/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
    const expired = await mkdtemp(path.join(os.tmpdir(), "interface-expiry-"));
    try {
        const budget = await openReplayBudget(
            expired,
            authorization,
            () => now,
        );
        now = 2000;
        await assert.rejects(
            () => budget.reserve({ arm: "gpt" }),
            /authorization expired/,
        );
        assert.equal(budget.snapshot().reservations.length, 0);
        await budget.close();
    } finally {
        await rm(expired, { recursive: true, force: true });
    }
});

test("dispatch retains malformed first outputs, usage and truthful wire identity without retries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "interface-dispatch-"));
    const startedAt = new Date().toISOString();
    const authorization = {
        startedAt,
        absoluteDeadline: new Date(Date.now() + 60000).toISOString(),
        maximumLogicalCalls: 80,
    };
    const budget = await openReplayBudget(root, authorization);
    const controller = new AbortController();
    const original = request();
    let calls = 0;
    const generator = {
        async complete(messages, onUsage, schema) {
            calls++;
            assert.deepEqual(JSON.parse(messages[1].content), original);
            assert.deepEqual(schema, nativeShapeSchema(original));
            generator.completionCallback(
                { messages, response_format: { json_schema: schema } },
                { model: "actual-test-model" },
            );
            onUsage({
                prompt_tokens: 8,
                completion_tokens: 2,
                total_tokens: 10,
            });
            return { success: true, data: "{invalid" };
        },
    };
    try {
        await mkdir(path.join(root, "calls"));
        const result = await dispatchReplay(
            {
                root,
                budget,
                controller,
                signal: controller.signal,
                authorization,
                generator,
                bindings: {
                    generator: { endpointAlias: "requested-test-model" },
                },
                byId: new Map([[4, { request: original }]]),
            },
            { packetId: 4, arm: "gpt-native-shape", repeat: 0 },
        );
        assert.equal(calls, 1);
        assert.equal(result.outcome, "failed");
        assert.equal(result.stage, "json-parse");
        assert.equal(result.rawText, "{invalid");
        assert.equal(result.reportedModel, "actual-test-model");
        assert.equal(result.usage.total_tokens, 10);
        assert.equal(budget.snapshot().reservations.length, 1);
        const saved = JSON.parse(
            await readFile(path.join(root, "calls", "call-0.json"), "utf8"),
        );
        assert.deepEqual(saved.request, original);
        assert(!controller.signal.aborted);
    } finally {
        await budget.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("native and chat capacity errors fail preflight without dispatch, truncation or splitting", () => {
    const original = request(),
        before = structuredClone(original);
    const records = [{ id: 3, request: original }];
    const native = { checkRequest() {} };
    const chat = {
        inspectRequest() {
            throw new Error("Chat context capacity exceeded");
        },
        complete() {
            assert.fail("Inference forbidden in preflight");
        },
    };
    assert.throws(
        () => preflightReplayRequests(native, chat, records),
        /Chat context capacity exceeded/,
    );
    native.checkRequest = () => {
        throw new Error("Native capacity exceeded");
    };
    assert.throws(
        () => preflightReplayRequests(native, chat, records),
        /Native capacity exceeded/,
    );
    assert.deepEqual(original, before);
});

test("terminal native authentication failure is charged and aborts queued work", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "interface-auth-"));
    const authorization = {
        startedAt: new Date().toISOString(),
        absoluteDeadline: new Date(Date.now() + 60000).toISOString(),
        maximumLogicalCalls: 80,
    };
    const budget = await openReplayBudget(root, authorization);
    const controller = new AbortController();
    let calls = 0;
    const context = {
        root,
        budget,
        authorization,
        controller,
        signal: controller.signal,
        native: {
            async decide() {
                calls++;
                return {
                    success: false,
                    code: "authentication",
                    message: "Decision request failed (authentication).",
                };
            },
        },
        bindings: { native: { model: "test-native" } },
        byId: new Map([[3, { request: request() }]]),
    };
    try {
        await mkdir(path.join(root, "calls"));
        const result = await dispatchReplay(context, {
            packetId: 3,
            arm: "d1-fresh",
            repeat: 1,
        });
        assert.equal(result.outcome, "failed");
        assert.equal(result.failureCode, "authentication");
        assert(controller.signal.aborted);
        await assert.rejects(
            () =>
                dispatchReplay(context, {
                    packetId: 3,
                    arm: "d1-fresh",
                    repeat: 2,
                }),
            /authentication/,
        );
        assert.equal(calls, 1);
        assert.equal(budget.snapshot().reservations.length, 1);
        assert.equal(budget.snapshot().reservations[0].outcome, "failed");
    } finally {
        await budget.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("host response metadata identifies actual chat transport without impersonating native scores or model", () => {
    const record = {
        outcome: "success",
        arm: "gpt-native-shape",
        request: request(),
        answers: answers(),
        binding: { binding: { provider: "azure", endpointAlias: "gpt-test" } },
        reportedModel: "gpt-test-version",
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        methodMs: 123,
    };
    const result = replayDecisionResponse(record);
    assert.equal(result.requestedModel, "gpt-test");
    assert.equal(result.reportedModel, "gpt-test-version");
    assert.equal(result.provider, "azure");
    assert.deepEqual(result.answers, record.answers);
    assert.equal(result.answers.q.confidence, 0.7);
    assert.deepEqual(result.usage, record.usage);
    assert.deepEqual(result.timing, { durationMs: 123 });
    assert.throws(
        () => replayDecisionResponse({ ...record, outcome: "failed" }),
        /Failed output/,
    );
    assert.throws(
        () => replayDecisionResponse({ ...record, arm: "gpt-choice-only" }),
        /not native-shaped/,
    );
    const native = {
        answers: answers(),
        requestedModel: "test-native",
        provider: "azure",
    };
    assert.deepEqual(
        replayDecisionResponse({
            outcome: "success",
            arm: "d1-fresh",
            response: native,
        }),
        native,
    );
});
