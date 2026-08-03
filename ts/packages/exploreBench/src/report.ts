// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { validateResultRows } from "./integrity.js";
import { readResults, readRunManifest, writeJsonAtomic } from "./io.js";
import { responseReadyDurationMs } from "./latency.js";
import { overallRecall, scoreSwebench } from "./score.js";
import type {
    BenchmarkVariant,
    CopilotUsage,
    MatrixEntry,
    RunManifest,
    RunResult,
    SwebenchMetricScore,
    SwebenchScore,
    TokenUsage,
    TypeAgentToolTrace,
    TypeAgentUsage,
} from "./types.js";
import { isTypeAgentVariant } from "./types.js";

export interface MetricSummary extends SwebenchMetricScore {}

export interface LeaderboardRow {
    matrixName: string;
    model: string;
    variant: BenchmarkVariant;
    rows: number;
    failures: number;
    validFinal: number;
    overallRecall: number;
    file: MetricSummary;
    line: MetricSummary;
    avgDurationMs: number;
    p50DurationMs: number;
    p95DurationMs: number;
    avgToolCalls: number;
    avgTypeAgentToolCalls: number;
    mcpAdoptionCount: number;
    mcpAdoptionRate: number;
    subagentAdoptionCount: number;
    subagentAdoptionRate: number;
    mainAgentRepositoryInspectionCount: number;
    mainAgentRepositoryInspectionRate: number;
    outsideExploreInspectionCount: number;
    outsideExploreInspectionRate: number;
    copilotUsage?: TokenUsage;
    typeAgentUsage?: TypeAgentUsage;
    combinedUsage?: TokenUsage;
    finalAttemptUsage?: TokenUsage;
}

interface PairedVariantSummary {
    overallRecall: number;
    file: MetricSummary;
    line: MetricSummary;
    finalAttemptTokens: number | null;
    meanDurationMs: number;
    p50DurationMs: number;
    p95DurationMs: number;
}

interface ComparisonRow {
    matrixName: string;
    model: string;
    treatmentVariant: "typeagent" | "typeagent-lsp";
    expectedPairs: number;
    pairedPairs: number;
    coverage: number;
    complete: boolean;
    missingBaselineTaskIds: string[];
    missingTreatmentTaskIds: string[];
    baseline: PairedVariantSummary | null;
    treatment: PairedVariantSummary | null;
    overallRecallDelta: number | null;
    fileScoreDelta: number | null;
    fileRecallDelta: number | null;
    lineScoreDelta: number | null;
    lineRecallDelta: number | null;
    avgDurationMsDelta: number | null;
    p50DurationMsDelta: number | null;
    p95DurationMsDelta: number | null;
    totalTokensDelta: number | null;
    finalAttemptTokensDelta: number | null;
    mcpAdoptionCount: number;
    mcpAdoptionRate: number;
    subagentAdoptionCount: number;
    subagentAdoptionRate: number;
}

interface PrefixReport {
    limit: number;
    taskIds: string[];
    expectedPairs: number;
    pairedPairs: number;
    complete: boolean;
    leaderboard: LeaderboardRow[];
    comparisons: ComparisonRow[];
}

interface CompactTaskResult {
    ok: boolean;
    durationMs: number;
    wallDurationMs: number;
    finalAnswer: string;
    score: SwebenchScore;
    mcpAdopted: boolean;
    lspAdopted?: boolean;
    lspCallCount?: number;
    lspResultCount?: number;
    subagentAdopted: boolean;
    defaultMainAgent: boolean;
    explorerSubagentTrace: RunResult["explorerSubagentTrace"];
    attemptedExplorerDelegations?: number;
    completedExplorerDelegations?: number;
    successfulExplorerDelegations?: number;
    failedExplorerDelegations?: number;
    mainAgentRepositoryInspection?: boolean;
    mcpToolTrace: RunResult["mcpToolTrace"];
    attemptedExploreCalls?: number;
    completedExploreCalls?: number;
    successfulExploreCalls?: number;
    outsideExploreInspection?: boolean;
    mcpServerReady?: boolean;
    mcpAdvertisedTools?: string[];
    usage?: CopilotUsage;
    typeAgentUsage?: TypeAgentUsage;
    combinedUsage?: TokenUsage;
    finalAttemptUsage?: TokenUsage;
    typeAgentToolTrace?: TypeAgentToolTrace;
    exploreTelemetry?: RunResult["exploreTelemetry"];
    telemetryFile?: string;
    telemetryError?: string;
    error?: string;
}

