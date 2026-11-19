// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { identity, sha256 } from "./quality-contract.mjs";
import {
    campaignContract,
    campaignContractV2,
    campaignSchedule,
    validateConstructionPacket,
    validateCampaign,
    validateCampaignRun,
    validateIngestionMapping,
    validateCampaignWitness,
    scoreCampaignArtifacts,
    validateExampleRunArtifacts,
} from "./quality-view-campaign.mjs";
import {
    measurementContract,
    scoreCampaignMeasurements,
    scoreReviewedTopicSnapshot,
} from "./quality-campaign-measurements.mjs";
import {
    assessCampaignRelease,
    scoreCampaignUsefulness,
    validateSplitIsolation,
} from "./quality-campaign-release.mjs";
import {
    executeCampaign,
    snapshotCampaignImplementation,
} from "./quality-campaign-execution.mjs";
import { main as campaignMain } from "./quality-view-campaign-cli.mjs";

const quote = "The accountable owner is unassigned.";
const h = sha256("");

test("execution CLI runs its entry point without dispatching from help or invalid arguments", async () => {
    const execute = promisify(execFile);
    const entry = fileURLToPath(
        new URL("./quality-campaign-execution.mjs", import.meta.url),
    );
    const help = await execute(process.execPath, [entry, "--help"]);
    assert.match(help.stdout, /Authorized execution only/);
    await assert.rejects(execute(process.execPath, [entry]), (error) => {
        assert.match(error.stderr, /Expected --spec/);
        assert.equal(error.code, 1);
        return true;
    });
});

test("campaign construction accepts canonical projects but rejects mismatched project/source order", () => {
    const f = fixture();
    const bundle = f.packet.bundles[0];
    bundle.kind = "projectBrief";
    bundle.project = {
        id: bundle.id,
        meetingIds: bundle.sources.map((source) => source.id),
    };
    assert.equal(validateConstructionPacket(f.packet), identity(f.packet));
    bundle.project.id = "different-project";
    assert.throws(
        () => validateConstructionPacket(f.packet),
        /Canonical project identity/,
    );
    bundle.project.id = bundle.id;
    bundle.project.meetingIds = [];
    assert.throws(
        () => validateConstructionPacket(f.packet),
        /ordered meetings/,
    );
});

function fixture() {
    const packet = {
        schemaVersion: 1,
        purpose: "construction-only",
        dataset: "original",
        release: {
            repository: "original-authored",
            revision: "v1",
            files: [{ path: "sources.json", sha256: h }],
            license: "MIT",
        },
        bundles: [
            {
                id: "case-1",
                kind: "wiki",
                query: "Ownership",
                aliases: [],
                sources: [
                    {
                        id: "dataset-source",
                        version: "dataset-v2",
                        title: "Ownership note",
                        text: quote,
                        sha256: sha256(quote),
                    },
                ],
            },
        ],
    };
    const campaign = {
        schemaVersion: 1,
        contract: campaignContract,
        id: "campaign-1",
        constructionHash: identity(packet),
        dataset: packet.dataset,
        phase: "development",
        seed: "frozen-seed",
        exclusions: [],
        inventory: [
            {
                id: "case-1",
                clusters: {
                    source: ["dataset-source"],
                    topic: ["ownership"],
                    project: ["initiative"],
                    meeting: [],
                },
            },
        ],
        thresholds: null,
    };
    const run = {
        schemaVersion: 1,
        campaignHash: identity(campaign),
        id: "run-1",
        startedAt: "2026-11-07T12:00:00Z",
        permissionRecordHash: h,
        generations: 1,
        caseIds: ["case-1"],
        arms: [
            {
                id: "baseline",
                sourceCommit: "a".repeat(40),
                patchHash: h,
                configurationHash: h,
                providerSettingsHash: h,
                promptHash: h,
                schemaHash: h,
                indexHash: h,
                eligibleSourcesHash: h,
                nodeVersion: "24",
                provider: "test-provider",
                model: "test-model",
                indexGeneration: "1",
                configurationIdentity: "local-fixture",
                execution: "live",
            },
        ],
        budget: { calls: 0, tokens: 0, cost: 0 },
    };
    const mapping = {
        schemaVersion: 1,
        constructionHash: identity(packet),
        records: [
            {
                caseId: "case-1",
                sourceId: "dataset-source",
                sourceVersion: "dataset-v2",
                corpusId: "owned-corpus",
                ingestedSourceId: "actual-source",
                revisionId: "actual-revision-37",
                contentHash: sha256(quote),
                retainedText: quote,
            },
        ],
    };
    const evidence = {
        corpusId: "owned-corpus",
        sourceId: "actual-source",
        revisionId: "actual-revision-37",
        locator: `indexed:0:${sha256(quote)}:0-${quote.length}`,
        excerpt: quote,
        blockText: quote,
    };
    const citation = {
        sourceId: evidence.sourceId,
        revisionId: evidence.revisionId,
        locator: evidence.locator,
        excerpt: quote,
    };
    const content = {
        kind: "wiki",
        construction: "informational-wiki-v1",
        title: "Ownership",
        summary: quote,
        index: [
            { pageId: "page-1", title: "Accountability", taxonomy: "project" },
        ],
        sections: [
            {
                id: "page-1",
                role: "page",
                heading: "Accountability",
                body: quote,
                details: {
                    kind: "page",
                    construction: "informational-wiki-v1",
                    taxonomy: "project",
                    note: "",
                    mergedPageIds: [],
                },
            },
        ],
        citations: [citation],
    };
    const row = {
        ...campaignSchedule(run)[0],
        status: "ok",
        stage: "complete",
        component: "informationalWiki",
        reason: "Completed fixture attempt",
        targetDisposition: "admitted",
        targetViewId: "page-1",
        saved: JSON.stringify(content),
        rendered: `Ownership\n${quote}`,
        serializedRequest: `Selected original evidence: ${quote}`,
        telemetry: {
            calls: 0,
            tokens: 0,
            reservations: 0,
            latencyMs: 1,
            cost: 0,
        },
        selectedEvidence: [evidence],
        citationResolutions: [{ ...evidence, resolvedText: quote }],
    };
    const witness = {
        sourceId: "dataset-source",
        sourceVersion: "dataset-v2",
        corpusId: evidence.corpusId,
        ingestedSourceId: evidence.sourceId,
        revisionId: evidence.revisionId,
        quote,
    };
    const gold = {
        schemaVersion: 1,
        constructionHash: identity(packet),
        cases: [
            {
                id: "case-1",
                expectations: [
                    {
                        id: "owner-qualification",
                        metric: "qualification",
                        requirement:
                            "Do not assign a reviewer as accountable owner",
                        critical: true,
                        accessible: true,
                        witnesses: [witness],
                    },
                    {
                        id: "ownership-reference",
                        metric: "wikiReference",
                        requirement: "Ownership coverage",
                        critical: false,
                        accessible: true,
                        witnesses: [witness],
                    },
                ],
            },
        ],
    };
    const review = {
        status: "approved-independent-human-review",
        constructionHash: identity(packet),
        goldHash: identity(gold),
        author: "fixture-author",
        reviewer: "independent-reviewer",
        reviewedAt: "2026-11-07T11:00:00Z",
    };
    const annotation = {
        id: row.id,
        status: "approved-independent-human-review",
        author: "generator-owner",
        reviewer: "independent-reviewer",
        reviewedAt: "2026-11-07T13:00:00Z",
        goldHash: identity(gold),
        mappingHash: identity(mapping),
        allVerifiableClaimsReviewed: true,
        savedConsistent: true,
        claims: ["saved", "rendered"].map((artifact) => ({
            id: artifact,
            artifact,
            quote,
            supported: true,
            critical: true,
            rationale: "Exact support",
            errors: [],
            witnesses: [witness],
        })),
        expectations: gold.cases[0].expectations.map((e) => ({
            id: e.id,
            selected: true,
            preserved: true,
            correct: true,
            requestQuote: quote,
            outputQuote: quote,
            savedQuote: quote,
            rationale: "Reviewed supported requirement",
            witnesses: e.witnesses,
        })),
    };
    const outputs = {
        schemaVersion: 1,
        runHash: identity(run),
        mappingHash: identity(mapping),
        records: [row],
    };
    const annotations = {
        schemaVersion: 1,
        runHash: identity(run),
        goldHash: identity(gold),
        records: [annotation],
    };
    const value = {
        packet,
        campaign,
        run,
        mapping,
        gold,
        review,
        outputs,
        annotations,
    };
    rebind(value);
    return value;
}

