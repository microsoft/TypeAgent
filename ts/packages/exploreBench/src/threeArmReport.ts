// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { patchLanguages } from "./dataset.js";
import { validateResultRows } from "./integrity.js";
import { readResults, readRunManifest, writeJsonAtomic } from "./io.js";
import {
    benchmarkVariantLabel,
    dedupeAndRescore,
    summarizeRows,
    type LeaderboardRow,
    type MetricSummary,
} from "./report.js";
import { overallRecall } from "./score.js";
import type {
    BenchmarkVariant,
    RepositoryLanguage,
    RunManifest,
    RunResult,
} from "./types.js";

type ThreeArmId = BenchmarkVariant;

interface ExecutionLatencySummary {
    executions: number;
    meanMs: number;
    p50Ms: number;
    p95Ms: number;
}

interface ThreeArmSummary {
    label: string;
    completed: number;
    commonSuccessfulRows: number;
    overallRecall: number | null;
    file: MetricSummary | null;
    line: MetricSummary | null;
    finalAttemptTokens: number | null;
    successfulExecutionLatency: ExecutionLatencySummary | null;
    lspAdoptionCount: number;
    lspCallCount: number;
    lspResultCount: number;
}

interface ThreeArmModelReport {
    matrixName: string;
    requestedTasks: number;
    commonSuccessfulTasks: number;
    complete: boolean;
    arms: Record<ThreeArmId, ThreeArmSummary>;
}

export interface ThreeArmReport {
    schemaVersion: 2;
    generatedAt: string;
    inputs: {
        paired: string;
        lsp: string;
    };
    runIds: {
        paired: string;
        lsp: string;
    };
    taskCount: number;
    languageFilter: RepositoryLanguage[];
    languageCoverage: Record<RepositoryLanguage, number>;
    arms: Array<{ id: ThreeArmId; label: string }>;
    models: ThreeArmModelReport[];
    tasks: Array<{
        taskId: string;
        languages: RepositoryLanguage[];
        results: Record<
            string,
            Partial<
                Record<
                    ThreeArmId,
                    {
                        ok: boolean;
                        overallRecall: number;
                        finalAttemptTokens: number | null;
                        lspAdopted: boolean;
                        lspCallCount: number;
                        lspResultCount: number;
                    }
                >
            >
        >;
    }>;
    notes: string[];
}

