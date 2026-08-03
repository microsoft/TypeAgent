// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { validateResultRows } from "./integrity.js";
import { responseReadyDurationMs } from "./latency.js";
import { overallRecall, scoreSwebench } from "./score.js";
import type {
    BenchmarkVariant,
    RunManifest,
    RunResult,
    SwebenchMetricScore,
} from "./types.js";

const MIN_TOKEN_SAVING = 0.3;
const requiredVariants: BenchmarkVariant[] = [
    "baseline",
    "typeagent",
    "typeagent-lsp",
];

export interface AcceptanceArmSummary {
    variant: BenchmarkVariant;
    rows: number;
    totalTokens: number;
    meanDurationMs: number;
    p50DurationMs: number;
    overallRecall: number;
    file: Pick<SwebenchMetricScore, "precision" | "recall" | "f1">;
    line: Pick<SwebenchMetricScore, "precision" | "recall" | "f1">;
}

export interface AcceptanceComparison {
    matrixName: string;
    model: string;
    baseline: AcceptanceArmSummary;
    treatment: AcceptanceArmSummary;
    tokenSaving: number;
}

export function assertAcceptanceGate(
    rawRows: RunResult[],
    manifest: RunManifest,
): AcceptanceComparison[] {
    if (manifest.taskIds.length !== 10 && manifest.taskIds.length !== 100) {
        throw new Error(
            `Acceptance gate requires exactly 10 or 100 tasks; observed ${manifest.taskIds.length}`,
        );
    }
    if (!manifest.taskIdsFile) {
        throw new Error(
            "Acceptance gate requires an exact task-IDs cohort file",
        );
    }
    if (
        manifest.variants.length !== requiredVariants.length ||
        requiredVariants.some((variant) => !manifest.variants.includes(variant))
    ) {
        throw new Error(
            "Acceptance gate requires baseline, typeagent, and typeagent-lsp",
        );
    }
    validateResultRows(rawRows, manifest);

    const terminal = new Map<string, RunResult>();
    for (const row of rawRows) {
        terminal.set(rowKey(row.taskId, row.matrixName, row.variant), row);
    }
    const failures: string[] = [];
    const comparisons: AcceptanceComparison[] = [];
    for (const entry of manifest.matrix) {
        const matrixName = entry.name ?? entry.model;
        const armRows = new Map<BenchmarkVariant, RunResult[]>();
        for (const variant of requiredVariants) {
            const rows: RunResult[] = [];
            for (const taskId of manifest.taskIds) {
                const row = terminal.get(rowKey(taskId, matrixName, variant));
                if (!row || !row.ok) {
                    failures.push(
                        `${matrixName}/${variant} lacks a successful terminal execution for a cohort task`,
                    );
                    continue;
                }
                rows.push({
                    ...row,
                    score: scoreSwebench(
                        row.finalAnswer,
                        row.swebench.patch,
                        row.repoPath,
                    ),
                });
            }
            armRows.set(variant, rows);
        }
        if (
            requiredVariants.some(
                (variant) =>
                    armRows.get(variant)?.length !== manifest.taskIds.length,
            )
        ) {
            continue;
        }
        const baseline = summarizeArm("baseline", armRows.get("baseline")!);
        for (const variant of ["typeagent", "typeagent-lsp"] as const) {
            const treatment = summarizeArm(variant, armRows.get(variant)!);
            const tokenSaving =
                1 - treatment.totalTokens / baseline.totalTokens;
            const label = `${matrixName}/${variant}`;
            if (tokenSaving < MIN_TOKEN_SAVING) {
                failures.push(
                    `${label} token saving ${(tokenSaving * 100).toFixed(1)}% is below 30.0%`,
                );
            }
            if (treatment.meanDurationMs >= baseline.meanDurationMs) {
                failures.push(`${label} mean latency is not below baseline`);
            }
            if (treatment.p50DurationMs >= baseline.p50DurationMs) {
                failures.push(`${label} P50 latency is not below baseline`);
            }
            for (const metric of ["precision", "recall", "f1"] as const) {
                if (treatment.file[metric] < baseline.file[metric]) {
                    failures.push(`${label} file ${metric} is below baseline`);
                }
                if (treatment.line[metric] < baseline.line[metric]) {
                    failures.push(`${label} line ${metric} is below baseline`);
                }
            }
            if (treatment.overallRecall < baseline.overallRecall) {
                failures.push(`${label} overall recall is below baseline`);
            }
            comparisons.push({
                matrixName,
                model: entry.model,
                baseline,
                treatment,
                tokenSaving,
            });
        }
    }
    if (failures.length > 0) {
        throw new Error(
            `Benchmark acceptance gate failed:\n${[...new Set(failures)].map((failure) => `- ${failure}`).join("\n")}`,
        );
    }
    return comparisons;
}

function summarizeArm(
    variant: BenchmarkVariant,
    rows: RunResult[],
): AcceptanceArmSummary {
    const durations = rows.map(responseReadyDurationMs);
    const scores = rows.map((row) => row.score);
    const totalTokens = rows.reduce((total, row) => {
        const usage = variant === "baseline" ? row.usage : row.combinedUsage;
        if (!usage || row.usage?.usageComplete !== true) {
            throw new Error(
                `Acceptance gate found incomplete terminal usage for ${row.matrixName}/${variant}`,
            );
        }
        return total + usage.totalTokens;
    }, 0);
    if (totalTokens <= 0) {
        throw new Error(
            `Acceptance gate requires positive terminal token usage for ${variant}`,
        );
    }
    return {
        variant,
        rows: rows.length,
        totalTokens,
        meanDurationMs: average(durations),
        p50DurationMs: median(durations),
        overallRecall: average(scores.map(overallRecall)),
        file: averageMetric(scores.map((score) => score.file)),
        line: averageMetric(scores.map((score) => score.line)),
    };
}

function averageMetric(
    metrics: SwebenchMetricScore[],
): Pick<SwebenchMetricScore, "precision" | "recall" | "f1"> {
    return {
        precision: average(metrics.map((metric) => metric.precision)),
        recall: average(metrics.map((metric) => metric.recall)),
        f1: average(metrics.map((metric) => metric.f1)),
    };
}

function average(values: number[]): number {
    return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function rowKey(
    taskId: string,
    matrixName: string,
    variant: BenchmarkVariant,
): string {
    return `${taskId}\0${matrixName}\0${variant}`;
}