function rebind(f) {
    f.campaign.constructionHash = identity(f.packet);
    f.run.campaignHash = identity(f.campaign);
    f.mapping.constructionHash = identity(f.packet);
    f.gold.constructionHash = identity(f.packet);
    f.review.constructionHash = identity(f.packet);
    f.review.goldHash = identity(f.gold);
    f.outputs.runHash = identity(f.run);
    f.outputs.mappingHash = identity(f.mapping);
    f.annotations.runHash = identity(f.run);
    f.annotations.goldHash = identity(f.gold);
    for (const row of f.outputs.records) {
        row.hashes = Object.fromEntries(
            ["saved", "rendered", "serializedRequest"].map((key) => [
                `${key}Hash`,
                row[key] === null ? null : identity(row[key]),
            ]),
        );
        if (row.requestCapture !== undefined)
            row.hashes.requestCaptureHash = identity(row.requestCapture);
        if (row.checkpointArtifacts !== undefined)
            row.hashes.checkpointArtifactsHash = identity(
                row.checkpointArtifacts,
            );
        const label = f.annotations.records.find(
            (entry) => entry.id === row.id,
        );
        if (label) {
            label.hashes = row.hashes;
            label.goldHash = identity(f.gold);
            label.mappingHash = identity(f.mapping);
        }
    }
}

const score = (f) =>
    scoreCampaignArtifacts(
        f.packet,
        f.campaign,
        f.run,
        f.outputs,
        f.annotations,
        f.gold,
        f.review,
        f.mapping,
    );

function reviewed(value) {
    return {
        status: "approved-independent-human-review",
        artifactHash: identity(value),
        author: "synthetic-protocol-author",
        reviewer: "synthetic-independent-reviewer",
        adjudicated: true,
        adjudicationRecordHash: h,
        reviewedAt: "2026-11-07T13:00:00Z",
    };
}

function measurementFixture() {
    const input = fixture();
    const row = input.outputs.records[0];
    const checkpoint = {
        sequence: 1,
        status: "accepted",
        stage: "complete",
        reason: "",
        revisionId: "revision-1",
    };
    row.checkpointArtifacts = {
        contract: "memory-view-checkpoint-artifacts-v1",
        schedule: JSON.stringify({ checkpoints: [checkpoint] }),
        records: [
            {
                ...checkpoint,
                saved: row.saved,
                rendered: row.rendered,
                evidence: null,
            },
        ],
    };
    rebind(input);
    const rubric = {
        schemaVersion: 2,
        contract: measurementContract,
        constructionHash: identity(input.packet),
        goldHash: identity(input.gold),
        cases: [
            {
                id: row.caseId,
                facts: input.gold.cases[0].expectations.map((entry, index) => ({
                    id: entry.id,
                    importance: index ? 1 : 3,
                    required: true,
                    answerable: true,
                })),
                ordering: [],
                checkpoints: [
                    {
                        sequence: 1,
                        expectations: [
                            {
                                id: "uptake",
                                kind: "newFactUptake",
                                requirement: "Preserve the owner qualification",
                                witnesses:
                                    input.gold.cases[0].expectations[0]
                                        .witnesses,
                            },
                        ],
                    },
                ],
            },
        ],
    };
    const span = {
        start: row.rendered.indexOf(quote),
        end: row.rendered.indexOf(quote) + quote.length,
        quote,
    };
    const measurement = {
        id: row.id,
        hashes: row.hashes,
        ordering: [],
        caveats: [],
        allCaveatsReviewed: true,
        checkpoints: [
            {
                ...checkpoint,
                saved: row.saved,
                rendered: row.rendered,
                hashes: {
                    saved: identity(row.saved),
                    rendered: identity(row.rendered),
                },
                allVerifiableClaimsReviewed: true,
                claims: [
                    {
                        id: "claim",
                        artifact: "rendered",
                        span,
                        supported: true,
                        critical: true,
                        rationale: "Synthetic exact support",
                        witnesses:
                            input.gold.cases[0].expectations[0].witnesses,
                    },
                ],
                expectations: [
                    {
                        id: "uptake",
                        satisfied: true,
                        span,
                        rationale: "Synthetic preservation",
                    },
                ],
            },
        ],
    };
    const measurements = {
        schemaVersion: 2,
        contract: measurementContract,
        rubricHash: identity(rubric),
        outputsHash: identity(input.outputs),
        records: [{ ...measurement, review: reviewed(measurement) }],
    };
    return { input, rubric, rubricReview: reviewed(rubric), measurements };
}

function bindMeasurements(f) {
    rebind(f.input);
    f.rubric.constructionHash = identity(f.input.packet);
    f.rubric.goldHash = identity(f.input.gold);
    f.rubricReview = reviewed(f.rubric);
    f.measurements.outputsHash = identity(f.input.outputs);
    f.measurements.rubricHash = identity(f.rubric);
    for (const record of f.measurements.records) {
        record.hashes = f.input.outputs.records.find(
            (row) => row.id === record.id,
        ).hashes;
        for (const checkpoint of record.checkpoints)
            checkpoint.hashes = {
                saved:
                    checkpoint.saved === null
                        ? null
                        : identity(checkpoint.saved),
                rendered:
                    checkpoint.rendered === null
                        ? null
                        : identity(checkpoint.rendered),
            };
        const { review, ...judgment } = record;
        record.review = reviewed(judgment);
    }
}

const measure = (f) =>
    scoreCampaignMeasurements(
        f.input,
        f.rubric,
        f.rubricReview,
        f.measurements,
    );

test("v2 weights required answerable facts and separates selection from correct preservation", () => {
    const f = measurementFixture();
    f.input.annotations.records[0].expectations[0].preserved = false;
    f.input.annotations.records[0].expectations[0].correct = false;
    bindMeasurements(f);
    const result = measure(f);
    assert.equal(result.qualityQualified, false);
    assert.equal(result.details[0].metrics.selectedWeightedCoverage.value, 1);
    assert.equal(
        result.details[0].metrics.preservedWeightedCoverage.value,
        0.25,
    );
    f.rubric.cases[0].facts[0].answerable = false;
    bindMeasurements(f);
    assert.equal(
        measure(f).details[0].metrics.preservedWeightedCoverage.value,
        1,
    );
});

test("v2 exposes empty caveat/order denominators rather than perfect scores", () => {
    const result = measure(measurementFixture());
    assert.equal(result.details[0].metrics.issueOrdering.value, null);
    assert.equal(result.details[0].metrics.caveatRelevance.value, null);
    assert.equal(result.details[0].metrics.newFactUptake.value, 1);
});

for (const [name, mutate, pattern] of [
    [
        "importance",
        (f) => {
            f.rubric.cases[0].facts[0].importance = 0;
        },
        /importance/,
    ],
    [
        "complete facts",
        (f) => {
            f.rubric.cases[0].facts.pop();
        },
        /complete inventory/,
    ],
    [
        "original witnesses",
        (f) => {
            f.rubric.cases[0].checkpoints[0].expectations[0].witnesses[0].quote =
                "Invented";
        },
        /quote|witness/i,
    ],
    [
        "every checkpoint",
        (f) => {
            f.measurements.records[0].checkpoints = [];
        },
        /Every scheduled checkpoint/,
    ],
    [
        "artifact binding",
        (f) => {
            f.measurements.records[0].checkpoints[0].rendered += "invented";
        },
        /captured execution/,
    ],
    [
        "complete claims",
        (f) => {
            f.measurements.records[0].checkpoints[0].allVerifiableClaimsReviewed = false;
        },
        /Complete checkpoint claim/,
    ],
    [
        "complete caveats",
        (f) => {
            f.measurements.records[0].allCaveatsReviewed = false;
        },
        /Complete caveat/,
    ],
]) {
    test(`v2 rejects invalid ${name}`, () => {
        const f = measurementFixture();
        mutate(f);
        bindMeasurements(f);
        assert.throws(() => measure(f), pattern);
    });
}

test("v2 rejects self-review and tampered review bindings", () => {
    const f = measurementFixture();
    f.rubricReview.reviewer = f.rubricReview.author;
    assert.throws(() => measure(f), /independent/);
    f.rubricReview = reviewed(f.rubric);
    f.measurements.records[0].allCaveatsReviewed = false;
    assert.throws(() => measure(f), /artifact binding/);
});

test("v2 scores interrupted checkpoints without rewriting their captured schedule", () => {
    const f = measurementFixture();
    const row = f.input.outputs.records[0];
    row.status = "failed";
    row.reason = "Synthetic child interruption";
    const artifacts = row.checkpointArtifacts;
    const captured = artifacts.records[0];
    captured.status = "running";
    captured.stage = "construction";
    const { saved, rendered, evidence, ...original } = captured;
    artifacts.schedule = JSON.stringify({ checkpoints: [original] });
    const schedule = artifacts.schedule;
    artifacts.reconciliation = {
        contract: "memory-view-checkpoint-reconciliation-v1",
        scheduleHash: sha256(schedule),
        checkpoints: [
            {
                sequence: captured.sequence,
                status: "failed",
                stage: "reconciliation",
                reason: row.reason,
            },
        ],
    };
    const review = f.measurements.records[0].checkpoints[0];
    review.status = "failed";
    review.stage = "reconciliation";
    review.expectations[0].satisfied = false;
    bindMeasurements(f);
    const scored = measure(f).details[0].checkpoints[0];
    assert.equal(scored.status, "failed");
    assert.equal(scored.metrics.newFactUptake.value, 0);
    assert.equal(artifacts.schedule, schedule);
    assert.equal(captured.status, "running");
    artifacts.reconciliation.scheduleHash = h;
    bindMeasurements(f);
    assert.throws(() => measure(f), /bind the original schedule/);
    artifacts.reconciliation.scheduleHash = sha256(schedule);
    artifacts.reconciliation.checkpoints[0].status = "accepted";
    bindMeasurements(f);
    assert.throws(() => measure(f), /only fail interrupted/);
});