export interface EvalReport {
    schemaVersion: 3;
    generatedAt: string;
    input: string;
    runId: string;
    manifest: RunManifest;
    rawRows: number;
    dedupedRows: number;
    models: string[];
    variants: BenchmarkVariant[];
    variantLabels: Record<BenchmarkVariant, string>;
    prefixes: Record<string, PrefixReport>;
    tasks: Array<{
        taskId: string;
        rowIndex: number;
        repo?: string;
        query: string;
        gold: SwebenchScore["patchFiles"];
        results: Record<string, CompactTaskResult>;
    }>;
    notes: string[];
}

export async function writeReports(input: string): Promise<{
    report: EvalReport;
    jsonPath: string;
    markdownPath: string;
}> {
    const absoluteInput = path.resolve(input);
    const manifest = await readRunManifest(
        path.join(path.dirname(absoluteInput), "manifest.json"),
    );
    const rawRows = await readResults(absoluteInput);
    validateResultRows(rawRows, manifest);
    const rows = dedupeAndRescore(rawRows);
    const prefixes: Record<string, PrefixReport> = {};
    for (const limit of benchmarkPrefixLimits(manifest.taskIds.length)) {
        const taskIds = manifest.taskIds.slice(0, limit);
        const allowed = new Set(taskIds);
        const prefixRows = rows.filter((row) => allowed.has(row.taskId));
        const comparisons = buildComparisons(
            prefixRows,
            manifest.matrix,
            taskIds,
        );
        const expectedPairs = comparisons.reduce(
            (total, comparison) => total + comparison.expectedPairs,
            0,
        );
        const pairedPairs = comparisons.reduce(
            (total, comparison) => total + comparison.pairedPairs,
            0,
        );
        prefixes[String(limit)] = {
            limit,
            taskIds,
            expectedPairs,
            pairedPairs,
            complete: pairedPairs === expectedPairs,
            leaderboard: buildLeaderboard(prefixRows, manifest.matrix),
            comparisons,
        };
    }

    const report: EvalReport = {
        schemaVersion: 3,
        generatedAt: new Date().toISOString(),
        input: absoluteInput,
        runId: manifest.runId,
        manifest,
        rawRows: rawRows.length,
        dedupedRows: rows.length,
        models: manifest.matrix.map((entry) => entry.name ?? entry.model),
        variants: manifest.variants,
        variantLabels: {
            baseline: benchmarkVariantLabel("baseline"),
            typeagent: benchmarkVariantLabel("typeagent"),
            "typeagent-lsp": benchmarkVariantLabel("typeagent-lsp"),
        },
        prefixes,
        tasks: buildTasks(rows, manifest.taskIds, manifest.matrix),
        notes: [
            "Localization benchmark only: Copilot does not generate or apply patches and does not run tests.",
            `The requested tasks are ${taskSelectionDescription(manifest)}.`,
            "results.jsonl is the raw source of truth; report scores are recomputed from finalAnswer and the embedded SWE-bench patch.",
            "Overall recall is 50% file recall plus 50% line recall; use file/line explore scores to account for over-citation.",
            "Comparison deltas use only task IDs with successful Copilot SDK and TypeAgent rows; incomplete coverage is reported explicitly.",
            "Token and latency deltas use only each task's terminal execution. Latency runs from execution start through the final response-ready boundary and excludes post-response usage reads, disconnect, cleanup, and telemetry settling. Failed retries remain in results.jsonl for audit but are not charged to either arm.",
            `Final-execution tokens cover the ${manifest.taskIds.length} requested tasks exactly when all rows complete; an unknown or incomplete provider usage record is never treated as zero.`,
            "Baseline success requires one synchronous explorer-subagent delegation and no direct main-agent inspection; TypeAgent success requires the default Copilot main agent to invoke the session-bound Explorer MCP tool without a model-authored query and relay its citations unchanged. Explorer telemetry cryptographically binds the invocation to the exact raw request.",
            "The baseline exposes the task tool to its main agent and bounded read/grep/glob/bash tools only to its explorer subagent. The TypeAgent arm exposes only the Explorer MCP tool to the same default main agent; repository inspection remains inside TypeAgent Code Mode.",
            "A successful TypeAgent treatment normally contains exactly three dependent inner requests in one Explorer execution: discoverRepository, refineRepository, then submitExploration. The final turn selects locations only after observing both repository programs. Any bounded repair turn is retained and charged to the same treatment execution.",
            "Cached-input, cache-write, and reasoning tokens are subsets; total tokens are input plus output and do not double-count them. Schema-v4 records one inseparable inner usage bucket because the same model completions both translate state into typed actions and generate Code Mode programs; schema-v3 translation/codeMode fields remain readable only for backward compatibility.",
        ],
    };
    const jsonPath = path.join(path.dirname(absoluteInput), "report.json");
    const markdownPath = path.join(path.dirname(absoluteInput), "report.md");
    await writeJsonAtomic(jsonPath, report);
    await writeFile(markdownPath, renderMarkdown(report), "utf8");
    return { report, jsonPath, markdownPath };
}

