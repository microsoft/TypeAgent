// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
    COPILOT_SDK_VERSION,
    createCopilotClient,
    runCopilot,
    stopCopilotClient,
} from "./copilot.js";
import { ensureDockerRepo } from "./docker.js";
import { validateResultRows, type RunIdentity } from "./integrity.js";
import {
    appendResult,
    readResults,
    resultKey,
    safeRunId,
    writeJsonAtomic,
} from "./io.js";
import { scoreSwebench } from "./score.js";
import {
    createTrajectoryFiles,
    validateRunTrajectoryFiles,
} from "./trajectory.js";
import { resolveRunRuntimeFingerprint } from "./runtimeFingerprint.js";
import type {
    BenchTask,
    BenchmarkAgentConfig,
    BenchmarkVariant,
    MatrixEntry,
    McpServerConfig,
    RunResult,
    RunRuntimeFingerprint,
} from "./types.js";
import { isTypeAgentVariant } from "./types.js";

export interface BenchmarkOptions {
    runId: string;
    output: string;
    copilotPath: string;
    runtimeEvidence: string;
    runtimeFingerprint: RunRuntimeFingerprint;
    providerBaseUrl: string;
    apiKeyEnv: string;
    agent: BenchmarkAgentConfig;
    envFile?: string;
    mcp: McpServerConfig;
    timeoutMs: number;
    maxConcurrency: number;
    maxAttempts: number;
    dockerPlatform: string;
    variants: BenchmarkVariant[];
    forceRerun?: boolean;
}

export interface WorkItem {
    task: BenchTask;
    entry: MatrixEntry;
    variant: BenchmarkVariant;
    startAttempt: number;
}

export interface ResumeRow {
    taskId: string;
    matrixName: string;
    variant: BenchmarkVariant;
    ok: boolean;
    attempt: number;
    maxAttempts: number;
}

const defaultVariants: BenchmarkVariant[] = ["baseline", "typeagent"];

export function executionHarnessForVariant(
    variant: BenchmarkVariant,
): "copilot-subagent" | "copilot-mcp" {
    return variant === "baseline" ? "copilot-subagent" : "copilot-mcp";
}

