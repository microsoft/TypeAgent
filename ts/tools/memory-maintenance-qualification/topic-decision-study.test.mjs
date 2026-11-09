// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
    evaluateTopicDecision,
    replayTopicDecision,
    validateFrozenTopicInput,
} from "./topic-decision-study.mjs";

function input() {
    return {
        corpusId: "test",
        actor: "offline",
        definition: {
            kind: "wiki",
            selector: { kind: "sources", sources: [] },
            wiki: { query: "Complete topic incidence" },
        },
        expectedVersion: 0,
        bounds: {},
        inputs: [],
        pipeline: "topics-v1",
        model: "frozen-previous-policy",
        fingerprint: "frozen",
        topicInput: {
            occurrences: [
                {
                    id: "original",
                    sourceId: "s",
                    revisionId: "r",
                    citations: [],
                },
            ],
        },
    };
}
function partition() {
    return {
        nodes: ["a", "b", "c", "d"].map((id) => ({ id })),
        curation: {
            concepts: [{ id: "one", memberIds: ["a", "b", "c"] }],
            deferred: [{ nodeId: "d", reason: "Passing mention" }],
        },
    };
}
function annotations() {
    return {
        splitId: "calibration-source-family-1",
        reviewerIds: ["reviewer-1", "reviewer-2"],
        adjudicated: true,
        items: [
            {
                nodeId: "a",
                admission: "admit",
                group: "planet",
                highRisk: true,
            },
            { nodeId: "b", admission: "admit", group: "planet" },
            { nodeId: "c", admission: "admit", group: "element" },
            { nodeId: "d", admission: "defer" },
        ],
    };
}

test("frozen replay records treatment and incidence identity without forwarding review judgments", async () => {
    const frozen = input();
    const before = structuredClone(frozen);
    const receipt = { stage: "decision", outcome: "success", durationMs: 1 };
    const result = await replayTopicDecision({
        input: frozen,
        identity: "decision-policy",
        signal: new AbortController().signal,
        validate: (snapshot) =>
            assert.equal(snapshot.curation.deferred.length, 1),
        generate: async (captured, _signal, onReceipt) => {
            assert.equal(captured.model, "decision-policy");
            assert.equal(captured.questions, undefined);
            assert.equal(captured.annotations, undefined);
            onReceipt(receipt);
            return {
                corpusId: captured.corpusId,
                inputFingerprint: captured.fingerprint,
                recipe: `${captured.model}:editorial-v1:curated-decision-v2`,
                occurrences: captured.topicInput.occurrences,
                nodes: [{ id: "raw" }],
                curation: { concepts: [], deferred: [{ nodeId: "raw" }] },
            };
        },
    });
    assert.deepEqual(frozen, before);
    assert.equal(result.state, "complete");
    assert.equal(result.manifest.workload, "frozen-incidence-from-scratch");
    assert.match(result.manifest.incidenceHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(result.receipts, [receipt]);
    assert.equal(result.nativeReadinessQualified, false);
    assert.equal(result.semanticQualityQualified, false);
    assert.equal(result.metrics.annotationMetrics, null);
});

test("sampled admission and merge metrics retain exact denominators and high-risk false merges", () => {
    const result = evaluateTopicDecision(partition(), annotations());
    assert.deepEqual(result.coverage, {
        rawNodes: 4,
        admittedNodes: 3,
        deferredNodes: 1,
        concepts: 1,
    });
    assert.equal(result.annotationMetrics.admission.precision, 1);
    assert.equal(result.annotationMetrics.admission.recall, 1);
    assert.deepEqual(result.annotationMetrics.merge, {
        truePositive: 1,
        falsePositive: 2,
        falseNegative: 0,
        highRiskFalseMerges: 1,
        precision: 1 / 3,
        recall: 1,
    });
    const partial = annotations();
    partial.items.pop();
    assert.equal(
        evaluateTopicDecision(partition(), partial).annotationMetrics
            .fullCorpus,
        false,
    );
});

test("unknown judgments and empty denominators never become invented accuracy", () => {
    const labelled = annotations();
    labelled.items = [{ nodeId: "a", admission: "insufficient_evidence" }];
    const result = evaluateTopicDecision(
        partition(),
        labelled,
    ).annotationMetrics;
    assert.equal(result.scoredNodes, 0);
    assert.equal(result.insufficientEvidence, 1);
    assert.equal(result.admission.precision, null);
    assert.equal(result.admission.recall, null);
    assert.equal(result.merge.precision, null);
});

test("annotation provenance, membership and adjudication are validated before scoring", () => {
    const missing = annotations();
    missing.adjudicated = false;
    assert.throws(
        () => evaluateTopicDecision(partition(), missing),
        /adjudicated/,
    );
    const duplicate = annotations();
    duplicate.items.push(duplicate.items[0]);
    assert.throws(
        () => evaluateTopicDecision(partition(), duplicate),
        /duplicate/,
    );
    const unknown = annotations();
    unknown.items[0].nodeId = "invented";
    assert.throws(() => evaluateTopicDecision(partition(), unknown), /Unknown/);
});

test("reader questions, cached decisions and prose are rejected from frozen construction inputs", () => {
    for (const field of ["questions", "answers", "annotations"])
        assert.throws(
            () => validateFrozenTopicInput({ ...input(), [field]: [] }),
            /Unexpected/,
        );
    const cached = input();
    cached.topicInput.reusableCuration = { concepts: [], deferred: [] };
    assert.throws(() => validateFrozenTopicInput(cached), /cannot reuse/);
});

test("producer failure, cancellation and altered incidence never produce a successful replay", async () => {
    const base = {
        input: input(),
        identity: "decision-policy",
        validate: () => {},
        signal: new AbortController().signal,
    };
    await assert.rejects(
        replayTopicDecision({
            ...base,
            generate: async () => {
                throw new Error("Provider failed");
            },
        }),
        /Provider failed/,
    );
    await assert.rejects(
        replayTopicDecision({
            ...base,
            generate: async (captured) => {
                captured.topicInput.occurrences[0].id = "changed";
                return { occurrences: captured.topicInput.occurrences };
            },
        }),
        /incidence changed/,
    );
    const controller = new AbortController();
    await assert.rejects(
        replayTopicDecision({
            ...base,
            signal: controller.signal,
            generate: async () => {
                controller.abort();
                return {};
            },
        }),
        /abort/i,
    );
});

test("the CLI refuses inference without explicit authorization before importing configured models", () => {
    assert.throws(
        () =>
            execFileSync(
                process.execPath,
                [
                    fileURLToPath(
                        new URL("./topic-decision-study.mjs", import.meta.url),
                    ),
                    "--product",
                    process.cwd(),
                    "--output",
                    "unused-topic-decision-result.json",
                ],
                { stdio: "pipe" },
            ),
        (error) => {
            assert.match(error.stderr.toString(), /explicit authorization/);
            return true;
        },
    );
});

test("frozen study rejects an obsolete Decision recipe rather than qualifying it", async () => {
    await assert.rejects(
        replayTopicDecision({
            input: input(),
            identity: "decision-policy",
            validate: () => {},
            signal: new AbortController().signal,
            generate: async (captured) => ({
                occurrences: captured.topicInput.occurrences,
                corpusId: captured.corpusId,
                inputFingerprint: captured.fingerprint,
                recipe: `${captured.model}:editorial-v1:curated-decision-v1`,
            }),
        }),
        /curated-decision-v[12]/,
    );
});
