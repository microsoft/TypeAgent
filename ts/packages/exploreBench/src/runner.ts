// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
    COPILOT_SDK_VERSION,
    createCopilotClient,
    runCopilot,
    stopCopilotClient,
} from "./copilot.js";
import { ensureDockerRepo } from "./docker.js";
import { validateResultRows } from "./integrity.js";
import {
    appendResult,
    readResults,
    resultKey,
    safeRunId,
    writeJsonAtomic,
} from "./io.js";
import { scoreSwebench } from "./score.js";
import type {
    BenchTask,
    BenchmarkAgentConfig,
    BenchmarkVariant,
    MatrixEntry,
    McpServerConfig,
    RunResult,
} from "./types.js";

export interface BenchmarkOptions {
    runId: string;
    output: string;
    copilotPath: string;
    runtimeEvidence: string;
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
}

export interface ResumeRow {
    taskId: string;
    matrixName: string;
    variant: BenchmarkVariant;
    ok: boolean;
}

const defaultVariants: BenchmarkVariant[] = ["baseline", "typeagent"];

export async function runBenchmark(
    tasks: BenchTask[],
    matrix: MatrixEntry[],
    options: BenchmarkOptions,
): Promise<void> {
    const variants = options.variants;
    if (variants.length === 0 || new Set(variants).size !== variants.length) {
        throw new Error("Benchmark variants must be non-empty and unique");
    }
    const previousRows = await readResults(options.output);
    validateResultRows(previousRows, {
        runId: options.runId,
        taskIds: tasks.map((task) => task.id),
        matrix,
        variants,
        agent: options.agent,
    });
    const pending = selectPendingWork(
        tasks,
        matrix,
        previousRows,
        variants,
        options.forceRerun,
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
    for (const task of tasks) {
        for (const entry of matrix) {
            const matrixName = entry.name ?? entry.model;
            for (const variant of variants) {
                if (!pendingKeys.has(resultKey(task.id, matrixName, variant))) {
                    process.stderr.write(
                        `skip\t${task.id}\t${matrixName}\t${variant}\tcompleted\n`,
                    );
                }
            }
        }
    }

    const repoPreparation = new Map<string, Promise<void>>();
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
        sdkVersion: COPILOT_SDK_VERSION,
        copilotPath: options.copilotPath,
        ...runtimeStatus,
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
                    let attempt = 1;
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
                    await mkdir(path.dirname(telemetryFile), {
                        recursive: true,
                    });
                    process.stderr.write(
                        `start\t${work.task.id}\t${matrixName}\t${work.variant}\tattempt=${attempt}/${options.maxAttempts}\n`,
                    );
                    const output = await runCopilot(client, {
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
                        timeoutMs: options.timeoutMs,
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
                        attempt,
                        maxAttempts: options.maxAttempts,
                        ...(output.usedRepair ? { usedRepair: true } : {}),
                        finalAnswer: output.finalAnswer,
                        score,
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
                    await writeResult(result);
                    process.stderr.write(
                        `${result.ok ? "ok" : "fail"}\t${work.task.id}\t${matrixName}\t${work.variant}\t${result.durationMs}ms\tmcp=${result.attemptedExploreCalls ?? 0}/${result.successfulExploreCalls ?? 0}\tsubagent=${result.attemptedExplorerDelegations ?? 0}/${output.successfulExplorerDelegations}\tmainInspect=${result.mainAgentRepositoryInspection === true}\n`,
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
): WorkItem[] {
    const latest = new Map<string, ResumeRow>();
    for (const row of previousRows) {
        latest.set(resultKey(row.taskId, row.matrixName, row.variant), row);
    }
    const pending: WorkItem[] = [];
    for (const task of tasks) {
        for (const entry of matrix) {
            const matrixName = entry.name ?? entry.model;
            for (const variant of variants) {
                if (
                    forceRerun ||
                    !latest.get(resultKey(task.id, matrixName, variant))?.ok
                ) {
                    pending.push({ task, entry, variant });
                }
            }
        }
    }
    return pending;
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