export async function runBenchmark(
    tasks: BenchTask[],
    matrix: MatrixEntry[],
    options: BenchmarkOptions,
): Promise<void> {
    const variants = options.variants;
    if (variants.length === 0 || new Set(variants).size !== variants.length) {
        throw new Error("Benchmark variants must be non-empty and unique");
    }
    const identity: RunIdentity = {
        runId: options.runId,
        taskIds: tasks.map((task) => task.id),
        matrix,
        variants,
        agent: options.agent,
        maxAttempts: options.maxAttempts,
        tasks,
    };
    const previousRows = await readResults(options.output);
    validateResultRows(previousRows, identity);
    await validateRetainedTrajectories(previousRows);
    const pending = selectPendingWork(
        tasks,
        matrix,
        previousRows,
        variants,
        options.forceRerun,
        options.maxAttempts,
    );
    const pendingKeys = new Set(
        pending.map((work) =>
            resultKey(
                work.task.id,
                work.entry.name ?? work.entry.model,
                work.variant,
            ),
        ),
    );
    const progressRows = createProgressRowLabels(tasks);
    for (const task of tasks) {
        for (const entry of matrix) {
            const matrixName = entry.name ?? entry.model;
            for (const variant of variants) {
                if (!pendingKeys.has(resultKey(task.id, matrixName, variant))) {
                    process.stderr.write(
                        `skip\t${progressRows.get(task.id) ?? "row-unknown"}\t${matrixName}\t${variant}\tcompleted\n`,
                    );
                }
            }
        }
    }

    const repoPreparation = new Map<string, Promise<void>>();
    const resultHistories = groupRowsByKey(previousRows);
    let writeQueue = Promise.resolve();
    const writeResult = async (result: RunResult): Promise<void> => {
        writeQueue = writeQueue.then(() =>
            appendResult(options.output, result),
        );
        await writeQueue;
    };

    if (pending.length === 0) {
        return;
    }

    const runtimeFingerprint = await resolveRunRuntimeFingerprint(
        options.copilotPath,
        options.mcp,
    );
    if (!isDeepStrictEqual(runtimeFingerprint, options.runtimeFingerprint)) {
        throw new Error(
            "Benchmark runtime binaries changed after the manifest was frozen",
        );
    }
    const ripgrep = runtimeFingerprint.ripgrep;
    const client = createCopilotClient({
        copilotPath: options.copilotPath,
        baseDirectory: path.join(path.dirname(options.output), ".copilot"),
        workingDirectory: path.dirname(options.output),
    });
    await client.start();
    const runtimeStatus = await client.getStatus();
    await writeJsonAtomic(options.runtimeEvidence, {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        harnesses: [
            {
                name: "copilot-sdk",
                sdkVersion: COPILOT_SDK_VERSION,
                copilotPath: runtimeFingerprint.copilot.path,
                sha256: runtimeFingerprint.copilot.sha256,
                ...runtimeStatus,
            },
            {
                name: "packaged-ripgrep",
                executable: ripgrep.path,
                sha256: ripgrep.sha256,
            },
            ...(pending.some((work) => isTypeAgentVariant(work.variant))
                ? [
                      {
                          name: "typeagent-mcp",
                          command: options.mcp.command,
                          commandSha256: runtimeFingerprint.mcpCommand.sha256,
                          entrypoint: runtimeFingerprint.mcpEntrypoint?.path,
                          entrypointSha256:
                              runtimeFingerprint.mcpEntrypoint?.sha256,
                          args: options.mcp.args,
                          tool: "explore",
                          outerHarness: "copilot-sdk",
                      },
                  ]
                : []),
            ...(pending.some((work) => work.variant === "typeagent-lsp") &&
            runtimeFingerprint.pythonLsp
                ? [
                      {
                          name: "python-lsp",
                          executable: runtimeFingerprint.pythonLsp.path,
                          sha256: runtimeFingerprint.pythonLsp.sha256,
                          interpreter:
                              runtimeFingerprint.pythonLspInterpreter?.path,
                          interpreterSha256:
                              runtimeFingerprint.pythonLspInterpreter?.sha256,
                          lockFile: runtimeFingerprint.pythonLspLock?.path,
                          lockFileSha256:
                              runtimeFingerprint.pythonLspLock?.sha256,
                      },
                      {
                          name: "typescript-lsp",
                          executable:
                              runtimeFingerprint.typescriptLspCommand?.path,
                          sha256: runtimeFingerprint.typescriptLspCommand
                              ?.sha256,
                          entrypoint:
                              runtimeFingerprint.typescriptLspEntrypoint?.path,
                          entrypointSha256:
                              runtimeFingerprint.typescriptLspEntrypoint
                                  ?.sha256,
                      },
                  ]
                : []),
        ],
    });

    try {
        await mapWithConcurrencyPerModel(
            pending,
            options.maxConcurrency,
            async (work) => {
                let preparation = repoPreparation.get(work.task.id);
                if (!preparation) {
                    preparation = ensureDockerRepo(
                        work.task,
                        options.dockerPlatform,
                    );
                    repoPreparation.set(work.task.id, preparation);
                }
                await preparation;

                const matrixName = work.entry.name ?? work.entry.model;
                for (
                    let attempt = work.startAttempt;
                    attempt <= options.maxAttempts;
                    attempt += 1
                ) {
                    const telemetryFile = createTelemetryFilePath(
                        options.output,
                        work.task.id,
                        matrixName,
                        work.variant,
                        attempt,
                    );
                    const trajectoryFiles = createTrajectoryFiles(
                        options.output,
                        work.task.id,
                        work.entry.model,
                        work.variant,
                        attempt,
                    );
                    await mkdir(path.dirname(telemetryFile), {
                        recursive: true,
                    });
                    process.stderr.write(
                        `start\t${progressRows.get(work.task.id) ?? "row-unknown"}\t${matrixName}\t${work.variant}\tattempt=${attempt}/${options.maxAttempts}\n`,
                    );
                    const output = await runCopilot(client, {
                        rowName: work.task.id,
                        attempt,
                        repoPath: path.resolve(work.task.repoPath),
                        prompt: work.task.query,
                        model: work.entry.model,
                        variant: work.variant,
                        providerBaseUrl: options.providerBaseUrl,
                        apiKeyEnv: options.apiKeyEnv,
                        agent: options.agent,
                        ...(options.envFile
                            ? { envFile: options.envFile }
                            : {}),
                        mcp: options.mcp,
                        telemetryFile,
                        trajectoryFiles,
                        timeoutMs: options.timeoutMs,
                        ripgrepPath: ripgrep.path,
                    });
                    const score = scoreSwebench(
                        output.finalAnswer,
                        work.task.swebench.patch,
                        work.task.repoPath,
                    );
                    const usableFinalAnswer = isUsableFinalAnswer(score);
                    const ok = output.ok && usableFinalAnswer;
                    const error =
                        output.error ??
                        (output.ok && !usableFinalAnswer
                            ? "Copilot CLI completed without a parseable <final_answer> citation"
                            : undefined);
                    const result: RunResult = {
                        runId: options.runId,
                        taskId: work.task.id,
                        rowIndex: work.task.swebench.rowIndex,
                        matrixName,
                        model: work.entry.model,
                        variant: work.variant,
                        provider: {
                            type: "openai-compatible",
                            baseUrl: options.providerBaseUrl,
                            apiKeyEnv: options.apiKeyEnv,
                            hasApiKey: !output.error?.startsWith("Missing "),
                            wireApi: "responses",
                        },
                        repoPath: work.task.repoPath,
                        query: work.task.query,
                        swebench: work.task.swebench,
                        ok,
                        durationMs: output.durationMs,
                        latencyTimeline: output.latencyTimeline,
                        attempt,
                        maxAttempts: options.maxAttempts,
                        finalAnswer: output.finalAnswer,
                        score,
                        ...(output.usedRepair ? { usedRepair: true } : {}),
                        outerLoopAbortedAfterExplore:
                            output.outerLoopAbortedAfterExplore,
                        ...(output.usage ? { usage: output.usage } : {}),
                        ...(output.typeAgentUsage
                            ? { typeAgentUsage: output.typeAgentUsage }
                            : {}),
                        ...(output.combinedUsage
                            ? { combinedUsage: output.combinedUsage }
                            : {}),
                        ...(output.exploreTelemetry
                            ? {
                                  exploreTelemetry: output.exploreTelemetry,
                                  typeAgentToolTrace:
                                      output.exploreTelemetry.toolTrace,
                              }
                            : {}),
                        telemetryFile: output.telemetryFile,
                        trajectoryFiles: output.trajectoryFiles,
                        ripgrepPath: ripgrep.path,
                        ripgrepSha256: ripgrep.sha256,
                        attemptedExploreCalls: output.attemptedExploreCalls,
                        completedExploreCalls: output.completedExploreCalls,
                        successfulExploreCalls: output.successfulExploreCalls,
                        outsideExploreInspection:
                            output.outsideExploreInspection,
                        mcpServerReady: output.mcpServerReady,
                        mcpAdvertisedTools: output.mcpAdvertisedTools,
                        ...(output.telemetryError
                            ? { telemetryError: output.telemetryError }
                            : {}),
                        mcpAdopted: output.mcpAdopted,
                        lspAdopted: output.lspAdopted,
                        lspCallCount: output.lspCallCount,
                        lspResultCount: output.lspResultCount,
                        subagentAdopted: output.subagentAdopted,
                        defaultMainAgent: output.defaultMainAgent,
                        attemptedExplorerDelegations:
                            output.attemptedExplorerDelegations,
                        completedExplorerDelegations:
                            output.completedExplorerDelegations,
                        successfulExplorerDelegations:
                            output.successfulExplorerDelegations,
                        failedExplorerDelegations:
                            output.failedExplorerDelegations,
                        explorerRepositoryCalls: output.explorerRepositoryCalls,
                        firstAssistantActionExclusiveExplore:
                            output.firstAssistantActionExclusiveExplore,
                        exploreCompletedBeforeLaterAssistantAction:
                            output.exploreCompletedBeforeLaterAssistantAction,
                        firstAssistantActionExclusiveExplorer:
                            output.firstAssistantActionExclusiveExplorer,
                        explorerCompletedBeforeLaterAssistantAction:
                            output.explorerCompletedBeforeLaterAssistantAction,
                        mainAgentRepositoryInspection:
                            output.mainAgentRepositoryInspection,
                        explorerSubagentTrace: output.explorerSubagentTrace,
                        mcpToolTrace: output.mcpToolTrace,
                        toolTrace: output.toolTrace,
                        events: output.events,
                        ...(output.selectedAgentName
                            ? {
                                  selectedAgentName: output.selectedAgentName,
                              }
                            : {}),
                        ...(error ? { error } : {}),
                    };
                    const key = resultKey(
                        result.taskId,
                        result.matrixName,
                        result.variant,
                    );
                    const history = resultHistories.get(key) ?? [];
                    await validateAttemptTrajectories(result, history);
                    failClosedResultIntegrity(result, identity, history);
                    await writeResult(result);
                    history.push(result);
                    resultHistories.set(key, history);
                    process.stderr.write(
                        `${result.ok ? "ok" : "fail"}\t${progressRows.get(work.task.id) ?? "row-unknown"}\t${matrixName}\t${work.variant}\t${result.durationMs}ms\tmcp=${result.attemptedExploreCalls ?? 0}/${result.successfulExploreCalls ?? 0}\tsubagent=${result.attemptedExplorerDelegations ?? 0}/${result.successfulExplorerDelegations ?? 0}\tmainInspect=${result.mainAgentRepositoryInspection === true}\n`,
                    );
                    if (result.ok) {
                        break;
                    }
                }
            },
        );
        await writeQueue;
    } finally {
        try {
            await stopCopilotClient(client);
        } catch (error) {
            process.stderr.write(
                `warning: Copilot CLI shutdown required force stop: ${(error as Error).message}\n`,
            );
        }
    }
}

