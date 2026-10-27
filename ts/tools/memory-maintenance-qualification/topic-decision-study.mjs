// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { open, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
    assertCheckpoint,
    snapshotCompiledCheckpoint,
    writeJson,
} from "./harness.mjs";
import { liveDependencyCheckpoint } from "./live-stages.mjs";
import { hashValue as hash } from "./replay-artifacts.mjs";

export function validateFrozenTopicInput(input) {
    assert.equal(
        input?.pipeline,
        "topics-v1",
        "Frozen replay requires captured topic incidence",
    );
    assert.deepEqual(
        input.inputs,
        [],
        "Reader passages/questions must not enter topic construction",
    );
    const allowed = new Set([
        "corpusId",
        "actor",
        "definition",
        "expectedVersion",
        "targetRevisionId",
        "bounds",
        "inputs",
        "influenceSources",
        "influenceEvents",
        "pipeline",
        "model",
        "fingerprint",
        "topicInput",
    ]);
    assert.ok(
        Object.keys(input).every((key) => allowed.has(key)),
        "Unexpected frozen-input field",
    );
    assert.ok(
        Array.isArray(input.topicInput?.occurrences),
        "Complete occurrences are required",
    );
    assert.ok(
        Object.keys(input.topicInput).every((key) =>
            ["occurrences", "authoredLabels", "indexGeneration"].includes(key),
        ),
        "From-scratch replay cannot reuse prose, decisions or hidden annotations",
    );
    assert.equal(input.definition?.wiki?.query, "Complete topic incidence");
}

function ratio(numerator, denominator) {
    return denominator ? numerator / denominator : null;
}
function pairCounts(items, predicted) {
    let truePositive = 0,
        falsePositive = 0,
        falseNegative = 0,
        highRiskFalseMerges = 0;
    const admitted = items.filter((item) => item.admission === "admit");
    for (let left = 0; left < admitted.length; left++)
        for (let right = left + 1; right < admitted.length; right++) {
            const a = admitted[left],
                b = admitted[right];
            const expected = a.group === b.group;
            const actual =
                predicted.has(a.nodeId) &&
                predicted.get(a.nodeId) === predicted.get(b.nodeId);
            if (expected && actual) truePositive++;
            if (expected && !actual) falseNegative++;
            if (!expected && actual) {
                falsePositive++;
                if (a.highRisk || b.highRisk) highRiskFalseMerges++;
            }
        }
    return {
        truePositive,
        falsePositive,
        falseNegative,
        highRiskFalseMerges,
        precision: ratio(truePositive, truePositive + falsePositive),
        recall: ratio(truePositive, truePositive + falseNegative),
    };
}
export function evaluateTopicDecision(snapshot, annotations) {
    const predicted = new Map(
        snapshot.curation.concepts.flatMap((concept) =>
            concept.memberIds.map((id) => [id, concept.id]),
        ),
    );
    const nodes = new Set(snapshot.nodes.map((node) => node.id));
    const coverage = {
        rawNodes: nodes.size,
        admittedNodes: predicted.size,
        deferredNodes: snapshot.curation.deferred.length,
        concepts: snapshot.curation.concepts.length,
    };
    if (!annotations) return { coverage, annotationMetrics: null };
    assert.ok(
        annotations.splitId && annotations.reviewerIds?.length >= 2,
        "Annotations need a named split and independently adjudicated reviewer provenance",
    );
    assert.equal(
        new Set(annotations.reviewerIds).size,
        annotations.reviewerIds.length,
    );
    assert.equal(
        annotations.adjudicated,
        true,
        "Disagreements must be adjudicated before scoring",
    );
    assert.ok(
        annotations.reviewerIds.every(
            (id) => typeof id === "string" && id.trim(),
        ),
    );
    const seen = new Set();
    for (const item of annotations.items) {
        assert.ok(
            nodes.has(item.nodeId) && !seen.has(item.nodeId),
            "Unknown or duplicate annotated node",
        );
        seen.add(item.nodeId);
        assert.ok(
            ["admit", "defer", "insufficient_evidence"].includes(
                item.admission,
            ),
        );
        assert.ok(
            item.highRisk === undefined || typeof item.highRisk === "boolean",
        );
        if (item.admission === "admit")
            assert.ok(typeof item.group === "string" && item.group.length);
    }
    const labelled = annotations.items.filter(
        (item) => item.admission !== "insufficient_evidence",
    );
    const truth = labelled.filter((item) => item.admission === "admit").length;
    const positive = labelled.filter((item) =>
        predicted.has(item.nodeId),
    ).length;
    const correct = labelled.filter(
        (item) => item.admission === "admit" && predicted.has(item.nodeId),
    ).length;
    return {
        coverage,
        annotationMetrics: {
            provenance:
                "Supplied adjudicated annotations; reviewer independence is externally verified",
            splitId: annotations.splitId,
            sampledNodes: seen.size,
            scoredNodes: labelled.length,
            fullCorpus: seen.size === nodes.size,
            weighting: "Unweighted labelled sample, not a population estimate",
            insufficientEvidence: annotations.items.length - labelled.length,
            admission: {
                truePositive: correct,
                predictedPositive: positive,
                expectedPositive: truth,
                precision: ratio(correct, positive),
                recall: ratio(correct, truth),
            },
            merge: pairCounts(labelled, predicted),
        },
    };
}

