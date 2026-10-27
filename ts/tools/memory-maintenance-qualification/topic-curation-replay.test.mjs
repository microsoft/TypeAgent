// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { indexedTopicOccurrence } from "../../packages/memory/service/dist/topicIncidence.js";
import { loadTopicReplay, runTopicReplay } from "./topic-curation-replay.mjs";
import { writeSegmentedJson } from "../../packages/knowPro/dist/segmentedJson.js";
const testDirectory = path.dirname(fileURLToPath(import.meta.url));

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
