// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile, writeFile, open, unlink } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { assertCheckpoint, writeJson } from "./harness.mjs";
import { compiledIdentity } from "./topic-decision-study.mjs";
import { validateTopicDecisionFixture } from "./topic-decision-microtrial.mjs";

export const requestHash = (request) =>
    createHash("sha256").update(JSON.stringify(request)).digest("hex");

export function validateFrozenPackets(frozen, model, countTokens) {
    assert.ok(frozen.packets.length > 0, "Frozen wave must not be empty");
    assert.equal(frozen.requestHashes.length, frozen.packets.length);
    frozen.packets.forEach((packet, index) => {
        assert.equal(
            requestHash(packet.request),
            frozen.requestHashes[index],
            "Frozen request changed",
        );
        assert.equal(
            packet.tokens,
            countTokens(
                JSON.stringify({ model: model.model, ...packet.request }),
            ),
        );
        assert.ok(packet.tokens <= 24576);
        model.checkRequest(packet.request);
    });
}

export function summarizeWave(receipts, durationMs, expectedCalls) {
    const rows = receipts.filter((row) => row.stage === "decision");
    assert.equal(
        rows.length,
        expectedCalls,
        "Wave did not account for all expected calls",
    );
    const intervals = rows.map((row) => [
        row.endedAtMs - row.durationMs,
        row.endedAtMs,
    ]);
    const boundaries = intervals
        .flatMap(([start, end]) => [
            [start, 1],
            [end, -1],
        ])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let active = 0,
        peak = 0;
    for (const [, delta] of boundaries) {
        active += delta;
        peak = Math.max(peak, active);
    }
    return {
        durationMs,
        attempts: rows.length,
        failures: rows.filter((row) => row.outcome !== "success").length,
        peakInFlight: peak,
        requestHashes: rows.map((row) => row.requestHash),
        meanQueueMs:
            rows.reduce((sum, row) => sum + row.queueMs, 0) / rows.length,
        nativeMs: rows.reduce((sum, row) => sum + row.durationMs, 0),
        providerPromptTokens: rows.reduce(
            (sum, row) =>
                sum +
                (row.usage?.prompt_tokens ?? row.usage?.input_tokens ?? 0),
            0,
        ),
    };
}

async function freeze({ product, model, fixture, snapshot, identity }) {
    const control = product.prepareTopicDecisionBatch(
        snapshot,
        { model, batchSize: 24 },
        fixture.preexistingCuration ?? undefined,
        fixture.stopAfterNewNodes,
    );
    assert.deepEqual(control.candidateIds, fixture.selectedFocalIds);
    const capacity = [];
    for (const batchSize of [24, 32, 48, "context"]) {
        const started = performance.now();
        const prepared = product.prepareTopicDecisionBatch(
            snapshot,
            { model, batchSize },
            fixture.preexistingCuration ?? undefined,
            96,
        );
        capacity.push({
            batchSize,
            candidates: prepared.candidateIds.length,
            calls: prepared.packets.length,
            questions: prepared.packets.map(
                (packet) => Object.keys(packet.request.questions).length,
            ),
            tokens: prepared.packets.map((packet) => packet.tokens),
            preparationMs: performance.now() - started,
        });
    }
    return {
        state: "frozen-inference-free",
        identity,
        rawSnapshotHash: fixture.rawSnapshotHash,
        fixtureHash: requestHash(fixture),
        candidateIds: control.candidateIds,
        packets: control.packets,
        requestHashes: control.packets.map((packet) =>
            requestHash(packet.request),
        ),
        capacity,
        limitations: [
            "Capacity probes do not qualify larger-batch semantics or downstream accuracy.",
        ],
    };
}

async function sweep({ product, client, frozen, model, values, output }) {
    const trials = [];
    for (let repeat = 0; repeat < Number(values.repeats); repeat++) {
        const order = repeat % 2 ? [8, 4, 2, 1] : [1, 2, 4, 8];
        for (const concurrency of order) {
            const receipts = [];
            const started = performance.now();
            try {
                const responses = await client.runWithRequestBudget(
                    product.createTopicDecisionBudget(),
                    () =>
                        product.executeTopicDecisionWave(
                            {
                                model,
                                concurrency,
                                onReceipt: (row) => {
                                    const receipt = {
                                        ...row,
                                        endedAtMs:
                                            performance.timeOrigin +
                                            performance.now(),
                                        repeat,
                                        concurrency,
                                    };
                                    receipts.push(receipt);
                                    appendFileSync(
                                        `${output}.calls.jsonl`,
                                        JSON.stringify(receipt) + "\n",
                                    );
                                },
                            },
                            frozen.packets,
                            AbortSignal.timeout(300000),
                            "fixed-packet-concurrency-screen",
                        ),
                );
                const metrics = summarizeWave(
                    receipts,
                    performance.now() - started,
                    frozen.packets.length,
                );
                assert.ok(
                    metrics.peakInFlight <= concurrency,
                    "Concurrency bound exceeded",
                );
                trials.push({
                    state: "complete",
                    repeat,
                    concurrency,
                    ...metrics,
                    answers: responses.map((response) =>
                        Object.fromEntries(
                            Object.entries(response.answers).map(
                                ([key, value]) => [
                                    key,
                                    value.type === "choice"
                                        ? value.choice
                                        : value.score,
                                ],
                            ),
                        ),
                    ),
                });
            } catch (error) {
                trials.push({
                    state: "failed",
                    repeat,
                    concurrency,
                    durationMs: performance.now() - started,
                    error: { name: error.name, message: error.message },
                    receipts,
                });
                await writeJson(output, {
                    state: "failed",
                    trials,
                    isolationNotes: values["isolation-notes"],
                });
                throw error;
            }
            await writeJson(output, { state: "running", trials });
        }
    }
    return {
        state: "screen-complete",
        trials,
        frozenPacketHashes: frozen.requestHashes,
        isolationNotes: values["isolation-notes"],
        accuracy: null,
        nativeReadinessQualified: false,
        semanticQualityQualified: false,
    };
}

