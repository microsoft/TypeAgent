// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { validateResultRows } from "./integrity.js";
import { readResults, readRunManifest, writeJsonAtomic } from "./io.js";
import { translatedRequestMatchesIngress } from "./requestIdentity.js";
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
    avgToolCalls: number;
    avgTypeAgentToolCalls: number;
    directExplorerAdoptionCount: number;
    directExplorerAdoptionRate: number;
    subagentAdoptionCount: number;
    subagentAdoptionRate: number;
    mainAgentRepositoryInspectionCount: number;
    mainAgentRepositoryInspectionRate: number;
    outsideExploreInspectionCount: number;
    outsideExploreInspectionRate: number;
    copilotUsage?: TokenUsage;
    dispatcherUsage?: TypeAgentUsage;
    typeAgentUsage?: TypeAgentUsage;
    combinedUsage?: TokenUsage;
    finalAttemptUsage?: TokenUsage;
}

interface PairedVariantSummary {
    overallRecall: number;
    file: MetricSummary;
    line: MetricSummary;
    finalAttemptTokens: number | null;
}

interface ComparisonRow {
    matrixName: string;
    model: string;
    expectedPairs: number;
    pairedPairs: number;
    coverage: number;
    complete: boolean;
    missingBaselineTaskIds: string[];
    missingTreatmentTaskIds: string[];
    baseline: PairedVariantSummary | null;
    typeagent: PairedVariantSummary | null;
    overallRecallDelta: number | null;
    fileScoreDelta: number | null;
    fileRecallDelta: number | null;
    lineScoreDelta: number | null;
    lineRecallDelta: number | null;
    avgDurationMsDelta: number | null;
    totalTokensDelta: number | null;
    finalAttemptTokensDelta: number | null;
    directExplorerAdoptionCount: number;
    directExplorerAdoptionRate: number;
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
    finalAnswer: string;
    score: SwebenchScore;
    directExplorerAdopted: boolean;
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
    dispatcherUsage?: TypeAgentUsage;
    typeAgentUsage?: TypeAgentUsage;
    combinedUsage?: TokenUsage;
    finalAttemptUsage?: TokenUsage;
    typeAgentToolTrace?: TypeAgentToolTrace;
    exploreTelemetry?: RunResult["exploreTelemetry"];
    typeAgentDispatch?: RunResult["typeAgentDispatch"];
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
        const expectedPairs = taskIds.length * manifest.matrix.length;
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
            "Token deltas compare Copilot SDK usage against TypeAgent combined usage (dispatcher translation plus inner Explorer reasoning and Code Mode generation exactly once), accumulated across every raw attempt for each final row.",
            `Final-attempt tokens cover the ${manifest.taskIds.length} requested tasks exactly when all rows complete. All-attempt tokens include retries and are shown only when every attempt emitted measurable usage; an unknown provider timeout is never treated as zero.`,
            "Copilot SDK success requires one synchronous explorer-subagent delegation and no direct main-agent inspection; TypeAgent success requires untouched natural-language ingress, dispatcher translation, and one executed Explorer action whose output becomes the final answer.",
            "The Copilot SDK arm exposes the task tool to its main agent and bounded immutable-snapshot read/grep/glob/ls tools only to its explorer subagent. The TypeAgent arm runs its dispatcher and Explorer application agent in-process without a Copilot session or transport wrapper.",
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
        const finalAttemptUsage =
            current.combinedUsage ??
            (current.variant === "baseline" &&
            current.usage?.usageComplete !== false
                ? current.usage
                : undefined);
        const {
            usage: _usage,
            dispatcherUsage: _dispatcherUsage,
            typeAgentUsage: _typeAgentUsage,
            combinedUsage: _combinedUsage,
            ...latest
        } = current;
        const copilotUsages = completeValues(
            attempts.map((row) =>
                row.usage?.usageComplete !== false ? row.usage : undefined,
            ),
        );
        const typeAgentUsages = completeValues(
            attempts.map((row) => {
                if (row.variant === "baseline") {
                    return undefined;
                }
                return row.typeAgentUsage?.usageComplete !== false
                    ? row.typeAgentUsage
                    : undefined;
            }),
        );
        const dispatcherUsages = isTypeAgentVariant(current.variant)
            ? completeValues(
                  attempts.map((row) =>
                      row.dispatcherUsage?.usageComplete !== false
                          ? row.dispatcherUsage
                          : undefined,
                  ),
              )
            : undefined;
        const combinedUsages = completeValues(
            attempts.map((row) => {
                if (row.variant === "baseline") {
                    return row.usage?.usageComplete !== false
                        ? row.usage
                        : undefined;
                }
                if (row.combinedUsage) {
                    return row.combinedUsage;
                }
                return undefined;
            }),
        );
        return {
            ...latest,
            score: scoreSwebench(
                current.finalAnswer,
                current.swebench.patch,
                current.repoPath,
            ),
            ...(copilotUsages ? { usage: sumCopilotUsage(copilotUsages) } : {}),
            ...(dispatcherUsages
                ? { dispatcherUsage: sumTypeAgentUsage(dispatcherUsages) }
                : {}),
            ...(typeAgentUsages && isTypeAgentVariant(current.variant)
                ? { typeAgentUsage: sumTypeAgentUsage(typeAgentUsages) }
                : {}),
            ...(combinedUsages
                ? { combinedUsage: sumUsage(combinedUsages) }
                : {}),
            ...(finalAttemptUsage ? { finalAttemptUsage } : {}),
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
    return matrix.map((entry) => {
        const matrixName = entry.name ?? entry.model;
        const modelRows = rows.filter((row) => row.matrixName === matrixName);
        const requestedTaskIds = new Set(taskIds);
        const requestedBaselineRows = modelRows.filter(
            (row) =>
                row.variant === "baseline" && requestedTaskIds.has(row.taskId),
        );
        const requestedTreatmentRows = modelRows.filter(
            (row) =>
                row.variant === "typeagent" && requestedTaskIds.has(row.taskId),
        );
        const baseline = new Map(
            modelRows
                .filter((row) => row.variant === "baseline" && row.ok)
                .map((row) => [row.taskId, row]),
        );
        const treatment = new Map(
            modelRows
                .filter((row) => row.variant === "typeagent" && row.ok)
                .map((row) => [row.taskId, row]),
        );
        const pairedTaskIds = taskIds.filter(
            (taskId) => baseline.has(taskId) && treatment.has(taskId),
        );
        const baselineRows = pairedTaskIds.map(
            (taskId) => baseline.get(taskId)!,
        );
        const treatmentRows = pairedTaskIds.map(
            (taskId) => treatment.get(taskId)!,
        );
        const baselineSummary = summarizeRows(baselineRows);
        const treatmentSummary = summarizeRows(treatmentRows);
        const expectedPairs = taskIds.length;
        const pairedPairs = pairedTaskIds.length;
        const directExplorerAdoptionCount = requestedTreatmentRows.filter(
            hasValidDirectExplorerDispatch,
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
            typeagent: pairedVariantSummary(treatmentSummary),
            overallRecallDelta:
                baselineSummary && treatmentSummary
                    ? treatmentSummary.overallRecall -
                      baselineSummary.overallRecall
                    : null,
            fileScoreDelta:
                baselineSummary && treatmentSummary
                    ? treatmentSummary.file.score - baselineSummary.file.score
                    : null,
            fileRecallDelta:
                baselineSummary && treatmentSummary
                    ? treatmentSummary.file.recall - baselineSummary.file.recall
                    : null,
            lineScoreDelta:
                baselineSummary && treatmentSummary
                    ? treatmentSummary.line.score - baselineSummary.line.score
                    : null,
            lineRecallDelta:
                baselineSummary && treatmentSummary
                    ? treatmentSummary.line.recall - baselineSummary.line.recall
                    : null,
            avgDurationMsDelta:
                baselineSummary && treatmentSummary
                    ? treatmentSummary.avgDurationMs -
                      baselineSummary.avgDurationMs
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
            directExplorerAdoptionCount,
            directExplorerAdoptionRate:
                expectedPairs > 0
                    ? directExplorerAdoptionCount / expectedPairs
                    : 0,
            subagentAdoptionCount,
            subagentAdoptionRate:
                expectedPairs > 0 ? subagentAdoptionCount / expectedPairs : 0,
        };
    });
}

export function summarizeRows(group: RunResult[]): LeaderboardRow | undefined {
    if (group.length === 0) {
        return undefined;
    }
    const first = group[0];
    const directExplorerAdoptionCount = group.filter(
        hasValidDirectExplorerDispatch,
    ).length;
    const subagentAdoptionCount = group.filter(
        (row) => row.subagentAdopted,
    ).length;
    const mainAgentRepositoryInspectionCount = group.filter(
        (row) => row.mainAgentRepositoryInspection === true,
    ).length;
    const outsideExploreInspectionCount = group.filter(
        (row) => row.outsideExploreInspection === true,
    ).length;
    const copilotUsages =
        first.variant === "baseline"
            ? completeValues(
                  group.map((row) =>
                      row.usage?.usageComplete !== false
                          ? row.usage
                          : undefined,
                  ),
              )
            : undefined;
    const dispatcherUsages = isTypeAgentVariant(first.variant)
        ? completeValues(
              group.map((row) =>
                  row.dispatcherUsage?.usageComplete !== false
                      ? row.dispatcherUsage
                      : undefined,
              ),
          )
        : undefined;
    const typeAgentUsages = isTypeAgentVariant(first.variant)
        ? completeValues(
              group.map((row) =>
                  row.typeAgentUsage?.usageComplete !== false
                      ? row.typeAgentUsage
                      : undefined,
              ),
          )
        : undefined;
    const combinedUsages = completeValues(
        group.map(
            (row) =>
                row.combinedUsage ??
                (row.variant === "baseline" &&
                row.usage?.usageComplete !== false
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
        avgDurationMs: average(group.map((row) => row.durationMs)),
        avgToolCalls: average(group.map((row) => row.toolTrace.length)),
        avgTypeAgentToolCalls: average(
            group.map((row) => row.typeAgentToolTrace?.totalCalls ?? 0),
        ),
        directExplorerAdoptionCount,
        directExplorerAdoptionRate: directExplorerAdoptionCount / group.length,
        subagentAdoptionCount,
        subagentAdoptionRate: subagentAdoptionCount / group.length,
        mainAgentRepositoryInspectionCount,
        mainAgentRepositoryInspectionRate:
            mainAgentRepositoryInspectionCount / group.length,
        outsideExploreInspectionCount,
        outsideExploreInspectionRate:
            outsideExploreInspectionCount / group.length,
        ...(copilotUsages ? { copilotUsage: sumUsage(copilotUsages) } : {}),
        ...(dispatcherUsages
            ? { dispatcherUsage: sumTypeAgentUsage(dispatcherUsages) }
            : {}),
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
                        durationMs: row.durationMs,
                        finalAnswer: row.finalAnswer,
                        score: row.score,
                        directExplorerAdopted:
                            hasValidDirectExplorerDispatch(row),
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
                        ...(row.variant === "baseline" && row.usage
                            ? { usage: row.usage }
                            : {}),
                        ...(row.dispatcherUsage
                            ? { dispatcherUsage: row.dispatcherUsage }
                            : {}),
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
                        ...(row.typeAgentDispatch
                            ? { typeAgentDispatch: row.typeAgentDispatch }
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

function sumCopilotUsage(usages: CopilotUsage[]): CopilotUsage {
    return {
        ...sumUsage(usages),
        source: usages.every((usage) => usage.source === "assistant.usage")
            ? "assistant.usage"
            : "rpc",
        requestCount: usages.reduce(
            (total, usage) => total + usage.requestCount,
            0,
        ),
        usageComplete: usages.every((usage) => usage.usageComplete !== false),
        models: [...new Set(usages.flatMap((usage) => usage.models))],
    };
}

function sumTypeAgentUsage(usages: TypeAgentUsage[]): TypeAgentUsage {
    return {
        ...sumUsage(usages),
        requestCount: usages.reduce(
            (total, usage) => total + usage.requestCount,
            0,
        ),
        usageComplete: usages.every((usage) => usage.usageComplete !== false),
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

function hasValidDirectExplorerDispatch(row: RunResult): boolean {
    if (!isTypeAgentVariant(row.variant)) {
        return false;
    }
    const evidence = row.typeAgentDispatch;
    if (
        !evidence ||
        evidence.ingress !== "natural-language" ||
        evidence.submittedRequest !== row.query ||
        evidence.submittedRequest.trimStart().startsWith("@") ||
        evidence.dispatchMethod !== "grammar" ||
        evidence.translationInvoked ||
        evidence.translationRequestCount !== 0 ||
        evidence.activeAgentNames.length !== 1 ||
        evidence.activeAgentNames[0] !== "explorer" ||
        evidence.activeSchemaNames.length !== 1 ||
        evidence.activeSchemaNames[0] !== "explorer" ||
        evidence.translatedActions.length !== 1 ||
        evidence.executionCount !== 1 ||
        !evidence.outputMatchedExecution ||
        !evidence.executionRequestMatchedIngress ||
        evidence.usedCopilot ||
        evidence.usedMcp
    ) {
        return false;
    }
    const action = evidence.translatedActions[0];
    return (
        action.schemaName === "explorer" &&
        action.actionName === "exploreRepository" &&
        translatedRequestMatchesIngress(action.parameters?.request, row.query)
    );
}

function renderMarkdown(report: EvalReport): string {
    const sections = Object.values(report.prefixes).map((prefix) => {
        const comparisons = prefix.comparisons.map((row) => {
            const baselineSummary = row.baseline;
            const typeAgentSummary = row.typeagent;
            const baseline = prefix.leaderboard.find(
                (entry) =>
                    entry.matrixName === row.matrixName &&
                    entry.variant === "baseline",
            );
            const treatment = prefix.leaderboard.find(
                (entry) =>
                    entry.matrixName === row.matrixName &&
                    entry.variant === "typeagent",
            );
            return `| ${row.matrixName} | ${row.pairedPairs}/${row.expectedPairs} | ${completed(baseline)}/${row.expectedPairs} | ${completed(treatment)}/${row.expectedPairs} | ${formatInteger(baselineSummary?.finalAttemptTokens)} | ${formatInteger(typeAgentSummary?.finalAttemptTokens)} | ${formatInteger(row.finalAttemptTokensDelta === null ? null : -row.finalAttemptTokensDelta)} | ${formatNumber(baselineSummary?.overallRecall)} | ${formatNumber(typeAgentSummary?.overallRecall)} | ${formatMetric(baselineSummary?.file)} | ${formatMetric(typeAgentSummary?.file)} | ${formatMetric(baselineSummary?.line)} | ${formatMetric(typeAgentSummary?.line)} | ${row.subagentAdoptionCount}/${row.expectedPairs} | ${row.directExplorerAdoptionCount}/${row.expectedPairs} |`;
        });
        return [
            `## Selected ${prefix.limit}-task prefix (${taskSelectionLabel(report.manifest)})`,
            "",
            `Paired coverage: ${prefix.pairedPairs}/${prefix.expectedPairs} (${prefix.complete ? "complete" : "INCOMPLETE"}).`,
            "",
            "| Model | Paired | Copilot SDK completed | TypeAgent completed | Copilot SDK final tokens | TypeAgent final tokens (dispatcher + Explorer) | Final tokens saved | Copilot SDK recall | TypeAgent recall | Copilot SDK file P/R/F1 | TypeAgent file P/R/F1 | Copilot SDK line P/R/F1 | TypeAgent line P/R/F1 | Explore agent used | Direct Explorer dispatch used |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
            ...comparisons,
        ].join("\n");
    });
    return [
        `# Explore benchmark: ${report.runId}`,
        "",
        "SWE-bench localization only; this is not patch-generation pass@1.",
        "",
        "Arms: Copilot SDK (with explore agent) and direct TypeAgent dispatcher. Token and quality columns compare the same successful paired tasks; completion and adoption columns cover every requested task. Token columns are absolute successful-final-attempt totals, and TypeAgent combines dispatcher translation with inner Explorer usage exactly once. Positive tokens saved means TypeAgent used fewer tokens.",
        "All-attempt component totals remain in report.json when complete; a provider timeout without telemetry leaves them unknown instead of treating missing usage as zero.",
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

function formatMetric(metric: MetricSummary | undefined): string {
    return metric
        ? `${fixed(metric.precision)} / ${fixed(metric.recall)} / ${fixed(metric.f1)}`
        : "—";
}

function completed(summary: LeaderboardRow | undefined): number {
    return summary ? summary.rows - summary.failures : 0;
}