export async function replayTopicDecision({
    input,
    identity,
    generate,
    validate,
    signal,
    onReceipt,
    annotations,
}) {
    validateFrozenTopicInput(input);
    assert.ok(typeof identity === "string" && identity.length);
    const frozen = structuredClone(input);
    const receipts = [];
    const manifest = {
        schemaVersion: 1,
        workload: "frozen-incidence-from-scratch",
        approach: "Decision-only",
        inputHash: hash(input),
        incidenceHash: hash(input.topicInput.occurrences),
        policyIdentity: identity,
        annotationHash: annotations ? hash(annotations) : null,
    };
    const treatment = {
        ...frozen,
        model: identity,
        fingerprint: hash({
            inputHash: manifest.inputHash,
            incidenceHash: manifest.incidenceHash,
            policyIdentity: identity,
        }),
    };
    const started = performance.now();
    const snapshot = await generate(treatment, signal, (receipt) => {
        receipts.push(receipt);
        onReceipt?.(receipt);
    });
    const durationMs = performance.now() - started;
    signal.throwIfAborted();
    validate(snapshot);
    assert.equal(
        hash(snapshot.occurrences),
        manifest.incidenceHash,
        "Complete frozen incidence changed",
    );
    assert.equal(snapshot.corpusId, treatment.corpusId);
    assert.equal(snapshot.inputFingerprint, treatment.fingerprint);
    assert.equal(
        snapshot.recipe,
        `${identity}:editorial-v1:curated-decision-v2`,
    );
    assert.equal(hash(input), manifest.inputHash, "Frozen inputs were mutated");
    return {
        state: "complete",
        manifest,
        durationMs,
        receipts,
        snapshot,
        metrics: evaluateTopicDecision(snapshot, annotations),
        nativeReadinessQualified: false,
        semanticQualityQualified: false,
        limitations: [
            "Frozen replay excludes extraction, store publication and native readiness.",
            "No LLM comparator runs on this host. Cross-host ratios require matched hardware and provider isolation.",
            "Point estimates are not holdout qualification; sample weighting, intervals and nomination-recall audit remain required.",
        ],
    };
}

export async function compiledIdentity(root) {
    const sources = {};
    const visit = async (relative) => {
        for (const entry of await readdir(path.join(root, relative), {
            withFileTypes: true,
        })) {
            const next = path.join(relative, entry.name);
            if (entry.isDirectory()) await visit(next);
            else if (entry.name.endsWith(".ts"))
                sources[next] = createHash("sha256")
                    .update(await readFile(path.join(root, next)))
                    .digest("hex");
        }
    };
    for (const directory of [
        "memory/service",
        "memory/client",
        "aiclient",
        "config",
        "knowPro",
    ])
        await visit(path.join("packages", ...directory.split("/"), "src"));
    for (const file of [
        "topic-decision-study.mjs",
        "topic-decision-microtrial.mjs",
        "topic-decision-sweep.mjs",
        "topic-decision-replay.mjs",
        "replay-artifacts.mjs",
        "replay-tape.mjs",
        "replay-storage.mjs",
        "harness.mjs",
    ]) {
        const relative = path.join(
            "tools",
            "memory-maintenance-qualification",
            file,
        );
        sources[relative] = createHash("sha256")
            .update(await readFile(path.join(root, relative)))
            .digest("hex");
    }
    return {
        ...(await snapshotCompiledCheckpoint(root)),
        ...(await liveDependencyCheckpoint(root)),
        ...sources,
    };
}

