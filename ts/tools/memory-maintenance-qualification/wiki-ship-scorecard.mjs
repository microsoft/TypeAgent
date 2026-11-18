// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { wikiQualityDimensions } from "./wiki-admission-evaluation.mjs";

const ratio = (numerator, denominator) =>
    denominator ? numerator / denominator : null;
const mean = (values) =>
    values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;

function qualitySide(judgment, side, facts) {
    const coverage = judgment.coverage;
    const critical = new Set(
        facts.filter((fact) => fact.critical).map((fact) => fact.id),
    );
    const counts = Object.fromEntries(
        ["covered", "missing", "uncertain"].map((choice) => [
            choice,
            coverage.filter((row) => row[side] === choice).length,
        ]),
    );
    return {
        dimensions: Object.fromEntries(
            wikiQualityDimensions.map((name) => [
                name,
                mean(
                    judgment.pageScores[side].map((page) => page.scores[name]),
                ),
            ]),
        ),
        pagesAudited: judgment.pageScores[side].length,
        unresolvedPageRatings: judgment.pageScores[side].filter(
            (page) =>
                page.unresolvedDimensions?.length || page.supportUncertain,
        ).length,
        unresolvedDefects:
            judgment.unresolvedChecks?.filter((row) => row.side === side)
                .length ?? 0,
        coverage: {
            ...counts,
            denominator: facts.length,
            lowerBound: ratio(counts.covered, facts.length),
            upperBound: ratio(counts.covered + counts.uncertain, facts.length),
            criticalMissing: coverage.filter(
                (row) => critical.has(row.factId) && row[side] === "missing",
            ).length,
            criticalUncertain: coverage.filter(
                (row) => critical.has(row.factId) && row[side] === "uncertain",
            ).length,
        },
        criticalDefects: judgment.defects.filter(
            (row) => row.side === side && row.critical,
        ).length,
    };
}

function orderCard({ reversed, judgment }, facts) {
    const baseline = reversed ? "B" : "A";
    const candidate = reversed ? "A" : "B";
    const covered = judgment.coverage.filter(
        (row) => row[baseline] === "covered",
    );
    const retained = covered.filter(
        (row) => row[candidate] === "covered",
    ).length;
    const uncertain = covered.filter(
        (row) => row[candidate] === "uncertain",
    ).length;
    const critical = new Set(
        facts.filter((fact) => fact.critical).map((fact) => fact.id),
    );
    const baselineCard = qualitySide(judgment, baseline, facts);
    const candidateCard = qualitySide(judgment, candidate, facts);
    const purposeMatched = new Set(judgment.matches.map((row) => row[baseline]))
        .size;
    return {
        reversed,
        winner:
            judgment.winner === baseline
                ? "G0"
                : judgment.winner === candidate
                  ? "D1"
                  : judgment.winner,
        baseline: baselineCard,
        candidate: candidateCard,
        dimensionDeltas: Object.fromEntries(
            wikiQualityDimensions.map((name) => [
                name,
                baselineCard.dimensions[name] === null ||
                candidateCard.dimensions[name] === null
                    ? null
                    : candidateCard.dimensions[name] -
                      baselineCard.dimensions[name],
            ]),
        ),
        retainedBaselineFacts: {
            numerator: retained,
            denominator: covered.length,
            uncertain,
            lowerBound: ratio(retained, covered.length),
            upperBound: ratio(retained + uncertain, covered.length),
            criticalLost: covered.filter(
                (row) =>
                    critical.has(row.factId) && row[candidate] === "missing",
            ).length,
        },
        purposeRecall: {
            numerator: purposeMatched,
            denominator: baselineCard.pagesAudited,
            value: ratio(purposeMatched, baselineCard.pagesAudited),
            uncertainPairs: judgment.uncertainPurposePairs?.length ?? 0,
        },
    };
}