test("v2 scores exact reviewed issue spans, allowing ties/incomparability through absent constraints", () => {
    const f = measurementFixture();
    f.rubric.cases[0].ordering = [
        {
            id: "owner-first",
            before: "owner-qualification",
            after: "ownership-reference",
            witnesses: f.input.gold.cases[0].expectations[0].witnesses,
        },
    ];
    f.measurements.records[0].ordering = [
        {
            id: "owner-first",
            before: { quote: "Ownership", start: 0, end: 9 },
            after: { quote, start: 10, end: 10 + quote.length },
        },
    ];
    bindMeasurements(f);
    assert.equal(measure(f).details[0].metrics.issueOrdering.value, 1);
    const verdict = f.measurements.records[0].ordering[0];
    [verdict.before, verdict.after] = [verdict.after, verdict.before];
    bindMeasurements(f);
    assert.equal(measure(f).details[0].metrics.issueOrdering.value, 0);
});

test("v2 caveat relevance and redundancy remain independent reviewed metrics", () => {
    const f = measurementFixture();
    f.measurements.records[0].caveats = [
        {
            id: "caveat",
            span: { quote, start: 10, end: 10 + quote.length },
            relevant: true,
            redundant: true,
            rationale: "Protocol test, not real reviewed gold",
        },
    ];
    bindMeasurements(f);
    const metrics = measure(f).details[0].metrics;
    assert.equal(metrics.caveatRelevance.value, 1);
    assert.equal(metrics.caveatNonRedundancy.value, 0);
});

test("topic measurements reuse admission/merge/split scoring with complete hierarchy review", () => {
    const snapshot = {
        nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
        curation: {
            concepts: [
                { id: "one", memberIds: ["a"] },
                { id: "two", memberIds: ["b"] },
            ],
            deferred: [{ nodeId: "c" }],
        },
        parents: [{ childId: "a", parentId: "b" }],
    };
    const annotations = {
        splitId: "synthetic-development",
        reviewerIds: ["one", "two"],
        adjudicated: true,
        items: [
            { nodeId: "a", admission: "admit", group: "same" },
            { nodeId: "b", admission: "admit", group: "same" },
            { nodeId: "c", admission: "defer" },
        ],
        hierarchy: [
            {
                ...snapshot.parents[0],
                acceptable: true,
                rationale: "Synthetic reviewed edge",
            },
        ],
    };
    const result = scoreReviewedTopicSnapshot(
        snapshot,
        annotations,
        reviewed({ snapshot, annotations }),
    );
    assert.equal(result.falseSplits, 1);
    assert.equal(result.falseMerges, 0);
    assert.equal(result.annotationMetrics.admission.recall, 1);
    assert.equal(result.hierarchyAcceptability.value, 1);
    const invalid = structuredClone(snapshot);
    invalid.parents[0].parentId = "one";
    const invalidAnnotations = structuredClone(annotations);
    invalidAnnotations.hierarchy[0].parentId = "one";
    assert.throws(
        () =>
            scoreReviewedTopicSnapshot(
                invalid,
                invalidAnnotations,
                reviewed({
                    snapshot: invalid,
                    annotations: invalidAnnotations,
                }),
            ),
        /actual topic nodes/,
    );
    snapshot.curation.concepts[0].memberIds.push("b");
    assert.throws(
        () =>
            scoreReviewedTopicSnapshot(
                snapshot,
                annotations,
                reviewed({ snapshot, annotations }),
            ),
        /multiply assigned/,
    );
});

function releaseFixture() {
    const f = measurementFixture();
    const second = JSON.parse(
        JSON.stringify(measurementFixture())
            .replaceAll("case-1", "case-2")
            .replaceAll("dataset-source", "dataset-source-2")
            .replaceAll("actual-source", "actual-source-2")
            .replaceAll("ownership", "ownership-2")
            .replaceAll("initiative", "initiative-2"),
    );
    second.input.packet.bundles[0].sources[0].text +=
        "\nSynthetic independent document.";
    const source = second.input.packet.bundles[0].sources[0];
    source.sha256 = sha256(source.text);
    second.input.mapping.records[0].retainedText = source.text;
    second.input.mapping.records[0].contentHash = source.sha256;
    for (const key of [
        "packet",
        "campaign",
        "mapping",
        "gold",
        "outputs",
        "annotations",
    ]) {
        const field = {
            packet: "bundles",
            campaign: "inventory",
            mapping: "records",
            gold: "cases",
            outputs: "records",
            annotations: "records",
        }[key];
        f.input[key][field].push(...second.input[key][field]);
    }
    f.rubric.cases.push(...second.rubric.cases);
    f.measurements.records.push(...second.measurements.records);
    const { input } = f;
    input.packet.dataset = "freshwiki";
    input.campaign.dataset = "freshwiki";
    input.campaign.phase = "confirmation";
    input.campaign.thresholds = {
        status: "preregistered",
        registeredBy: "synthetic-owner",
        registeredAt: "2026-11-07T10:00:00Z",
        rubricHash: h,
        calibrationRecordHash: h,
        metrics: [
            {
                metric: "supportedClaims",
                direction: "minimum",
                value: 1,
                nonRegressionMargin: 0,
            },
        ],
    };
    input.run.caseIds.push("case-2");
    const candidate = {
        ...input.run.arms[0],
        id: "candidate",
        promptHash: sha256("synthetic-treatment"),
    };
    input.run.arms.push(candidate);
    input.run.budget = { calls: 100, tokens: 10000, cost: 100 };
    for (const row of [...input.outputs.records]) {
        const label = input.annotations.records.find(
            (label) => label.id === row.id,
        );
        const measurement = f.measurements.records.find(
            (record) => record.id === row.id,
        );
        const next = structuredClone(row);
        next.arm = "candidate";
        next.id = JSON.stringify([next.arm, next.caseId, next.generation]);
        next.rendered += "\nCandidate";
        next.checkpointArtifacts.records[0].rendered = next.rendered;
        input.outputs.records.push(next);
        input.annotations.records.push({
            ...structuredClone(label),
            id: next.id,
        });
        const nextMeasurement = {
            ...structuredClone(measurement),
            id: next.id,
        };
        nextMeasurement.checkpoints[0].rendered = next.rendered;
        nextMeasurement.checkpoints[0].hashes.rendered = identity(
            next.rendered,
        );
        f.measurements.records.push(nextMeasurement);
    }
    for (const row of input.outputs.records) {
        const body = JSON.stringify({
            messages: [
                {
                    role: "user",
                    content: JSON.stringify({ fragments: [{ text: quote }] }),
                },
            ],
        });
        row.serializedRequest = body;
        row.requestCapture = {
            contract: "memory-request-capture-v1",
            manifest: JSON.stringify({
                schemaVersion: 1,
                contract: "memory-request-capture-v1",
                caseId: row.caseId,
                requestEvidenceKind: "admitted-dispatch-body",
                calls: [
                    {
                        id: "one",
                        checkpoint: 1,
                        operation: "informational_wiki:normal",
                        requestFile: "calls/one/request.json",
                        requestHash: sha256(body),
                        outcome: { state: "returned", elapsedMs: 1 },
                        usage: null,
                        reservations: [
                            {
                                inputTokens: 10,
                                outputTokens: 10,
                                safetyTokens: 1,
                            },
                        ],
                    },
                ],
            }),
            requests: [{ file: "calls/one/request.json", body }],
        };
    }
    upgradeCampaignV2(f);
    bindMeasurements(f);
    const registry = {
        contract: "memory-view-split-registry-v1",
        development: [
            {
                id: "unopened-development-metadata",
                sourceHashes: [sha256("different development document")],
                clusters: {
                    source: ["dev-source"],
                    topic: ["dev-topic"],
                    project: ["dev-project"],
                    meeting: [],
                },
            },
        ],
        confirmation: input.packet.bundles.map((bundle) => ({
            id: bundle.id,
            sourceHashes: bundle.sources.map((source) => source.sha256),
            clusters: input.campaign.inventory.find(
                (entry) => entry.id === bundle.id,
            ).clusters,
        })),
    };
    const registration = {
        contract: "memory-view-release-v1",
        status: "preregistered",
        runHash: identity(input.run),
        maxCostPerCall: 1,
        campaignHash: identity(input.campaign),
        rubricHash: identity(f.rubric),
        splitRegistryHash: identity(registry),
        registeredAt: "2026-11-07T10:00:00Z",
        registeredBy: "synthetic-owner",
        baseline: "baseline",
        candidate: "candidate",
        usefulnessMinimum: 0.5,
        analysis: {
            clusterKind: "project",
            minClusters: 2,
            seed: 1,
            resamples: 100,
            confidence: 0.95,
        },
        metrics: [
            "supportedClaims",
            "selectedWeightedCoverage",
            "preservedWeightedCoverage",
        ].map((metric) => ({
            metric,
            direction: "minimum",
            threshold: 1,
            nonRegressionMargin: 0,
        })),
    };
    const blinded = {
        contract: "memory-view-blinded-usefulness-v2",
        outputsHash: identity(input.outputs),
        armsHiddenFromReviewers: true,
        assignments: input.run.caseIds.map((caseId) => ({
            id: JSON.stringify([caseId, 1]),
            first: input.outputs.records.find(
                (row) => row.caseId === caseId && row.arm === "baseline",
            ).hashes.renderedHash,
            second: input.outputs.records.find(
                (row) => row.caseId === caseId && row.arm === "candidate",
            ).hashes.renderedHash,
        })),
        judgments: input.run.caseIds.map((caseId) => ({
            id: JSON.stringify([caseId, 1]),
            verdict: "second",
            rationale: "Synthetic protocol judgment only",
        })),
    };
    return {
        ...f,
        registration,
        registry,
        blinded,
        usefulnessReview: reviewed(blinded),
        confirmation: {
            status: "custodian-approved-untouched-confirmation",
            custodian: "synthetic-custodian",
            registrationHash: identity(registration),
            runHash: identity(input.run),
        },
        rollback: {
            status: "tested-compatible",
            recipeHash: h,
            compatibilityTestRecordHash: h,
            qualificationRecordHash: h,
            protections: Object.fromEntries(
                [
                    "allSuppliedCitationIds",
                    "finalFactualRejection",
                    "publicationProof",
                    "legacyServing",
                    "acceptedRevisionSurvivesFailure",
                ].map((key) => [key, true]),
            ),
        },
    };
}