export function benchmarkPrefixLimits(taskCount: number): number[] {
    return [1, 5, 10, 20, 30, 50, 100, 500, 1000].filter(
        (limit) => taskCount >= limit,
    );
}

export function dedupeAndRescore(rawRows: RunResult[]): RunResult[] {
    const grouped = new Map<string, RunResult[]>();
    for (const row of rawRows) {
        const key = `${row.taskId}\0${row.matrixName}\0${row.variant}`;
        const attempts = grouped.get(key) ?? [];
        attempts.push(row);
        grouped.set(key, attempts);
    }
    return [...grouped.values()].map((attempts) => {
        const current = attempts[attempts.length - 1];
        const usage =
            current.usage?.usageComplete === true ? current.usage : undefined;
        const typeAgentUsage =
            isTypeAgentVariant(current.variant) &&
            current.typeAgentUsage?.usageComplete === true
                ? current.typeAgentUsage
                : undefined;
        const combinedUsage =
            current.variant === "baseline"
                ? usage
                : usage && typeAgentUsage
                  ? current.combinedUsage
                  : undefined;
        const {
            usage: _usage,
            typeAgentUsage: _typeAgentUsage,
            combinedUsage: _combinedUsage,
            ...latest
        } = current;
        return {
            ...latest,
            score: scoreSwebench(
                current.finalAnswer,
                current.swebench.patch,
                current.repoPath,
            ),
            ...(usage ? { usage } : {}),
            ...(typeAgentUsage ? { typeAgentUsage } : {}),
            ...(combinedUsage ? { combinedUsage } : {}),
            ...(combinedUsage ? { finalAttemptUsage: combinedUsage } : {}),
        };
    });
}

function buildLeaderboard(
    rows: RunResult[],
    matrix: MatrixEntry[],
): LeaderboardRow[] {
    const groups = new Map<string, RunResult[]>();
    for (const row of rows) {
        const key = `${row.matrixName}\0${row.variant}`;
        const group = groups.get(key) ?? [];
        group.push(row);
        groups.set(key, group);
    }
    const variantOrder: BenchmarkVariant[] = [
        "baseline",
        "typeagent",
        "typeagent-lsp",
    ];
    return matrix.flatMap((entry) => {
        const matrixName = entry.name ?? entry.model;
        return variantOrder.flatMap((variant) => {
            const summary = summarizeRows(
                groups.get(`${matrixName}\0${variant}`) ?? [],
            );
            return summary ? [summary] : [];
        });
    });
}