export function createProgressRowLabels(
    tasks: readonly Pick<BenchTask, "id">[],
): Map<string, string> {
    return new Map(tasks.map((task, index) => [task.id, `row-${index + 1}`]));
}

export async function validateRetainedTrajectories(
    rows: readonly RunResult[],
): Promise<void> {
    await validateRunTrajectoryFiles(rows);
}

export async function validateAttemptTrajectories(
    result: RunResult,
    history: readonly RunResult[] = [],
): Promise<void> {
    await validateRunTrajectoryFiles([...history, result]);
}

export function failClosedResultIntegrity(
    result: RunResult,
    identity: RunIdentity,
    history: RunResult[] = [],
): void {
    try {
        validateResultRows([...history, result], identity);
    } catch (error) {
        if (!result.ok) {
            throw error;
        }
        result.ok = false;
        result.error = `Integrity validation failed: ${error instanceof Error ? error.message : String(error)}`;
        validateResultRows([...history, result], identity);
    }
}

export async function mapWithConcurrencyPerModel(
    items: WorkItem[],
    limit: number,
    worker: (item: WorkItem) => Promise<void>,
): Promise<void> {
    const groups = new Map<string, WorkItem[]>();
    for (const item of items) {
        const model = item.entry.model;
        const group = groups.get(model) ?? [];
        group.push(item);
        groups.set(model, group);
    }
    await Promise.all(
        [...groups.values()].map((group) =>
            mapWithConcurrency(group, limit, worker),
        ),
    );
}

