// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { indexedTopicOccurrence } from "../../packages/memory/service/dist/topicIncidence.js";
import { createConfiguredTopicGenerator } from "../../packages/memory/service/dist/topicGeneration.js";
import {
    loadTopicReplay,
    runTopicReplay,
    topicReplaySettings,
    topicReplayDeadline,
    finalTopicCoverage,
    inspectTopicReplayModelBinding,
} from "./topic-curation-replay.mjs";
import { ViewHistory } from "../../packages/memory/service/dist/viewHistory.js";
import { writeSegmentedJson } from "../../packages/knowPro/dist/segmentedJson.js";
const testDirectory = path.dirname(fileURLToPath(import.meta.url));

function syntheticModel(complete) {
    return {
        completionSettings: { response_format: { type: "json_object" } },
        inspectRequest(messages, schema) {
            return {
                serializedRequest: JSON.stringify({ messages, schema }),
                estimatedInputTokens: 100,
                constraints: { outputTokens: 1000 },
            };
        },
        complete,
    };
}

function deferResponse(messages) {
    const payload = JSON.parse(messages[1].content);
    return {
        success: true,
        data: JSON.stringify({
            concepts: [],
            deferred: payload.nodes.map(({ id }) => ({
                nodeId: id,
                reason: "Synthetic fixture",
            })),
        }),
    };
}