function buildComparisons(
    rows: RunResult[],
    matrix: MatrixEntry[],
    taskIds: string[],
): ComparisonRow[] {
    return matrix.flatMap((entry) => {
        const matrixName = entry.name ?? entry.model;
        const modelRows = rows.filter((row) => row.matrixName === matrixName);
        const requestedTaskIds = new Set(taskIds);
        const requestedBaselineRows = modelRows.filter(
            (row) =>
                row.variant === "baseline" && requestedTaskIds.has(row.taskId),
        );
        const baseline = new Map(
            modelRows
                .filter((row) => row.variant === "baseline" && row.ok)
                .map((row) => [row.taskId, row]),
        );
        const treatmentVariants = (
            ["typeagent", "typeagent-lsp"] as const
        ).filter((variant) => modelRows.some((row) => row.variant === variant));
        return treatmentVariants.map((treatmentVariant) => {
            const requestedTreatmentRows = modelRows.filter(
                (row) =>
                    row.variant === treatmentVariant &&
                    requestedTaskIds.has(row.taskId),
            );
            const treatment = new Map(
                modelRows
                    .filter((row) => row.variant === treatmentVariant && row.ok)
                    .map((row) => [row.taskId, row]),
            );
            const pairedTaskIds = taskIds.filter(
                (taskId) => baseline.has(taskId) && treatment.has(taskId),
            );
            const baselineSummary = summarizeRows(
                pairedTaskIds.map((taskId) => baseline.get(taskId)!),
            );
            const treatmentSummary = summarizeRows(
                pairedTaskIds.map((taskId) => treatment.get(taskId)!),
            );
            const expectedPairs = taskIds.length;
            const pairedPairs = pairedTaskIds.length;
            const mcpAdoptionCount = requestedTreatmentRows.filter(
                hasValidMcpExplorerAdoption,
            ).length;
            const subagentAdoptionCount = requestedBaselineRows.filter(
                (row) => row.subagentAdopted,
            ).length;
            const completeUsage =
                pairedPairs > 0 &&
                pairedTaskIds.every(
                    (taskId) =>
                        baseline.get(taskId)?.usage !== undefined &&
                        treatment.get(taskId)?.combinedUsage !== undefined,
                );
            return {
                matrixName,
                model: entry.model,
                treatmentVariant,
                expectedPairs,
                pairedPairs,
                coverage: expectedPairs > 0 ? pairedPairs / expectedPairs : 0,
                complete: pairedPairs === expectedPairs,
                missingBaselineTaskIds: taskIds.filter(
                    (taskId) => !baseline.has(taskId),
                ),
                missingTreatmentTaskIds: taskIds.filter(
                    (taskId) => !treatment.has(taskId),
                ),
                baseline: pairedVariantSummary(baselineSummary),
                treatment: pairedVariantSummary(treatmentSummary),
                overallRecallDelta:
                    baselineSummary && treatmentSummary
                        ? treatmentSummary.overallRecall -
                          baselineSummary.overallRecall
                        : null,
                fileScoreDelta:
                    baselineSummary && treatmentSummary
                        ? treatmentSummary.file.score -
                          baselineSummary.file.score
                        : null,
                fileRecallDelta:
                    baselineSummary && treatmentSummary
                        ? treatmentSummary.file.recall -
                          baselineSummary.file.recall
                        : null,
                lineScoreDelta:
                    baselineSummary && treatmentSummary
                        ? treatmentSummary.line.score -
                          baselineSummary.line.score
                        : null,
                lineRecallDelta:
                    baselineSummary && treatmentSummary
                        ? treatmentSummary.line.recall -
                          baselineSummary.line.recall
                        : null,
                avgDurationMsDelta:
                    baselineSummary && treatmentSummary
                        ? treatmentSummary.avgDurationMs -
                          baselineSummary.avgDurationMs
                        : null,
                p50DurationMsDelta:
                    baselineSummary && treatmentSummary
                        ? treatmentSummary.p50DurationMs -
                          baselineSummary.p50DurationMs
                        : null,
                p95DurationMsDelta:
                    baselineSummary && treatmentSummary
                        ? treatmentSummary.p95DurationMs -
                          baselineSummary.p95DurationMs
                        : null,
                totalTokensDelta:
                    completeUsage &&
                    baselineSummary?.copilotUsage &&
                    treatmentSummary?.combinedUsage
                        ? treatmentSummary.combinedUsage.totalTokens -
                          baselineSummary.copilotUsage.totalTokens
                        : null,
                finalAttemptTokensDelta:
                    baselineSummary?.finalAttemptUsage &&
                    treatmentSummary?.finalAttemptUsage
                        ? treatmentSummary.finalAttemptUsage.totalTokens -
                          baselineSummary.finalAttemptUsage.totalTokens
                        : null,
                mcpAdoptionCount,
                mcpAdoptionRate:
                    expectedPairs > 0 ? mcpAdoptionCount / expectedPairs : 0,
                subagentAdoptionCount,
                subagentAdoptionRate:
                    expectedPairs > 0
                        ? subagentAdoptionCount / expectedPairs
                        : 0,
            };
        });
    });
}