export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            product: { type: "string" },
            fixture: { type: "string" },
            output: { type: "string" },
            checkpoint: { type: "string" },
            frozen: { type: "string" },
            "freeze-only": { type: "boolean" },
            "authorized-live-topic-decision": { type: "boolean" },
            repeats: { type: "string", default: "2" },
            "isolation-notes": { type: "string" },
        },
    });
    assert.ok(
        values["freeze-only"] || values["authorized-live-topic-decision"],
        "Explicit inference authorization required",
    );
    for (const key of ["product", "output", "checkpoint"])
        assert.ok(
            values[key] && path.isAbsolute(values[key]),
            `${key} must be absolute`,
        );
    assert.ok(
        [1, 2, 3].includes(Number(values.repeats)),
        "Repeats must be 1..3",
    );
    const root = values.product,
        output = values.output;
    const expected = JSON.parse(await readFile(values.checkpoint, "utf8"));
    assertCheckpoint(await compiledIdentity(root), expected);
    const load = (file) => import(pathToFileURL(path.join(root, file)));
    const config = await load("packages\\config\\dist\\index.js");
    const client = await load("packages\\aiclient\\dist\\index.js");
    config.loadConfigSync();
    client.initRuntimeConfigFromProcessEnv();
    const product = await load("packages\\memory\\service\\dist\\index.js");
    const model = product.configuredTopicDecisionModel();
    const identity = product.configuredTopicDecisionIdentity();
    if (values["freeze-only"]) {
        assert.ok(values.fixture && path.isAbsolute(values.fixture));
        const fixture = JSON.parse(await readFile(values.fixture, "utf8"));
        const snapshot = JSON.parse(
            await readFile(
                path.resolve(path.dirname(values.fixture), fixture.rawSnapshot),
                "utf8",
            ),
        );
        const content = await load(
            "packages\\memory\\service\\dist\\viewContent.js",
        );
        assert.equal(content.viewHash(snapshot), fixture.rawSnapshotHash);
        product.validateTopicSnapshot(snapshot);
        validateTopicDecisionFixture(
            fixture,
            snapshot,
            product
                .pendingTopicDecisionNodes(
                    snapshot,
                    fixture.preexistingCuration ?? undefined,
                )
                .map((node) => node.id),
        );
        const frozen = await freeze({
            product,
            model,
            fixture,
            snapshot,
            identity,
        });
        frozen.checkpointHash = requestHash(expected);
        validateFrozenPackets(frozen, model, client.countO200kTokens);
        await writeFile(output, JSON.stringify(frozen, null, 2), {
            flag: "wx",
        });
        return;
    }
    assert.ok(values.frozen && path.isAbsolute(values.frozen));
    assert.ok(values["isolation-notes"]?.trim(), "Isolation notes required");
    const frozen = JSON.parse(await readFile(values.frozen, "utf8"));
    assert.equal(
        frozen.checkpointHash,
        requestHash(expected),
        "Frozen build checkpoint changed",
    );
    assert.equal(
        identity,
        frozen.identity,
        "Frozen model/config identity changed",
    );
    validateFrozenPackets(frozen, model, client.countO200kTokens);
    const lockPath = path.join(root, ".topic-decision-study.lock");
    const lock = await open(lockPath, "wx");
    let owned = false;
    try {
        await writeFile(
            output,
            JSON.stringify({ state: "running", identity }),
            { flag: "wx" },
        );
        owned = true;
        await writeFile(`${output}.calls.jsonl`, "", { flag: "wx" });
        const result = await sweep({
            product,
            client,
            frozen,
            model,
            values,
            output,
        });
        assertCheckpoint(await compiledIdentity(root), expected);
        assert.equal(product.configuredTopicDecisionIdentity(), identity);
        await writeJson(output, { ...result, identity, checkpoint: expected });
    } catch (error) {
        if (owned) {
            const prior = JSON.parse(await readFile(output, "utf8"));
            await writeJson(output, {
                ...prior,
                state: "failed",
                error: { name: error.name, message: error.message },
            });
        }
        throw error;
    } finally {
        await lock.close();
        await unlink(lockPath);
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