export function createTelemetryFilePath(
    output: string,
    taskId: string,
    matrixName: string,
    variant: BenchmarkVariant,
    attempt: number,
): string {
    const name = [
        safeRunId(taskId),
        safeRunId(matrixName),
        variant,
        `attempt-${attempt}`,
        randomUUID(),
    ].join("--");
    return path.join(
        path.dirname(path.resolve(output)),
        "telemetry",
        `${name}.json`,
    );
}

export function selectPendingWork(
    tasks: BenchTask[],
    matrix: MatrixEntry[],
    previousRows: ResumeRow[],
    variants: BenchmarkVariant[] = defaultVariants,
    forceRerun = false,
    maxAttempts = 1,
): WorkItem[] {
    const latest = new Map<string, ResumeRow>();
    for (const row of previousRows) {
        latest.set(resultKey(row.taskId, row.matrixName, row.variant), row);
    }
    const pending: WorkItem[] = [];
    for (const [taskIndex, task] of tasks.entries()) {
        const firstVariant = taskIndex % variants.length;
        const orderedVariants = [
            ...variants.slice(firstVariant),
            ...variants.slice(0, firstVariant),
        ];
        for (const entry of matrix) {
            const matrixName = entry.name ?? entry.model;
            for (const variant of orderedVariants) {
                if (
                    forceRerun ||
                    shouldRetry(
                        latest.get(resultKey(task.id, matrixName, variant)),
                        maxAttempts,
                    )
                ) {
                    const latestAttempt = forceRerun
                        ? undefined
                        : latest.get(resultKey(task.id, matrixName, variant));
                    pending.push({
                        task,
                        entry,
                        variant,
                        startAttempt: (latestAttempt?.attempt ?? 0) + 1,
                    });
                }
            }
        }
    }
    return pending;
}

