// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";

const dispositions = [
    "distinct",
    "covered",
    "contribute",
    "ambiguous",
    "defer",
];
export const wikiQualityDimensions = [
    "usefulness",
    "support",
    "completeness",
    "scope",
    "qualifications",
    "citations",
];

export function wikiTrialSchedule(
    cases,
    repetitions,
    counterbalanceCases = false,
) {
    assert.ok(Number.isSafeInteger(repetitions) && repetitions > 0);
    assert.equal(typeof counterbalanceCases, "boolean");
    const arms = ["G0", "G1", "D1"];
    return Array.from({ length: repetitions }, (_, repetition) =>
        cases.flatMap((id, index) => {
            const reverse =
                (repetition + (counterbalanceCases ? index : 0)) % 2;
            const order = reverse ? [...arms].reverse() : [...arms];
            const shift = Math.floor(repetition / 2) % order.length;
            return [...order.slice(shift), ...order.slice(0, shift)].map(
                (arm, position) => ({
                    id,
                    arm,
                    repetition,
                    ordinal:
                        repetition * cases.length * 3 + index * 3 + position,
                }),
            );
        }),
    ).flat();
}

export function decisionAgreement(receipts, annotations) {
    const groups = new Map();
    for (const receipt of receipts) {
        const group = groups.get(receipt.requestHash) ?? {};
        (group[receipt.arm] ??= []).push(receipt);
        groups.set(receipt.requestHash, group);
    }
    if (annotations) {
        assert.equal(annotations.adjudicated, true);
        assert.ok(
            Array.isArray(annotations.reviewerIds) &&
                annotations.reviewerIds.every(
                    (id) => typeof id === "string" && id.trim(),
                ) &&
                new Set(annotations.reviewerIds).size >= 2,
            "Independent adjudicated reviewers are required",
        );
        assert.ok(Array.isArray(annotations.items));
        assert.equal(
            new Set(annotations.items.map((row) => row.requestHash)).size,
            annotations.items.length,
            "Duplicate annotation",
        );
        for (const row of annotations.items) {
            assert.ok(
                groups.has(row.requestHash) &&
                    dispositions.includes(row.disposition),
                "Unknown annotation input or disposition",
            );
            assert.equal(
                typeof row.canonicalViewId,
                "string",
                "Explicit canonical target required",
            );
            if (["covered", "contribute"].includes(row.disposition))
                assert.ok(
                    row.canonicalViewId.trim(),
                    "Canonical disposition needs a target",
                );
            if (row.disposition === "defer")
                assert.ok(
                    ["evidence", "canonical-context"].includes(row.deferBasis),
                    "Deferral annotation needs its evidence/context basis",
                );
            if (row.disposition === "ambiguous")
                assert.ok(
                    Array.isArray(row.ambiguousViewIds) &&
                        row.ambiguousViewIds.length >= 2 &&
                        row.ambiguousViewIds.every(
                            (id) => typeof id === "string" && id.trim(),
                        ),
                    "Ambiguity annotation needs explicit page IDs",
                );
        }
    }
    const compare = (arm) => {
        const matrix = Object.fromEntries(
            dispositions.flatMap((expected) =>
                dispositions.map((predicted) => [
                    `${expected}->${predicted}`,
                    0,
                ]),
            ),
        );
        let matched = 0,
            same = 0,
            targetSame = 0,
            targetMatched = 0,
            failed = 0;
        const timing = [];
        const details = [];
        for (const [hash, group] of groups) {
            const expected = annotations
                ? annotations.items.find((row) => row.requestHash === hash)
                : group.G0?.find((row) => row.outcome === "returned")
                      ?.assessment;
            for (const row of group[arm] ?? []) {
                if (row.outcome !== "returned") {
                    failed++;
                    continue;
                }
                timing.push(row.durationMs);
                if (!expected) continue;
                matched++;
                const predicted = row.assessment;
                const key = `${expected.disposition}->${predicted.disposition}`;
                matrix[key] = (matrix[key] ?? 0) + 1;
                same += Number(expected.disposition === predicted.disposition);
                const detail = decisionDetails(expected, predicted);
                details.push(detail);
                if (detail.canonicalTarget !== null) {
                    targetMatched++;
                    targetSame += detail.canonicalTarget;
                }
            }
        }
        const classes = dispositions.map((label) => {
            const tp = matrix[`${label}->${label}`] ?? 0;
            const fp = dispositions
                .filter((x) => x !== label)
                .reduce((n, x) => n + (matrix[`${x}->${label}`] ?? 0), 0);
            const fn = dispositions
                .filter((x) => x !== label)
                .reduce((n, x) => n + (matrix[`${label}->${x}`] ?? 0), 0);
            return {
                label,
                tp,
                fp,
                fn,
                precision: fraction(tp, tp + fp),
                recall: fraction(tp, tp + fn),
                f1: fraction(2 * tp, 2 * tp + fp + fn),
            };
        });
        return {
            matched,
            same,
            targetSame,
            targetMatched,
            failed,
            matrix,
            classes,
            agreement: fraction(same, matched),
            medianMs: median(timing),
            logicalLatency: latencyDistribution(timing),
            macroF1: average(
                classes
                    .filter((row) => row.tp + row.fn > 0)
                    .map((row) => row.f1 ?? 0),
            ),
            detailAgreement: Object.fromEntries(
                ["canonicalTarget", "ambiguitySet", "deferralKind"].map(
                    (kind) => [
                        kind,
                        average(
                            details
                                .map((row) => row[kind])
                                .filter((value) => value !== null),
                        ),
                    ],
                ),
            ),
            gate: utilityGateMetrics(receipts.filter((row) => row.arm === arm)),
            correctnessBasis: annotations
                ? "independently-adjudicated"
                : "G0-agreement-only",
        };
    };
    return Object.fromEntries(
        ["G0", "G1", "D1"].map((arm) => [arm, compare(arm)]),
    );
}