export function summarizeRows(group: RunResult[]): LeaderboardRow | undefined {
    if (group.length === 0) {
        return undefined;
    }
    const first = group[0];
    const mcpAdoptionCount = group.filter(hasValidMcpExplorerAdoption).length;
    const subagentAdoptionCount = group.filter(
        (row) => row.subagentAdopted,
    ).length;
    const mainAgentRepositoryInspectionCount = group.filter(
        (row) => row.mainAgentRepositoryInspection === true,
    ).length;
    const outsideExploreInspectionCount = group.filter(
        (row) => row.outsideExploreInspection === true,
    ).length;
    const copilotUsages = completeValues(
        group.map((row) =>
            row.usage?.usageComplete === true ? row.usage : undefined,
        ),
    );
    const typeAgentUsages = isTypeAgentVariant(first.variant)
        ? completeValues(
              group.map((row) =>
                  row.typeAgentUsage?.usageComplete === true
                      ? row.typeAgentUsage
                      : undefined,
              ),
          )
        : undefined;
    const combinedUsages = completeValues(
        group.map(
            (row) =>
                row.combinedUsage ??
                (row.variant === "baseline" && row.usage?.usageComplete === true
                    ? row.usage
                    : undefined),
        ),
    );
    const finalAttemptUsages = completeValues(
        group.map((row) => (row.ok ? row.finalAttemptUsage : undefined)),
    );
    return {
        matrixName: first.matrixName,
        model: first.model,
        variant: first.variant,
        rows: group.length,
        failures: group.filter((row) => !row.ok).length,
        validFinal: group.filter((row) => row.ok && row.score.validFinalAnswer)
            .length,
        overallRecall: average(
            group.map((row) => (row.ok ? overallRecall(row.score) : 0)),
        ),
        file: averageMetric(
            group.map((row) => effectiveMetric(row, row.score.file)),
        ),
        line: averageMetric(
            group.map((row) => effectiveMetric(row, row.score.line)),
        ),
        avgDurationMs: average(group.map(responseReadyDurationMs)),
        p50DurationMs: median(group.map(responseReadyDurationMs)),
        p95DurationMs: percentile(group.map(responseReadyDurationMs), 0.95),
        avgToolCalls: average(group.map((row) => row.toolTrace.length)),
        avgTypeAgentToolCalls: average(
            group.map((row) => row.typeAgentToolTrace?.totalCalls ?? 0),
        ),
        mcpAdoptionCount,
        mcpAdoptionRate: mcpAdoptionCount / group.length,
        subagentAdoptionCount,
        subagentAdoptionRate: subagentAdoptionCount / group.length,
        mainAgentRepositoryInspectionCount,
        mainAgentRepositoryInspectionRate:
            mainAgentRepositoryInspectionCount / group.length,
        outsideExploreInspectionCount,
        outsideExploreInspectionRate:
            outsideExploreInspectionCount / group.length,
        ...(copilotUsages ? { copilotUsage: sumUsage(copilotUsages) } : {}),
        ...(typeAgentUsages
            ? { typeAgentUsage: sumTypeAgentUsage(typeAgentUsages) }
            : {}),
        ...(combinedUsages ? { combinedUsage: sumUsage(combinedUsages) } : {}),
        ...(finalAttemptUsages
            ? { finalAttemptUsage: sumUsage(finalAttemptUsages) }
            : {}),
    };
}

function pairedVariantSummary(
    summary: LeaderboardRow | undefined,
): PairedVariantSummary | null {
    if (!summary) {
        return null;
    }
    return {
        overallRecall: summary.overallRecall,
        file: summary.file,
        line: summary.line,
        finalAttemptTokens: summary.finalAttemptUsage?.totalTokens ?? null,
        meanDurationMs: summary.avgDurationMs,
        p50DurationMs: summary.p50DurationMs,
        p95DurationMs: summary.p95DurationMs,
    };
}

function effectiveMetric(
    row: RunResult,
    metric: SwebenchMetricScore,
): SwebenchMetricScore {
    return row.ok
        ? metric
        : {
              score: 0,
              precision: 0,
              recall: 0,
              f1: 0,
              nCitation: 0,
              nPatch: metric.nPatch,
          };
}