async function main() {
    const { values } = parseArgs({
        options: {
            product: { type: "string" },
            input: { type: "string" },
            output: { type: "string" },
            checkpoint: { type: "string" },
            annotations: { type: "string" },
            "freeze-only": { type: "boolean" },
            "authorized-live-topic-decision": { type: "boolean" },
            "isolation-notes": { type: "string" },
        },
    });
    assert.ok(
        values.product && values.output,
        "--product and --output are required",
    );
    const root = path.resolve(values.product),
        output = path.resolve(values.output);
    if (values["freeze-only"]) {
        await writeFile(
            output,
            JSON.stringify(
                {
                    name: "topic-decision-build",
                    sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
                        cwd: root,
                        encoding: "utf8",
                    }).trim(),
                    hashes: await compiledIdentity(root),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        return;
    }
    assert.equal(
        values["authorized-live-topic-decision"],
        true,
        "Live inference requires explicit authorization",
    );
    assert.ok(
        values.input && values.checkpoint && values["isolation-notes"]?.trim(),
        "--input, --checkpoint and --isolation-notes are required",
    );
    const expected = JSON.parse(
        await readFile(path.resolve(values.checkpoint), "utf8"),
    );
    assertCheckpoint(await compiledIdentity(root), expected);
    const input = JSON.parse(
        await readFile(path.resolve(values.input), "utf8"),
    );
    validateFrozenTopicInput(input);
    const annotations = values.annotations
        ? JSON.parse(await readFile(path.resolve(values.annotations), "utf8"))
        : undefined;
    const lockPath = path.join(root, ".topic-decision-study.lock");
    const lock = await open(lockPath, "wx");
    let ownedOutput = false;
    const receipts = [];
    try {
        const load = (file) =>
            import(pathToFileURL(path.join(root, ...file.split("/"))).href);
        const config = await load("packages/config/dist/index.js");
        const client = await load("packages/aiclient/dist/index.js");
        config.loadConfigSync();
        client.initRuntimeConfigFromProcessEnv();
        const product = await load("packages/memory/service/dist/index.js");
        const identity = product.configuredTopicDecisionIdentity(
            process.env.TYPEAGENT_BENCHMARK_MODEL,
        );
        const machine = {
            platform: os.platform(),
            release: os.release(),
            arch: os.arch(),
            cpu: os.cpus()[0]?.model,
            logicalCpus: os.cpus().length,
            ramBytes: os.totalmem(),
            node: process.version,
            isolationNotes: values["isolation-notes"],
        };
        await writeFile(
            output,
            JSON.stringify({
                state: "running",
                machine,
                checkpoint: expected,
                inputHash: hash(input),
            }),
            { flag: "wx" },
        );
        ownedOutput = true;
        await writeFile(`${output}.calls.jsonl`, "", { flag: "wx" });
        const result = await replayTopicDecision({
            input,
            identity,
            annotations,
            signal: AbortSignal.timeout(3000000),
            onReceipt: (receipt) => {
                receipts.push(receipt);
                appendFileSync(
                    `${output}.calls.jsonl`,
                    `${JSON.stringify(receipt)}\n`,
                );
            },
            validate: product.validateTopicSnapshot,
            generate: (captured, signal, onReceipt) =>
                product.createConfiguredTopicGenerator(
                    process.env.TYPEAGENT_BENCHMARK_MODEL,
                    undefined,
                    true,
                    () => ({
                        model: product.configuredTopicDecisionModel(),
                        onReceipt,
                    }),
                )(captured, signal),
        });
        assertCheckpoint(await compiledIdentity(root), expected);
        assert.equal(
            product.configuredTopicDecisionIdentity(
                process.env.TYPEAGENT_BENCHMARK_MODEL,
            ),
            identity,
            "Provider/configuration changed during the trial",
        );
        await writeJson(output, { ...result, machine, checkpoint: expected });
    } catch (error) {
        if (ownedOutput)
            await writeJson(output, {
                state: "failed",
                inputHash: hash(input),
                checkpoint: expected,
                receipts,
                error: {
                    name: error instanceof Error ? error.name : "UnknownError",
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
        console.error(error.message);
        process.exitCode = 1;
    });