test("release protocol requires actual comparison, review, protected confirmation and compatible rollback evidence", () => {
    const f = releaseFixture();
    const result = assessCampaignRelease(f);
    assert.equal(result.qualityQualified, true, JSON.stringify(result.reasons));
    assert.equal(result.publicationPerformed, false);
    assert.deepEqual(result.comparisons[0].estimate.interval, [0, 0]);
    delete f.confirmation;
    delete f.rollback;
    delete f.blinded;
    const missing = assessCampaignRelease(f);
    assert.equal(missing.qualityQualified, false);
    assert.equal(missing.reasons.length, 3);
});

for (const [name, mutate, pattern] of [
    [
        "split overlap",
        (f) => {
            f.registry.development[0].clusters.source =
                f.registry.confirmation[0].clusters.source;
        },
        /Cross-split leakage/,
    ],
    [
        "post-hoc registration",
        (f) => {
            f.registration.registeredAt = "2026-11-08T12:00:00Z";
        },
        /before execution/,
    ],
    [
        "identical controls",
        (f) => {
            f.input.run.arms[1].promptHash = f.input.run.arms[0].promptHash;
            bindMeasurements(f);
        },
        /Identical treatment/,
    ],
    [
        "provider confounding",
        (f) => {
            f.input.run.arms[1].model = "another-model";
            bindMeasurements(f);
        },
        /changed model/,
    ],
    [
        "overlapping analysis clusters",
        (f) => {
            f.input.campaign.inventory[1].clusters.topic =
                f.input.campaign.inventory[0].clusters.topic;
            bindMeasurements(f);
            f.registration.campaignHash = identity(f.input.campaign);
            f.registration.splitRegistryHash = identity(f.registry);
        },
        /not independent/,
    ],
]) {
    test(`release protocol rejects ${name}`, () => {
        const f = releaseFixture();
        mutate(f);
        if (["identical controls", "provider confounding"].includes(name)) {
            freezeConfirmationReview(f.input);
            bindMeasurements(f);
            f.registration.campaignHash = identity(f.input.campaign);
        }
        if (
            [
                "identical controls",
                "provider confounding",
                "overlapping analysis clusters",
            ].includes(name)
        )
            f.registration.runHash = identity(f.input.run);
        if (name === "split overlap")
            assert.throws(() => validateSplitIsolation(f.registry), pattern);
        else assert.throws(() => assessCampaignRelease(f), pattern);
    });
}

test("release protocol never qualifies too few independent clusters or unsafe rollback", () => {
    const f = releaseFixture();
    f.registration.analysis.minClusters = 3;
    f.confirmation.registrationHash = identity(f.registration);
    f.rollback.protections.finalFactualRejection = false;
    const result = assessCampaignRelease(f);
    assert.equal(result.qualityQualified, false);
    assert(result.reasons.some((reason) => reason.includes("Rollback")));
    assert(result.reasons.some((reason) => reason.includes("cluster")));
});

test("blinded usefulness binds exact artifacts and requires full scheduled-pair review", () => {
    const f = releaseFixture();
    f.blinded.assignments[0].first = h;
    assert.throws(
        () =>
            scoreCampaignUsefulness(
                f.input,
                "baseline",
                "candidate",
                f.blinded,
                reviewed(f.blinded),
            ),
        /exact rendered/,
    );
    f.blinded.judgments.pop();
    assert.throws(
        () =>
            scoreCampaignUsefulness(
                f.input,
                "baseline",
                "candidate",
                f.blinded,
                reviewed(f.blinded),
            ),
        /Every scheduled pair/,
    );
});

test("v2 original gold is independent of ingestion, while actual witnesses remain attempt-scoped", () => {
    const f = releaseFixture();
    assert.deepEqual(
        Object.keys(f.input.gold.cases[0].expectations[0].witnesses[0]),
        ["sourceId", "sourceVersion", "quote"],
    );
    assert.equal(f.input.mapping.records.length, 4);
    f.input.mapping.records[0].attemptId = "unknown-attempt";
    bindMeasurements(f);
    assert.throws(() => measure(f), /unknown attempt/);
});

test("v2 cannot silently accept a v1 mapping or actual-revision gold witness", () => {
    const f = releaseFixture();
    f.input.mapping.schemaVersion = 1;
    bindMeasurements(f);
    assert.throws(() => measure(f), /Duplicate ingestion mapping|run\/mapping/);
    const original = releaseFixture();
    original.input.gold.cases[0].expectations[0].witnesses[0].corpusId =
        "invented";
    bindMeasurements(original);
    assert.throws(() => measure(original), /construction witness/);
});

test("offline CLI wires measurement and release assessment to their reviewed exact artifacts", async (t) => {
    const f = releaseFixture();
    const project = fileURLToPath(new URL("../../", import.meta.url));
    const parent = path.join(project, "examples", "viewExamples", ".test-runs");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, "measurement-cli-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(
        path.join(root, ".quality-view-campaign-owner.json"),
        JSON.stringify({
            schemaVersion: 1,
            purpose: "quality-view-campaign",
            ownerId: "synthetic",
        }),
    );
    const files = {
        construction: f.input.packet,
        campaign: f.input.campaign,
        run: f.input.run,
        outputs: f.input.outputs,
        mapping: f.input.mapping,
        annotations: f.input.annotations,
        gold: f.input.gold,
        review: f.input.review,
        rubric: f.rubric,
        "rubric-review": f.rubricReview,
        measurements: f.measurements,
        registration: f.registration,
        registry: f.registry,
        confirmation: f.confirmation,
        rollback: f.rollback,
        blinded: f.blinded,
        "usefulness-review": f.usefulnessReview,
    };
    for (const [key, value] of Object.entries(files))
        await writeFile(path.join(root, `${key}.json`), JSON.stringify(value));
    for (const command of ["score-measurements", "assess-release"]) {
        const keys = Object.keys(files).filter(
            (key) =>
                command === "assess-release" ||
                ![
                    "registration",
                    "registry",
                    "confirmation",
                    "rollback",
                    "blinded",
                    "usefulness-review",
                ].includes(key),
        );
        let error = "";
        const code = await campaignMain(
            [
                command,
                "--root",
                path.relative(project, root),
                "--out",
                `${command}.json`,
                ...keys.flatMap((key) => [`--${key}`, `${key}.json`]),
            ],
            {
                cwd: project,
                stdout: { write: () => {} },
                stderr: {
                    write: (text) => {
                        error += text;
                    },
                },
            },
        );
        assert.equal(code, 0, error);
        const result = JSON.parse(
            await readFile(path.join(root, `${command}.json`), "utf8"),
        );
        assert.equal(result.qualityQualified, command === "assess-release");
    }
});