function buildTasks(
    rows: RunResult[],
    taskOrder: string[],
    matrix: MatrixEntry[],
): EvalReport["tasks"] {
    const byTask = new Map<string, RunResult[]>();
    for (const row of rows) {
        const group = byTask.get(row.taskId) ?? [];
        group.push(row);
        byTask.set(row.taskId, group);
    }
    return taskOrder.flatMap((taskId) => {
        const group = byTask.get(taskId);
        if (!group?.length) {
            return [];
        }
        const first = group[0];
        const results: Record<string, CompactTaskResult> = {};
        for (const entry of matrix) {
            const matrixName = entry.name ?? entry.model;
            for (const variant of [
                "baseline",
                "typeagent",
                "typeagent-lsp",
            ] as const) {
                const row = group.find(
                    (candidate) =>
                        candidate.matrixName === matrixName &&
                        candidate.variant === variant,
                );
                if (row) {
                    results[`${matrixName}:${variant}`] = {
                        ok: row.ok,
                        durationMs: responseReadyDurationMs(row),
                        wallDurationMs: row.durationMs,
                        finalAnswer: row.finalAnswer,
                        score: row.score,
                        mcpAdopted: hasValidMcpExplorerAdoption(row),
                        ...(row.lspAdopted !== undefined
                            ? { lspAdopted: row.lspAdopted }
                            : {}),
                        ...(row.lspCallCount !== undefined
                            ? { lspCallCount: row.lspCallCount }
                            : {}),
                        ...(row.lspResultCount !== undefined
                            ? { lspResultCount: row.lspResultCount }
                            : {}),
                        subagentAdopted: row.subagentAdopted,
                        defaultMainAgent: row.defaultMainAgent,
                        explorerSubagentTrace: row.explorerSubagentTrace,
                        mcpToolTrace: row.mcpToolTrace,
                        ...(row.attemptedExplorerDelegations !== undefined
                            ? {
                                  attemptedExplorerDelegations:
                                      row.attemptedExplorerDelegations,
                              }
                            : {}),
                        ...(row.completedExplorerDelegations !== undefined
                            ? {
                                  completedExplorerDelegations:
                                      row.completedExplorerDelegations,
                              }
                            : {}),
                        ...(row.successfulExplorerDelegations !== undefined
                            ? {
                                  successfulExplorerDelegations:
                                      row.successfulExplorerDelegations,
                              }
                            : {}),
                        ...(row.failedExplorerDelegations !== undefined
                            ? {
                                  failedExplorerDelegations:
                                      row.failedExplorerDelegations,
                              }
                            : {}),
                        ...(row.mainAgentRepositoryInspection !== undefined
                            ? {
                                  mainAgentRepositoryInspection:
                                      row.mainAgentRepositoryInspection,
                              }
                            : {}),
                        ...(row.attemptedExploreCalls !== undefined
                            ? {
                                  attemptedExploreCalls:
                                      row.attemptedExploreCalls,
                              }
                            : {}),
                        ...(row.completedExploreCalls !== undefined
                            ? {
                                  completedExploreCalls:
                                      row.completedExploreCalls,
                              }
                            : {}),
                        ...(row.successfulExploreCalls !== undefined
                            ? {
                                  successfulExploreCalls:
                                      row.successfulExploreCalls,
                              }
                            : {}),
                        ...(row.outsideExploreInspection !== undefined
                            ? {
                                  outsideExploreInspection:
                                      row.outsideExploreInspection,
                              }
                            : {}),
                        ...(row.mcpServerReady !== undefined
                            ? { mcpServerReady: row.mcpServerReady }
                            : {}),
                        ...(row.mcpAdvertisedTools
                            ? {
                                  mcpAdvertisedTools: row.mcpAdvertisedTools,
                              }
                            : {}),
                        ...(row.usage ? { usage: row.usage } : {}),
                        ...(row.typeAgentUsage
                            ? { typeAgentUsage: row.typeAgentUsage }
                            : {}),
                        ...(row.combinedUsage
                            ? { combinedUsage: row.combinedUsage }
                            : {}),
                        ...(row.finalAttemptUsage
                            ? { finalAttemptUsage: row.finalAttemptUsage }
                            : {}),
                        ...(row.typeAgentToolTrace
                            ? { typeAgentToolTrace: row.typeAgentToolTrace }
                            : {}),
                        ...(row.exploreTelemetry
                            ? { exploreTelemetry: row.exploreTelemetry }
                            : {}),
                        ...(row.telemetryFile
                            ? { telemetryFile: row.telemetryFile }
                            : {}),
                        ...(row.telemetryError
                            ? { telemetryError: row.telemetryError }
                            : {}),
                        ...(row.error ? { error: row.error } : {}),
                    };
                }
            }
        }
        return [
            {
                taskId,
                rowIndex: first.rowIndex,
                ...(first.swebench.repo ? { repo: first.swebench.repo } : {}),
                query: first.query,
                gold: first.score.patchFiles,
                results,
            },
        ];
    });
}

