// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    loadFrozenFixtures,
    developmentPacket,
    frozenManifestHash,
    validateRun,
    scheduled,
    identity,
    ratio,
    reviewedGold,
    validateWitness,
    unique,
    sha256,
} from "./quality-contract.mjs";
import {
    scoreArtifacts,
    compareArtifacts,
    scoreBlindedUsefulness,
} from "./quality-artifacts.mjs";
import { main } from "./quality-cli.mjs";

const frozen = await loadFrozenFixtures();
const digest = "a".repeat(64);

function runFixture(
    split = "development",
    caseIds = ["w01", "b01"],
    generations = 3,
) {
    return {
        schemaVersion: 1,
        id: "unit-test-only",
        manifestHash: frozenManifestHash,
        split,
        caseIds,
        generations,
        permissionRecordHash: digest,
        arms: ["B0", "candidate"].map((id) => ({
            id,
            sourceCommit: frozen.manifest.baselineCommit,
            patchHash: id === "B0" ? sha256("") : digest,
            configurationHash: digest,
            providerSettingsHash: digest,
            promptHash: digest,
            schemaHash: digest,
            indexHash: digest,
            eligibleSourcesHash: digest,
            nodeVersion: "test-only",
            provider: "test-only-no-model",
            model: "not-executed",
            indexGeneration: "unit",
            configurationIdentity: "unit",
        })),
    };
}

function reviewFixture() {
    return {
        status: "approved-independent-human-review",
        manifestHash: frozenManifestHash,
        expectationsHash: frozen.manifest.files["evaluator-only.json"],
        reviewer: "unit-test-reviewer",
        author: "unit-test-author",
        reviewedAt: "2026-10-20",
        evidence: "Fabricated contract test only, NOT a real approval",
    };
}

function scoringFixture() {
    const run = runFixture();
    const runHash = validateRun(run, frozen);
    const records = scheduled(run).map((item) => {
        const bundle = frozen.bundles.find((b) => b.id === item.caseId);
        const output = bundle.sources.map((s) => s.text).join("\n");
        return {
            id: item.id,
            status: "ok",
            saved: output,
            rendered: output,
            serializedRequest: output,
            telemetry: { calls: 0, tokens: 0, latencyMs: 0 },
        };
    });
    const annotations = records.map((row) => {
        const bundle = frozen.bundles.find(
            (b) => row.id.split(":")[1] === b.id,
        );
        const expectations = frozen.gold.cases.find(
            (g) => g.id === bundle.id,
        ).expectations;
        return {
            id: row.id,
            reviewer: "unit-only",
            reviewedAt: "2026-10-20",
            savedHash: identity(row.saved),
            renderedHash: identity(row.rendered),
            requestHash: identity(row.serializedRequest),
            savedConsistent: true,
            lifecyclePassed: true,
            admission: "distinct",
            legitimateProgress: true,
            claims: bundle.sources.map((s) => ({
                id: s.id,
                quote: s.text,
                supported: true,
                rationale: "Unit test contract, not a factual judge",
                witnesses: [
                    { sourceId: s.id, revision: s.revision, quote: s.text },
                ],
            })),
            expectations: expectations.map((e) => ({
                id: e.id,
                preserved: true,
                selected: true,
                outputQuote: e.quote,
                requestQuote: e.quote,
                witness: {
                    sourceId: e.sourceId,
                    revision: e.revision,
                    quote: e.quote,
                },
                rationale: "Unit test contract only",
            })),
            errors: {
                attribution: 0,
                status: 0,
                correction: 0,
                unknownState: 0,
                citationRevision: 0,
                critical: 0,
            },
        };
    });
    return {
        run,
        outputs: { runHash, records },
        annotations: { runHash, records: annotations },
        review: reviewFixture(),
    };
}

const score = (f) =>
    scoreArtifacts(frozen, f.run, f.outputs, f.annotations, f.review);