test("campaign binds exact admitted requests and annotations, excluding auditor-only selection", () => {
    const f = fixture();
    const row = f.outputs.records[0];
    const request = (text) =>
        JSON.stringify({
            messages: [
                {
                    role: "user",
                    content: JSON.stringify({ fragments: [{ text }] }),
                },
            ],
        });
    const bodies = [request(quote), request("Auditor-only evidence")];
    const manifest = {
        schemaVersion: 1,
        contract: "memory-request-capture-v1",
        caseId: row.caseId,
        requestEvidenceKind: "admitted-dispatch-body",
        calls: bodies.map((body, index) => ({
            id: String(index),
            checkpoint: 1,
            requestFile: `calls/${index}/request.json`,
            requestHash: sha256(body),
            operation:
                index === 0
                    ? "informational_wiki:normal"
                    : "memory_informational_support:validation",
            outcome: { state: "returned", elapsedMs: 1 },
            usage: null,
        })),
    };
    row.serializedRequest = bodies[0];
    row.requestCapture = {
        contract: manifest.contract,
        manifest: JSON.stringify(manifest),
        requests: manifest.calls.map((call, index) => ({
            file: call.requestFile,
            body: bodies[index],
        })),
    };
    rebind(f);
    assert.doesNotThrow(() => score(f));
    const pending = structuredClone(row.requestCapture);
    const pendingManifest = JSON.parse(pending.manifest);
    pendingManifest.calls[1].outcome = null;
    pending.manifest = JSON.stringify(pendingManifest);
    const complete = row.requestCapture;
    row.requestCapture = pending;
    rebind(f);
    assert.throws(() => score(f), /unfinished captured dispatch/);
    row.requestCapture = complete;
    rebind(f);
    f.annotations.records[0].hashes = { ...row.hashes, requestCaptureHash: h };
    assert.throws(
        () => score(f),
        /Annotation output\/request identity mismatch/,
    );
    rebind(f);
    row.serializedRequest = bodies[1];
    rebind(f);
    assert.throws(() => score(f), /construction/i);
});

test("reviewed task metrics join the existing scorecard and critical gate without inventing targets", () => {
    const f = fixture();
    f.gold.cases[0].tasks = [
        {
            id: "admit",
            metric: "topicAdmission",
            subject: "ownership",
            expected: "admitted",
            critical: true,
            requirement: "Useful scoped topic",
            witnesses: f.gold.cases[0].expectations[0].witnesses,
        },
    ];
    f.annotations.records[0].tasks = [
        {
            id: "admit",
            correct: false,
            observed: "deferred",
            rationale: "Reviewed useful evidence was deferred",
            evidence: [{ artifact: "rendered", quote }],
        },
    ];
    rebind(f);
    const summary = score(f).arms.baseline;
    assert.equal(summary.metrics.topicAdmission.value, 0);
    assert.equal(summary.metrics.sourceForgetting.denominator, null);
    assert.equal(summary.metrics.selectedFact.value, 1);
    assert.equal(summary.metrics.preservedFact.value, 1);
    assert.equal(summary.criticalErrors, 1);
    assert.equal(summary.gate.status, "failed");
    f.annotations.records[0].tasks = [];
    assert.throws(() => score(f), /Missing\/unknown task annotation/);
});

test("failed requests with assigned tasks remain in the campaign denominator without output quotes", () => {
    const f = fixture();
    f.gold.cases[0].tasks = [
        {
            id: "admit",
            metric: "topicAdmission",
            subject: "ownership",
            expected: "admitted",
            critical: false,
            requirement: "Useful scoped topic",
            witnesses: f.gold.cases[0].expectations[0].witnesses,
        },
    ];
    const row = f.outputs.records[0];
    Object.assign(row, {
        status: "failed",
        saved: null,
        rendered: null,
        citationResolutions: [],
    });
    const annotation = f.annotations.records[0];
    annotation.claims = [];
    annotation.savedConsistent = false;
    annotation.expectations.forEach((label) =>
        Object.assign(label, {
            preserved: false,
            correct: false,
            savedQuote: null,
            outputQuote: null,
        }),
    );
    annotation.tasks = [
        {
            id: "admit",
            correct: null,
            observed: "uncertain",
            rationale: "Request retained; provider failed before output",
            evidence: [],
        },
    ];
    rebind(f);
    const summary = score(f).arms.baseline;
    assert.equal(summary.attempts, 1);
    assert.equal(summary.failures.value, 1);
    assert.equal(summary.metrics.topicAdmission.denominator, 1);
    assert.equal(summary.metrics.topicAdmission.numerator, 0);
});

test("versioned variable inventory, exact artifacts and independently reviewed scorecard", () => {
    const f = fixture();
    assert.equal(validateConstructionPacket(f.packet), identity(f.packet));
    assert.equal(
        validateCampaignRun(f.run, f.campaign, f.packet),
        identity(f.run),
    );
    const result = score(f);
    assert.equal(result.arms.baseline.metrics.selectedQualification.value, 1);
    assert.equal(result.arms.baseline.metrics.wikiAccessibleReference.value, 1);
    assert.equal(
        result.arms.baseline.metrics.briefTypedAccuracy.denominator,
        null,
    );
    assert.equal(
        result.arms.baseline.gate.status,
        "passed-structural-citation-critical-gate",
    );
    assert.equal(result.arms.baseline.gate.qualityQualified, false);
    assert.equal(result.clusters.project[0].arms.baseline.attempts, 1);
    assert.equal(result.outputsHash, identity(f.outputs));
});

function exampleArtifacts(f) {
    const row = f.outputs.records[0];
    const version = {
        corpusId: "owned-corpus",
        viewId: row.targetViewId,
        revisionId: "view-revision-1",
        version: 1,
        content: JSON.parse(row.saved),
    };
    const saved = JSON.stringify(version, null, 2);
    const requestEvidence = JSON.stringify(
        [
            {
                corpusId: version.corpusId,
                pipeline: "informational-wiki-v1",
                definition: { viewId: version.viewId, kind: "wiki" },
                inputs: [
                    {
                        sourceId: "actual-source",
                        revisionId: "actual-revision-37",
                        contentHash: sha256(
                            "retained-source-content-descriptor",
                        ),
                        passages: version.content.citations,
                    },
                ],
            },
        ],
        null,
        2,
    );
    const sourceMapping = JSON.stringify(
        f.mapping.records.map((m) => ({
            caseId: m.caseId,
            dataset: f.packet.dataset,
            datasetRelease: f.packet.release,
            datasetSourceId: m.sourceId,
            sourceVersion: m.sourceVersion,
            retainedSha256: m.contentHash,
            corpusId: m.corpusId,
            sourceId: m.ingestedSourceId,
            revisionId: m.revisionId,
            contentHash: m.contentHash,
            receipt: { state: "complete" },
        })),
        null,
        2,
    );
    const receipt = {
        schemaVersion: 1,
        mode: "offline",
        qualityBaseline: false,
        requestEvidenceKind: "indexed-build-snapshot",
        status: "ok",
        caseId: "case-1",
        inputHash: identity(f.packet.bundles[0]),
        corpusId: version.corpusId,
        revisionId: version.revisionId,
        savedHash: sha256(`${saved}\n`),
        renderedHash: sha256(`${row.rendered}\n`),
        requestHash: sha256(`${requestEvidence}\n`),
        latencyMs: 29,
        injectedBehavior: { identity: "fixture" },
    };
    return {
        saved: `${saved}\n`,
        rendered: `${row.rendered}\n`,
        requestEvidence: `${requestEvidence}\n`,
        sourceMapping: `${sourceMapping}\n`,
        receipt: `${JSON.stringify(receipt)}\n`,
    };
}