function averageMetric(metrics: SwebenchMetricScore[]): MetricSummary {
    return {
        score: average(metrics.map((metric) => metric.score)),
        precision: average(metrics.map((metric) => metric.precision)),
        recall: average(metrics.map((metric) => metric.recall)),
        f1: average(metrics.map((metric) => metric.f1)),
        nCitation: average(metrics.map((metric) => metric.nCitation)),
        nPatch: average(metrics.map((metric) => metric.nPatch)),
    };
}

function sumUsage(usages: TokenUsage[]): TokenUsage {
    const sum = (pick: (usage: TokenUsage) => number): number =>
        usages.reduce((total, usage) => total + pick(usage), 0);
    return {
        inputTokens: sum((usage) => usage.inputTokens),
        cachedInputTokens: sum((usage) => usage.cachedInputTokens),
        cacheWriteTokens: sum((usage) => usage.cacheWriteTokens),
        outputTokens: sum((usage) => usage.outputTokens),
        reasoningOutputTokens: sum((usage) => usage.reasoningOutputTokens),
        totalTokens: sum((usage) => usage.totalTokens),
    };
}

function sumTypeAgentUsage(usages: TypeAgentUsage[]): TypeAgentUsage {
    return {
        ...sumUsage(usages),
        requestCount: usages.reduce(
            (total, usage) => total + usage.requestCount,
            0,
        ),
        usageComplete: usages.every((usage) => usage.usageComplete === true),
    };
}

function completeValues<T>(values: Array<T | undefined>): T[] | undefined {
    return values.every((value): value is T => value !== undefined)
        ? values
        : undefined;
}