test("freeze binds 24 distinct bundles, split, rubric and source-backed expectations", () => {
    assert.equal(frozen.manifestHash, frozenManifestHash);
    assert.equal(
        frozen.manifest.goldReviewStatus,
        "pending-independent-human-review",
    );
    assert.equal(
        new Set(
            frozen.bundles.map((b) => b.sources.map((s) => s.text).join("")),
        ).size,
        24,
    );
    assert.equal(frozen.gold.cases.length, 24);
    assert.equal(frozen.contract.thresholds.qualificationRecall, 0.95);
    assert.equal(frozen.contract.thresholds.supportedClaimPrecision, 0.98);
});

test("worker packet exposes only development construction; mutations do not alter freeze", () => {
    const packet = developmentPacket(frozen);
    assert.equal(packet.bundles.length, 12);
    assert.ok(packet.bundles.every((b) => b.split === "development"));
    const json = JSON.stringify(packet);
    for (const key of [
        "expectations",
        "requirement",
        "evaluatorOnly",
        "question",
        "w07",
        "b07",
    ])
        assert.ok(!json.includes(`"${key}"`));
    packet.bundles[0].sources[0].text = "mutated";
    assert.notEqual(frozen.bundles[0].sources[0].text, "mutated");
});

test("freeze CLI exposes identity/counts/review status without labels", async () => {
    const result = await main(["freeze"]);
    assert.equal(result.bundles, 24);
    assert.equal(result.manifestHash, frozenManifestHash);
    assert.ok(!JSON.stringify(result).includes("expectations"));
    assert.match(await main(["--help"]), /no models/);
    await assert.rejects(
        main(["not-a-command", "--output", "unused"]),
        /Unknown command/,
    );
});

test("holdout schedule is 36 outputs per arm but 12 bundles", () => {
    const run = runFixture(
        "holdout",
        frozen.bundles.filter((b) => b.split === "holdout").map((b) => b.id),
    );
    validateRun(run, frozen);
    assert.equal(scheduled(run).length, 72);
    run.generations = 1;
    assert.throws(() => validateRun(run, frozen), /three generations/);
});

for (const [name, mutate] of [
    ["unknown case", (r) => r.caseIds.push("unknown")],
    ["duplicate case", (r) => r.caseIds.push("w01")],
    ["wrong split", (r) => r.caseIds.push("w07")],
    ["missing provenance", (r) => delete r.arms[0].promptHash],
    ["no arms", (r) => (r.arms = [])],
    ["no cases", (r) => (r.caseIds = [])],
])
    test(`run rejects ${name}`, () => {
        const run = runFixture();
        mutate(run);
        assert.throws(() => validateRun(run, frozen));
    });

test("unreviewed and self-reviewed gold fail before scoring", () => {
    assert.throws(() => reviewedGold(undefined, frozen), /pending/);
    const review = reviewFixture();
    review.reviewer = review.author;
    assert.throws(() => reviewedGold(review, frozen), /independent/);
    const f = scoringFixture();
    f.review.status = "pending";
    assert.throws(() => score(f), /pending/);
});

test("source witnesses and duplicate cases fail closed", () => {
    assert.throws(
        () =>
            validateWitness(
                { sourceId: "w01-design", revision: "r99", quote: "a" },
                frozen.bundles[0],
            ),
        /revision/,
    );
    assert.throws(
        () =>
            validateWitness(
                { sourceId: "w01-design", revision: "r1", quote: "invented" },
                frozen.bundles[0],
            ),
        /absent/,
    );
    assert.throws(
        () => unique([{ id: "x" }, { id: "x" }], "id", "cases"),
        /duplicate/,
    );
});

test("human score aggregation records actual scheduled and observed denominators", () => {
    const result = score(scoringFixture());
    assert.deepEqual(result.arms.B0.qualifications, ratio(12, 12));
    assert.deepEqual(result.arms.B0.claims, ratio(12, 12));
    assert.equal(result.arms.B0.sourceBundles, 2);
    assert.equal(result.arms.B0.outputs, 6);
    assert.equal(result.arms.B0.gate, "pass");
    assert.equal(result.usefulness, null);
});

