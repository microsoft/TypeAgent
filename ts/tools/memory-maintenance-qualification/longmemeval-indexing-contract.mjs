// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

export const categories = [
    "temporal-reasoning",
    "knowledge-update",
    "multi-session",
];
export const digest = (value) =>
    createHash("sha256").update(value).digest("hex");
export const encode = (value) =>
    JSON.stringify(value, (_key, item) =>
        item instanceof Float32Array ? { float32: Array.from(item) } : item,
    );
export const decode = (value) =>
    JSON.parse(value, (_key, item) =>
        item && Object.keys(item).length === 1 && Array.isArray(item.float32)
            ? Float32Array.from(item.float32)
            : item,
    );
export async function writeNew(file, value) {
    await writeFile(file, encode(value), { flag: "wx" });
}
export async function readJson(file) {
    return decode(await readFile(file, "utf8"));
}
export function embeddingConfigurationHash(client, config) {
    return digest(
        encode({
            provider: client.getEmbeddingProvider(),
            dimensions: client.getEmbeddingSize(),
            configuration: config.resolveEmbeddingConfig(
                client.getRuntimeConfig(),
            ),
            hostedTargets: [
                process.env.OPENAI_ENDPOINT_EMBEDDING,
                process.env.AZURE_OPENAI_ENDPOINT_EMBEDDING,
            ],
        }),
    );
}
export function runtimeConfigurationHash(client, config) {
    return digest(encode(config.redactTree(client.getRuntimeConfig())));
}
export function assertPilotProviderConfiguration(
    spec,
    client,
    config,
    configuration,
) {
    if (!spec.indexingPilot) return;
    assert.equal(
        digest(encode(configuration)),
        spec.expectedConfigurationHash,
        "Approved provider configuration changed",
    );
    assert.equal(
        embeddingConfigurationHash(client, config),
        spec.expectedEmbeddingConfigurationHash,
        "Approved embedding configuration changed",
    );
    assert.equal(
        runtimeConfigurationHash(client, config),
        spec.expectedRuntimeConfigurationHash,
        "Approved runtime configuration changed",
    );
}

export function selectPilot(prepared, seed) {
    assert.equal(typeof seed, "string");
    assert.ok(seed.length > 0);
    const inventory = prepared.manifest.originalRowHashes;
    const ids = categories.map((category) => {
        const rows = inventory
            .filter((row) => row.category === category)
            .sort((a, b) => {
                const rank = (row) => digest(`${seed}:${category}:${row.id}`);
                return rank(a).localeCompare(rank(b));
            });
        assert.ok(rows.length, `Missing category: ${category}`);
        return rows[0].id;
    });
    const construction = ids.map((id) => {
        const source = prepared.construction.find((row) => row.id === id);
        assert.ok(source, `Missing construction: ${id}`);
        return structuredClone(source);
    });
    assert.equal(new Set(ids).size, 3);
    return {
        ids,
        construction,
        evaluator: {
            readerOnly: prepared.readerOnly.questions.filter((q) =>
                ids.includes(q.question_id),
            ),
            references: prepared.evaluatorOnly.references.filter((q) =>
                ids.includes(q.question_id),
            ),
        },
    };
}

export function validateConstruction(rows) {
    assert.equal(rows.length, 3);
    for (const row of rows) {
        assert.deepEqual(Object.keys(row).sort(), ["cutoff", "id", "sessions"]);
        assert.ok(row.sessions.length);
        for (const [position, session] of row.sessions.entries()) {
            assert.deepEqual(Object.keys(session).sort(), [
                "date",
                "id",
                "position",
                "turns",
            ]);
            assert.equal(session.position, position);
            assert.ok(session.turns.length);
            for (const turn of session.turns) {
                assert.deepEqual(Object.keys(turn).sort(), ["content", "role"]);
                assert.ok(["user", "assistant"].includes(turn.role));
                assert.equal(typeof turn.content, "string");
            }
        }
    }
}