export async function writeThreeArmReport(options: {
    pairedInput: string;
    lspInput: string;
    outputDir?: string;
}): Promise<{
    report: ThreeArmReport;
    jsonPath: string;
    markdownPath: string;
}> {
    const pairedInput = path.resolve(options.pairedInput);
    const lspInput = path.resolve(options.lspInput);
    const pairedManifest = await readManifest(pairedInput);
    const lspManifest = await readManifest(lspInput);
    assertCompatibleManifests(pairedManifest, lspManifest);

    const pairedRaw = await readResults(pairedInput);
    const lspRaw = await readResults(lspInput);
    validateResultRows(pairedRaw, pairedManifest);
    validateResultRows(lspRaw, lspManifest);
    const pairedRows = dedupeAndRescore(pairedRaw).filter(
        (row) => row.variant === "baseline" || row.variant === "typeagent",
    );
    const lspRows = dedupeAndRescore(lspRaw).filter(
        (row) => row.variant === "typeagent-lsp",
    );
    assertTaskIdentity(pairedRows, lspRows, lspManifest.taskIds);
    const rows = [...pairedRows, ...lspRows];
    const taskIds = lspManifest.taskIds;
    const taskLanguages = new Map(
        taskIds.map((taskId) => {
            const row = rows.find((candidate) => candidate.taskId === taskId);
            if (!row) {
                throw new Error(`No result row carries task ${taskId}`);
            }
            return [taskId, patchLanguages(row.swebench.patch)] as const;
        }),
    );
    const languageCoverage = {
        python: countLanguage(taskLanguages, "python"),
        typescript: countLanguage(taskLanguages, "typescript"),
    };
    const models = lspManifest.matrix.map((entry) => {
        const matrixName = entry.name ?? entry.model;
        const modelRows = rows.filter(
            (row) =>
                row.matrixName === matrixName && taskIds.includes(row.taskId),
        );
        return buildModelReport(matrixName, taskIds, modelRows);
    });
    const report: ThreeArmReport = {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        inputs: { paired: pairedInput, lsp: lspInput },
        runIds: {
            paired: pairedManifest.runId,
            lsp: lspManifest.runId,
        },
        taskCount: taskIds.length,
        languageFilter: lspManifest.languageFilter ?? ["python", "typescript"],
        languageCoverage,
        arms: armIds().map((id) => ({
            id,
            label: benchmarkVariantLabel(id),
        })),
        models,
        tasks: taskIds.map((taskId) => ({
            taskId,
            languages: taskLanguages.get(taskId) ?? [],
            results: Object.fromEntries(
                lspManifest.matrix.map((entry) => {
                    const matrixName = entry.name ?? entry.model;
                    const taskRows = rows.filter(
                        (row) =>
                            row.taskId === taskId &&
                            row.matrixName === matrixName,
                    );
                    return [
                        matrixName,
                        Object.fromEntries(
                            armIds().flatMap((id) => {
                                const row = taskRows.find(
                                    (candidate) => candidate.variant === id,
                                );
                                return row
                                    ? [[id, compactTaskResult(row)]]
                                    : [];
                            }),
                        ),
                    ];
                }),
            ),
        })),
        notes: [
            "Metrics compare only the three-way intersection of successful rows for the same task and model; completion counts cover the full requested cohort.",
            "Latency reports one final successful execution per common task; failed retry attempts are excluded from mean, p50, and p95.",
            "All three arms are read from the supplied current-harness result files; report generation does not issue model requests.",
            "LSP navigation is charged against the same eight-call repository budget, and every successful TypeAgent with LSP row must contain an error-free language-server call and repository-grounded reads before submission.",
            "The LSP call total counts successful navigation calls; failed attempts remain available in raw TypeAgent tool telemetry.",
            "SWE-bench Verified is Python-only at the gold-patch level in this cohort, so TypeScript language-server benchmark coverage is reported explicitly and may be zero.",
        ],
    };
    const outputDir = path.resolve(options.outputDir ?? path.dirname(lspInput));
    const jsonPath = path.join(outputDir, "report-three-arm.json");
    const markdownPath = path.join(outputDir, "report-three-arm.md");
    await writeJsonAtomic(jsonPath, report);
    await writeFile(markdownPath, renderMarkdown(report), "utf8");
    return { report, jsonPath, markdownPath };
}

function buildModelReport(
    matrixName: string,
    taskIds: string[],
    rows: RunResult[],
): ThreeArmModelReport {
    const byArm = Object.fromEntries(
        armIds().map((id) => [
            id,
            new Map(
                rows
                    .filter((row) => row.variant === id)
                    .map((row) => [row.taskId, row]),
            ),
        ]),
    ) as Record<ThreeArmId, Map<string, RunResult>>;
    const commonTaskIds = taskIds.filter((taskId) =>
        armIds().every((id) => byArm[id].get(taskId)?.ok === true),
    );
    const arms = Object.fromEntries(
        armIds().map((id) => {
            const requestedRows = taskIds.flatMap((taskId) => {
                const row = byArm[id].get(taskId);
                return row ? [row] : [];
            });
            const commonRows = commonTaskIds.map(
                (taskId) => byArm[id].get(taskId)!,
            );
            return [id, armSummary(id, requestedRows, commonRows)];
        }),
    ) as Record<ThreeArmId, ThreeArmSummary>;
    return {
        matrixName,
        requestedTasks: taskIds.length,
        commonSuccessfulTasks: commonTaskIds.length,
        complete: commonTaskIds.length === taskIds.length,
        arms,
    };
}