test("failed/missing attempts remain in recall and omission denominators and block gate", () => {
    const f = scoringFixture();
    for (const [index, status] of [
        [0, "missing"],
        [1, "failed"],
    ]) {
        const row = f.outputs.records[index];
        f.outputs.records[index] = {
            id: row.id,
            status,
            reason: "unit test transport failure",
        };
        f.annotations.records = f.annotations.records.filter(
            (r) => r.id !== row.id,
        );
    }
    const result = score(f).arms.B0;
    assert.equal(result.missing, 1);
    assert.equal(result.failed, 1);
    assert.deepEqual(result.qualifications, ratio(8, 12));
    assert.deepEqual(result.claims, ratio(8, 8));
    assert.equal(result.omissionBearingOutputs, 2);
    assert.equal(result.gate, "fail");
});

for (const [name, mutate] of [
    ["absent outputs", (f) => f.outputs.records.pop()],
    ["unknown outputs", (f) => (f.outputs.records[0].id = "unknown")],
    [
        "duplicate outputs",
        (f) => (f.outputs.records[1].id = f.outputs.records[0].id),
    ],
    ["absent annotations", (f) => f.annotations.records.pop()],
    [
        "mismatched request",
        (f) => (f.outputs.records[0].serializedRequest += "changed"),
    ],
    [
        "unwitnessed claims",
        (f) => (f.annotations.records[0].claims[0].witnesses = []),
    ],
    [
        "unknown expectations",
        (f) => (f.annotations.records[0].expectations[0].id = "unknown"),
    ],
    ["invalid scores", (f) => (f.annotations.records[0].errors.critical = -1)],
    ["invalid telemetry", (f) => (f.outputs.records[0].telemetry.calls = NaN)],
    ["absent saved output", (f) => (f.outputs.records[0].saved = "")],
])
    test(`score rejects ${name}`, () => {
        const f = scoringFixture();
        mutate(f);
        assert.throws(() => score(f));
    });

test("empty claim denominators are indeterminate, not perfect precision", () => {
    const f = scoringFixture();
    f.annotations.records.forEach((r) => (r.claims = []));
    const result = score(f).arms.B0;
    assert.deepEqual(result.claims, ratio(0, 0));
    assert.equal(result.gate, "indeterminate");
});

test("zero observed outputs fail without claiming empty precision", () => {
    const f = scoringFixture();
    f.outputs.records = f.outputs.records.map((r) => ({
        id: r.id,
        status: "missing",
        reason: "unit test",
    }));
    f.annotations.records = [];
    const result = score(f).arms.B0;
    assert.equal(result.claims.value, null);
    assert.equal(result.qualifications.value, 0);
    assert.equal(result.missing, 6);
    assert.equal(result.gate, "fail");
});

test("critical errors and saved/lifecycle failures block gate", () => {
    const f = scoringFixture();
    f.annotations.records[0].errors.critical = 1;
    assert.equal(score(f).arms.B0.gate, "fail");
    f.annotations.records[0].errors.critical = 0;
    f.annotations.records[0].savedConsistent = false;
    assert.equal(score(f).arms.B0.lifecycleFailures, 1);
});

test("paired bootstrap clusters by bundle, is deterministic and flags insufficient baseline omissions", () => {
    const result = score(scoringFixture());
    const first = compareArtifacts(result, "B0", "candidate");
    assert.deepEqual(first, compareArtifacts(result, "B0", "candidate"));
    assert.equal(first.sourceBundleClusters, 2);
    assert.equal(first.scheduledPairs, 6);
    assert.deepEqual(first.clustered95PercentInterval, [0, 0]);
    assert.equal(first.improvementGate, "limited-evidence");
    assert.equal(first.omissionReduction, null);
    assert.throws(() => compareArtifacts(result, "B0", "unknown"), /Unknown/);
});