function average(values: number[]): number {
    return values.length > 0
        ? values.reduce((total, value) => total + value, 0) / values.length
        : 0;
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

function hasValidMcpExplorerAdoption(row: RunResult): boolean {
    return (
        isTypeAgentVariant(row.variant) &&
        row.defaultMainAgent === true &&
        row.mcpServerReady === true &&
        row.mcpAdopted === true &&
        row.successfulExploreCalls === 1 &&
        row.firstAssistantActionExclusiveExplore === true &&
        row.exploreCompletedBeforeLaterAssistantAction === true &&
        row.mcpToolTrace.filter(
            (call) =>
                call.server === "typeagent" &&
                call.tool === "explore" &&
                call.completed === true &&
                call.success === true &&
                typeof call.arguments === "object" &&
                call.arguments !== null &&
                !Array.isArray(call.arguments) &&
                !Object.prototype.hasOwnProperty.call(call.arguments, "query"),
        ).length === 1
    );
}

function renderMarkdown(report: EvalReport): string {
    const sections = Object.values(report.prefixes).map((prefix) => {
        const comparisons = prefix.comparisons.map((row) => {
            const baselineSummary = row.baseline;
            const treatmentSummary = row.treatment;
            const baseline = prefix.leaderboard.find(
                (entry) =>
                    entry.matrixName === row.matrixName &&
                    entry.variant === "baseline",
            );
            const treatment = prefix.leaderboard.find(
                (entry) =>
                    entry.matrixName === row.matrixName &&
                    entry.variant === row.treatmentVariant,
            );
            return `| ${row.matrixName} | ${benchmarkVariantLabel(row.treatmentVariant)} | ${row.pairedPairs}/${row.expectedPairs} | ${completed(baseline)}/${row.expectedPairs} | ${completed(treatment)}/${row.expectedPairs} | ${formatInteger(baselineSummary?.finalAttemptTokens)} | ${formatInteger(treatmentSummary?.finalAttemptTokens)} | ${formatInteger(row.finalAttemptTokensDelta === null ? null : -row.finalAttemptTokensDelta)} | ${formatLatency(baselineSummary)} | ${formatLatency(treatmentSummary)} | ${formatNumber(baselineSummary?.overallRecall)} | ${formatNumber(treatmentSummary?.overallRecall)} | ${formatMetric(baselineSummary?.file)} | ${formatMetric(treatmentSummary?.file)} | ${formatMetric(baselineSummary?.line)} | ${formatMetric(treatmentSummary?.line)} | ${row.subagentAdoptionCount}/${row.expectedPairs} | ${row.mcpAdoptionCount}/${row.expectedPairs} |`;
        });
        return [
            `## Selected ${prefix.limit}-task prefix (${taskSelectionLabel(report.manifest)})`,
            "",
            `Paired coverage: ${prefix.pairedPairs}/${prefix.expectedPairs} (${prefix.complete ? "complete" : "INCOMPLETE"}).`,
            "",
            "| Model | Treatment arm | Paired | Copilot SDK completed | Treatment completed | Copilot SDK final tokens | Treatment final tokens (outer Copilot + inner Explorer) | Final tokens saved | Copilot SDK latency mean/P50/P95 | Treatment latency mean/P50/P95 | Copilot SDK recall | Treatment recall | Copilot SDK file P/R/F1 | Treatment file P/R/F1 | Copilot SDK line P/R/F1 | Treatment line P/R/F1 | Explore agent used | TypeAgent MCP used |",
            "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
            ...comparisons,
        ].join("\n");
    });
    return [
        `# Explore benchmark: ${report.runId}`,
        "",
        "SWE-bench localization only; this is not patch-generation pass@1.",
        "",
        "Arms: Copilot SDK with the Explore subagent, Copilot SDK with the TypeAgent Explorer Code Mode MCP tool, and the same TypeAgent MCP arm with LSP enabled. Token and quality columns compare the same successful paired tasks; completion and adoption columns cover every requested task. Token columns use terminal successful executions only, and TypeAgent combines outer Copilot usage with inner Explorer usage exactly once. Positive tokens saved means TypeAgent used fewer tokens.",
        "Each successful TypeAgent treatment normally contains exactly three dependent inner requests in one Explorer execution: discoverRepository, refineRepository, then submitExploration. The final turn selects locations only after observing both repository programs; bounded repair turns are retained and charged. Failed outer executions remain only in results.jsonl; a provider timeout without telemetry is never treated as zero.",
        "",
        ...sections.flatMap((section) => [section, ""]),
    ].join("\n");
}

export function benchmarkVariantLabel(variant: BenchmarkVariant): string {
    switch (variant) {
        case "baseline":
            return "Copilot SDK (with explore agent)";
        case "typeagent":
            return "TypeAgent";
        case "typeagent-lsp":
            return "TypeAgent with LSP";
    }
}

function taskSelectionDescription(manifest: RunManifest): string {
    const selection =
        manifest.taskIdsFile !== undefined
            ? `an exact task-ID cohort from ${JSON.stringify(manifest.taskIdsFile)}`
            : manifest.taskSeed === undefined
              ? `a deterministic repository-balanced window with offset ${manifest.taskOffset ?? 0}`
              : `a deterministic seeded-random sample with seed ${JSON.stringify(manifest.taskSeed)}`;
    return manifest.languageFilter?.length
        ? `${selection}, filtered from ${manifest.sourceTaskCount ?? manifest.taskIds.length} source tasks to patches using ${manifest.languageFilter.join(" or ")}`
        : selection;
}

function taskSelectionLabel(manifest: RunManifest): string {
    const selection =
        manifest.taskIdsFile !== undefined
            ? `exact task IDs file ${JSON.stringify(path.basename(manifest.taskIdsFile))}`
            : manifest.taskSeed === undefined
              ? `deterministic offset ${manifest.taskOffset ?? 0}`
              : `seeded random, seed ${JSON.stringify(manifest.taskSeed)}`;
    return manifest.languageFilter?.length
        ? `${selection}; ${manifest.languageFilter.join("/")} patches`
        : selection;
}

function fixed(value: number, digits = 3): string {
    return value.toFixed(digits);
}

function formatNumber(value: number | undefined): string {
    return value === undefined ? "—" : fixed(value);
}

function formatInteger(value: number | null | undefined): string {
    return value === null || value === undefined
        ? "—"
        : Math.round(value).toLocaleString("en-US");
}

function formatLatency(summary: PairedVariantSummary | null): string {
    return summary
        ? [summary.meanDurationMs, summary.p50DurationMs, summary.p95DurationMs]
              .map((value) => `${(value / 1_000).toFixed(1)}s`)
              .join("/")
        : "—";
}

function formatMetric(metric: MetricSummary | undefined): string {
    return metric
        ? `${fixed(metric.precision)} / ${fixed(metric.recall)} / ${fixed(metric.f1)}`
        : "—";
}

function completed(summary: LeaderboardRow | undefined): number {
    return summary ? summary.rows - summary.failures : 0;
}