function armSummary(
    id: ThreeArmId,
    requestedRows: RunResult[],
    commonRows: RunResult[],
): ThreeArmSummary {
    const summary: LeaderboardRow | undefined = summarizeRows(commonRows);
    return {
        label: benchmarkVariantLabel(id),
        completed: requestedRows.filter((row) => row.ok).length,
        commonSuccessfulRows: commonRows.length,
        overallRecall: summary?.overallRecall ?? null,
        file: summary?.file ?? null,
        line: summary?.line ?? null,
        finalAttemptTokens: summary?.finalAttemptUsage?.totalTokens ?? null,
        successfulExecutionLatency: summarizeExecutionLatency(commonRows),
        lspAdoptionCount: requestedRows.filter((row) => row.lspAdopted).length,
        lspCallCount: requestedRows.reduce(
            (total, row) => total + (row.lspCallCount ?? 0),
            0,
        ),
        lspResultCount: requestedRows.reduce(
            (total, row) => total + (row.lspResultCount ?? 0),
            0,
        ),
    };
}

function compactTaskResult(row: RunResult) {
    return {
        ok: row.ok,
        overallRecall: row.ok ? overallRecall(row.score) : 0,
        finalAttemptTokens: row.finalAttemptUsage?.totalTokens ?? null,
        lspAdopted: row.lspAdopted ?? false,
        lspCallCount: row.lspCallCount ?? 0,
        lspResultCount: row.lspResultCount ?? 0,
    };
}

function renderMarkdown(report: ThreeArmReport): string {
    const rows = report.models.map((model) => {
        const copilot = model.arms.baseline;
        const typeagent = model.arms.typeagent;
        const lsp = model.arms["typeagent-lsp"];
        return `| ${model.matrixName} | ${model.commonSuccessfulTasks}/${model.requestedTasks} | ${copilot.completed}/${model.requestedTasks} | ${typeagent.completed}/${model.requestedTasks} | ${lsp.completed}/${model.requestedTasks} | ${formatNumber(copilot.overallRecall)} | ${formatNumber(typeagent.overallRecall)} | ${formatNumber(lsp.overallRecall)} | ${formatMetric(copilot.file)} | ${formatMetric(typeagent.file)} | ${formatMetric(lsp.file)} | ${formatMetric(copilot.line)} | ${formatMetric(typeagent.line)} | ${formatMetric(lsp.line)} | ${formatInteger(copilot.finalAttemptTokens)} | ${formatInteger(typeagent.finalAttemptTokens)} | ${formatInteger(lsp.finalAttemptTokens)} | ${formatLatency(copilot.successfulExecutionLatency)} | ${formatLatency(typeagent.successfulExecutionLatency)} | ${formatLatency(lsp.successfulExecutionLatency)} | ${lsp.lspAdoptionCount}/${model.requestedTasks} | ${lsp.lspCallCount} | ${lsp.lspResultCount} |`;
    });
    return [
        "# Explore benchmark: three-arm LSP comparison",
        "",
        `Tasks: ${report.taskCount}; Python coverage: ${report.languageCoverage.python}; TypeScript coverage: ${report.languageCoverage.typescript}.`,
        "",
        "Quality, final-attempt token, and latency columns use only the successful three-way task intersection for each model. Latency counts one final successful execution per task and excludes failed retries. Completion and LSP adoption cover all requested tasks.",
        "",
        "| Model | Three-way paired | Copilot SDK (with explore agent) completed | TypeAgent completed | TypeAgent with LSP completed | Copilot SDK recall | TypeAgent recall | TypeAgent with LSP recall | Copilot SDK file P/R/F1 | TypeAgent file P/R/F1 | TypeAgent with LSP file P/R/F1 | Copilot SDK line P/R/F1 | TypeAgent line P/R/F1 | TypeAgent with LSP line P/R/F1 | Copilot SDK final-attempt tokens | TypeAgent final-attempt tokens | TypeAgent with LSP final-attempt tokens | Copilot SDK latency mean/p50/p95 | TypeAgent latency mean/p50/p95 | TypeAgent with LSP latency mean/p50/p95 | LSP adopted | Successful LSP calls | LSP locations |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        ...rows,
        "",
        "## Notes",
        "",
        ...report.notes.map((note) => `- ${note}`),
        "",
    ].join("\n");
}