test("failing-baseline improvement requires four omissions, preserved precision and complete pairs", () => {
    const f = scoringFixture();
    f.annotations.records
        .filter((r) => r.id.startsWith("B0:"))
        .forEach((r) => (r.expectations[0].preserved = false));
    const comparison = compareArtifacts(score(f), "B0", "candidate");
    assert.equal(comparison.baselineOmissionBearingOutputs, 6);
    assert.equal(comparison.omissionReduction, 1);
    assert.equal(comparison.improvementGate, "pass");
    const row = f.outputs.records.at(-1);
    f.outputs.records[f.outputs.records.length - 1] = {
        id: row.id,
        status: "missing",
        reason: "unit-only",
    };
    f.annotations.records = f.annotations.records.filter(
        (r) => r.id !== row.id,
    );
    const incomplete = compareArtifacts(score(f), "B0", "candidate");
    assert.equal(incomplete.failedOrMissingPairs, 1);
    assert.equal(incomplete.improvementGate, "fail");
});

test("blinded usefulness records wins/ties/losses, source witnesses and adjudicated disagreement", () => {
    const f = scoringFixture();
    const assignments = f.run.caseIds.flatMap((caseId) =>
        Array.from({ length: f.run.generations }, (_, i) => ({
            id: `${caseId}:${i + 1}`,
            first: `B0:${caseId}:${i + 1}`,
            second: `candidate:${caseId}:${i + 1}`,
        })),
    );
    const records = assignments.map((a) => {
        const first = f.outputs.records.find((r) => r.id === a.first);
        const second = f.outputs.records.find((r) => r.id === a.second);
        const bundle = frozen.bundles.find((b) => b.id === a.id.split(":")[0]);
        const source = bundle.sources[0];
        const vote = (reviewer, verdict) => ({
            reviewer,
            verdict,
            rationale: "Unit fixture, not real usefulness review",
            witnesses: [
                {
                    sourceId: source.id,
                    revision: source.revision,
                    quote: source.text,
                },
            ],
        });
        return {
            id: a.id,
            firstHash: identity({
                saved: first.saved,
                rendered: first.rendered,
            }),
            secondHash: identity({
                saved: second.saved,
                rendered: second.rendered,
            }),
            votes: [
                vote("unit-reviewer-a", "second"),
                vote("unit-reviewer-b", "second"),
            ],
        };
    });
    records[0].votes[0].verdict = "first";
    records[0].adjudication = {
        ...records[0].votes[1],
        reviewer: "unit-independent-adjudicator",
    };
    records[1].votes.forEach((v) => (v.verdict = "tie"));
    records[2].votes.forEach((v) => (v.verdict = "first"));
    const packet = {
        runHash: f.outputs.runHash,
        baseline: "B0",
        candidate: "candidate",
        assignments,
        blindingKeyHash: identity(assignments),
        records,
    };
    const result = scoreBlindedUsefulness(frozen, f.run, f.outputs, packet);
    assert.equal(result.wins, 4);
    assert.equal(result.ties, 1);
    assert.equal(result.losses, 1);
    assert.equal(result.disagreements, 1);
    assert.equal(result.adjudicated, 1);
    delete records[0].adjudication;
    assert.equal(
        scoreBlindedUsefulness(frozen, f.run, f.outputs, packet).unresolved,
        1,
    );
    packet.records = [];
    const missing = scoreBlindedUsefulness(frozen, f.run, f.outputs, packet);
    assert.equal(missing.missingReviews, 6);
    assert.equal(missing.winRateDecided.value, null);
    packet.records = records;
    records[0].firstHash = digest;
    assert.throws(
        () => scoreBlindedUsefulness(frozen, f.run, f.outputs, packet),
        /identity mismatch/,
    );
});