test("model binding contains only allowlisted metadata and normalized completion settings", () => {
    const model = syntheticModel(() =>
        assert.fail("Binding inspection invoked provider"),
    );
    model.completionSettings = {
        temperature: 1,
        n: 1,
        top_p: 0.9,
        response_format: { type: "json_object", credentials: "FORMAT_SECRET" },
        apiKey: "COMPLETION_SECRET",
        toJSON: () => assert.fail("Serialized complete completion settings"),
    };
    const settings = {
        provider: "azure",
        endpoint:
            "https://user:PASSWORD@private-host.example/openai/deployments/gpt-6-luna/chat/completions?api-key=QUERY_SECRET",
        modelName: "gpt-6-luna",
        apiKey: "API_SECRET",
        headers: { authorization: "HEADER_SECRET" },
        requestConstraints: {
            contextTokens: 1050000,
            inputTokens: 922000,
            outputTokens: 128000,
            credentials: "LIMIT_SECRET",
        },
        toJSON: () => assert.fail("Serialized ApiSettings"),
    };
    const inspected = inspectTopicReplayModelBinding(
        model,
        "gpt-6-luna",
        settings,
    );
    assert.deepEqual(inspected.binding, {
        provider: "azure",
        endpointAlias: "gpt-6-luna",
        deployment: "gpt-6-luna",
        modelName: "gpt-6-luna",
        completionSettings: {
            n: 1,
            temperature: 1,
            top_p: 0.9,
            response_format: { type: "json_object" },
        },
        requestLimits: {
            contextTokens: 1050000,
            inputTokens: 922000,
            outputTokens: 128000,
        },
    });
    assert.match(inspected.hash, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(
        JSON.stringify(inspected),
        /SECRET|PASSWORD|private-host|apiKey|authorization|reasoning_effort/,
    );
    assert.equal(
        inspectTopicReplayModelBinding(model, "gpt-6-luna", settings).hash,
        inspected.hash,
    );
    assert.equal(model.completionSettings.reasoning_effort, undefined);
    const queryOnly = inspectTopicReplayModelBinding(model, "gpt-6-luna", {
        ...settings,
        endpoint:
            "https://private-host.example/chat?key=/deployments/QUERY_SECRET/",
    });
    assert.equal(queryOnly.binding.deployment, undefined);
});

test("expected model binding mismatch is fatal before any provider invocation", async () => {
    const root = await mkdtemp(
        path.join(testDirectory, "topic-model-binding-mismatch-"),
    );
    try {
        const input = await fixture(root);
        const output = path.join(root, "mismatch");
        let providerCalls = 0;
        const model = syntheticModel(() => {
            providerCalls++;
            return { success: false };
        });
        await assert.rejects(
            runTopicReplay(
                {
                    input,
                    output,
                    mode: "live",
                    live: true,
                    endpoint: "gpt-6-luna",
                    "expected-model-binding": "0".repeat(64),
                },
                { initializeModel: () => model },
            ),
            /Replay model binding does not match/,
        );
        assert.equal(providerCalls, 0);
        const binding = JSON.parse(
            await readFile(path.join(output, "model-binding.json"), "utf8"),
        );
        assert.equal(
            binding.hash,
            inspectTopicReplayModelBinding(model, "gpt-6-luna").hash,
        );
        assert.equal(
            JSON.parse(
                await readFile(path.join(output, "failure.json"), "utf8"),
            ).modelBindingHash,
            binding.hash,
        );
        assert.deepEqual(
            JSON.parse(await readFile(path.join(output, "calls.json"), "utf8")),
            [],
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("binding is rechecked immediately before normal, repair and organization provider calls", async () => {
    const root = await mkdtemp(
        path.join(testDirectory, "topic-model-binding-per-call-"),
    );
    try {
        const input = await fixture(root);
        for (const boundary of ["normal", "contract-repair", "organization"]) {
            let providerCalls = 0;
            let inspections = 0;
            const model = syntheticModel((messages) => {
                providerCalls++;
                if (boundary === "organization") {
                    const nodes = JSON.parse(messages[1].content).nodes;
                    return {
                        success: true,
                        data: JSON.stringify({
                            concepts: [nodes.slice(0, 4), nodes.slice(4)].map(
                                (group, index) => ({
                                    label: `Synthetic concept ${index}`,
                                    scope: "Fixture",
                                    purpose: "A scoped fixture reference",
                                    salience: 6,
                                    memberIds: group.map(({ id }) => id),
                                    evidenceIds: [
                                        ...new Set(
                                            group.flatMap(
                                                (node) => node.evidenceIds,
                                            ),
                                        ),
                                    ],
                                }),
                            ),
                            deferred: [],
                        }),
                    };
                }
                const data = JSON.parse(deferResponse(messages).data);
                data.deferred[1] = data.deferred[0];
                return { success: true, data: JSON.stringify(data) };
            });
            const expected = inspectTopicReplayModelBinding(
                model,
                "gpt-6-luna",
            ).hash;
            const inspect = model.inspectRequest;
            model.inspectRequest = (...args) => {
                const result = inspect(...args);
                inspections++;
                if (
                    (boundary === "organization" &&
                        Array.isArray(JSON.parse(args[0][1].content))) ||
                    (boundary !== "organization" &&
                        inspections === (boundary === "normal" ? 1 : 2))
                )
                    model.completionSettings.temperature = 0.8;
                return result;
            };
            const output = path.join(root, boundary);
            await assert.rejects(
                runTopicReplay(
                    {
                        input,
                        output,
                        mode: "live",
                        live: true,
                        endpoint: "gpt-6-luna",
                        organize: boundary === "organization",
                        "max-calls": "10",
                        "expected-model-binding": expected,
                    },
                    { initializeModel: () => model },
                ),
                /Replay model binding does not match/,
            );
            assert.equal(providerCalls, boundary === "normal" ? 0 : 1);
            const calls = JSON.parse(
                await readFile(path.join(output, "calls.json"), "utf8"),
            );
            assert.equal(calls.at(-1).kind, boundary);
            assert.notEqual(calls.at(-1).modelBindingHash, expected);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("matching model binding is saved in result metrics and each provider receipt", async () => {
    const root = await mkdtemp(
        path.join(testDirectory, "topic-model-binding-matching-"),
    );
    try {
        const input = await fixture(root);
        const model = syntheticModel(deferResponse);
        const expected = inspectTopicReplayModelBinding(model, "gpt-6-luna");
        const result = await runTopicReplay(
            {
                input,
                output: path.join(root, "matched"),
                mode: "live",
                live: true,
                endpoint: "gpt-6-luna",
                "expected-model-binding": expected.hash.toUpperCase(),
            },
            { initializeModel: () => model },
        );
        assert.equal(result.observations.completed, true);
        assert.equal(result.observations.providerCalls, 1);
        assert.equal(result.observations.modelBindingHash, expected.hash);
        assert.deepEqual(result.observations.modelBinding, expected.binding);
        assert.equal(
            result.observations.calls[0].modelBindingHash,
            expected.hash,
        );
        assert.equal(result.identity.expectedModelBinding, expected.hash);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

async function fixture(root, count = 8) {
    const input = {
        corpusId: "test",
        actor: "offline",
        definition: {
            viewId: "topics",
            kind: "wiki",
            selector: { kind: "sources", sources: [] },
        },
        expectedVersion: 0,
        bounds: {},
        inputs: [],
        influenceSources: [],
        pipeline: "topics-v1",
        model: "offline",
        fingerprint: "a".repeat(64),
        topicInput: {
            occurrences: Array.from({ length: count }, (_, index) =>
                indexedTopicOccurrence(
                    {
                        sourceId: `s${index}`,
                        revisionId: "r1",
                        blockOrdinal: 0,
                        text: `Reference ${index} explains a scoped concept.`,
                        score: 1,
                    },
                    `Concept ${index}`,
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
    return file;
}

test("payload history reads the selected build at a pinned commit and never advances the source", async (t) => {
    const root = await mkdtemp(
        path.join(testDirectory, "topic-payload-history-"),
    );
    try {
        const input = JSON.parse(await readFile(await fixture(root), "utf8"));
        const directory = path.join(root, "store", "views");
        const history = new ViewHistory(directory, () => ({}));
        const state = {
            padding: "Synthetic payload history. ".repeat(30000),
            builds: { selected: { results: [{ snapshot: input }] } },
            topics: { inputFingerprint: input.fingerprint },
        };
        const first = await history.commit(
            null,
            state,
            {},
            "offline",
            "First input",
        );
        const head = await history.commit(
            first,
            {
                ...state,
                builds: {
                    other: {
                        results: [
                            {
                                snapshot: {
                                    ...input,
                                    fingerprint: "b".repeat(64),
                                },
                            },
                        ],
                    },
                },
            },
            {},
            "offline",
            "Second input",
        );
        const gitdir = path.join(directory, "view-history.git");
        const tree = execFileSync(
            "git",
            [`--git-dir=${gitdir}`, "ls-tree", "--name-only", first],
            { encoding: "utf8" },
        );
        assert.match(tree, /state-payloads/);
        assert.doesNotMatch(tree, /state\.json/);
        const read = t.mock.method(ViewHistory.prototype, "readField");
        const pinned = await loadTopicReplay({
            history: gitdir,
            commit: first,
            job: "selected",
        });
        assert.equal(pinned.input.fingerprint, input.fingerprint);
        assert.deepEqual(read.mock.calls[0].arguments, [
            ["builds", "selected"],
            first,
        ]);
        const latest = await loadTopicReplay({ history: gitdir, job: "other" });
        assert.equal(latest.input.fingerprint, "b".repeat(64));
        await assert.rejects(
            loadTopicReplay({ history: gitdir, commit: first, job: "other" }),
            /Select exactly one/,
        );
        assert.equal(await history.readHead(), head);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("effective topic replay settings preserve defaults and every explicit treatment", () => {
    assert.deepEqual(topicReplaySettings({}), { concurrency: 1 });
    assert.deepEqual(
        topicReplaySettings({
            concurrency: "2",
            "input-tokens": "12000",
            "prior-fraction": "0.25",
            "prior-deltas": true,
            "compact-ids": false,
            "frozen-preparation": true,
        }),
        {
            concurrency: 2,
            inputTokenTarget: 12000,
            priorContextFraction: 0.25,
            priorDeltas: true,
            compactIds: false,
            frozenPreparation: true,
        },
    );
    assert.throws(
        () => topicReplaySettings({ "compact-ids": "false" }),
        /Invalid compact-ids/,
    );
    assert.throws(
        () => topicReplaySettings({ "prior-fraction": "0.25" }),
        /Invalid topic curation settings/,
    );
});

test("compact wire IDs retain raw counts and candidate capture saves effective production settings", async () => {
    const root = await mkdtemp(
        path.join(testDirectory, "topic-settings-capture-"),
    );
    try {
        const input = await fixture(root, 55);
        const settings = {
            "compact-ids": true,
            "prior-deltas": true,
            "frozen-preparation": true,
            concurrency: "2",
            "input-tokens": "24000",
            "prior-fraction": "0.25",
        };
        const output = path.join(root, "capture");
        const result = await runTopicReplay(
            { input, output, ...settings },
            {
                initializeModel: () =>
                    assert.fail("Capture initialized a provider"),
            },
        );
        const binding = JSON.parse(
            await readFile(path.join(output, "binding-1.json"), "utf8"),
        );
        assert.ok(
            binding.payload.nodes.every(({ id }) => !id.startsWith("topic:")),
        );
        assert.equal(
            result.observations.calls[0].rawNodes,
            binding.payload.nodes.length,
        );
        assert.equal(result.observations.calls[0].priorConcepts, 0);
        assert.equal(result.observations.providerCalls, 0);
        assert.deepEqual(result.settings, topicReplaySettings(settings));
        assert.deepEqual(result.identity.settings, result.settings);
        assert.equal(result.observations.calls[0].phase, "preparation");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("absolute deadline cannot be extended by timeout and validates ISO timestamps", () => {
    const now = Date.parse("2030-01-01T00:00:00Z");
    const budget = topicReplayDeadline(
        { deadline: "2030-01-01T00:00:01Z", "timeout-ms": "999999" },
        () => now,
    );
    assert.equal(budget.deadline, now + 1000);
    assert.equal(
        topicReplayDeadline(
            { deadline: "2030-01-01T01:00:00+00:00", "timeout-ms": "500" },
            () => now,
        ).deadline,
        now + 500,
    );
    assert.throws(
        () => topicReplayDeadline({ deadline: "tomorrow" }),
        /Invalid --deadline/,
    );
});

test("expired deadline rejects before initialization; initialization cannot reset it", async () => {
    let initialized = 0;
    await assert.rejects(
        runTopicReplay(
            {
                mode: "live",
                live: true,
                deadline: "2000-01-01T00:00:00Z",
            },
            {
                initializeModel: () => {
                    initialized++;
                },
            },
        ),
        /Replay deadline exceeded/,
    );
    assert.equal(initialized, 0);
    const root = await mkdtemp(
        path.join(testDirectory, "topic-initialization-deadline-"),
    );
    try {
        const input = await fixture(root);
        let now = Date.parse("2030-01-01T00:00:00Z");
        let invoked = 0;
        const output = path.join(root, "cancelled");
        const result = await runTopicReplay(
            {
                input,
                output,
                mode: "live",
                live: true,
                deadline: "2030-01-01T00:00:01Z",
                "timeout-ms": "999999",
            },
            {
                now: () => now,
                initializeModel: () => {
                    initialized++;
                    now += 1001;
                    return syntheticModel(() => {
                        invoked++;
                    });
                },
            },
        );
        assert.equal(initialized, 1);
        assert.equal(invoked, 0);
        assert.equal(result.observations.disposition, "deadline-incomplete");
        assert.equal(
            JSON.parse(
                await readFile(path.join(output, "failure.json"), "utf8"),
            ).status,
            "cancelled",
        );
        assert.equal(
            JSON.parse(await readFile(path.join(output, "result.json"), "utf8"))
                .observations.providerCalls,
            0,
        );
        assert.deepEqual(
            JSON.parse(
                await readFile(
                    path.join(output, "partial-curation.json"),
                    "utf8",
                ),
            ),
            { concepts: [], deferred: [] },
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("deadline is checked immediately before every provider call, including repairs", async () => {
    const root = await mkdtemp(
        path.join(testDirectory, "topic-per-call-deadline-"),
    );
    try {
        const input = await fixture(root);
        let now = Date.parse("2030-01-01T00:00:00Z");
        let providerCalls = 0;
        const model = syntheticModel((messages) => {
            providerCalls++;
            const response = deferResponse(messages);
            const data = JSON.parse(response.data);
            data.deferred[1] = data.deferred[0];
            return { success: true, data: JSON.stringify(data) };
        });
        let inspections = 0;
        const inspect = model.inspectRequest;
        model.inspectRequest = (...args) => {
            const result = inspect(...args);
            if (++inspections === 2) now += 1001;
            return result;
        };
        const output = path.join(root, "cancelled");
        const result = await runTopicReplay(
            {
                input,
                output,
                mode: "live",
                live: true,
                "max-calls": "10",
                deadline: "2030-01-01T00:00:01Z",
                "timeout-ms": "999999",
            },
            { now: () => now, initializeModel: () => model },
        );
        assert.equal(providerCalls, 1);
        assert.equal(result.observations.providerCalls, 1);
        assert.equal(result.observations.disposition, "deadline-incomplete");
        assert.equal(result.observations.calls[1].kind, "contract-repair");
        assert.equal(result.observations.calls[1].status, "aborted");
        assert.match(result.observations.calls[1].error.message, /deadline/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("provider gets an abort signal and cancellation persists metrics and validated partial progress", async () => {
    const root = await mkdtemp(
        path.join(testDirectory, "topic-provider-abort-"),
    );
    try {
        const input = await fixture(root, 55);
        let receivedSignal;
        let calls = 0;
        const output = path.join(root, "cancelled");
        const result = await runTopicReplay(
            {
                input,
                output,
                mode: "live",
                live: true,
                "max-calls": "10",
                "timeout-ms": "3000",
            },
            {
                initializeModel: () =>
                    syntheticModel(
                        (messages, _usage, _schema, _log, signal) => {
                            if (++calls === 1) return deferResponse(messages);
                            receivedSignal = signal;
                            return new Promise(() => {});
                        },
                    ),
            },
        );
        assert.equal(receivedSignal.aborted, true);
        assert.equal(result.observations.disposition, "deadline-incomplete");
        assert.equal(result.observations.providerCalls, 2);
        assert.ok(result.observations.coverage.deferredNodes > 0);
        assert.ok(result.observations.coverage.unaccountedNodes > 0);
        const progress = JSON.parse(
            await readFile(path.join(output, "progress.json"), "utf8"),
        );
        const partial = JSON.parse(
            await readFile(path.join(output, "partial-curation.json"), "utf8"),
        );
        assert.deepEqual(partial, progress.curation);
        assert.equal(result.observations.calls[1].status, "aborted");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("organization shares the original deadline and cannot invoke a provider after expiry", async () => {
    const root = await mkdtemp(
        path.join(testDirectory, "topic-organization-deadline-"),
    );
    try {
        const input = await fixture(root);
        let now = Date.parse("2030-01-01T00:00:00Z");
        let providerCalls = 0;
        const model = syntheticModel((messages) => {
            providerCalls++;
            const nodes = JSON.parse(messages[1].content).nodes;
            return {
                success: true,
                data: JSON.stringify({
                    concepts: [nodes.slice(0, 4), nodes.slice(4)].map(
                        (group, index) => ({
                            label: `Synthetic concept ${index}`,
                            scope: "Fixture",
                            purpose: "A scoped fixture reference",
                            salience: 6,
                            memberIds: group.map(({ id }) => id),
                            evidenceIds: [
                                ...new Set(
                                    group.flatMap((node) => node.evidenceIds),
                                ),
                            ],
                        }),
                    ),
                    deferred: [],
                }),
            };
        });
        const inspect = model.inspectRequest;
        model.inspectRequest = (...args) => {
            const result = inspect(...args);
            if (Array.isArray(JSON.parse(args[0][1].content))) now += 1001;
            return result;
        };
        const output = path.join(root, "cancelled");
        const result = await runTopicReplay(
            {
                input,
                output,
                mode: "live",
                live: true,
                organize: true,
                "max-calls": "10",
                deadline: "2030-01-01T00:00:01Z",
                "timeout-ms": "999999",
            },
            { now: () => now, initializeModel: () => model },
        );
        assert.equal(providerCalls, 1);
        assert.equal(result.observations.disposition, "deadline-incomplete");
        assert.equal(result.observations.coverage.admittedNodes, 8);
        assert.equal(result.observations.coverage.unaccountedNodes, 0);
        assert.ok(
            JSON.parse(
                await readFile(path.join(output, "curation.json"), "utf8"),
            ),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("structural coverage reports actual memberships without semantic quality claims", () => {
    const coverage = finalTopicCoverage({
        nodes: [
            { id: "a", occurrenceIds: ["o1", "o2"] },
            { id: "b", occurrenceIds: ["o3"] },
            { id: "c", occurrenceIds: ["o4"] },
        ],
        curation: {
            concepts: [{ memberIds: ["a"] }],
            deferred: [{ nodeId: "b" }],
        },
    });
    assert.equal(coverage.admittedNodes, 1);
    assert.equal(coverage.deferredNodes, 1);
    assert.equal(coverage.unaccountedNodes, 1);
    assert.equal(coverage.representedOccurrences, 2);
    assert.equal(coverage.selectedOccurrences, 4);
    assert.equal(coverage.semanticQualityAssessed, false);
});

test("cancellation does not downgrade artifact persistence errors", async () => {
    const root = await mkdtemp(
        path.join(testDirectory, "topic-cancellation-persistence-"),
    );
    try {
        const input = await fixture(root);
        const output = path.join(root, "cancelled");
        let now = Date.parse("2030-01-01T00:00:00Z");
        await assert.rejects(
            runTopicReplay(
                {
                    input,
                    output,
                    mode: "live",
                    live: true,
                    deadline: "2030-01-01T00:00:01Z",
                    "timeout-ms": "999999",
                },
                {
                    now: () => now,
                    initializeModel: async () => {
                        await mkdir(path.join(output, "calls.json"));
                        now += 1001;
                        return syntheticModel(() =>
                            assert.fail("Expired replay invoked provider"),
                        );
                    },
                },
            ),
            (error) => ["EEXIST", "EISDIR", "EPERM"].includes(error.code),
        );
        await assert.rejects(readFile(path.join(output, "result.json")), {
            code: "ENOENT",
        });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("capture, indexed parity and recorded parser replay require no provider", async () => {
    const root = await mkdtemp(path.join(testDirectory, "topic-replay-test-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
        throw new Error("Offline replay attempted network access");
    };
    try {
        const input = await fixture(root);
        const output = path.join(root, "capture");
        const captured = await runTopicReplay({ input, output });
        assert.equal(captured.identityVerified, true);
        assert.equal(captured.observations.providerCalls, 0);
        assert.equal(captured.observations.disposition, "capture-only");
        assert.equal(captured.observations.completed, false);
        const binding = JSON.parse(
            await readFile(path.join(output, "binding-1.json"), "utf8"),
        );
        await writeFile(
            path.join(output, "response-1.json"),
            JSON.stringify({
                concepts: [],
                deferred: binding.payload.nodes.map(({ id }) => ({
                    nodeId: id,
                    reason: "Synthetic replay fixture",
                })),
            }),
        );
        const recorded = await runTopicReplay({
            input,
            output: path.join(root, "recorded"),
            mode: "recorded",
            responses: output,
        });
        assert.equal(recorded.observations.completed, true);
        assert.equal(recorded.observations.providerCalls, 0);
        assert.equal(recorded.observations.accountedNodes, 8);
        const resumed = await runTopicReplay({
            input,
            output: path.join(root, "resumed"),
            mode: "recorded",
            responses: output,
            progress: path.join(root, "recorded", "progress.json"),
            organize: true,
        });
        assert.equal(resumed.observations.completed, true);
        assert.equal(resumed.observations.calls.length, 0);
        assert.equal(resumed.observations.accountedNodes, 8);
        assert.deepEqual(resumed.observations.organization, {
            concepts: 0,
            parents: 0,
            related: 0,
        });
        const cpu = await runTopicReplay({
            input,
            output: path.join(root, "cpu"),
            mode: "cpu",
            samples: "1",
            warmups: "0",
        });
        assert.equal(cpu.observations.evidenceParity, true);
        assert.equal(cpu.observations.nominationParity, true);
        await assert.rejects(
            runTopicReplay({
                input,
                output: path.join(root, "unauthorized"),
                mode: "live",
            }),
            /requires --live/,
        );
    } finally {
        globalThis.fetch = originalFetch;
        await rm(root, { recursive: true, force: true });
    }
});

test("replay rejects invalid budgets and mismatched response bindings", async () => {
    const root = await mkdtemp(path.join(testDirectory, "topic-replay-test-"));
    try {
        const input = await fixture(root);
        await assert.rejects(
            runTopicReplay({
                input,
                output: path.join(root, "invalid"),
                concurrency: "3",
            }),
            /Invalid topic curation/,
        );
        const output = path.join(root, "capture");
        await runTopicReplay({ input, output });
        await writeFile(path.join(output, "binding-1.json"), "{}");
        await assert.rejects(
            runTopicReplay({
                input,
                mode: "recorded",
                output: path.join(root, "mismatch"),
                responses: output,
            }),
            /does not match/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("implementation identity excludes generated tool data artifacts", async () => {
    const root = await mkdtemp(
        path.join(
            path.dirname(fileURLToPath(import.meta.url)),
            "topic-replay-data-test-",
        ),
    );
    try {
        const input = await fixture(root);
        const result = await runTopicReplay({
            input,
            output: path.join(root, "capture"),
        });
        assert.equal(result.identityVerified, true);
        assert.ok(
            Object.keys(result.identity.untracked).every(
                (file) => !file.includes(path.basename(root)),
            ),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("bounded replay resumes only matching validated durable progress", async () => {
    const root = await mkdtemp(
        path.join(testDirectory, "topic-replay-resume-"),
    );
    try {
        const input = await fixture(root, 55);
        const captured = path.join(root, "captured");
        await runTopicReplay({ input, output: captured });
        const binding = JSON.parse(
            await readFile(path.join(captured, "binding-1.json"), "utf8"),
        );
        await writeFile(
            path.join(captured, "response-1.json"),
            JSON.stringify({
                concepts: [],
                deferred: binding.payload.nodes.map(({ id }) => ({
                    nodeId: id,
                    reason: "Synthetic replay fixture",
                })),
            }),
        );
        const partial = await runTopicReplay({
            input,
            output: path.join(root, "partial"),
            mode: "recorded",
            responses: captured,
        });
        assert.equal(partial.observations.completed, false);
        assert.equal(partial.observations.disposition, "call-limit-incomplete");
        const progress = path.join(root, "partial", "progress.json");
        const remaining = path.join(root, "remaining");
        await runTopicReplay({ input, progress, output: remaining });
        const next = JSON.parse(
            await readFile(path.join(remaining, "binding-1.json"), "utf8"),
        );
        const saved = new Set(binding.payload.nodes.map(({ id }) => id));
        assert.ok(next.payload.nodes.every(({ id }) => !saved.has(id)));
        await assert.rejects(
            runTopicReplay({
                input,
                progress,
                concurrency: "2",
                output: path.join(root, "wrong-policy"),
            }),
            /does not match/,
        );
        await assert.rejects(
            runTopicReplay({
                input,
                progress,
                nodes: "54",
                output: path.join(root, "wrong-selection"),
            }),
            /does not match/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("subset replay resumes partial and completed progress with complete source incidence", async () => {
    const root = await mkdtemp(
        path.join(testDirectory, "topic-replay-subset-resume-"),
    );
    try {
        const input = await fixture(root, 55);
        const selected = { input, nodes: "30" };
        const captured = path.join(root, "captured");
        const capture = await runTopicReplay({
            ...selected,
            output: captured,
        });
        assert.equal(capture.nodes, 30);
        assert.equal(capture.occurrences, 55);
        const deferCaptured = async (directory) => {
            const binding = JSON.parse(
                await readFile(path.join(directory, "binding-1.json"), "utf8"),
            );
            await writeFile(
                path.join(directory, "response-1.json"),
                JSON.stringify({
                    concepts: [],
                    deferred: binding.payload.nodes.map(({ id }) => ({
                        nodeId: id,
                        reason: "Synthetic subset replay fixture",
                    })),
                }),
            );
            return binding.payload.nodes.length;
        };
        const processed = await deferCaptured(captured);
        const partial = path.join(root, "partial");
        const first = await runTopicReplay({
            ...selected,
            mode: "recorded",
            responses: captured,
            output: partial,
        });
        assert.equal(first.observations.completed, false);
        const progress = path.join(partial, "progress.json");
        const remaining = path.join(root, "remaining");
        await runTopicReplay({
            ...selected,
            progress,
            output: remaining,
        });
        assert.equal(processed + (await deferCaptured(remaining)), 30);
        const completed = path.join(root, "completed");
        const result = await runTopicReplay({
            ...selected,
            progress,
            mode: "recorded",
            responses: remaining,
            output: completed,
        });
        assert.equal(result.observations.completed, true);
        assert.equal(result.observations.accountedNodes, 30);
        assert.equal(result.occurrences, 55);
        const resumed = await runTopicReplay({
            ...selected,
            progress: path.join(completed, "progress.json"),
            mode: "recorded",
            responses: path.join(root, "unused-responses"),
            output: path.join(root, "resumed"),
        });
        assert.equal(resumed.observations.completed, true);
        assert.equal(resumed.observations.accountedNodes, 30);
        assert.equal(resumed.observations.calls.length, 0);
        await assert.rejects(
            runTopicReplay({
                ...selected,
                nodes: "31",
                progress,
                output: path.join(root, "wrong-selection"),
            }),
            /does not match/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("subset selection still validates evidence outside the selected nodes", async () => {
    const root = await mkdtemp(
        path.join(testDirectory, "topic-replay-subset-evidence-"),
    );
    try {
        const input = await fixture(root, 55);
        const { snapshot } = await loadTopicReplay({ input, nodes: "30" });
        const selected = new Set(
            snapshot.nodes.flatMap((node) => node.occurrenceIds),
        );
        const captured = JSON.parse(await readFile(input, "utf8"));
        const outside = captured.topicInput.occurrences.find(
            (occurrence) => !selected.has(occurrence.id),
        );
        assert.ok(outside);
        outside.citations[0].excerpt += " altered";
        await writeFile(input, JSON.stringify(captured));
        await assert.rejects(
            runTopicReplay({
                input,
                nodes: "30",
                output: path.join(root, "invalid-evidence"),
            }),
            /Topic evidence excerpt does not match indexed coordinate length/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("index storage replay preserves data and reuses unchanged artifacts without inference", async () => {
    const root = await mkdtemp(
        path.join(testDirectory, "topic-index-replay-test-"),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
        throw new Error("Index replay attempted network access");
    };
    try {
        const input = await fixture(root);
        const generation = path.join(root, "index", "generation");
        await mkdir(generation, { recursive: true });
        const manifest = path.join(generation, "corpus_data.json");
        await writeSegmentedJson(
            manifest,
            {
                jsonData: { messages: [{ textChunks: ["Synthetic fixture"] }] },
                binaryData: {
                    relatedEmbeddings: [new Float32Array([1, 0])],
                    messageEmbeddings: [new Float32Array([0, 1])],
                },
            },
            { messages: 1, semanticRefs: 0 },
        );
        const result = await runTopicReplay({
            input,
            mode: "index-storage",
            "index-file": manifest,
            output: path.join(root, "replay"),
            samples: "1",
        });
        assert.equal(result.observations.payloadParity, true);
        assert.ok(result.observations.writes[0].cold.newArtifacts > 0);
        assert.equal(result.observations.writes[0].unchanged.newArtifacts, 0);
        assert.equal(result.identityVerified, true);
    } finally {
        globalThis.fetch = originalFetch;
        await rm(root, { recursive: true, force: true });
    }
});

test("completed curation resumes through the real organization generator without recuration", async () => {
    const root = await mkdtemp(
        path.join(testDirectory, "topic-organize-replay-"),
    );
    try {
        const input = await fixture(root);
        const captured = path.join(root, "captured");
        await runTopicReplay({ input, output: captured });
        const binding = JSON.parse(
            await readFile(path.join(captured, "binding-1.json"), "utf8"),
        );
        const groups = [
            binding.payload.nodes.slice(0, 4),
            binding.payload.nodes.slice(4),
        ];
        await writeFile(
            path.join(captured, "response-1.json"),
            JSON.stringify({
                concepts: groups.map((nodes, index) => ({
                    label: `Synthetic concept ${index}`,
                    scope: "Fixture",
                    purpose: "A scoped fixture reference",
                    salience: 6,
                    memberIds: nodes.map(({ id }) => id),
                    evidenceIds: [
                        ...new Set(nodes.flatMap((node) => node.evidenceIds)),
                    ],
                })),
                deferred: [],
            }),
        );
        const curated = path.join(root, "curated");
        await runTopicReplay({
            input,
            mode: "recorded",
            responses: captured,
            output: curated,
        });

        await test("frozen replay organizes captured watermark input without claiming native packet receipts", async () => {
            const root = await mkdtemp(
                path.join(testDirectory, "topic-watermark-organize-"),
            );
            const originalFetch = globalThis.fetch;
            globalThis.fetch = () =>
                assert.fail("Diagnostic replay invoked network");
            try {
                const input = await fixture(root);
                const captured = JSON.parse(await readFile(input, "utf8"));
                Object.assign(captured.topicInput, {
                    packetReplay: true,
                    curationInputFingerprint: "a".repeat(64),
                    suppressionFingerprint: "b".repeat(64),
                    reusableCurationPackets: [],
                });
                const capturedText = JSON.stringify(captured);
                await writeFile(input, capturedText);
                const model = syntheticModel((messages) => {
                    const payload = JSON.parse(messages[1].content);
                    return {
                        success: true,
                        data: JSON.stringify(
                            Array.isArray(payload)
                                ? { parents: [], related: [] }
                                : {
                                      concepts: payload.nodes.map((node) => ({
                                          label: node.label,
                                          scope: node.scope,
                                          purpose:
                                              "Synthetic evidence-grounded topic",
                                          salience: 6,
                                          memberIds: [node.id],
                                          evidenceIds: node.evidenceIds,
                                      })),
                                      deferred: [],
                                  },
                        ),
                    };
                });
                const inspect = model.inspectRequest;
                model.inspectRequest = (...args) => ({
                    ...inspect(...args),
                    constraints: {
                        inputTokens: 922000,
                        outputTokens: 128000,
                        contextTokens: 1050000,
                        metadata: "configured",
                    },
                });
                const output = path.join(root, "organized");
                const result = await runTopicReplay(
                    {
                        input,
                        output,
                        mode: "live",
                        live: true,
                        organize: true,
                        concurrency: "2",
                        "input-tokens": "24000",
                        "prior-fraction": "0.25",
                        "prior-deltas": true,
                        "compact-ids": true,
                        "frozen-preparation": true,
                        "max-calls": "10",
                    },
                    { initializeModel: () => model },
                );
                assert.equal(result.observations.completed, true);
                assert.equal(result.observations.accountedNodes, 8);
                assert.equal(result.observations.organization.concepts, 8);
                assert.deepEqual(
                    result.observations.calls.map(
                        ({ phase, kind }) => phase ?? kind,
                    ),
                    ["preparation", "reconciliation", "organization"],
                );
                const snapshot = JSON.parse(
                    await readFile(path.join(output, "snapshot.json"), "utf8"),
                );
                assert.equal(snapshot.curationPackets, undefined);
                const nativeInput = structuredClone(captured);
                nativeInput.topicInput.reusableCuration = snapshot.curation;
                await assert.rejects(
                    createConfiguredTopicGenerator({
                        model,
                        mode: {
                            kind: "generative",
                            settings: {
                                concurrency: 2,
                                inputTokenTarget: 24000,
                                priorContextFraction: 0.25,
                                priorDeltas: true,
                                compactIds: true,
                                frozenPreparation: true,
                            },
                        },
                    })(nativeInput, new AbortController().signal),
                    /Topic curation packet prefix does not match checkpoint coverage/,
                );
                assert.equal(await readFile(input, "utf8"), capturedText);
            } finally {
                globalThis.fetch = originalFetch;
                await rm(root, { recursive: true, force: true });
            }
        });
        const progress = path.join(curated, "progress.json");
        const organizationCapture = path.join(root, "organization-capture");
        await assert.rejects(
            runTopicReplay({
                input,
                progress,
                mode: "recorded",
                organize: true,
                responses: path.join(root, "missing-responses"),
                output: organizationCapture,
            }),
            /ENOENT/,
        );
        const organizationBinding = JSON.parse(
            await readFile(
                path.join(organizationCapture, "binding-1.json"),
                "utf8",
            ),
        );
        const topics = organizationBinding.payload;
        assert.equal(topics.length, 2);
        await writeFile(
            path.join(organizationCapture, "response-1.json"),
            JSON.stringify({
                parents: [{ parentId: topics[0].id, childId: topics[1].id }],
                related: [],
            }),
        );
        const result = await runTopicReplay({
            input,
            progress,
            mode: "recorded",
            organize: true,
            responses: organizationCapture,
            output: path.join(root, "organized"),
        });
        assert.equal(result.observations.completed, true);
        assert.equal(result.observations.calls.length, 1);
        assert.equal(result.observations.calls[0].kind, "organization");
        assert.deepEqual(result.observations.organization, {
            concepts: 2,
            parents: 1,
            related: 0,
        });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