async function readManifest(input: string): Promise<RunManifest> {
    return readRunManifest(path.join(path.dirname(input), "manifest.json"));
}

function assertCompatibleManifests(
    paired: RunManifest,
    lsp: RunManifest,
): void {
    if (
        paired.dataset !== lsp.dataset ||
        paired.split !== lsp.split ||
        JSON.stringify(paired.matrix) !== JSON.stringify(lsp.matrix)
    ) {
        throw new Error(
            "Three-arm inputs must use the same dataset, split, and model matrix",
        );
    }
    if (
        !paired.variants.includes("baseline") ||
        !paired.variants.includes("typeagent")
    ) {
        throw new Error(
            "Paired input must contain Copilot SDK and TypeAgent variants",
        );
    }
    if (!lsp.variants.includes("typeagent-lsp")) {
        throw new Error(
            "LSP input must contain the TypeAgent with LSP variant",
        );
    }
    const pairedTasks = new Set(paired.taskIds);
    const missing = lsp.taskIds.filter((taskId) => !pairedTasks.has(taskId));
    if (missing.length > 0) {
        throw new Error(
            `Paired input is missing ${missing.length} LSP cohort task(s)`,
        );
    }
}

function assertTaskIdentity(
    pairedRows: RunResult[],
    lspRows: RunResult[],
    taskIds: string[],
): void {
    for (const taskId of taskIds) {
        const paired = pairedRows.find((row) => row.taskId === taskId);
        const lsp = lspRows.find((row) => row.taskId === taskId);
        if (!paired || !lsp || taskIdentity(paired) !== taskIdentity(lsp)) {
            throw new Error(
                `Three-arm inputs disagree on task identity for ${taskId}`,
            );
        }
    }
}

function taskIdentity(row: RunResult): string {
    return JSON.stringify({
        taskId: row.taskId,
        rowIndex: row.rowIndex,
        query: row.query,
        swebench: row.swebench,
    });
}

function countLanguage(
    taskLanguages: Map<string, RepositoryLanguage[]>,
    language: RepositoryLanguage,
): number {
    return [...taskLanguages.values()].filter((languages) =>
        languages.includes(language),
    ).length;
}

function armIds(): ThreeArmId[] {
    return ["baseline", "typeagent", "typeagent-lsp"];
}

function formatMetric(metric: MetricSummary | null): string {
    return metric
        ? `${formatNumber(metric.precision)}/${formatNumber(metric.recall)}/${formatNumber(metric.f1)}`
        : "n/a";
}

function formatNumber(value: number | null): string {
    return value === null ? "n/a" : value.toFixed(3);
}

function formatInteger(value: number | null): string {
    return value === null ? "n/a" : Math.round(value).toLocaleString("en-US");
}

function summarizeExecutionLatency(
    rows: RunResult[],
): ExecutionLatencySummary | null {
    if (rows.length === 0) {
        return null;
    }
    const durations = rows.map((row) => row.durationMs);
    return {
        executions: rows.length,
        meanMs:
            durations.reduce((total, value) => total + value, 0) /
            durations.length,
        p50Ms: median(durations),
        p95Ms: percentile(durations, 0.95),
    };
}

function median(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function percentile(values: number[], fraction: number): number {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function formatLatency(latency: ExecutionLatencySummary | null): string {
    return latency
        ? [latency.meanMs, latency.p50Ms, latency.p95Ms]
              .map((value) => `${(value / 1_000).toFixed(1)}s`)
              .join("/")
        : "n/a";
}