export async function freezePilot(
    directory,
    prepared,
    seed,
    checkpoint,
    inputs = {},
) {
    const selected = selectPilot(prepared, seed);
    validateConstruction(selected.construction);
    await mkdir(directory);
    const root = await realpath(directory);
    const manifest = {
        schemaVersion: 1,
        runId: randomUUID(),
        seed,
        categories,
        questionIds: selected.ids,
        companionId: selected.ids[0],
        provenance: prepared.manifest,
        checkpoint,
        constructionHash: digest(encode(selected.construction)),
        evaluatorHash: digest(encode(selected.evaluator)),
        inputsHash: digest(encode(inputs)),
        inventory: selected.construction.map((source) => ({
            id: source.id,
            sessions: source.sessions.length,
            turns: source.sessions.reduce(
                (n, session) => n + session.turns.length,
                0,
            ),
            characters: source.sessions.reduce(
                (n, session) =>
                    n +
                    session.turns.reduce(
                        (sum, turn) => sum + turn.content.length,
                        0,
                    ),
                0,
            ),
        })),
        dateInterpretation:
            "Naive official dates interpreted as UTC; original date retained",
        schedule: ["A0", "A1"],
        financialCap: "not-enforced-by-this-runner",
        reviewRubricVersion: 1,
        requiredHumanChecks: [
            "citationSupported",
            "referenceConsistent",
            "judgeAgreement",
        ],
    };
    await writeNew(path.join(root, "construction.json"), selected.construction);
    await writeNew(path.join(root, "evaluator.json"), selected.evaluator);
    await writeNew(path.join(root, "inputs.json"), inputs);
    await writeNew(path.join(root, "manifest.json"), manifest);
    await writeNew(path.join(root, "ownership.json"), {
        runId: manifest.runId,
        manifestHash: digest(encode(manifest)),
        directory: root,
    });
    return manifest;
}

export async function openPilot(directory) {
    const root = await realpath(directory);
    const manifest = await readJson(path.join(root, "manifest.json"));
    const owner = await readJson(path.join(root, "ownership.json"));
    assert.equal(manifest.schemaVersion, 1, "Unknown pilot schema");
    assert.equal(owner.directory, root, "Pilot directory moved");
    assert.equal(owner.runId, manifest.runId);
    assert.equal(
        owner.manifestHash,
        digest(encode(manifest)),
        "Manifest changed",
    );
    const construction = await readJson(path.join(root, "construction.json"));
    assert.equal(digest(encode(construction)), manifest.constructionHash);
    validateConstruction(construction);
    assert.deepEqual(
        construction.map((row) => row.id),
        manifest.questionIds,
    );
    const evaluator = await readJson(path.join(root, "evaluator.json"));
    assert.equal(
        digest(encode(evaluator)),
        manifest.evaluatorHash,
        "Evaluator changed",
    );
    const inputs = await readJson(path.join(root, "inputs.json"));
    assert.equal(digest(encode(inputs)), manifest.inputsHash, "Inputs changed");
    return { root, manifest, construction, inputs };
}

export function validateApproval(approval, manifestHash, checkpoint) {
    assert.equal(approval.schemaVersion, 1);
    assert.equal(
        approval.manifestHash,
        manifestHash,
        "Wrong approved manifest",
    );
    assert.equal(approval.publicDatasetApproved, true);
    assert.equal(approval.configuredProvidersApproved, true);
    assert.equal(
        approval.acceptNoMonetaryCap,
        true,
        "Runner has time limits, not a financial cap; explicit acceptance required",
    );
    assert.equal(approval.checkpointHash, digest(encode(checkpoint)));
    assert.match(approval.chatConfigurationHash, /^[a-f0-9]{64}$/);
    assert.match(approval.dependencyHash, /^[a-f0-9]{64}$/);
    assert.match(approval.embeddingConfigurationHash, /^[a-f0-9]{64}$/);
    assert.match(approval.runtimeConfigurationHash, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(approval.workMinutes));
    assert.ok(approval.workMinutes >= 1 && approval.workMinutes <= 15);
}

export function replayTape(entries, recording = false) {
    const records = new Map(entries.map((entry) => [entry.key, entry]));
    let calls = 0;
    return {
        get calls() {
            return calls;
        },
        entries: () =>
            [...records.values()].sort((a, b) => a.key.localeCompare(b.key)),
        async invoke(method, identity, args, work) {
            const key = digest(encode({ method, identity, args }));
            const existing = records.get(key);
            if (!recording) {
                assert.ok(existing, `Provider replay miss: ${method}`);
                return decode(encode({ value: existing.value })).value;
            }
            calls++;
            const value = await work();
            if (existing)
                assert.equal(
                    encode({ value }),
                    encode({ value: existing.value }),
                    "Non-deterministic duplicate provider input cannot be replayed",
                );
            records.set(key, { key, method, value });
            return value;
        },
    };
}
