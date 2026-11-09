// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
    createReplayTape,
    nativeReplayModel,
    generativeReplayCompletion,
} from "./replay-tape.mjs";
import {
    atomicWriteJson,
    createReplayOutput,
    curationAccounting,
    hashValue,
    readReplayProgress,
    writeReplayProgress,
} from "./replay-artifacts.mjs";
import { runDecisionReplay } from "./topic-decision-replay.mjs";
import { replayViewStorage } from "./replay-storage.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const scratch = () => mkdtemp(path.join(directory, "decision-replay-test-"));
const identity = {
    model: "synthetic",
    configGeneration: 0,
    provider: "azure",
    providerSource: "factory",
};
const request = (id = "a") => ({
    state: { source: id, chronology: "2026-01-01", role: "user" },
    questions: {
        one: { type: "choice", criteria: { yes: "same", no: "distinct" } },
    },
});
const options = (root, mode, extra = {}) => ({
    mode,
    file: path.join(root, `${mode}.json`),
    identity,
    responses: path.join(root, "record.json"),
    authorizedLive: mode === "record",
    ...extra,
});

test("native replay binds concurrent requests and duplicate occurrences, never completion ordinal", async () => {
    const root = await scratch();
    try {
        let providerCalls = 0;
        const gates = [];
        const tape = await createReplayTape(options(root, "record"));
        const model = nativeReplayModel(tape, identity, () => ({
            ...identity,
            decide: () =>
                new Promise((resolve) => {
                    providerCalls++;
                    gates.push(resolve);
                }),
        }));
        const first = model.decide(request("same"));
        const second = model.decide(request("same"));
        const third = model.decide(request("other"));
        while (gates.length < 3)
            await new Promise((resolve) => setTimeout(resolve, 5));
        gates[2]({ answer: "third" });
        gates[1]({ answer: "second" });
        gates[0]({ answer: "first" });
        assert.deepEqual(await Promise.all([first, second, third]), [
            { answer: "first" },
            { answer: "second" },
            { answer: "third" },
        ]);
        await tape.close();
        assert.equal(providerCalls, 3);
        const playback = await createReplayTape(options(root, "playback"));
        const offline = nativeReplayModel(playback, identity, () => {
            throw new Error("Provider initialized offline");
        });
        assert.deepEqual(await offline.decide(request("other")), {
            answer: "third",
        });
        assert.deepEqual(
            await Promise.all([
                offline.decide(request("same")),
                offline.decide(request("same")),
            ]),
            [{ answer: "first" }, { answer: "second" }],
        );
        assert.equal(playback.providerCalls, 0);
        await playback.close();
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("native playback refuses changed full state, question criteria/order, policy and generation", async () => {
    const root = await scratch();
    try {
        const original = request();
        const recording = await createReplayTape(options(root, "record"));
        await recording.invoke("native", { request: original }, () => ({
            success: true,
        }));
        await recording.close();
        for (const changed of [
            { ...original, state: { ...original.state, role: "assistant" } },
            {
                ...original,
                questions: {
                    one: {
                        type: "choice",
                        criteria: { no: "distinct", yes: "same" },
                    },
                },
            },
            {
                ...original,
                questions: {
                    one: {
                        type: "choice",
                        criteria: { yes: "changed", no: "distinct" },
                    },
                },
            },
        ]) {
            const tape = await createReplayTape(options(root, "playback"));
            await assert.rejects(
                tape.invoke("native", { request: changed }, () =>
                    assert.fail(),
                ),
                /does not match/,
            );
            await tape.close();
        }
        for (const changed of [
            { ...identity, configGeneration: 1 },
            { ...identity, policy: "changed" },
        ])
            await assert.rejects(
                createReplayTape(
                    options(root, "playback", { identity: changed }),
                ),
                /does not match/,
            );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("recording rejects actual native model identity mismatches before native admission or dispatch", async (t) => {
    for (const [field, value] of [
        ["provider", "copilot"],
        ["model", "different-model"],
        ["configGeneration", identity.configGeneration + 1],
    ]) {
        await t.test(field, async () => {
            const root = await scratch();
            let tape;
            try {
                const calls = { checkRequest: 0, decide: 0 };
                const actual = {
                    ...identity,
                    [field]: value,
                    checkRequest() {
                        calls.checkRequest++;
                    },
                    async decide() {
                        calls.decide++;
                        return { success: true };
                    },
                };
                tape = await createReplayTape(options(root, "record"));
                const model = nativeReplayModel(tape, identity, () => actual);
                assert.throws(
                    () => model.checkRequest(request()),
                    /Replay identity does not match/,
                );
                assert.deepEqual(calls, { checkRequest: 0, decide: 0 });
                await assert.rejects(
                    model.decide(request()),
                    /Replay identity does not match/,
                );
                assert.deepEqual(calls, { checkRequest: 0, decide: 0 });
            } finally {
                await tape?.close();
                await rm(root, { recursive: true, force: true });
            }
        });
    }
});

test("generative replay binds exact instructions, payload, schema and model wire identity", async () => {
    const root = await scratch();
    try {
        const binding = {
            model: "synthetic-chat",
            wireIdentity: { api: "chat", outputTokens: 100 },
        };
        const schema = {
            name: "test",
            strict: true,
            schema: { type: "object" },
        };
        const record = await createReplayTape(options(root, "record"));
        const complete = generativeReplayCompletion(
            record,
            binding,
            () => async () => ({ authoring: "exact" }),
        );
        assert.deepEqual(
            await complete(
                "rules",
                { members: ["a", "b"] },
                record.signal,
                "authoring",
                undefined,
                schema,
            ),
            { authoring: "exact" },
        );
        await record.close();
        const playback = await createReplayTape(options(root, "playback"));
        const offline = generativeReplayCompletion(playback, binding, () =>
            assert.fail("Provider initialized"),
        );
        assert.deepEqual(
            await offline(
                "rules",
                { members: ["a", "b"] },
                playback.signal,
                "maintenance",
                undefined,
                schema,
            ),
            { authoring: "exact" },
        );
        await assert.rejects(
            offline(
                "new rules",
                { members: ["a", "b"] },
                playback.signal,
                "authoring",
                undefined,
                schema,
            ),
            /does not match/,
        );
        await assert.rejects(
            offline(
                "rules",
                { members: ["b", "a"] },
                playback.signal,
                "authoring",
                undefined,
                schema,
            ),
            /does not match/,
        );
        await assert.rejects(
            offline(
                "rules",
                { members: ["a", "b"] },
                playback.signal,
                "authoring",
                undefined,
                { ...schema, strict: false },
            ),
            /does not match/,
        );
        await playback.close();
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("capture has zero provider initializations, budgets span every call kind and deadlines reject late results", async () => {
    const root = await scratch();
    try {
        const capture = await createReplayTape(
            options(root, "capture", { maxCalls: 1 }),
        );
        await assert.rejects(
            capture.invoke("native", { request: request() }, () =>
                assert.fail("Provider initialized"),
            ),
            /captured without provider/,
        );
        await assert.rejects(
            capture.invoke("generative", { schema: {} }, () => assert.fail()),
            /call limit/,
        );
        assert.equal(capture.providerCalls, 0);
        await capture.close();
        const timed = await createReplayTape(
            options(root, "record", { timeoutMs: 20 }),
        );
        await assert.rejects(
            timed.invoke(
                "generative",
                { schema: {} },
                () =>
                    new Promise((resolve) =>
                        setTimeout(() => resolve({ late: true }), 50),
                    ),
            ),
            /deadline/,
        );
        await timed.close();
        await new Promise((resolve) => setTimeout(resolve, 55));
        const saved = JSON.parse(
            await readFile(path.join(root, "record.json"), "utf8"),
        );
        assert.equal(saved.calls[0].status, "failed");
        assert.equal(saved.calls[0].result, undefined);
        const controller = new AbortController();
        const aborted = await createReplayTape(
            options(root, "record", { signal: controller.signal }),
        );
        controller.abort(new Error("cancelled by test"));
        await assert.rejects(
            aborted.invoke("native", {}, () => assert.fail()),
            /cancelled by test/,
        );
        await aborted.close();
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("native admission and provider failures are reproduced without provider calls", async () => {
    const root = await scratch();
    class AdmissionError extends Error {}
    try {
        const tape = await createReplayTape(options(root, "record"));
        const model = nativeReplayModel(tape, identity, () => ({
            ...identity,
            checkRequest() {
                throw new AdmissionError("too large");
            },
            async decide() {
                throw Object.assign(new Error("provider unavailable"), {
                    code: "unavailable",
                });
            },
        }));
        assert.throws(() => model.checkRequest(request()), /too large/);
        await assert.rejects(model.decide(request()), /provider unavailable/);
        await tape.close();
        const playback = await createReplayTape(options(root, "playback"));
        const offline = nativeReplayModel(
            playback,
            identity,
            () => assert.fail(),
            (error) => new AdmissionError(error.message),
        );
        assert.throws(() => offline.checkRequest(request()), AdmissionError);
        await assert.rejects(offline.decide(request()), {
            code: "unavailable",
        });
        assert.equal(playback.providerCalls, 0);
        await playback.close();
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("atomic progress preserves retryable pending, coverage and maintenance and refuses altered resume", async () => {
    const root = await scratch();
    try {
        const curation = {
            concepts: [
                {
                    id: "c1",
                    memberIds: ["a"],
                    validation: {
                        coverage: "member-admission-v2",
                        method: "decision",
                        validatedMemberIds: ["a"],
                    },
                    maintenance: {
                        priority: 1,
                        reasons: ["old anchor"],
                        suspectMemberIds: ["a"],
                        signature: "signature",
                    },
                },
            ],
            deferred: [],
            pending: [
                {
                    nodeId: "b",
                    reason: "needs validation",
                    candidateTargetIds: ["c1"],
                },
            ],
        };
        const file = path.join(root, "progress.json");
        await writeReplayProgress(file, identity, curation, {
            occurrences: { call: 2 },
        });
        const read = await readReplayProgress(file, identity, (value) =>
            curationAccounting(value, ["a", "b"]),
        );
        assert.deepEqual(read.curation, curation);
        assert.equal(read.occurrences.call, 2);
        const accounting = curationAccounting(curation, ["a", "b"]);
        assert.equal(accounting.pending, 1);
        assert.equal(accounting.deferred, 0);
        assert.equal(accounting.assignmentsResolved, false);
        assert.equal(accounting.maintenanceComplete, false);
        assert.equal(accounting.maintenance.length, 1);
        assert.throws(
            () =>
                curationAccounting(
                    { ...curation, deferred: [{ nodeId: "b" }] },
                    ["a", "b"],
                ),
            /Duplicate/,
        );
        await assert.rejects(
            readReplayProgress(
                file,
                { ...identity, model: "changed" },
                () => {},
            ),
            /does not match/,
        );
        read.occurrences.call = 3;
        await atomicWriteJson(file, read);
        await assert.rejects(
            readReplayProgress(file, identity, () => {}),
            /occurrence cursor changed/,
        );
        assert.deepEqual(
            (await readdir(root)).filter((name) => name.endsWith(".partial")),
            [],
        );
        await assert.rejects(
            createReplayOutput(path.join(root, "source-output"), root),
            /outside/,
        );
        const controller = new AbortController();
        controller.abort(new Error("cancelled checkpoint"));
        await assert.rejects(
            atomicWriteJson(file, { late: true }, controller.signal),
            /cancelled checkpoint/,
        );
        assert.deepEqual(JSON.parse(await readFile(file, "utf8")), read);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("shared disposable view storage preserves retained source payload", async () => {
    const root = await scratch();
    try {
        const state = {
            views: {},
            topics: { pending: ["a"], maintenance: ["old-anchor"] },
        };
        const before = hashValue(state);
        const result = await replayViewStorage(state, 1, root);
        assert.equal(result.payloadParity, true);
        assert.equal(hashValue(state), before);
        assert.deepEqual(await readdir(root), []);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("native adapter permits at least 24 concurrent dispatches without an added scheduler", async () => {
    const root = await scratch();
    try {
        const gates = [];
        const tape = await createReplayTape(options(root, "record"));
        const model = nativeReplayModel(tape, identity, () => ({
            ...identity,
            decide: () => new Promise((resolve) => gates.push(resolve)),
        }));
        const running = Array.from({ length: 24 }, (_, index) =>
            model.decide(request(String(index))),
        );
        const deadline = Date.now() + 5000;
        while (gates.length < 24 && Date.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 5));
        const active = gates.length;
        gates.forEach((resolve) => resolve({ success: true }));
        assert.equal(active, 24);
        await Promise.all(running);
        await tape.close();
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("adapters dispatch the same frozen native and generative payload that was bound", async () => {
    const root = await scratch();
    try {
        const tape = await createReplayTape(options(root, "record"));
        const model = nativeReplayModel(tape, identity, () => ({
            ...identity,
            async decide(value) {
                assert.equal(value.state.source, "original");
                return { success: true };
            },
        }));
        const value = request("original");
        const pending = model.decide(value);
        value.state.source = "mutated";
        await pending;
        const complete = generativeReplayCompletion(
            tape,
            identity,
            () => async (_rules, payload, _signal, _stage, ordinal, schema) => {
                assert.deepEqual(payload.members, ["original"]);
                assert.equal(ordinal, 7);
                assert.equal(schema.name, "original");
                return { success: true };
            },
        );
        const payload = { members: ["original"] },
            schema = { name: "original" };
        const generation = complete(
            "rules",
            payload,
            tape.signal,
            "authoring",
            7,
            schema,
        );
        payload.members.push("mutated");
        schema.name = "mutated";
        await generation;
        await tape.close();
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("wire inspection capture/playback is exact and never initializes an offline provider", async () => {
    const root = await scratch();
    try {
        const binding = {
            model: "synthetic",
            prompt: [{ role: "user", content: "exact source" }],
            schema: { name: "schema" },
        };
        const inspection = {
            serializedRequest: '{"exact":"wire"}',
            estimatedInputTokens: 7,
            tokenizer: "o200k_base",
            constraints: {
                inputTokens: 100,
                outputTokens: 20,
                contextTokens: 120,
            },
        };
        const recording = await createReplayTape(options(root, "record"));
        assert.deepEqual(
            recording.inspectRequest(binding, () => inspection),
            inspection,
        );
        await recording.close();
        const playback = await createReplayTape(options(root, "playback"));
        assert.deepEqual(
            playback.inspectRequest(binding, () =>
                assert.fail("Provider initialized"),
            ),
            inspection,
        );
        assert.throws(
            () =>
                playback.inspectRequest(
                    { ...binding, schema: { name: "changed" } },
                    () => assert.fail(),
                ),
            /does not match/,
        );
        await playback.close();
        const source = JSON.parse(
            await readFile(path.join(root, "record.json"), "utf8"),
        );
        Object.values(source.inspections)[0].result.constraints.outputTokens++;
        await atomicWriteJson(path.join(root, "record.json"), source);
        const altered = await createReplayTape(options(root, "playback"));
        assert.throws(
            () => altered.inspectRequest(binding, () => assert.fail()),
            /wire inspection changed/,
        );
        await altered.close();
        const capture = await createReplayTape(options(root, "capture"));
        assert.throws(
            () =>
                capture.inspectRequest(binding, () =>
                    assert.fail("Provider initialized"),
                ),
            /captured without provider/,
        );
        await capture.close();
        assert.equal(capture.providerCalls, 0);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("continuation tapes require the saved duplicate occurrence cursor and refuse incomplete responses", async () => {
    const root = await scratch();
    try {
        const first = await createReplayTape(options(root, "record"));
        await first.invoke("native", { request: request() }, () => ({
            value: "first",
        }));
        const occurrences = first.occurrences();
        await first.close();
        const continuation = await createReplayTape(
            options(root, "record", { occurrences }),
        );
        await continuation.invoke("native", { request: request() }, () => ({
            value: "second",
        }));
        await continuation.close();
        const resumed = await createReplayTape(
            options(root, "playback", { occurrences }),
        );
        assert.deepEqual(
            await resumed.invoke("native", { request: request() }, () =>
                assert.fail(),
            ),
            { value: "second" },
        );
        await resumed.close();
        const missingCursor = await createReplayTape(options(root, "playback"));
        await assert.rejects(
            missingCursor.invoke("native", { request: request() }, () =>
                assert.fail(),
            ),
            /occurrence/,
        );
        await missingCursor.close();
        const document = JSON.parse(
            await readFile(path.join(root, "record.json"), "utf8"),
        );
        document.calls[0].status = "pending";
        await atomicWriteJson(path.join(root, "record.json"), document);
        const incomplete = await createReplayTape(
            options(root, "playback", { occurrences }),
        );
        await assert.rejects(
            incomplete.invoke("native", { request: request() }, () =>
                assert.fail(),
            ),
            /incomplete/,
        );
        await incomplete.close();
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("default Decision capture hashes shipped implementations and performs no network calls", async () => {
    const root = await scratch();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
        throw new Error("Offline capture attempted network access");
    };
    try {
        const client = await import("../../packages/aiclient/dist/index.js");
        const { indexedTopicOccurrence } = await import(
            "../../packages/memory/service/dist/topicIncidence.js"
        );
        const occurrence = indexedTopicOccurrence(
            {
                sourceId: "source",
                revisionId: "r1",
                blockOrdinal: 0,
                text: "A brief scoped synthetic reference.",
                score: 1,
            },
            "Reference",
            0,
        );
        const input = {
            corpusId: "test",
            actor: "offline",
            pipeline: "topics-v1",
            model: "offline-policy",
            definition: {
                viewId: "topics",
                kind: "wiki",
                selector: { kind: "sources", sources: [] },
            },
            expectedVersion: 0,
            bounds: {},
            inputs: [],
            influenceSources: [{ sourceId: "source", revisionId: "r1" }],
            fingerprint: "a".repeat(64),
            topicInput: { occurrences: [occurrence] },
        };
        const file = path.join(root, "input.json");
        await writeFile(file, JSON.stringify(input));
        const binding = {
            policyIdentity: "offline-policy",
            native: {
                ...identity,
                configGeneration: client.getRuntimeConfigGeneration(),
            },
            generative: {
                model: "offline-chat",
                wireIdentity: "offline-wire",
                completionSettings: {
                    response_format: { type: "json_object" },
                },
            },
        };
        const result = await runDecisionReplay({
            input: file,
            binding,
            output: path.join(root, "capture"),
        });
        assert.equal(result.disposition, "capture-only");
        assert.equal(result.providerCalls, 0);
        assert.ok(
            Object.hasOwn(
                result.identity.implementation,
                "packages/memory/service/dist/topicGeneration.js",
            ),
        );
        assert.ok(
            Object.hasOwn(
                result.identity.implementation,
                "packages/aiclient/dist/runtimeConfig.js",
            ),
        );
        assert.ok(
            Object.hasOwn(
                result.identity.implementation,
                "tools/memory-maintenance-qualification/replay-tape.mjs",
            ),
        );
    } finally {
        globalThis.fetch = originalFetch;
        await rm(root, { recursive: true, force: true });
    }
});

test("real Decision generator records and plays back at native concurrency 24, including durable resume", async () => {
    const root = await scratch();
    const product = await import("../../packages/memory/service/dist/index.js");
    const client = await import("../../packages/aiclient/dist/index.js");
    const { indexedTopicOccurrence } = await import(
        "../../packages/memory/service/dist/topicIncidence.js"
    );
    const { getRuntimeConfigGeneration } = client;
    try {
        const native = {
            ...identity,
            model: "offline",
            configGeneration: getRuntimeConfigGeneration(),
        };
        const binding = {
            native,
            policyIdentity: "offline-policy",
            packetPolicy: "v2",
            execution: { concurrency: 24 },
            generative: {
                model: "offline-chat",
                wireIdentity: "synthetic-no-provider",
                inspection: false,
                completionSettings: {
                    response_format: { type: "json_object" },
                },
            },
        };
        const input = {
            corpusId: "test",
            actor: "offline",
            pipeline: "topics-v1",
            model: "offline-policy",
            definition: {
                viewId: "topics",
                kind: "wiki",
                selector: { kind: "sources", sources: [] },
            },
            expectedVersion: 0,
            bounds: {},
            inputs: [],
            influenceSources: [],
            fingerprint: "a".repeat(64),
            topicInput: {
                occurrences: Array.from({ length: 28 }, (_, index) =>
                    indexedTopicOccurrence(
                        {
                            sourceId: `s${index}`,
                            revisionId: "r1",
                            blockOrdinal: 0,
                            text: `Brief passing mention ${index}.`,
                            score: 1,
                        },
                        `Mention ${index}`,
                        0,
                    ),
                ),
            },
        };
        input.influenceSources = input.topicInput.occurrences.map(
            ({ sourceId, revisionId }) => ({ sourceId, revisionId }),
        );
        const file = path.join(root, "input.json");
        await writeFile(file, JSON.stringify(input));
        let calls = 0;
        let disposition = "defer_passing_mention";
        const dependencies = {
            product: {
                ...product,
                configuredTopicDecisionIdentity: () => binding.policyIdentity,
            },
            client,
            implementation: async () => ({ synthetic: "fixed" }),
            nativeFactory: () => ({
                ...native,
                async decide(value) {
                    calls++;
                    const answers = Object.fromEntries(
                        Object.entries(value.questions).map(
                            ([name, question]) => [
                                name,
                                question.type === "choice"
                                    ? {
                                          type: "choice",
                                          choice: disposition,
                                          probabilities: Object.fromEntries(
                                              Object.keys(
                                                  question.criteria,
                                              ).map((key) => [
                                                  key,
                                                  key === disposition ? 1 : 0,
                                              ]),
                                          ),
                                      }
                                    : {
                                          type: "score",
                                          score: 4,
                                          probabilities: Object.fromEntries(
                                              question.criteria.map(
                                                  (_, index) => [
                                                      String(index),
                                                      index === 4 ? 1 : 0,
                                                  ],
                                              ),
                                          ),
                                      },
                            ],
                        ),
                    );
                    return {
                        success: true,
                        data: {
                            answers,
                            requestedModel: native.model,
                            provider: native.provider,
                        },
                    };
                },
            }),
            generativeFactory: () =>
                assert.fail("Deferrals need no generative provider"),
        };
        const recorded = await runDecisionReplay(
            {
                input: file,
                output: path.join(root, "recorded"),
                mode: "record",
                live: true,
                binding,
            },
            dependencies,
        );
        assert.equal(recorded.returned, true);
        assert.equal(recorded.accounting.deferred, 28);
        assert.ok(calls > 0);
        const offline = {
            ...dependencies,
            nativeFactory: () => assert.fail("Offline provider"),
            initialize: () => assert.fail("Offline initialization"),
        };
        const responses = path.join(root, "recorded", "tape.json");
        const played = await runDecisionReplay(
            {
                input: file,
                output: path.join(root, "played"),
                mode: "playback",
                responses,
                binding,
            },
            offline,
        );
        assert.equal(played.providerCalls, 0);
        assert.deepEqual(played.accounting, recorded.accounting);
        const resumed = await runDecisionReplay(
            {
                input: file,
                output: path.join(root, "resumed"),
                mode: "playback",
                responses,
                binding,
                progress: path.join(root, "recorded", "progress.json"),
            },
            offline,
        );
        assert.equal(resumed.providerCalls, 0);
        assert.equal(resumed.accounting.deferred, 28);
        assert.equal(resumed.identity.execution.concurrency, 24);
        assert.equal(
            hashValue(JSON.parse(await readFile(file, "utf8"))),
            hashValue(input),
        );
        disposition = "standalone_new";
        const admittedBinding = {
            ...binding,
            generative: { ...binding.generative, inspection: true },
        };
        const authoring = {
            ...dependencies,
            generativeFactory: () => ({
                completionSettings: binding.generative.completionSettings,
                inspectRequest(prompt, schema) {
                    return {
                        serializedRequest: JSON.stringify({
                            model: "synthetic-chat",
                            messages: prompt,
                            jsonSchema: schema,
                        }),
                        estimatedInputTokens: 100,
                        tokenizer: "o200k_base",
                        constraints: {
                            inputTokens: 922000,
                            outputTokens: 128000,
                            contextTokens: 1050000,
                        },
                    };
                },
                async complete(prompt) {
                    const payload = JSON.parse(prompt[1].content);
                    return {
                        success: true,
                        data: JSON.stringify(
                            Array.isArray(payload)
                                ? { parents: [], related: [] }
                                : {
                                      concepts: payload.clusters.map(
                                          (cluster, index) => ({
                                              clusterId: cluster.clusterId,
                                              label: `Reference ${index}`,
                                              scope: "Reference",
                                              purpose:
                                                  "Understand this scoped explanation",
                                          }),
                                      ),
                                  },
                        ),
                    };
                },
            }),
        };
        const admittedInput = {
            ...input,
            topicInput: {
                occurrences: input.topicInput.occurrences.slice(0, 2),
            },
        };
        admittedInput.influenceSources =
            admittedInput.topicInput.occurrences.map(
                ({ sourceId, revisionId }) => ({ sourceId, revisionId }),
            );
        const admittedFile = path.join(root, "admitted-input.json");
        await writeFile(admittedFile, JSON.stringify(admittedInput));
        const authored = await runDecisionReplay(
            {
                input: admittedFile,
                binding: admittedBinding,
                mode: "record",
                live: true,
                output: path.join(root, "authored"),
            },
            authoring,
        );
        assert.equal(authored.accounting.admitted, 2);
        const authoredTape = JSON.parse(
            await readFile(path.join(root, "authored", "tape.json"), "utf8"),
        );
        assert.ok(
            authoredTape.calls.filter(
                (call) => call.binding.kind === "generative",
            ).length >= 2,
            "Both native metadata authoring and organization must be recorded",
        );
        assert.ok(
            Object.keys(authoredTape.inspections).length >= 2,
            "Actual metadata and organization wire inspection must be retained",
        );
        const offlineAuthored = await runDecisionReplay(
            {
                input: admittedFile,
                binding: admittedBinding,
                mode: "playback",
                responses: path.join(root, "authored", "tape.json"),
                output: path.join(root, "authored-playback"),
            },
            {
                ...offline,
                generativeFactory: () =>
                    assert.fail("Offline generative provider"),
            },
        );
        assert.equal(offlineAuthored.providerCalls, 0);
        assert.deepEqual(offlineAuthored.accounting, authored.accounting);
        const maintainedInput = {
            ...admittedInput,
            topicInput: { ...admittedInput.topicInput, maintainClusters: true },
        };
        const maintainedFile = path.join(root, "maintenance-input.json");
        await writeFile(maintainedFile, JSON.stringify(maintainedInput));
        const clusterBinding = {
            ...binding,
            execution: { ...binding.execution, clusterValidation: true },
        };
        const captured = await runDecisionReplay(
            {
                input: maintainedFile,
                binding: clusterBinding,
                mode: "capture",
                output: path.join(root, "maintenance-capture"),
            },
            offline,
        );
        assert.equal(captured.providerCalls, 0);
        const savedSnapshot = JSON.parse(
            await readFile(
                path.join(root, "authored", "snapshot.json"),
                "utf8",
            ),
        );
        const raw = product.createTopicSnapshot(
            maintainedInput,
            maintainedInput.model,
        );
        const anchor = savedSnapshot.curation.concepts[0],
            candidate = savedSnapshot.curation.concepts[1];
        const { prioritizeTopicMaintenance } = await import(
            "../../packages/memory/service/dist/topicClusterMaintenance.js"
        );
        prioritizeTopicMaintenance(
            raw,
            anchor,
            anchor.memberIds,
            1,
            "old-anchor repair",
        );
        const pendingCuration = {
            concepts: [anchor],
            deferred: [],
            pending: [
                {
                    nodeId: candidate.memberIds[0],
                    reason: "retry required",
                    candidateTargetIds: [anchor.id],
                },
            ],
        };
        product.validateTopicSnapshot({
            ...raw,
            curationProgress: pendingCuration,
        });
        const pendingProgress = path.join(root, "pending-progress.json");
        await writeReplayProgress(
            pendingProgress,
            captured.identity,
            pendingCuration,
            { occurrences: {} },
        );
        const retried = await runDecisionReplay(
            {
                input: maintainedFile,
                binding: clusterBinding,
                mode: "capture",
                progress: pendingProgress,
                output: path.join(root, "pending-retry"),
            },
            offline,
        );
        assert.equal(retried.disposition, "capture-only");
        assert.equal(retried.providerCalls, 0);
        assert.equal(retried.accounting.pending, 1);
        assert.equal(retried.accounting.deferred, 0);
        assert.equal(retried.accounting.maintenance.length, 1);
        assert.equal(retried.accounting.assignmentsResolved, false);
        assert.equal(retried.accounting.maintenanceComplete, false);
        const invalid = structuredClone(pendingCuration);
        invalid.pending[0].candidateTargetIds = ["unknown-target"];
        const invalidProgress = path.join(
            root,
            "invalid-pending-progress.json",
        );
        await writeReplayProgress(invalidProgress, captured.identity, invalid, {
            occurrences: {},
        });
        await assert.rejects(
            runDecisionReplay(
                {
                    input: maintainedFile,
                    binding: clusterBinding,
                    mode: "capture",
                    progress: invalidProgress,
                    output: path.join(root, "invalid-pending"),
                },
                offline,
            ),
            /invalid|pending|target/i,
        );
        const { writeSegmentedJson } = await import(
            "../../packages/knowPro/dist/segmentedJson.js"
        );
        const indexDirectory = path.join(root, "index-store", "generation");
        await mkdir(indexDirectory, { recursive: true });
        const indexFile = path.join(indexDirectory, "corpus_data.json");
        await writeSegmentedJson(
            indexFile,
            {
                jsonData: { messages: [{ textChunks: ["Synthetic fixture"] }] },
                binaryData: {
                    relatedEmbeddings: [new Float32Array([1, 0])],
                    messageEmbeddings: [new Float32Array([0, 1])],
                },
            },
            { messages: 1, semanticRefs: 0 },
        );
        const sourceManifest = await readFile(indexFile, "utf8");
        const storage = await runDecisionReplay(
            {
                input: file,
                binding,
                mode: "index-storage",
                "index-file": indexFile,
                samples: "1",
                output: path.join(root, "native-index-storage"),
            },
            offline,
        );
        assert.equal(storage.providerCalls, 0);
        assert.equal(storage.observations.payloadParity, true);
        assert.equal(storage.observations.writes[0].unchanged.newArtifacts, 0);
        assert.equal(await readFile(indexFile, "utf8"), sourceManifest);
        const { ViewHistory } = await import(
            "../../packages/memory/service/dist/viewHistory.js"
        );
        const historyDirectory = path.join(root, "retained-source", "views");
        const history = new ViewHistory(historyDirectory, () => ({
            views: {},
        }));
        const firstNode = product.createTopicSnapshot(input, input.model)
            .nodes[0].id;
        const retainedState = {
            views: {},
            builds: { job: { results: [{ snapshot: input }] } },
            topics: {
                inputFingerprint: input.fingerprint,
                curationProgress: {
                    concepts: [],
                    deferred: [
                        { nodeId: firstNode, reason: "retained decision" },
                    ],
                },
            },
        };
        const retainedHead = await history.commit(
            null,
            retainedState,
            {},
            "offline",
            "Synthetic retained progress",
        );
        disposition = "defer_passing_mention";
        const historical = await runDecisionReplay(
            {
                history: path.join(historyDirectory, "view-history.git"),
                binding,
                resume: true,
                mode: "record",
                live: true,
                output: path.join(root, "history-recorded"),
            },
            dependencies,
        );
        assert.equal(historical.accounting.deferred, 28);
        const historicalResume = await runDecisionReplay(
            {
                history: path.join(historyDirectory, "view-history.git"),
                binding,
                mode: "playback",
                responses: path.join(root, "history-recorded", "tape.json"),
                progress: path.join(root, "history-recorded", "progress.json"),
                output: path.join(root, "history-progress-resumed"),
            },
            offline,
        );
        assert.equal(historicalResume.accounting.deferred, 28);
        assert.equal(historicalResume.providerCalls, 0);
        assert.equal(
            await history.readHead(),
            retainedHead,
            "Replay must not write the retained source store",
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