function decisionDetails(expected, predicted) {
    const sameSet = (left, right) =>
        JSON.stringify([...(left ?? [])].sort()) ===
        JSON.stringify([...(right ?? [])].sort());
    return {
        canonicalTarget: ["covered", "contribute"].includes(
            expected.disposition,
        )
            ? Number(expected.canonicalViewId === predicted.canonicalViewId)
            : null,
        ambiguitySet:
            expected.disposition === "ambiguous"
                ? Number(
                      predicted.disposition === "ambiguous" &&
                          sameSet(
                              expected.ambiguousViewIds,
                              predicted.ambiguousViewIds,
                          ),
                  )
                : null,
        deferralKind:
            expected.disposition === "defer"
                ? Number(
                      predicted.disposition === "defer" &&
                          expected.deferBasis === predicted.deferBasis,
                  )
                : null,
    };
}

function utilityGateMetrics(receipts) {
    const returned = receipts.filter(
        (row) => row.outcome === "returned" && row.utilityChoice,
    );
    const deferred = returned.filter((row) =>
        row.utilityChoice.startsWith("defer_"),
    ).length;
    return {
        returned: returned.length,
        evidenceDeferred: deferred,
        fullAssessmentRequired: returned.length - deferred,
        evidenceDeferralRate: fraction(deferred, returned.length),
        utilityLatency: latencyDistribution(
            receipts.map((row) => row.utilityMs).filter(Number.isFinite),
        ),
        fullAssessmentLatency: latencyDistribution(
            receipts.map((row) => row.fullAssessmentMs).filter(Number.isFinite),
        ),
    };
}

export function latencyDistribution(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return {
        count: values.length,
        p50Ms: median(values),
        p95Ms: values.length
            ? sorted[Math.ceil(sorted.length * 0.95) - 1]
            : null,
    };
}

export function pairedAssessmentLatency(receipts) {
    const hashes = [...new Set(receipts.map((row) => row.requestHash))];
    return ["G1", "D1"].map((arm) => {
        const pairs = [];
        for (const requestHash of hashes) {
            const matching = receipts.filter(
                (row) =>
                    row.requestHash === requestHash &&
                    row.outcome === "returned",
            );
            const baseline = matching.find((row) => row.arm === "G0");
            const candidate = matching.find((row) => row.arm === arm);
            if (!baseline || !candidate) continue;
            pairs.push({
                requestHash,
                mode: baseline.mode,
                baselineMs: baseline.durationMs,
                candidateMs: candidate.durationMs,
                deltaMs: candidate.durationMs - baseline.durationMs,
                reduction:
                    baseline.durationMs > 0
                        ? 1 - candidate.durationMs / baseline.durationMs
                        : null,
            });
        }
        return {
            arm,
            pairs,
            medianDeltaMs: median(pairs.map((row) => row.deltaMs)),
            medianReduction: median(
                pairs
                    .map((row) => row.reduction)
                    .filter((value) => value !== null),
            ),
        };
    });
}

function average(values) {
    return values.length
        ? values.reduce((n, value) => n + value, 0) / values.length
        : null;
}

