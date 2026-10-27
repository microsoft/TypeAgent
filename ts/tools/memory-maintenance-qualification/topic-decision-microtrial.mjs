// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { assertCheckpoint, writeJson } from "./harness.mjs";
import { compiledIdentity } from "./topic-decision-study.mjs";
import { atomicWriteJson, hashValue as hash } from "./replay-artifacts.mjs";

const assigned = (curation) => [
    ...(curation?.concepts.flatMap((concept) => concept.memberIds) ?? []),
    ...(curation?.deferred.map((entry) => entry.nodeId) ?? []),
    ...(curation?.pending?.map((entry) => entry.nodeId) ?? []),
];

export function validateTopicDecisionFixture(fixture, snapshot, pendingIds) {
    assert.ok(
        [
            "historical-state-conditioned-topic-microtrial",
            "frozen-extraction-from-scratch-prefix",
        ].includes(fixture.workload),
        "Unsupported topic fixture workload",
    );
    const fields = new Set([
        "workload",
        "sourceRun",
        "rawSnapshot",
        "rawSnapshotHash",
        "preexistingCuration",
        "selectedFocalIds",
        "stopAfterNewNodes",
        "qualification",
    ]);
    assert.ok(
        Object.keys(fixture).every((key) => fields.has(key)),
        "Unexpected fixture field",
    );
    assert.ok(
        !snapshot.curation && !snapshot.curationProgress,
        "Raw snapshot must not contain curation",
    );
    assert.ok(
        Number.isSafeInteger(fixture.stopAfterNewNodes) &&
            fixture.stopAfterNewNodes > 0,
    );
    assert.equal(fixture.selectedFocalIds.length, fixture.stopAfterNewNodes);
    assert.equal(
        new Set(fixture.selectedFocalIds).size,
        fixture.stopAfterNewNodes,
    );
    assert.deepEqual(
        fixture.selectedFocalIds,
        pendingIds.slice(0, fixture.stopAfterNewNodes),
        "Fixture must select the exact next focal prefix",
    );
    if (fixture.workload === "frozen-extraction-from-scratch-prefix")
        assert.equal(
            fixture.preexistingCuration,
            null,
            "From-scratch prefixes cannot reuse decisions",
        );
}

export async function replayTopicDecisionFixture({
    fixture,
    snapshot,
    identity,
    pendingIds,
    curate,
    validate,
    signal,
    onReceipt,
}) {
    validateTopicDecisionFixture(fixture, snapshot, pendingIds);
    validate(snapshot);
    if (fixture.preexistingCuration)
        validate({
            ...snapshot,
            curationProgress: fixture.preexistingCuration,
        });
    const inputHash = hash(snapshot),
        fixtureHash = hash(fixture);
    const working = structuredClone(snapshot);
    working.inputFingerprint = hash({ inputHash, fixtureHash, identity });
    const receipts = [];
    const started = performance.now();
    const curation = await curate(
        working,
        structuredClone(fixture.preexistingCuration ?? undefined),
        fixture.stopAfterNewNodes,
        signal,
        (receipt) => {
            receipts.push(receipt);
            onReceipt?.(receipt);
        },
    );
    signal.throwIfAborted();
    validate({ ...working, curationProgress: curation });
    const expected = [
        ...new Set([
            ...assigned(fixture.preexistingCuration),
            ...fixture.selectedFocalIds,
        ]),
    ].sort();
    assert.deepEqual(
        assigned(curation).sort(),
        expected,
        "Diagnostic run changed assigned scope",
    );
    assert.equal(hash(snapshot), inputHash, "Frozen raw inputs were mutated");
    assert.equal(hash(fixture), fixtureHash, "Frozen fixture was mutated");
    return {
        state: "diagnostic-prefix-complete",
        durationMs: performance.now() - started,
        manifest: {
            workload: fixture.workload,
            inputHash,
            fixtureHash,
            identity,
            selectedFocalIds: fixture.selectedFocalIds,
            newNodes: fixture.stopAfterNewNodes,
        },
        receipts,
        curation,
        nativeReadinessQualified: false,
        semanticQualityQualified: false,
        accuracy: null,
    };
}

