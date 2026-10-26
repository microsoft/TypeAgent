// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    check,
    text,
    identity,
    ratio,
    unique,
    validateRun,
    scheduled,
    reviewedGold,
    validateWitness,
} from "./quality-contract.mjs";

const errorKinds = [
    "attribution",
    "status",
    "correction",
    "unknownState",
    "citationRevision",
    "critical",
];

function count(value, name) {
    check(
        Number.isSafeInteger(value) && value >= 0,
        `${name}: nonnegative integer required`,
    );
}

function validateAnnotation(row, annotation, bundle, gold) {
    check(annotation, `Missing human annotation: ${row.id}`);
    text(annotation.reviewer, "annotation reviewer");
    text(annotation.reviewedAt, "annotation date");
    check(
        annotation.savedHash === identity(row.saved) &&
            annotation.renderedHash === identity(row.rendered) &&
            annotation.requestHash === identity(row.serializedRequest),
        "Annotation output/request identity mismatch",
    );
    check(
        typeof annotation.savedConsistent === "boolean" &&
            typeof annotation.lifecyclePassed === "boolean",
        "Saved/lifecycle human verdicts required",
    );
    check(
        [
            "admitted",
            "covered",
            "contribution",
            "distinct",
            "blocked",
            "conflicted",
            "ambiguous",
            "stale",
        ].includes(annotation.admission),
        "Invalid admission outcome",
    );
    check(
        typeof annotation.legitimateProgress === "boolean",
        "Progress verdict required",
    );
    unique(annotation.claims, "id", "claims");
    for (const claim of annotation.claims) {
        text(claim.quote, "output claim quote");
        check(
            row.rendered.includes(claim.quote),
            "Claim quote absent from rendered output",
        );
        check(
            typeof claim.supported === "boolean",
            "Claim support verdict required",
        );
        text(claim.rationale, "claim rationale");
        check(Array.isArray(claim.witnesses), "Claim witnesses required");
        if (claim.supported)
            check(
                claim.witnesses.length > 0,
                "Supported claim needs a source witness",
            );
        for (const witness of claim.witnesses) validateWitness(witness, bundle);
    }
    const expectations = unique(
        annotation.expectations,
        "id",
        "annotation expectations",
    );
    check(
        expectations.size === gold.expectations.length,
        "Missing/unknown expectation annotations",
    );
    for (const expected of gold.expectations) {
        const verdict = expectations.get(expected.id);
        check(verdict, "Missing expectation annotation");
        check(
            typeof verdict.preserved === "boolean" &&
                typeof verdict.selected === "boolean",
            "Expectation verdicts required",
        );
        text(verdict.rationale, "expectation rationale");
        validateWitness(verdict.witness, bundle);
        check(
            verdict.witness.sourceId === expected.sourceId &&
                verdict.witness.revision === expected.revision,
            "Expectation witness mismatch",
        );
        if (verdict.preserved) {
            text(verdict.outputQuote, "preserved output quote");
            check(
                row.rendered.includes(verdict.outputQuote),
                "Preservation quote absent",
            );
        }
        if (verdict.selected) {
            text(verdict.requestQuote, "selected evidence quote");
            check(
                row.serializedRequest.includes(verdict.requestQuote) &&
                    bundle.sources.some(
                        (s) =>
                            s.id === expected.sourceId &&
                            s.text.includes(verdict.requestQuote),
                    ),
                "Selected quote absent from request/source",
            );
        }
    }
    for (const key of errorKinds)
        count(annotation.errors?.[key], `errors.${key}`);
    for (const key of ["calls", "tokens", "latencyMs"]) {
        check(
            Number.isFinite(row.telemetry?.[key]) && row.telemetry[key] >= 0,
            `Invalid telemetry.${key}`,
        );
    }
}