export function fraction(n, d) {
    return d ? n / d : null;
}
export function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function wikiPageInventory(snapshot) {
    return snapshot.views.filter(
        (view) =>
            view.definition.kind === "wiki" &&
            view.state !== "archived" &&
            !view.redirect,
    );
}

export function stablePageOverlap(left, right) {
    const a = new Set(left.map((page) => page.viewId));
    const b = new Set(right.map((page) => page.viewId));
    const shared = [...a].filter((id) => b.has(id)).length;
    return {
        left: a.size,
        right: b.size,
        shared,
        jaccard: fraction(shared, new Set([...a, ...b]).size),
        interpretation: "Stable IDs only; not semantic equivalence or accuracy",
    };
}

export function pairedWikiResults(trials) {
    return ["G1", "D1"].map((arm) => {
        const pairs = [];
        for (const baseline of trials.filter((row) => row.arm === "G0")) {
            const candidate = trials.find(
                (row) =>
                    row.arm === arm &&
                    row.id === baseline.id &&
                    row.repetition === baseline.repetition,
            );
            if (!candidate) continue;
            const complete =
                baseline.status === "complete" &&
                candidate.status === "complete";
            pairs.push({
                id: baseline.id,
                repetition: baseline.repetition,
                baseline: baseline.status,
                candidate: candidate.status,
                successfulReadinessDeltaMs: complete
                    ? candidate.readinessMs - baseline.readinessMs
                    : null,
                overlap:
                    candidate.pages && baseline.pages
                        ? stablePageOverlap(baseline.pages, candidate.pages)
                        : null,
            });
        }
        return {
            arm,
            pairs,
            medianSuccessfulReadinessDeltaMs: median(
                pairs
                    .map((pair) => pair.successfulReadinessDeltaMs)
                    .filter((n) => n !== null),
            ),
        };
    });
}

export function wikiJudgePacket(
    left,
    right,
    order = false,
    originalEvidence = [],
) {
    const evidence = new Map();
    for (const item of originalEvidence) {
        assert.ok(typeof item.text === "string" && item.text.trim());
        evidence.set(
            JSON.stringify(["original-source", item.sourceKey, item.text]),
            item.text,
        );
    }
    const pages = [left, right].map((views) =>
        views.map((view) => ({
            pageId: view.viewId,
            query: view.definition.wiki.query,
            aliases: view.definition.wiki.aliases,
            content: view.content,
            priorQualifications:
                view.generation?.input?.wikiContribution?.priorProse ?? "",
        })),
    );
    for (const view of [...left, ...right])
        for (const source of view.generation?.input?.inputs ?? [])
            for (const passage of source.passages ?? []) {
                const key = JSON.stringify([
                    passage.sourceId,
                    passage.revisionId,
                    passage.locator,
                    passage.excerpt,
                ]);
                if (!evidence.has(key)) evidence.set(key, passage.excerpt);
            }
    assert.ok(
        evidence.size,
        "Quality judging requires original indexed evidence",
    );
    return {
        sides: { A: pages[Number(order)], B: pages[Number(!order)] },
        evidence: [...evidence.values()].map((text, index) => ({
            id: `e${index}`,
            text,
        })),
    };
}

export function validateWikiJudgment(value, packet) {
    assert.ok(value && typeof value === "object");
    assert.ok(["A", "B", "tie", "insufficient"].includes(value.winner));
    assert.ok(Array.isArray(value.matches) && Array.isArray(value.defects));
    for (const side of ["A", "B"]) {
        validateQualityRatings(value.scores?.[side]);
        const pageScores = value.pageScores?.[side];
        assert.ok(
            Array.isArray(pageScores),
            "Per-page quality scores required",
        );
        assert.equal(
            pageScores.length,
            packet.sides[side].length,
            "Every page needs quality scores",
        );
        assert.equal(
            new Set(pageScores.map((row) => row.pageId)).size,
            pageScores.length,
            "Duplicate per-page quality scores",
        );
        for (const row of pageScores) {
            assert.ok(
                packet.sides[side].some((page) => page.pageId === row.pageId),
                "Unknown scored page",
            );
            validateQualityRatings(row.scores);
        }
    }
    for (const match of value.matches) {
        for (const side of ["A", "B"])
            assert.ok(
                packet.sides[side].some((page) => page.pageId === match[side]),
                "Unknown semantic page match",
            );
        assert.ok(
            typeof match.reason === "string" && match.reason.trim(),
            "Semantic match reason required",
        );
    }
    assert.equal(
        new Set(
            value.matches.map((match) => JSON.stringify([match.A, match.B])),
        ).size,
        value.matches.length,
        "Duplicate semantic page match",
    );
    for (const defect of value.defects) {
        assert.ok(["A", "B"].includes(defect.side));
        const page = packet.sides[defect.side].find(
            (item) => item.pageId === defect.pageId,
        );
        const evidence = packet.evidence.find(
            (item) => item.id === defect.evidenceId,
        );
        assert.ok(
            page &&
                evidence &&
                typeof defect.sourceQuote === "string" &&
                defect.sourceQuote.trim() &&
                evidence.text.includes(defect.sourceQuote),
            "Quality defect must bind an exact original-source quote",
        );
        assert.equal(typeof defect.critical, "boolean");
        assert.ok(
            typeof defect.reason === "string" && defect.reason.trim(),
            "Defect reason required",
        );
        assert.ok(
            typeof defect.proseQuote === "string" &&
                defect.proseQuote.trim() &&
                [
                    page.content.summary,
                    ...page.content.sections.map((section) => section.body),
                ]
                    .join("\n")
                    .includes(defect.proseQuote),
            "Quality defect must bind actual page prose",
        );
    }
    return value;
}