function shouldRetry(
    latest: ResumeRow | undefined,
    maxAttempts: number,
): boolean {
    return (
        !latest ||
        (!latest.ok &&
            latest.maxAttempts === maxAttempts &&
            latest.attempt < maxAttempts)
    );
}

function groupRowsByKey(rows: RunResult[]): Map<string, RunResult[]> {
    const grouped = new Map<string, RunResult[]>();
    for (const row of rows) {
        const key = resultKey(row.taskId, row.matrixName, row.variant);
        const history = grouped.get(key) ?? [];
        history.push(row);
        grouped.set(key, history);
    }
    return grouped;
}

export function assertCompleteRun(
    tasks: BenchTask[],
    matrix: MatrixEntry[],
    variants: BenchmarkVariant[],
    rows: ResumeRow[],
): void {
    const latest = new Map<string, ResumeRow>();
    for (const row of rows) {
        latest.set(resultKey(row.taskId, row.matrixName, row.variant), row);
    }
    let successful = 0;
    let failed = 0;
    let missing = 0;
    for (const task of tasks) {
        for (const entry of matrix) {
            const matrixName = entry.name ?? entry.model;
            for (const variant of variants) {
                const row = latest.get(resultKey(task.id, matrixName, variant));
                if (!row) {
                    missing += 1;
                } else if (row.ok) {
                    successful += 1;
                } else {
                    failed += 1;
                }
            }
        }
    }
    const expected = tasks.length * matrix.length * variants.length;
    if (successful !== expected) {
        throw new Error(
            `Benchmark run incomplete: expected=${expected} successful=${successful} failed=${failed} missing=${missing}`,
        );
    }
}

export function isUsableFinalAnswer(score: RunResult["score"]): boolean {
    return score.validFinalAnswer && score.citations.length > 0;
}

export async function mapWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>,
): Promise<void> {
    let nextIndex = 0;
    async function runWorker(): Promise<void> {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) {
                return;
            }
            await worker(items[index]);
        }
    }
    await Promise.all(
        Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () =>
            runWorker(),
        ),
    );
}