async function executionFixture(t, calls = 4, interrupted = false) {
    const project = fileURLToPath(new URL("../../", import.meta.url));
    const parent = path.join(project, "examples", "viewExamples", ".test-runs");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, "campaign-protocol-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const f = fixture();
    f.outputs.records[0].targetViewId = "case-1";
    const content = JSON.parse(f.outputs.records[0].saved);
    content.sections[0].id = "case-1";
    content.index[0].pageId = "case-1";
    f.outputs.records[0].saved = JSON.stringify(content);
    const artifacts = exampleArtifacts(f);
    const receipt = JSON.parse(artifacts.receipt);
    receipt.mode = "live";
    receipt.injectedBehavior = null;
    receipt.runtime = {
        nodeVersion: process.version,
        synthesisIdentity: "synthetic-child-protocol",
        configurationHash: h,
        providerSettingsHash: h,
        providers: ["test-provider"],
        models: ["test-model"],
    };
    artifacts.receipt = JSON.stringify(receipt);
    const body = JSON.stringify({
        messages: [
            {
                role: "user",
                content: JSON.stringify({ fragments: [{ text: quote }] }),
            },
        ],
    });
    const manifest = {
        schemaVersion: 1,
        contract: "memory-request-capture-v1",
        caseId: "case-1",
        requestEvidenceKind: "admitted-dispatch-body",
        calls: [
            {
                id: "one",
                checkpoint: 1,
                requestFile: "calls/one/request.json",
                requestHash: sha256(body),
                operation: "informational_wiki:normal",
                outcome: { state: "returned", elapsedMs: 1 },
                reservations: [
                    { inputTokens: 10, outputTokens: 10, safetyTokens: 1 },
                ],
                usage: null,
            },
        ],
    };
    const files = {
        "receipt.json": artifacts.receipt,
        "saved.json": artifacts.saved,
        "rendered.txt": artifacts.rendered,
        "source-mapping.json": artifacts.sourceMapping,
        "request-evidence.json": artifacts.requestEvidence,
        "evidence.json": JSON.stringify({
            selectedEvidence: f.outputs.records[0].selectedEvidence,
            citationResolutions: f.outputs.records[0].citationResolutions,
        }),
        "request-calls.json": JSON.stringify(manifest),
        "calls/one/request.json": body,
        "checkpoints.json": JSON.stringify({
            checkpoints: [
                {
                    sequence: 1,
                    status: interrupted ? "running" : "accepted",
                    stage: interrupted ? "construction" : "complete",
                    revisionId: receipt.revisionId,
                },
            ],
        }),
        "revisions/0001/saved.json": artifacts.saved,
        "revisions/0001/rendered.txt": artifacts.rendered,
        "revisions/0001/evidence.json": "{}",
    };
    const childScript = `
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const args = process.argv.slice(2);
const root = args[args.indexOf("--root") + 1];
const authorization = args[args.indexOf("--authorization") + 1];
const execution = JSON.parse(await readFile(path.join(path.dirname(authorization), "execution.json"), "utf8"));
if (execution.schedule.filter(row => row.status === "running").length !== 1)
    throw new Error("Schedule must be persisted before the child starts");
const corpus = createHash("sha256").update(root).digest("hex").slice(0, 20);
const files = JSON.parse((await readFile(new URL("./protocol.json", import.meta.url), "utf8")).replaceAll("owned-corpus", corpus));
const receipt = JSON.parse(files["receipt.json"]);
for (const [field, file] of [["savedHash", "saved.json"], ["renderedHash", "rendered.txt"], ["requestHash", "request-evidence.json"]])
    receipt[field] = createHash("sha256").update(files[file]).digest("hex");
files["receipt.json"] = JSON.stringify(receipt);
for (const [name, data] of Object.entries(files)) {
    const file = path.join(root, ...name.split("/"));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { flag: "wx" });
}
if (${interrupted}) throw new Error("Synthetic child interruption");
`;
    const bindings = [];
    const arms = [];
    for (const id of ["baseline", "candidate"]) {
        const productRoot = path.join(root, id);
        for (const base of [
            "examples/viewExamples",
            "packages/memory/service",
            "packages/memory/client",
            "packages/memory/conversation",
            "packages/aiclient",
            "packages/config",
            "packages/knowPro",
        ])
            for (const directory of ["src", "dist"])
                await mkdir(
                    path.join(productRoot, ...base.split("/"), directory),
                    { recursive: true },
                );
        await writeFile(
            path.join(
                productRoot,
                "examples",
                "viewExamples",
                "dist",
                "cli.js",
            ),
            childScript,
        );
        await writeFile(
            path.join(
                productRoot,
                "examples",
                "viewExamples",
                "dist",
                "protocol.json",
            ),
            JSON.stringify(files),
        );
        await writeFile(
            path.join(
                productRoot,
                "packages",
                "memory",
                "service",
                "dist",
                "viewSynthesis.js",
            ),
            `// Synthetic ${id} protocol fixture; no model calls.`,
        );
        const implementation =
            await snapshotCampaignImplementation(productRoot);
        const arm = {
            ...f.run.arms[0],
            id,
            sourceCommit: implementation.sourceCommit,
            patchHash: implementation.patchHash,
            promptHash: implementation.promptHash,
            schemaHash: implementation.schemaHash,
            eligibleSourcesHash: identity(f.packet),
            nodeVersion: process.version,
            configurationIdentity: "synthetic-child-protocol",
        };
        arms.push(arm);
        bindings.push({
            id,
            productRoot,
            implementationHash: identity(implementation),
            declaredArm: arm,
        });
    }
    f.run.arms = arms;
    f.campaign.schemaVersion = 2;
    f.campaign.contract = campaignContractV2;
    f.run.schemaVersion = 2;
    f.run.campaignHash = identity(f.campaign);
    f.run.generations = 2;
    f.run.budget = { calls, tokens: 1000, cost: 10 };
    const requestBudget = {
        inputTokens: 10000,
        outputTokens: 100,
        safetyTokens: 1,
        elapsedMs: 10000,
        tokenizer: "utf8-bytes-v1",
    };
    const authorization = {
        approved: true,
        identity: "synthetic-child-protocol-test",
        approvedAt: "2026-11-07T10:00:00Z",
        campaignHash: identity(f.campaign),
        caseIds: f.run.caseIds,
        armIds: arms.map((arm) => arm.id),
        generations: 2,
        budget: f.run.budget,
        maxCostPerCall: 1,
        bindingsHash: identity(bindings),
        requestBudgetHash: identity(requestBudget),
        timeoutMs: 10000,
    };
    f.run.permissionRecordHash = identity(authorization);
    const ownedRoot = path.join(root, "campaign");
    await mkdir(ownedRoot);
    await writeFile(
        path.join(ownedRoot, ".quality-view-campaign-owner.json"),
        JSON.stringify({
            schemaVersion: 1,
            purpose: "quality-view-campaign",
            ownerId: "synthetic-test",
        }),
    );
    return {
        project,
        root: path.relative(project, ownedRoot),
        packet: f.packet,
        campaign: f.campaign,
        run: f.run,
        authorization,
        bindings,
        requestBudget,
        timeoutMs: 10000,
    };
}

function freezeConfirmationReview(f) {
    const calibration = {
        status: "approved-independent-human-review",
        rubricHash: f.campaign.thresholds.rubricHash,
        reviewers: ["calibrator-1", "calibrator-2"],
        minimumAgreement: 1,
        reviewedAt: "2026-11-07T08:00:00Z",
        judgments: [
            {
                id: "calibration-regression-fixture",
                artifactHash: identity(f.outputs.records[0].saved),
                votes: [
                    { reviewer: "calibrator-1", verdict: "supported" },
                    { reviewer: "calibrator-2", verdict: "supported" },
                ],
                resolution: "Synthetic regression votes agree",
            },
        ],
    };
    f.campaign.reviewProtocol = {
        schemaVersion: 1,
        status: "approved-independent-human-review",
        author: "rubric-author",
        reviewer: "independent-owner",
        reviewedAt: "2026-11-07T09:00:00Z",
        rubricHash: calibration.rubricHash,
        calibration,
        candidateHashes: f.run.arms.map(identity),
    };
    f.campaign.splitCustody = {
        inventory: f.campaign.inventory,
        assignments: f.campaign.inventory.map(({ id }) => ({
            id,
            phase: "confirmation",
        })),
    };
    f.campaign.thresholds.calibrationRecordHash = identity(calibration);
}

function upgradeCampaignV2(f) {
    const { input } = f;
    input.campaign.schemaVersion = 2;
    input.campaign.contract = campaignContractV2;
    input.run.schemaVersion = 2;
    input.outputs.schemaVersion = 2;
    input.annotations.schemaVersion = 2;
    input.gold.schemaVersion = 2;
    const canonical = ({ sourceId, sourceVersion, quote }) => ({
        sourceId,
        sourceVersion,
        quote,
    });
    for (const entry of input.gold.cases)
        for (const expected of entry.expectations)
            expected.witnesses = expected.witnesses.map(canonical);
    for (const row of input.annotations.records) {
        const output = input.outputs.records.find(
            (output) => output.id === row.id,
        );
        const gold = input.gold.cases.find(
            (entry) => entry.id === output.caseId,
        );
        for (const label of row.expectations)
            label.witnesses = gold.expectations.find(
                (expected) => expected.id === label.id,
            ).witnesses;
    }
    for (const entry of f.rubric.cases) {
        for (const order of entry.ordering)
            order.witnesses = order.witnesses.map(canonical);
        for (const checkpoint of entry.checkpoints)
            for (const expected of checkpoint.expectations)
                expected.witnesses = expected.witnesses.map(canonical);
    }
    input.mapping = {
        ...input.mapping,
        schemaVersion: 2,
        contract: "informational-view-ingestion-v2",
        records: input.outputs.records.flatMap((row) =>
            input.mapping.records
                .filter((record) => record.caseId === row.caseId)
                .map((record) => ({ ...record, attemptId: row.id })),
        ),
    };
    if (input.campaign.phase === "confirmation")
        freezeConfirmationReview(input);
}

test("campaign coordinator executes all frozen arm/generation slots through child protocol and retains unknown usage", async (t) => {
    const spec = await executionFixture(t);
    const result = await executeCampaign(spec);
    assert.equal(result.qualityQualified, false);
    assert.equal(result.outputs.records.length, 4);
    assert.deepEqual(
        result.outputs.records.map((row) => row.status),
        ["ok", "ok", "ok", "ok"],
        JSON.stringify(result.execution),
    );
    assert(
        result.outputs.records.every(
            (row) =>
                row.telemetry.tokens === null && row.telemetry.cost === null,
        ),
    );
    assert.equal(result.mapping.records.length, 4);
    const durable = JSON.parse(
        await readFile(
            path.join(spec.project, spec.root, "execution.json"),
            "utf8",
        ),
    );
    assert(durable.schedule.every((slot) => slot.status === "ok"));
});