export function scoreArtifacts(frozen, run, outputs, annotations, review) {
    reviewedGold(review, frozen);
    const runHash = validateRun(run, frozen);
    check(
        outputs.runHash === runHash && annotations.runHash === runHash,
        "Output/annotation run identity mismatch",
    );
    const plan = scheduled(run);
    const planned = new Set(plan.map((row) => row.id));
    const rows = unique(outputs.records, "id", "outputs");
    const labels = unique(annotations.records, "id", "annotations");
    check(
        rows.size === plan.length,
        "Absent output rows: explicitly record missing/failed attempts",
    );
    for (const id of rows.keys()) check(planned.has(id), "Unknown output");
    for (const id of labels.keys()) {
        check(
            planned.has(id) && rows.get(id)?.status === "ok",
            "Unknown annotation or annotation for failed/missing output",
        );
    }
    const details = [];
    for (const expected of plan) {
        const row = rows.get(expected.id);
        check(row, "Absent scheduled output");
        check(
            ["ok", "failed", "missing"].includes(row.status),
            "Invalid output status",
        );
        const bundle = frozen.bundles.find((b) => b.id === expected.caseId);
        const gold = frozen.gold.cases.find((c) => c.id === expected.caseId);
        const n = gold.expectations.length;
        if (row.status !== "ok") {
            text(row.reason, "Failure/missing reason");
            details.push({
                ...expected,
                status: row.status,
                qualifications: ratio(0, n),
                selected: ratio(0, n),
                claims: ratio(0, 0),
                omission: true,
                errors: null,
            });
            continue;
        }
        for (const key of ["saved", "rendered", "serializedRequest"])
            text(row[key], key);
        const label = labels.get(row.id);
        validateAnnotation(row, label, bundle, gold);
        details.push({
            ...expected,
            status: "ok",
            qualifications: ratio(
                label.expectations.filter((e) => e.preserved).length,
                n,
            ),
            selected: ratio(
                label.expectations.filter((e) => e.selected).length,
                n,
            ),
            claims: ratio(
                label.claims.filter((c) => c.supported).length,
                label.claims.length,
            ),
            omission: label.expectations.some((e) => !e.preserved),
            errors: label.errors,
            admission: label.admission,
            legitimateProgress: label.legitimateProgress,
            lifecyclePassed: label.lifecyclePassed,
            savedConsistent: label.savedConsistent,
            telemetry: row.telemetry,
        });
    }
    const arms = Object.fromEntries(
        run.arms.map((arm) => {
            const selected = details.filter((d) => d.arm === arm.id);
            const sum = (get) =>
                selected.reduce((total, row) => total + get(row), 0);
            const errors = Object.fromEntries(
                errorKinds.map((key) => [
                    key,
                    sum((r) => r.errors?.[key] ?? 0),
                ]),
            );
            const claims = ratio(
                sum((r) => r.claims.numerator),
                sum((r) => r.claims.denominator),
            );
            const qualifications = ratio(
                sum((r) => r.qualifications.numerator),
                sum((r) => r.qualifications.denominator),
            );
            const selectedEvidence = ratio(
                sum((r) => r.selected.numerator),
                sum((r) => r.selected.denominator),
            );
            const failed = sum((r) => Number(r.status === "failed"));
            const missing = sum((r) => Number(r.status === "missing"));
            const lifecycleFailures = sum((r) =>
                Number(
                    r.status === "ok" &&
                        (!r.lifecyclePassed || !r.savedConsistent),
                ),
            );
            const thresholds = frozen.contract.thresholds;
            const gate =
                failed + missing + lifecycleFailures > 0 || errors.critical > 0
                    ? "fail"
                    : claims.value === null || qualifications.value === null
                      ? "indeterminate"
                      : claims.value >= thresholds.supportedClaimPrecision &&
                          qualifications.value >= thresholds.qualificationRecall
                        ? "pass"
                        : "fail";
            return [
                arm.id,
                {
                    outputs: selected.length,
                    sourceBundles: new Set(selected.map((r) => r.caseId)).size,
                    observed: selected.length - failed - missing,
                    failed,
                    missing,
                    claims,
                    qualifications,
                    selectedEvidence,
                    errors,
                    omissionBearingOutputs: sum((r) => Number(r.omission)),
                    legitimateProgress: sum((r) =>
                        Number(r.legitimateProgress === true),
                    ),
                    admission: Object.fromEntries(
                        [
                            ...new Set(
                                selected
                                    .map((r) => r.admission)
                                    .filter(Boolean),
                            ),
                        ].map((state) => [
                            state,
                            sum((r) => Number(r.admission === state)),
                        ]),
                    ),
                    lifecycleFailures,
                    gate,
                    telemetry: Object.fromEntries(
                        ["calls", "tokens", "latencyMs"].map((key) => [
                            key,
                            sum((r) => r.telemetry?.[key] ?? 0),
                        ]),
                    ),
                },
            ];
        }),
    );
    return {
        schemaVersion: 1,
        runHash,
        manifestHash: frozen.manifestHash,
        scope: "Human-annotated authored pilot; not official benchmark performance",
        precisionScope:
            "Observed rendered-output claims only; missing/failed attempts never receive perfect precision",
        telemetryScope:
            "Successful outputs only; failed/missing attempts reported separately",
        usefulness: null,
        usefulnessStatus:
            "Pending separate blinded paired human review; no automated proxy",
        arms,
        details,
    };
}