function validateQualityRatings(scores) {
    for (const dimension of wikiQualityDimensions)
        assert.ok(
            Number.isInteger(scores?.[dimension]) &&
                scores[dimension] >= 1 &&
                scores[dimension] <= 5,
            "Quality dimensions require integer ratings 1-5",
        );
}

export function summarizeWikiComparison(comparison, ledger, left, right) {
    const orders = comparison.judgments.map(({ reversed, judgment }) => {
        const baseline = reversed ? "B" : "A",
            candidate = reversed ? "A" : "B";
        const coverage = (side) => {
            const critical = judgment.coverage.filter(
                (row) =>
                    ledger.facts.find((fact) => fact.id === row.factId)
                        .critical,
            );
            return {
                covered: judgment.coverage.filter(
                    (row) => row[side] === "covered",
                ).length,
                missing: judgment.coverage.filter(
                    (row) => row[side] === "missing",
                ).length,
                uncertain: judgment.coverage.filter(
                    (row) => row[side] === "uncertain",
                ).length,
                criticalMissing: critical.filter(
                    (row) => row[side] === "missing",
                ).length,
                criticalUncertain: critical.filter(
                    (row) => row[side] === "uncertain",
                ).length,
            };
        };
        const matched = (side) =>
            new Set(judgment.matches.map((match) => match[side])).size;
        return {
            reversed,
            winner:
                judgment.winner === baseline
                    ? "baseline"
                    : judgment.winner === candidate
                      ? "candidate"
                      : judgment.winner,
            baselineScores: judgment.scores[baseline],
            candidateScores: judgment.scores[candidate],
            baselinePageScores: judgment.pageScores[baseline],
            candidatePageScores: judgment.pageScores[candidate],
            baselineCoverage: coverage(baseline),
            candidateCoverage: coverage(candidate),
            semanticPurposeRecall: fraction(matched(baseline), left.length),
            semanticPurposePrecision: fraction(
                matched(candidate),
                right.length,
            ),
            criticalDefects: judgment.defects.filter(
                (defect) => defect.side === candidate && defect.critical,
            ).length,
        };
    });
    return {
        orders,
        orderWinnerAgreement:
            orders.length === 2 ? orders[0].winner === orders[1].winner : null,
    };
}

export function macroWikiQuality(comparisons) {
    return ["G1", "D1"].map((arm) => {
        const rows = comparisons.filter(
            (row) => row.arm === arm && row.summary,
        );
        const histories = [...new Set(rows.map((row) => row.id))].map((id) => {
            const orders = rows
                .filter((row) => row.id === id)
                .flatMap((row) => row.summary.orders);
            return {
                id,
                dimensionDeltas: Object.fromEntries(
                    wikiQualityDimensions.map((name) => [
                        name,
                        orders.reduce(
                            (sum, row) =>
                                sum +
                                row.candidateScores[name] -
                                row.baselineScores[name],
                            0,
                        ) / orders.length,
                    ]),
                ),
            };
        });
        return {
            arm,
            histories,
            macroDimensionDeltas: Object.fromEntries(
                wikiQualityDimensions.map((name) => [
                    name,
                    histories.length
                        ? histories.reduce(
                              (sum, row) => sum + row.dimensionDeltas[name],
                              0,
                          ) / histories.length
                        : null,
                ]),
            ),
        };
    });
}