test("campaign coordinator records every unattempted slot after reservation exhaustion", async (t) => {
    const spec = await executionFixture(t, 1);
    const result = await executeCampaign(spec);
    assert.deepEqual(
        result.outputs.records.map((row) => row.status),
        ["ok", "missing", "missing", "missing"],
        JSON.stringify(result.execution),
    );
    assert(
        result.outputs.records
            .slice(1)
            .every(
                (row) =>
                    row.telemetry.calls === 0 && row.telemetry.tokens === null,
            ),
    );
    assert(
        result.execution
            .slice(1)
            .every((slot) => slot.status === "not-attempted"),
    );
});

test("campaign coordinator reconciles interrupted children while retaining raw checkpoint schedules", async (t) => {
    const spec = await executionFixture(t, 4, true);
    const result = await executeCampaign(spec);
    assert.equal(result.outputs.records.length, 4);
    assert.deepEqual(
        result.outputs.records.map((row) => row.status),
        ["failed", "missing", "missing", "missing"],
    );
    for (const row of result.outputs.records.slice(0, 1)) {
        const artifacts = row.checkpointArtifacts;
        assert.equal(
            JSON.parse(artifacts.schedule).checkpoints[0].status,
            "running",
        );
        assert.equal(artifacts.records[0].status, "running");
        assert.equal(
            artifacts.reconciliation.scheduleHash,
            sha256(artifacts.schedule),
        );
        assert.equal(artifacts.reconciliation.checkpoints[0].status, "failed");
        assert.equal(
            artifacts.reconciliation.checkpoints[0].stage,
            "reconciliation",
        );
        assert.match(
            artifacts.reconciliation.checkpoints[0].reason,
            /Synthetic child interruption/,
        );
        assert.equal(row.hashes.checkpointArtifactsHash, identity(artifacts));
    }
});

test("campaign coordinator rejects unauthorized settings and mutated frozen implementations before execution", async (t) => {
    const spec = await executionFixture(t);
    spec.requestBudget.inputTokens++;
    await assert.rejects(executeCampaign(spec), /bind frozen deployments/);
    spec.requestBudget.inputTokens--;
    await writeFile(
        path.join(
            spec.bindings[0].productRoot,
            "packages",
            "memory",
            "service",
            "dist",
            "viewSynthesis.js",
        ),
        "// Changed after freeze",
    );
    await assert.rejects(
        executeCampaign(spec),
        /Frozen arm implementation changed/,
    );
});

test("actual example ViewVersion and snapshot artifacts bridge without invented prompts or usage", () => {
    const f = fixture();
    const artifacts = exampleArtifacts(f);
    const result = validateExampleRunArtifacts(f.packet, artifacts);
    assert.equal(result.productionQualityEligible, false);
    assert.equal(result.semanticQualityEvaluated, false);
    assert.equal(result.offlineInjected, true);
    assert.equal(result.serializedRequest, null);
    assert.equal(
        result.hashes.saved.exactStringIdentity,
        identity(artifacts.saved),
    );
    assert.equal(result.mapping.records[0].revisionId, "actual-revision-37");
    assert.notEqual(
        result.selectedPassages[0].snapshotContentHash,
        result.mapping.records[0].contentHash,
    );
    assert.equal(
        result.citationChecks.serviceResolutionEvidence,
        "not-retained",
    );
    assert.deepEqual(result.telemetry, {
        calls: null,
        tokens: null,
        reservations: null,
        latencyMs: null,
        cost: null,
    });
    assert.equal(result.runnerElapsedMs, 29);
});

test("example bridge rejects modified files, source revisions and citation selection", () => {
    for (const mutate of [
        (a) => {
            a.rendered += "changed";
        },
        (a) => {
            const m = JSON.parse(a.sourceMapping);
            m[0].revisionId = "different";
            a.sourceMapping = JSON.stringify(m);
        },
        (a) => {
            const v = JSON.parse(a.saved);
            v.content.citations[0].excerpt = "not selected";
            a.saved = JSON.stringify(v);
            const r = JSON.parse(a.receipt);
            r.savedHash = sha256(a.saved);
            a.receipt = JSON.stringify(r);
        },
    ]) {
        const f = fixture();
        const artifacts = exampleArtifacts(f);
        mutate(artifacts);
        assert.throws(
            () => validateExampleRunArtifacts(f.packet, artifacts),
            /receipt hash|source\/revision|differs from indexed/,
        );
    }
});

test("example receipt hashes bind exact LF bytes without alternate payload acceptance", () => {
    for (const key of ["saved", "rendered", "requestEvidence"]) {
        for (const alter of [
            (raw) => raw.slice(0, -1),
            (raw) => `${raw}\n`,
            (raw) => `${raw.slice(0, -1)}\r\n`,
        ]) {
            const f = fixture();
            const artifacts = exampleArtifacts(f);
            artifacts[key] = alter(artifacts[key]);
            assert.throws(
                () => validateExampleRunArtifacts(f.packet, artifacts),
                /receipt hash mismatch/,
            );
        }
        const f = fixture();
        const artifacts = exampleArtifacts(f);
        const receipt = JSON.parse(artifacts.receipt);
        const hashKey =
            key === "requestEvidence" ? "requestHash" : `${key}Hash`;
        receipt[hashKey] = sha256(artifacts[key].slice(0, -1));
        artifacts.receipt = JSON.stringify(receipt);
        assert.throws(
            () => validateExampleRunArtifacts(f.packet, artifacts),
            /receipt hash mismatch/,
        );
    }
});

test("quality evaluation rejects offline arms, including mixed live/offline matrices", () => {
    for (const execution of ["offline-injected", "offline", undefined]) {
        const f = fixture();
        f.run.arms.push({
            ...f.run.arms[0],
            id: "non-live",
            execution,
        });
        rebind(f);
        assert.throws(
            () => validateCampaignRun(f.run, f.campaign, f.packet),
            /Quality evaluation requires live execution/,
        );
        assert.throws(
            () => score(f),
            /Quality evaluation requires live execution/,
        );
    }
});

test("example declarations and indexed snapshots cannot be relabeled production quality", () => {
    const f = fixture();
    f.outputs.qualityBaseline = false;
    rebind(f);
    assert.throws(() => score(f), /cannot be scored as production quality/);
    f.outputs.requestEvidenceKind = "indexed-build-snapshot";
    assert.throws(() => score(f), /not wire requests/);
    const artifacts = exampleArtifacts(f);
    const receipt = JSON.parse(artifacts.receipt);
    receipt.mode = "live";
    receipt.injectedBehavior = null;
    artifacts.receipt = JSON.stringify(receipt);
    assert.equal(
        validateExampleRunArtifacts(f.packet, artifacts)
            .productionQualityEligible,
        false,
    );
});

test("construction rejects evaluator fields and unknown source hashes", () => {
    const f = fixture();
    f.packet.bundles[0].answer = "hidden answer";
    assert.throws(() => validateConstructionPacket(f.packet), /unknown field/);
    delete f.packet.bundles[0].answer;
    f.packet.bundles[0].sources[0].sha256 = h;
    assert.throws(
        () => validateConstructionPacket(f.packet),
        /source hash mismatch/,
    );
});

test("adapter reviewed structured licenses retain exact construction identity", () => {
    const f = fixture();
    f.packet.release.license = {
        id: "MIT",
        terms: "Pinned repository license",
        reviewed: true,
        underlying: [
            {
                id: "source-terms",
                terms: "Approved source terms",
                reviewed: true,
            },
        ],
    };
    assert.equal(validateConstructionPacket(f.packet), identity(f.packet));
    f.packet.release.license.underlying[0].reviewed = false;
    assert.throws(
        () => validateConstructionPacket(f.packet),
        /Underlying source license review/,
    );
});

test("no frozen quotas: zero-source availability and multiple case inventory", () => {
    const f = fixture();
    const second = structuredClone(f.packet.bundles[0]);
    second.id = "case-2";
    second.sources = [];
    f.packet.bundles.push(second);
    f.campaign.inventory.push({
        id: second.id,
        clusters: {
            source: [],
            topic: ["unavailable-topic"],
            project: [],
            meeting: [],
        },
    });
    rebind(f);
    assert.equal(validateCampaign(f.campaign, f.packet), identity(f.campaign));
});

test("positive generation count and every slot required, duplicates rejected", () => {
    const f = fixture();
    f.run.generations = 0;
    rebind(f);
    assert.throws(() => score(f), /Positive generation/);
    f.run.generations = 2;
    rebind(f);
    assert.throws(() => score(f), /Absent output rows/);
    f.outputs.records.push(structuredClone(f.outputs.records[0]));
    assert.throws(() => score(f), /duplicate/);
});

test("gold approval and annotations bind to gold, artifact and request identities", () => {
    for (const mutate of [
        (f) => {
            f.review.reviewer = f.review.author;
        },
        (f) => {
            f.gold.cases[0].expectations[0].requirement += " changed";
        },
        (f) => {
            f.annotations.records[0].goldHash = h;
        },
        (f) => {
            f.outputs.records[0].serializedRequest += " changed";
        },
        (f) => {
            f.annotations.records[0].allVerifiableClaimsReviewed = false;
        },
    ]) {
        const f = fixture();
        mutate(f);
        assert.throws(
            () => score(f),
            /independent|identity|binding|Every verifiable/,
        );
    }
});