export function compareArtifacts(
    scorecard,
    baseline,
    candidate,
    { seed = 20261020, resamples = 2000 } = {},
) {
    const rowIds = unique(scorecard.details, "id", "comparison output details");
    check(rowIds.size > 0, "Empty comparison");
    for (const row of rowIds.values()) {
        check(
            ["ok", "failed", "missing"].includes(row.status),
            "Invalid comparison output status",
        );
        const metric = row.qualifications;
        count(metric?.numerator, "qualification numerator");
        count(metric?.denominator, "qualification denominator");
        check(
            metric.denominator > 0 &&
                metric.numerator <= metric.denominator &&
                metric.value === metric.numerator / metric.denominator,
            "Invalid qualification score",
        );
        check(scorecard.arms[row.arm], "Unknown comparison detail arm");
    }
    check(
        baseline !== candidate &&
            scorecard.arms[baseline] &&
            scorecard.arms[candidate],
        "Unknown or identical comparison arms",
    );
    check(
        Number.isSafeInteger(resamples) && resamples >= 100,
        "At least 100 bootstrap resamples required",
    );
    check(Number.isSafeInteger(seed), "Integer seed required");
    const left = scorecard.details.filter((d) => d.arm === baseline);
    const right = new Map(
        scorecard.details
            .filter((d) => d.arm === candidate)
            .map((d) => [`${d.caseId}:${d.generation}`, d]),
    );
    const clusters = new Map();
    let complete = 0;
    for (const a of left) {
        const b = right.get(`${a.caseId}:${a.generation}`);
        check(b, "Unpaired comparison");
        if (a.status === "ok" && b.status === "ok") complete++;
        const values = clusters.get(a.caseId) ?? [];
        values.push(b.qualifications.value - a.qualifications.value);
        clusters.set(a.caseId, values);
    }
    return finishComparison(
        left,
        right,
        clusters,
        complete,
        baseline,
        candidate,
        scorecard,
        seed,
        resamples,
    );
}

