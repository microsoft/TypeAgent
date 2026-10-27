// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { indexedTopicOccurrence } from "../../packages/memory/service/dist/topicIncidence.js";
import { runTopicReplay } from "./topic-curation-replay.mjs";
import { writeSegmentedJson } from "../../packages/knowPro/dist/segmentedJson.js";

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
    const root = await mkdtemp(path.join(os.tmpdir(), "topic-replay-test-"));
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
    const root = await mkdtemp(path.join(os.tmpdir(), "topic-replay-test-"));
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
    const root = await mkdtemp(path.join(os.tmpdir(), "topic-replay-resume-"));
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

test("index storage replay preserves data and reuses unchanged artifacts without inference", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "topic-index-replay-test-"),
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
        path.join(os.tmpdir(), "topic-organize-replay-"),
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