test("expectation witnesses bind exact gold quote and actual ingestion revision", () => {
    const f = fixture();
    const annotation = f.annotations.records[0];
    annotation.expectations[0].witnesses = [
        { ...annotation.expectations[0].witnesses[0], quote: "owner" },
    ];
    assert.throws(() => score(f), /gold witness binding/);
    const good = fixture();
    const retained = validateIngestionMapping(good.mapping, good.packet);
    assert.throws(
        () =>
            validateCampaignWitness(
                {
                    ...good.gold.cases[0].expectations[0].witnesses[0],
                    revisionId: "dataset-v2",
                },
                good.packet.bundles[0],
                retained,
            ),
        /actual ingestion revision/,
    );
});

test("critical unsupported facts and incorrect qualifications cannot pass", () => {
    const f = fixture();
    f.annotations.records[0].claims[0].supported = false;
    f.annotations.records[0].claims[0].errors = ["attribution"];
    f.annotations.records[0].expectations[0].correct = false;
    const result = score(f).arms.baseline;
    assert.equal(result.gate.status, "failed");
    assert.equal(result.metrics.supportedClaims.value, 0.5);
    assert.equal(result.metrics.preservedQualification.value, 0);
    assert.equal(result.criticalErrors, 2);
    assert.equal(result.errors.attribution, 1);
});

test("exact indexed citation resolution mismatch is a visible failed citation gate", () => {
    const f = fixture();
    f.outputs.records[0].citationResolutions[0].resolvedText = "different";
    const result = score(f);
    assert.equal(result.arms.baseline.metrics.citations.value, 0);
    assert.equal(result.arms.baseline.gate.status, "failed");
    assert.match(
        result.details[0].diagnostics[0],
        /Service citation excerpt mismatch/,
    );
});

test("unknown failed telemetry remains unknown, missing attempts do not score perfect", () => {
    const f = fixture();
    const row = f.outputs.records[0];
    row.status = "missing";
    row.reason = "No receipt retained";
    for (const key of ["saved", "rendered", "serializedRequest"])
        row[key] = null;
    row.selectedEvidence = [];
    row.citationResolutions = [];
    for (const key of Object.keys(row.telemetry)) row.telemetry[key] = null;
    f.annotations.records = [];
    rebind(f);
    const result = score(f).arms.baseline;
    assert.equal(result.failures.value, 1);
    assert.equal(result.metrics.preservedQualification.value, 0);
    assert.equal(result.metrics.supportedClaims.denominator, null);
    assert.deepEqual(result.telemetry.tokens, {
        knownTotal: null,
        knownAttempts: 0,
        unknownAttempts: 1,
    });
    assert.equal(result.gate.status, "failed");
    delete row.telemetry.tokens;
    assert.throws(() => score(f), /explicit nonnegative value or null/);
});

test("selected evidence succeeds independently of failed rendered output", () => {
    const f = fixture();
    const row = f.outputs.records[0];
    row.status = "failed";
    row.stage = "synthesis";
    row.reason = "Provider failed after capture";
    row.saved = null;
    row.rendered = null;
    row.citationResolutions = [];
    const label = f.annotations.records[0];
    label.claims = [];
    label.savedConsistent = false;
    for (const e of label.expectations) {
        e.preserved = false;
        e.correct = false;
    }
    rebind(f);
    const result = score(f).arms.baseline;
    assert.equal(result.metrics.selectedQualification.value, 1);
    assert.equal(result.metrics.preservedQualification.value, 0);
    assert.equal(result.metrics.renderedDelivery.value, 0);
    assert.equal(result.gate.status, "failed");
});

test("empty and unavailable reference denominators are distinct, never perfect", () => {
    const f = fixture();
    f.gold.cases[0].expectations = [
        {
            id: "unavailable",
            metric: "wikiReference",
            requirement: "Unavailable reference source",
            critical: false,
            accessible: false,
            witnesses: [],
        },
    ];
    f.annotations.records[0].expectations = [
        {
            id: "unavailable",
            selected: false,
            preserved: false,
            correct: false,
            rationale: "Source unavailable",
            witnesses: [],
        },
    ];
    rebind(f);
    const metrics = score(f).arms.baseline.metrics;
    assert.equal(metrics.selectedQualification.denominator, null);
    assert.equal(metrics.wikiFullReference.value, 0);
    assert.equal(metrics.wikiFullReference.denominator, 1);
    assert.equal(metrics.wikiAccessibleReference.denominator, null);
});

test("external thresholds are explicit preregistration, not frozen pilot defaults", () => {
    const f = fixture();
    f.packet.dataset = "freshwiki";
    f.campaign.dataset = f.packet.dataset;
    rebind(f);
    assert.equal(score(f).arms.baseline.gate.status, "not-preregistered");
    f.campaign.phase = "confirmation";
    rebind(f);
    assert.throws(() => score(f), /thresholds must be preregistered/);
    f.campaign.thresholds = {
        status: "preregistered",
        registeredBy: "evaluation-owner",
        registeredAt: "2026-11-07T10:00:00Z",
        rubricHash: h,
        calibrationRecordHash: h,
        metrics: [
            {
                metric: "wikiAccessibleReference",
                direction: "minimum",
                value: 0.75,
                nonRegressionMargin: 0,
            },
        ],
    };
    freezeConfirmationReview(f);
    rebind(f);
    const result = score(f).arms.baseline;
    assert.equal(result.gate.status, "passed-preregistered-gates");
    assert.equal(result.gate.qualityQualified, true);
    f.campaign.thresholds.registeredAt = "2026-11-08T10:00:00Z";
    rebind(f);
    assert.throws(() => score(f), /registered after/);
});

test("wiki stable page, exact index and readable delivery are independently checked", () => {
    const f = fixture();
    const content = JSON.parse(f.outputs.records[0].saved);
    content.index[0].title = "old title";
    f.outputs.records[0].saved = JSON.stringify(content);
    rebind(f);
    assert.match(score(f).details[0].diagnostics[0], /Exact wiki index/);
    const good = fixture();
    good.annotations.records[0].savedConsistent = false;
    assert.equal(score(good).arms.baseline.metrics.renderedDelivery.value, 0);
    assert.equal(score(good).arms.baseline.metrics.structural.value, 1);
    assert.equal(score(good).arms.baseline.gate.status, "failed");
});

test("brief typed fact accuracy and query coverage are separate with strict nullable unions", () => {
    const f = fixture();
    f.packet.bundles[0].kind = "projectBrief";
    f.packet.dataset = "qmsum-product";
    f.campaign.dataset = f.packet.dataset;
    f.campaign.inventory[0].clusters.meeting = ["meeting-1"];
    const content = JSON.parse(f.outputs.records[0].saved);
    content.kind = "projectBrief";
    content.construction = "informational-project-summary-v1";
    delete content.index;
    const details = [
        { kind: "goalsScope" },
        {
            kind: "owners",
            assignments: [
                {
                    id: "accountability",
                    responsibility: "Accountability",
                    state: "unassigned",
                    owner: null,
                },
            ],
        },
        {
            kind: "status",
            project: "active",
            incident: "closed",
            capacity: "pendingOwnerReview",
        },
        {
            kind: "milestones",
            items: [{ id: "proposal", status: "proposed", date: null }],
        },
        { kind: "decisions", items: [{ id: "decision", status: "confirmed" }] },
        { kind: "risks", items: [], openQuestions: ["Who owns capacity?"] },
        { kind: "context", asOf: null, basis: "unknown" },
    ];
    content.sections = details.map((d) => ({
        id: d.kind,
        role: d.kind,
        heading: d.kind,
        body: quote,
        details: d,
    }));
    f.outputs.records[0].saved = JSON.stringify(content);
    f.gold.cases[0].expectations[0].metric = "briefTypedFact";
    f.gold.cases[0].expectations[1].metric = "briefQuery";
    rebind(f);
    const result = score(f);
    assert.equal(result.arms.baseline.metrics.structural.value, 1);
    assert.equal(result.arms.baseline.metrics.briefTypedAccuracy.value, 1);
    assert.equal(result.arms.baseline.metrics.briefQueryCoverage.value, 1);
    assert.equal(
        result.arms.baseline.metrics.wikiFullReference.denominator,
        null,
    );
    assert.equal(result.clusters.meeting[0].arms.baseline.attempts, 1);
    content.sections[1].details.assignments[0].owner = "Named reviewer";
    f.outputs.records[0].saved = JSON.stringify(content);
    rebind(f);
    assert.match(
        score(f).details[0].diagnostics[0],
        /Unknown\/unassigned owner must be null/,
    );
    content.sections[1].details.assignments[0].owner = null;
    content.openQuestions = [];
    f.outputs.records[0].saved = JSON.stringify(content);
    rebind(f);
    assert.match(score(f).details[0].diagnostics[0], /unknown field/);
});