function gatesFor(card) {
    const orders = card.orders;
    const metric = (name, threshold, values, pass) => ({
        name,
        threshold,
        observed: values,
        status:
            !orders.length || values.some((value) => value === null)
                ? "unmeasured"
                : values.every(pass)
                  ? "pass"
                  : "fail",
    });
    const dimensions = orders.flatMap((order) =>
        Object.values(order.dimensionDeltas),
    );
    return [
        {
            name: "same-checkpoint-successful-readiness",
            threshold: "both arms ready",
            observed: card.construction,
            status: card.construction.comparable ? "pass" : "unmeasured",
        },
        metric(
            "fact-retention",
            ">=0.95 in both orders",
            orders.map((o) => o.retainedBaselineFacts.lowerBound),
            (v) => v >= 0.95,
        ),
        metric(
            "purpose-recall",
            ">=0.95 in both orders",
            orders.map((o) => o.purposeRecall.value),
            (v) => v >= 0.95,
        ),
        metric(
            "critical-baseline-fact-loss",
            "0 in both orders",
            orders.map((o) => o.retainedBaselineFacts.criticalLost),
            (v) => v === 0,
        ),
        metric(
            "critical-candidate-defects",
            "0 in both orders",
            orders.map((o) => o.candidate.criticalDefects),
            (v) => v === 0,
        ),
        metric(
            "per-dimension-quality-delta",
            ">=-0.2; unrounded page means",
            dimensions,
            (v) => v >= -0.2,
        ),
        metric(
            "successful-readiness-reduction",
            ">=0.15; not failure-time reduction",
            [card.construction.reduction],
            (v) => v >= 0.15,
        ),
        {
            name: "complete-source-support-audit",
            threshold: "all facts supported; no uncertain criticality",
            observed: card.sourceLedger,
            status:
                card.sourceLedger.unresolved === 0 &&
                card.sourceLedger.total > 0
                    ? "pass"
                    : "unmeasured",
        },
        {
            name: "both-order-complete-evaluation",
            threshold: "2 valid exhaustive judgments",
            observed: orders.length,
            status: orders.length === 2 ? "pass" : "unmeasured",
        },
        metric(
            "unresolved-page-checks",
            "0",
            orders.map(
                (o) =>
                    o.candidate.unresolvedPageRatings +
                    o.candidate.unresolvedDefects,
            ),
            (v) => v === 0,
        ),
        {
            name: "independent-human-accuracy-and-repetitions",
            threshold:
                "independent labels, repeated balanced trials and staging-only control",
            observed: "Not established by this two-history model-scored pilot",
            status: "unmeasured",
        },
    ];
}

export function wikiShipScorecard(campaign, quality) {
    const histories = quality.comparisons.map((comparison) => {
        const facts =
            quality.ledgers.find(
                (ledger) => ledger.questionId === comparison.id,
            )?.facts ?? [];
        const trial = (arm) =>
            campaign.trials.find(
                (row) =>
                    row.id === comparison.id &&
                    row.arm === arm &&
                    row.repetition === comparison.repetition,
            );
        const baseline = trial("G0"),
            candidate = trial(comparison.arm);
        const comparable =
            comparison.readinessComparable !== false &&
            !campaign.nonComparableCases?.includes(comparison.id) &&
            baseline?.status === "complete" &&
            candidate?.status === "complete" &&
            Number.isFinite(baseline.readinessMs) &&
            baseline.readinessMs > 0 &&
            Number.isFinite(candidate.readinessMs) &&
            candidate.readinessMs > 0;
        const card = {
            id: comparison.id,
            repetition: comparison.repetition,
            arm: comparison.arm,
            construction: {
                baseline: baseline?.status ?? "missing",
                candidate: candidate?.status ?? "missing",
                baselineMs: baseline?.readinessMs ?? null,
                candidateMs: candidate?.readinessMs ?? null,
                comparable,
                reduction: comparable
                    ? 1 - candidate.readinessMs / baseline.readinessMs
                    : null,
            },
            sourceLedger: {
                total: facts.length,
                supported: facts.filter(
                    (fact) => fact.sourceAudit?.support === "supported",
                ).length,
                unsupported: facts.filter(
                    (fact) => fact.sourceAudit?.support === "unsupported",
                ).length,
                uncertain: facts.filter(
                    (fact) => fact.sourceAudit?.support === "uncertain",
                ).length,
                unresolved: facts.filter(
                    (fact) =>
                        !fact.sourceAudit ||
                        fact.sourceAudit.support !== "supported" ||
                        fact.sourceAudit.criticality === "uncertain",
                ).length,
            },
            orders: comparison.judgments.map((order) =>
                orderCard(order, facts),
            ),
        };
        card.gates = gatesFor(card);
        card.recommendation = card.gates.some((gate) => gate.status === "fail")
            ? "NO-GO"
            : "HOLD";
        return card;
    });
    return {
        execution: quality.execution,
        qualityMode: quality.qualityMode,
        evidenceLevel: "machine-scored pilot; not human-adjudicated accuracy",
        recommendation: histories.some(
            (card) => card.recommendation === "NO-GO",
        )
            ? "NO-GO"
            : "HOLD",
        qualityFailures: quality.failures,
        histories,
        limitations: [
            "Unresolved source facts remain in every denominator and become uncertain coverage, never silently dropped.",
            "Uncertain page dimensions use a conservative lower-bound score of 1 and block qualification.",
            "Only successful same-campaign pairs have latency reductions; failure and timeout times are not speedups.",
            "Native evaluator disagreements remain separate evidence; this is not a native verdict fallback.",
            "No SHIP result without independent accuracy labels, repetitions and the staging-only control.",
        ],
    };
}