export function captureTopicClusterPackets(model, file) {
    return {
        provider: model.provider,
        providerSource: model.providerSource,
        model: model.model,
        configGeneration: model.configGeneration,
        ...(model.checkRequest
            ? { checkRequest: (request) => model.checkRequest(request) }
            : {}),
        decide: async (request, options) => {
            const capture =
                request.state !== null &&
                typeof request.state === "object" &&
                request.state.cluster !== undefined;
            const id = capture ? hash(request) : undefined;
            if (capture)
                appendFileSync(
                    file,
                    JSON.stringify({
                        kind: "request",
                        serializedRequestHash: id,
                        request,
                    }) + "\n",
                );
            const result = await model.decide(request, options);
            if (capture)
                appendFileSync(
                    file,
                    JSON.stringify({
                        kind: "result",
                        serializedRequestHash: id,
                        result,
                    }) + "\n",
                );
            return result;
        },
    };
}

export function captureTopicClusterCompletion(complete, file) {
    return async (...args) => {
        const capture = args[1]?.memberKeys !== undefined;
        const request = {
            instructions: args[0],
            payload: args[1],
            schema: args[5],
        };
        const id = capture ? hash(request) : undefined;
        if (capture)
            appendFileSync(
                file,
                JSON.stringify({
                    kind: "generative-request",
                    serializedRequestHash: id,
                    request,
                }) + "\n",
            );
        const result = await complete(...args);
        if (capture)
            appendFileSync(
                file,
                JSON.stringify({
                    kind: "generative-result",
                    serializedRequestHash: id,
                    result,
                }) + "\n",
            );
        return result;
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
            "packet-policy": { type: "string", default: "v2" },
            concurrency: { type: "string", default: "1" },
            "batch-size": { type: "string", default: "24" },
            lookahead: { type: "string", default: "1" },
            "max-questions": { type: "string", default: "64" },
            "full-transactions": { type: "boolean" },
            "cluster-validation": { type: "boolean" },
            "capture-cluster-packets": { type: "boolean" },
            "work-minutes": { type: "string", default: "10" },
            "isolation-notes": { type: "string" },
            "authorized-live-topic-decision": { type: "boolean" },
        },
    });
    assert.equal(
        values["authorized-live-topic-decision"],
        true,
        "Live inference requires explicit authorization",
    );
    for (const key of ["product", "fixture", "output", "checkpoint"])
        assert.ok(
            values[key] && path.isAbsolute(values[key]),
            `${key} must be absolute`,
        );
    assert.ok(
        ["v2", "factored-best-fit"].includes(values["packet-policy"]),
        "Unknown packet policy",
    );
    assert.ok(
        values["isolation-notes"]?.trim(),
        "Host/provider isolation notes are required",
    );
    const minutes = Number(values["work-minutes"]);
    assert.ok(
        Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 15,
        "Work minutes must be 1-15",
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
    const execution = product.resolveTopicDecisionExecution({
        concurrency: Number(values.concurrency),
        batchSize:
            values["batch-size"] === "context"
                ? "context"
                : Number(values["batch-size"]),
        lookahead: Number(values.lookahead),
        maxQuestions: Number(values["max-questions"]),
        fullTransactions: values["full-transactions"] ?? false,
        clusterValidation: values["cluster-validation"] ?? false,
    });
    const content = await load(
        "packages\\memory\\service\\dist\\viewContent.js",
    );
    const fixture = JSON.parse(await readFile(values.fixture, "utf8"));
    const snapshot = JSON.parse(
        await readFile(
            path.resolve(path.dirname(values.fixture), fixture.rawSnapshot),
            "utf8",
        ),
    );
    assert.equal(
        content.viewHash(snapshot),
        fixture.rawSnapshotHash,
        "Frozen raw snapshot changed",
    );
    const identity = product.configuredTopicDecisionIdentity(
        undefined,
        values["packet-policy"],
        execution,
    );
    const configuredModel = product.configuredTopicDecisionModel();
    const model = values["capture-cluster-packets"]
        ? captureTopicClusterPackets(configuredModel, `${output}.packets.jsonl`)
        : configuredModel;
    const pendingIds = product
        .pendingTopicDecisionNodes(
            snapshot,
            fixture.preexistingCuration ?? undefined,
        )
        .map((node) => node.id);
    validateTopicDecisionFixture(fixture, snapshot, pendingIds);
    const lockPath = path.join(root, ".topic-decision-study.lock");
    const lock = await open(lockPath, "wx");
    let owned = false;
    const receipts = [];
    let progressCheckpoints = 0;
    const startedAt = new Date().toISOString();
    const started = performance.now();
    try {
        await writeFile(
            output,
            JSON.stringify({
                state: "running",
                identity,
                fixtureHash: hash(fixture),
            }),
            { flag: "wx" },
        );
        owned = true;
        await writeFile(`${output}.calls.jsonl`, "", { flag: "wx" });
        if (values["capture-cluster-packets"])
            await writeFile(`${output}.packets.jsonl`, "", { flag: "wx" });
        await writeFile(
            `${output}.progress.json`,
            JSON.stringify({ state: "not-started" }),
            { flag: "wx" },
        );
        const configuredComplete = product.createTopicCompletion();
        const complete = values["capture-cluster-packets"]
            ? captureTopicClusterCompletion(
                  configuredComplete,
                  `${output}.packets.jsonl`,
              )
            : configuredComplete;
        const result = await replayTopicDecisionFixture({
            fixture,
            snapshot,
            identity,
            pendingIds,
            signal: AbortSignal.timeout(minutes * 60000),
            validate: product.validateTopicSnapshot,
            onReceipt: (receipt) => {
                const stamped = {
                    ...receipt,
                    timestamp: new Date().toISOString(),
                    endedAtMs: performance.timeOrigin + performance.now(),
                };
                receipts.push(stamped);
                appendFileSync(
                    `${output}.calls.jsonl`,
                    JSON.stringify(stamped) + "\n",
                );
            },
            curate: (working, reusable, limit, signal, onReceipt) => {
                const evidenceIndex = new product.TopicEvidenceIndex(working);
                return product.curateTopicsWithDecision(
                    working,
                    (node) =>
                        product.summaryEvidence(working, node, evidenceIndex),
                    (rules, payload, schema) =>
                        complete(
                            rules,
                            payload,
                            signal,
                            "topic.microtrial.model",
                            undefined,
                            schema,
                        ),
                    signal,
                    {
                        ...execution,
                        model,
                        packetPolicy: values["packet-policy"],
                        onReceipt,
                    },
                    async (curation) => {
                        product.validateTopicSnapshot({
                            ...working,
                            curationProgress: curation,
                        });
                        await atomicWriteJson(`${output}.progress.json`, {
                            state: "diagnostic-prefix-progress",
                            identity,
                            rawSnapshotHash: fixture.rawSnapshotHash,
                            curation,
                        });
                        progressCheckpoints++;
                    },
                    reusable,
                    limit,
                );
            },
        });
        assertCheckpoint(await compiledIdentity(root), expected);
        assert.equal(
            product.configuredTopicDecisionIdentity(
                undefined,
                values["packet-policy"],
                execution,
            ),
            identity,
        );
        await writeJson(output, {
            ...result,
            startedAt,
            finishedAt: new Date().toISOString(),
            checkpoint: expected,
            packetPolicy: values["packet-policy"],
            execution,
            progressCheckpoints,
            machine: {
                platform: os.platform(),
                release: os.release(),
                arch: os.arch(),
                cpu: os.cpus()[0]?.model,
                logicalCpus: os.cpus().length,
                ramBytes: os.totalmem(),
                node: process.version,
                isolationNotes: values["isolation-notes"],
            },
        });
    } catch (error) {
        if (owned)
            await writeJson(output, {
                state: "failed",
                startedAt,
                durationMs: performance.now() - started,
                identity,
                fixtureHash: hash(fixture),
                receipts,
                error: {
                    name: error.name,
                    message: error.message,
                    code: error?.failure?.code ?? null,
                    httpStatus: error?.failure?.httpStatus ?? null,
                },
            });
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
