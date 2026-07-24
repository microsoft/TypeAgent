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
import { validateResultRows, type RunIdentity } from "./integrity.js";
import {
    appendResult,
    readResults,
    resultKey,
    safeRunId,
    writeJsonAtomic,
} from "./io.js";
import { scoreSwebench } from "./score.js";
import { runTypeAgentDispatcher } from "./typeAgent.js";
import type {
    BenchTask,
    BenchmarkAgentConfig,
    BenchmarkVariant,
    MatrixEntry,
    McpServerConfig,
    RunResult,
} from "./types.js";
import { isTypeAgentVariant } from "./types.js";

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
    const identity: RunIdentity = {
        runId: options.runId,
        taskIds: tasks.map((task) => task.id),
        matrix,
        variants,
        agent: options.agent,
    };
    const previousRows = await readResults(options.output);
    validateResultRows(previousRows, identity);
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

    const needsCopilot = pending.some((work) => work.variant === "baseline");
    const client = needsCopilot
        ? createCopilotClient({
              copilotPath: options.copilotPath,
              baseDirectory: path.join(
                  path.dirname(options.output),
                  ".copilot",
              ),
              workingDirectory: path.dirname(options.output),
          })
        : undefined;
    if (client) {
        await client.start();
    }
    const runtimeStatus = client ? await client.getStatus() : undefined;
    await writeJsonAtomic(options.runtimeEvidence, {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        harnesses: [
            ...(client
                ? [
                      {
                          name: "copilot-sdk",
                          sdkVersion: COPILOT_SDK_VERSION,
                          copilotPath: options.copilotPath,
                          ...runtimeStatus,
                      },
                  ]
                : []),
            ...(pending.some((work) => isTypeAgentVariant(work.variant))
                ? [
                      {
                          name: "typeagent-dispatcher",
                          outerTranslation: "natural-language",
                          applicationAgents: ["explorer"],
                          mcp: false,
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
                    const output = isTypeAgentVariant(work.variant)
                        ? await runTypeAgentDispatcher({
                              repoPath: path.resolve(work.task.repoPath),
                              prompt: work.task.query,
                              model: work.entry.model,
                              variant: work.variant,
                              providerBaseUrl: options.providerBaseUrl,
                              apiKeyEnv: options.apiKeyEnv,
                              ...(options.envFile
                                  ? { envFile: options.envFile }
                                  : {}),
                              telemetryFile,
                          })
                        : await runCopilot(client!, {
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
                            ? `${isTypeAgentVariant(work.variant) ? "TypeAgent Explorer" : "Copilot CLI"} completed without a parseable <final_answer> citation`
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
                        finalAnswer: output.finalAnswer,
                        score,
                        ...("usedRepair" in output && output.usedRepair
                            ? { usedRepair: true }
                            : {}),
                        ...("usage" in output && output.usage
                            ? { usage: output.usage }
                            : {}),
                        ...(output.typeAgentUsage
                            ? { typeAgentUsage: output.typeAgentUsage }
                            : {}),
                        ...("dispatcherUsage" in output &&
                        output.dispatcherUsage
                            ? { dispatcherUsage: output.dispatcherUsage }
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
                        attemptedExploreCalls:
                            "attemptedExploreCalls" in output
                                ? output.attemptedExploreCalls
                                : 0,
                        completedExploreCalls:
                            "completedExploreCalls" in output
                                ? output.completedExploreCalls
                                : 0,
                        successfulExploreCalls:
                            "successfulExploreCalls" in output
                                ? output.successfulExploreCalls
                                : 0,
                        outsideExploreInspection:
                            "outsideExploreInspection" in output
                                ? output.outsideExploreInspection
                                : false,
                        mcpServerReady:
                            "mcpServerReady" in output
                                ? output.mcpServerReady
                                : false,
                        mcpAdvertisedTools:
                            "mcpAdvertisedTools" in output
                                ? output.mcpAdvertisedTools
                                : [],
                        ...("telemetryError" in output && output.telemetryError
                            ? { telemetryError: output.telemetryError }
                            : {}),
                        mcpAdopted:
                            "mcpAdopted" in output ? output.mcpAdopted : false,
                        lspAdopted: output.lspAdopted,
                        lspCallCount: output.lspCallCount,
                        lspResultCount: output.lspResultCount,
                        subagentAdopted:
                            "subagentAdopted" in output
                                ? output.subagentAdopted
                                : false,
                        defaultMainAgent:
                            "defaultMainAgent" in output
                                ? output.defaultMainAgent
                                : false,
                        attemptedExplorerDelegations:
                            "attemptedExplorerDelegations" in output
                                ? output.attemptedExplorerDelegations
                                : 0,
                        completedExplorerDelegations:
                            "completedExplorerDelegations" in output
                                ? output.completedExplorerDelegations
                                : 0,
                        successfulExplorerDelegations:
                            "successfulExplorerDelegations" in output
                                ? output.successfulExplorerDelegations
                                : 0,
                        failedExplorerDelegations:
                            "failedExplorerDelegations" in output
                                ? output.failedExplorerDelegations
                                : 0,
                        explorerRepositoryCalls:
                            "explorerRepositoryCalls" in output
                                ? output.explorerRepositoryCalls
                                : 0,
                        firstAssistantActionExclusiveExplorer:
                            "firstAssistantActionExclusiveExplorer" in output
                                ? output.firstAssistantActionExclusiveExplorer
                                : false,
                        explorerCompletedBeforeLaterAssistantAction:
                            "explorerCompletedBeforeLaterAssistantAction" in
                            output
                                ? output.explorerCompletedBeforeLaterAssistantAction
                                : false,
                        mainAgentRepositoryInspection:
                            "mainAgentRepositoryInspection" in output
                                ? output.mainAgentRepositoryInspection
                                : false,
                        explorerSubagentTrace:
                            "explorerSubagentTrace" in output
                                ? output.explorerSubagentTrace
                                : [],
                        mcpToolTrace:
                            "mcpToolTrace" in output ? output.mcpToolTrace : [],
                        toolTrace:
                            "toolTrace" in output ? output.toolTrace : [],
                        events: "events" in output ? output.events : [],
                        ...("selectedAgentName" in output &&
                        output.selectedAgentName
                            ? {
                                  selectedAgentName: output.selectedAgentName,
                              }
                            : {}),
                        ...("dispatchEvidence" in output &&
                        output.dispatchEvidence
                            ? { typeAgentDispatch: output.dispatchEvidence }
                            : {}),
                        ...(error ? { error } : {}),
                    };
                    failClosedResultIntegrity(result, identity);
                    await writeResult(result);
                    process.stderr.write(
                        `${result.ok ? "ok" : "fail"}\t${work.task.id}\t${matrixName}\t${work.variant}\t${result.durationMs}ms\tdirect=${result.typeAgentDispatch?.executionCount ?? 0}\tsubagent=${result.attemptedExplorerDelegations ?? 0}/${result.successfulExplorerDelegations ?? 0}\tmainInspect=${result.mainAgentRepositoryInspection === true}\n`,
                    );
                    if (result.ok) {
                        break;
                    }
                }
            },
        );
        await writeQueue;
    } finally {
        if (client) {
            try {
                await stopCopilotClient(client);
            } catch (error) {
                process.stderr.write(
                    `warning: Copilot CLI shutdown required force stop: ${(error as Error).message}\n`,
                );
            }
        }
    }
}

export function failClosedResultIntegrity(
    result: RunResult,
    identity: RunIdentity,
): void {
    try {
        validateResultRows([result], identity);
    } catch (error) {
        if (!result.ok) {
            throw error;
        }
        result.ok = false;
        result.error = `Integrity validation failed: ${error instanceof Error ? error.message : String(error)}`;
        validateResultRows([result], identity);
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
