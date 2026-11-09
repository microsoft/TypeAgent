// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { protocolVersion } from "./ghcp-eval-corpus.mjs";
import {
    evaluationCategory,
    assertCategoryResults,
} from "./ghcp-eval-categories.mjs";
import { percentile, preliminaryGrade } from "./ghcp-eval-grade.mjs";

function latency(rows, select = (row) => row.e2eMs) {
    const values = rows
        .map(select)
        .filter((value) => Number.isFinite(value) && value >= 0);
    return {
        population: rows.length,
        measured: values.length,
        missing: rows.length - values.length,
        p50Ms: percentile(values, 0.5),
        p90Ms: percentile(values, 0.9),
        p95Ms: percentile(values, 0.95),
    };
}

const key = (row) => `${row.repetition}:${row.caseId}:${row.candidate}`;
const pair = (row) => `${row.repetition}:${row.caseId}`;

function reviewedRows(spec, results, reviews, category) {
    if (
        spec.protocolVersion !== protocolVersion ||
        spec.category !== category.name ||
        !Number.isInteger(spec.repetitions) ||
        spec.repetitions < 1 ||
        spec.corpusVersion !== category.corpusVersion
    )
        throw new Error("Cannot pool or relabel historical protocols");
    assertCategoryResults(results, spec.order, category);
    const expected = new Set(spec.order.map(key));
    const expectedCount = 20 * category.candidates.length * spec.repetitions;
    if (
        expected.size !== spec.order.length ||
        results.length !== spec.order.length ||
        spec.order.length !== expectedCount ||
        spec.order.some(
            (row) =>
                row.category !== category.name ||
                !category.candidates.includes(row.candidate) ||
                !Number.isInteger(row.repetition) ||
                row.repetition < 0 ||
                row.repetition >= spec.repetitions ||
                !(
                    category.name === "lists"
                        ? /^list-[SMRA][1-5]$/
                        : /^[SMRA][1-5]$/
                ).test(row.caseId),
        )
    )
        throw new Error("A complete category schedule is required");
    const decisions = new Map(reviews.map((review) => [key(review), review]));
    if (
        decisions.size !== reviews.length ||
        reviews.some(
            (review) =>
                review.category !== category.name ||
                !expected.has(key(review)) ||
                !["success", "failed", "unknown"].includes(review.outcome),
        )
    )
        throw new Error("Invalid or cross-category review");
    return results.map((result) => {
        const review = decisions.get(key(result));
        const outcome = review?.outcome ?? "unknown";
        if (
            outcome === "success" &&
            (!review.reason?.trim() ||
                !Array.isArray(review.evidence) ||
                !review.evidence.length ||
                !review.evidence.every(
                    (value) => typeof value === "string" && value.trim(),
                ) ||
                ["failed", "incomplete"].includes(
                    preliminaryGrade(result, {}).outcome,
                ))
        )
            throw new Error(
                `Success contradicts trace/state guard or lacks review evidence: ${key(result)}`,
            );
        return { ...result, outcome };
    });
}

function candidateSummary(rows, candidate, common) {
    const own = rows.filter((row) => row.candidate === candidate);
    const successes = own.filter((row) => row.outcome === "success");
    const preparation = candidate === 4 ? own : [];
    const prepMs = preparation.every(
        (row) => Number.isFinite(row.preparationMs) && row.preparationMs >= 0,
    )
        ? preparation.reduce((sum, row) => sum + row.preparationMs, 0)
        : null;
    return {
        candidate,
        denominator: own.length,
        successes: successes.length,
        failed: own.filter((row) => row.outcome === "failed").length,
        unknown: own.filter((row) => row.outcome === "unknown").length,
        e2e: latency(own),
        successfulE2e: latency(successes),
        commonSuccessE2e: latency(own.filter((row) => common.has(pair(row)))),
        preparation: {
            ...latency(preparation, (row) => row.preparationMs),
            totalMs: prepMs,
            amortizedPerTrialMs:
                own.length && prepMs !== null ? prepMs / own.length : null,
        },
        includingPreparation: latency(own, (row) =>
            Number.isFinite(row.e2eMs) &&
            (candidate !== 4 || Number.isFinite(row.preparationMs))
                ? row.e2eMs + (row.preparationMs ?? 0)
                : null,
        ),
        cohorts: Object.fromEntries(
            ["S", "M", "R", "A"].map((cohort) => {
                const cohortRows = own.filter((row) =>
                    row.caseId.replace(/^list-/, "").startsWith(cohort),
                );
                return [
                    cohort,
                    {
                        denominator: cohortRows.length,
                        successes: cohortRows.filter(
                            (row) => row.outcome === "success",
                        ).length,
                        unknown: cohortRows.filter(
                            (row) => row.outcome === "unknown",
                        ).length,
                        failed: cohortRows.filter(
                            (row) => row.outcome === "failed",
                        ).length,
                        e2e: latency(cohortRows),
                    },
                ];
            }),
        ),
    };
}

function pairwiseLatency(rows, candidates) {
    return candidates.flatMap((first, i) =>
        candidates.slice(i + 1).map((second) => {
            const successful = rows.filter((row) => row.outcome === "success");
            const firstRows = successful.filter(
                (row) => row.candidate === first,
            );
            const secondByPair = new Map(
                successful
                    .filter((row) => row.candidate === second)
                    .map((row) => [pair(row), row]),
            );
            const paired = firstRows.filter((row) =>
                secondByPair.has(pair(row)),
            );
            return {
                candidates: [first, second],
                pairs: paired.map(pair).sort(),
                first: latency(paired),
                second: latency(
                    paired.map((row) => secondByPair.get(pair(row))),
                ),
            };
        }),
    );
}

export function summarizeCategory(spec, results, reviews) {
    const category = evaluationCategory(spec.category);
    const rows = reviewedRows(spec, results, reviews, category);
    const common = new Set(
        rows.filter((row) => row.outcome === "success").map(pair),
    );
    for (const id of common) {
        const successful = rows.filter(
            (row) => pair(row) === id && row.outcome === "success",
        );
        if (
            new Set(successful.map((row) => row.candidate)).size !==
            category.candidates.length
        )
            common.delete(id);
    }
    return {
        protocolVersion,
        category: category.name,
        corpusVersion: category.corpusVersion,
        denominator: rows.length,
        commonSuccessPairs: [...common].sort(),
        pairwiseCommonSuccess: pairwiseLatency(rows, category.candidates),
        percentileMethod:
            "nearest rank; null for no observed latency; missing timings never zero",
        limitation:
            "Exploratory repetitions, no powered winner; review faithfulness independently. Do not pool categories.",
        candidates: category.candidates.map((candidate) =>
            candidateSummary(rows, candidate, common),
        ),
    };
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    const [specFile, resultFile, reviewFile, output] = process.argv.slice(2);
    if (!output)
        throw new Error(
            "Usage: ghcp-eval-report.mjs <spec.json> <results.json> <reviews.json> <new-summary.json>",
        );
    const sources = [specFile, resultFile, reviewFile].map((file) =>
        fs.readFileSync(file),
    );
    const summary = summarizeCategory(
        ...sources.map((buffer) => JSON.parse(buffer.toString("utf8"))),
    );
    summary.sourceSha256 = sources.map((buffer) =>
        createHash("sha256").update(buffer).digest("hex"),
    );
    fs.writeFileSync(output, JSON.stringify(summary, null, 2) + "\n", {
        flag: "wx",
    });
}