export function scoreBlindedUsefulness(frozen, run, outputs, packet) {
    const runHash = validateRun(run, frozen);
    check(
        packet.runHash === runHash && outputs.runHash === runHash,
        "Usefulness run identity mismatch",
    );
    check(
        packet.baseline !== packet.candidate &&
            run.arms.some((a) => a.id === packet.baseline) &&
            run.arms.some((a) => a.id === packet.candidate),
        "Unknown usefulness comparison arms",
    );
    check(
        packet.blindingKeyHash === identity(packet.assignments),
        "Blinding assignment identity mismatch",
    );
    const assignments = unique(
        packet.assignments,
        "id",
        "blinding assignments",
    );
    const reviews = unique(packet.records, "id", "usefulness reviews");
    const attempts = unique(outputs.records, "id", "usefulness outputs");
    const plan = scheduled(run);
    const known = new Set(plan.map((r) => r.id));
    check(
        attempts.size === known.size &&
            [...attempts.keys()].every((id) => known.has(id)),
        "Missing/unknown usefulness outputs; explicitly record failures",
    );
    for (const row of attempts.values()) {
        check(
            ["ok", "failed", "missing"].includes(row.status),
            "Invalid usefulness attempt status",
        );
        if (row.status === "ok") {
            text(row.saved, "saved usefulness output");
            text(row.rendered, "rendered usefulness output");
        } else text(row.reason, "Usefulness failure/missing reason");
    }
    const pairs = run.caseIds.flatMap((caseId) =>
        Array.from({ length: run.generations }, (_, i) => ({
            id: `${caseId}:${i + 1}`,
            caseId,
            generation: i + 1,
        })),
    );
    check(
        assignments.size === pairs.length,
        "Every scheduled pair needs a frozen blinding assignment",
    );
    for (const id of reviews.keys())
        check(assignments.has(id), "Unknown usefulness review");
    const counts = {
        wins: 0,
        ties: 0,
        losses: 0,
        disagreements: 0,
        adjudicated: 0,
        unresolved: 0,
        missingReviews: 0,
        failedOrMissingPairs: 0,
    };
    for (const pair of pairs) {
        const assignment = assignments.get(pair.id);
        check(assignment, "Unknown/missing blinding assignment");
        const expected = [packet.baseline, packet.candidate].map(
            (arm) => `${arm}:${pair.id}`,
        );
        check(
            new Set([assignment.first, assignment.second]).size === 2 &&
                expected.includes(assignment.first) &&
                expected.includes(assignment.second),
            "Unpaired blinding assignment",
        );
        const first = attempts.get(assignment.first);
        const second = attempts.get(assignment.second);
        check(
            [first.status, second.status].every((s) =>
                ["ok", "failed", "missing"].includes(s),
            ),
            "Invalid usefulness attempt status",
        );
        if (first.status !== "ok" || second.status !== "ok") {
            check(!reviews.has(pair.id), "Cannot review absent/failed output");
            counts.failedOrMissingPairs++;
            continue;
        }
        const review = reviews.get(pair.id);
        if (!review) {
            counts.missingReviews++;
            continue;
        }
        check(
            review.firstHash ===
                identity({
                    saved: first.saved,
                    rendered: first.rendered,
                }) &&
                review.secondHash ===
                    identity({
                        saved: second.saved,
                        rendered: second.rendered,
                    }),
            "Usefulness output identity mismatch",
        );
        const bundle = frozen.bundles.find((b) => b.id === pair.caseId);
        const validateVote = (vote) => {
            text(vote.reviewer, "Usefulness reviewer");
            check(
                ["first", "second", "tie"].includes(vote.verdict),
                "Invalid usefulness verdict",
            );
            text(vote.rationale, "Usefulness rationale");
            check(
                Array.isArray(vote.witnesses) && vote.witnesses.length > 0,
                "Usefulness source witnesses required",
            );
            vote.witnesses.forEach((w) => validateWitness(w, bundle));
        };
        check(
            Array.isArray(review.votes) &&
                review.votes.length === 2 &&
                review.votes[0].reviewer !== review.votes[1].reviewer,
            "Two distinct blinded reviewers required",
        );
        review.votes.forEach(validateVote);
        let verdict = review.votes[0].verdict;
        if (verdict !== review.votes[1].verdict) {
            counts.disagreements++;
            if (!review.adjudication) {
                counts.unresolved++;
                continue;
            }
            validateVote(review.adjudication);
            check(
                review.votes.every(
                    (v) => v.reviewer !== review.adjudication.reviewer,
                ),
                "Independent adjudicator required",
            );
            counts.adjudicated++;
            verdict = review.adjudication.verdict;
        } else {
            check(
                !review.adjudication,
                "Unexpected adjudication without disagreement",
            );
        }
        if (verdict === "tie") counts.ties++;
        else {
            const winner = assignment[verdict];
            counts[
                winner === `${packet.candidate}:${pair.id}` ? "wins" : "losses"
            ]++;
        }
    }
    return {
        runHash,
        baseline: packet.baseline,
        candidate: packet.candidate,
        blindingKeyHash: packet.blindingKeyHash,
        ...counts,
        scheduledPairs: pairs.length,
        sourceBundleClusters: run.caseIds.length,
        decidedPairs: counts.wins + counts.ties + counts.losses,
        winRateScheduled: ratio(counts.wins, pairs.length),
        winRateDecided: ratio(
            counts.wins,
            counts.wins + counts.ties + counts.losses,
        ),
        scope: "Source-backed blinded human pilot judgments; repeated generations are not independent bundles",
    };
}
function finishComparison(
    left,
    right,
    clusters,
    complete,
    baseline,
    candidate,
    scorecard,
    seed,
    resamples,
) {
    check(
        left.length === right.size && clusters.size > 0,
        "Empty/unpaired comparison",
    );
    const means = [...clusters.values()].map(
        (values) => values.reduce((a, b) => a + b, 0) / values.length,
    );
    let state = seed >>> 0;
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 2 ** 32;
    };
    const samples = Array.from(
        { length: resamples },
        () =>
            means.reduce(
                (sum) => sum + means[Math.floor(random() * means.length)],
                0,
            ) / means.length,
    ).sort((a, b) => a - b);
    const a = scorecard.arms[baseline];
    const b = scorecard.arms[candidate];
    const reduction =
        a.omissionBearingOutputs === 0
            ? null
            : 1 - b.omissionBearingOutputs / a.omissionBearingOutputs;
    const sufficient = a.omissionBearingOutputs >= 4;
    return {
        baseline,
        candidate,
        sourceBundleClusters: means.length,
        scheduledPairs: left.length,
        completePairs: complete,
        failedOrMissingPairs: left.length - complete,
        qualificationRecallDelta:
            means.reduce((a, b) => a + b, 0) / means.length,
        clustered95PercentInterval:
            means.length < 2
                ? null
                : [
                      samples[Math.floor(resamples * 0.025)],
                      samples[Math.floor(resamples * 0.975)],
                  ],
        seed,
        resamples,
        baselineOmissionBearingOutputs: a.omissionBearingOutputs,
        candidateOmissionBearingOutputs: b.omissionBearingOutputs,
        omissionReduction: reduction,
        improvementGate: !sufficient
            ? "limited-evidence"
            : a.claims.value === null || b.claims.value === null
              ? "indeterminate"
              : complete === left.length &&
                  b.gate === "pass" &&
                  b.errors.critical === 0 &&
                  b.claims.value >= a.claims.value &&
                  reduction >= 0.5
                ? "pass"
                : "fail",
        interpretation:
            "Paired bundle-cluster pilot estimate, not independent generations or a production guarantee",
    };
}
