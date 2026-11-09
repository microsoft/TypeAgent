// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { identity, sha256 } from "./quality-contract.mjs";
import {
    campaignContract,
    campaignSchedule,
    validateConstructionPacket,
    validateCampaign,
    validateCampaignRun,
    validateIngestionMapping,
    validateCampaignWitness,
    scoreCampaignArtifacts,
    validateExampleRunArtifacts,
} from "./quality-view-campaign.mjs";

const quote = "The accountable owner is unassigned.";
const h = sha256("");

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
