// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ensureDockerRepo } from "./docker.js";
import { validateResultRows, type RunIdentity } from "./integrity.js";
import {
    appendResult,
    readRunManifest,
    readResults,
    resultKey,
    safeRunId,
    writeJsonAtomic,
} from "./io.js";
import {
    CACHE_COMPATIBILITY_REVISION,
    taskMatchesResult,
} from "./resultCache.js";
import { scoreSwebench } from "./score.js";
import { resolvePackagedRipgrepPath } from "./ripgrep.js";
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

export interface RuntimeEvidenceExpectation {
    ripgrepPath: string;
    ripgrepSha256: string;
    variants: readonly BenchmarkVariant[];
    copilotPath: string;
    allowCachedOnly?: boolean;
}

interface CachedRuntimeSources {
    harnesses: Record<string, unknown>[];
    sources: Array<{
        runId: string;
        resultsPath: string;
        manifestPath: string;
        runtimeEvidence: string;
        variants: BenchmarkVariant[];
        manifestSha256: string;
        evidenceSha256: string;
    }>;
}

const defaultVariants: BenchmarkVariant[] = ["baseline", "typeagent"];

export async function runBenchmark(
    tasks: BenchTask[],
    matrix: MatrixEntry[],
    options: BenchmarkOptions,
): Promise<void> {
    const variants = options.variants;
    if (tasks.length === 0) {
        throw new Error("Benchmark tasks must be non-empty");
    }
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
    validateResumeTaskRows(tasks, previousRows);
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

    const ripgrepPath = await resolvePackagedRipgrepPath();
    const ripgrepSha256 = createHash("sha256")
        .update(await readFile(ripgrepPath))
        .digest("hex");
    const cachedRuntimeSources = previousRows.some((row) => row.reusedFrom)
        ? await validateCachedRuntimeSources(
              previousRows,
              ripgrepPath,
              ripgrepSha256,
          )
        : undefined;
    const existingRuntimeEvidence = options.forceRerun
        ? undefined
        : await readRuntimeEvidenceIfExists(options.runtimeEvidence);
    if (existingRuntimeEvidence) {
        validateRuntimeEvidence(existingRuntimeEvidence, {
            ripgrepPath,
            ripgrepSha256,
            variants: variantsForRows(previousRows),
            copilotPath: options.copilotPath,
        });
        validateCachedRuntimeMetadata(
            existingRuntimeEvidence,
            cachedRuntimeSources,
        );
        if (
            existingRuntimeEvidence.cachedOnly === true &&
            previousRows.some((row) => !row.reusedFrom)
        ) {
            throw new Error(
                "Runtime evidence marked cached-only contains local result rows",
            );
        }
    } else if (previousRows.some((row) => !row.reusedFrom)) {
        throw new Error(
            "Completed local rows are missing their runtime evidence artifact",
        );
    }
    if (pending.length === 0) {
        if (!existingRuntimeEvidence) {
            if (!cachedRuntimeSources) {
                throw new Error(
                    "Completed local rows are missing their runtime evidence artifact",
                );
            }
            const evidence = {
                schemaVersion: 1,
                capturedAt: new Date().toISOString(),
                cachedOnly: true,
                repositorySearch: repositorySearchEvidence(
                    ripgrepPath,
                    ripgrepSha256,
                ),
                harnesses: cachedRuntimeSources.harnesses,
                cachedSources: cachedRuntimeSources.sources,
            };
            validateRuntimeEvidence(evidence, {
                ripgrepPath,
                ripgrepSha256,
                variants: variantsForRows(previousRows),
                copilotPath: options.copilotPath,
            });
            await writeJsonAtomic(options.runtimeEvidence, evidence);
        }
        return;
    }

    const needsCopilot = pending.some((work) => work.variant === "baseline");
    const copilot = needsCopilot ? await import("./copilot.js") : undefined;
    const client = copilot
        ? copilot.createCopilotClient({
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
    const harnesses = [
        ...(client
            ? [
                  {
                      name: "copilot-sdk",
                      sdkVersion: copilot!.COPILOT_SDK_VERSION,
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
    ];
    const evidence = {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        repositorySearch: repositorySearchEvidence(ripgrepPath, ripgrepSha256),
        harnesses: mergeHarnessEvidence(
            existingRuntimeEvidence ??
                (cachedRuntimeSources
                    ? { harnesses: cachedRuntimeSources.harnesses }
                    : undefined),
            harnesses,
        ),
        ...(cachedRuntimeSources
            ? { cachedSources: cachedRuntimeSources.sources }
            : {}),
    };
    validateRuntimeEvidence(evidence, {
        ripgrepPath,
        ripgrepSha256,
        variants: [
            ...new Set([
                ...variantsForRows(previousRows),
                ...pending.map((work) => work.variant),
            ]),
        ],
        copilotPath: options.copilotPath,
    });
    await writeJsonAtomic(options.runtimeEvidence, evidence);

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
                              ripgrepPath,
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
                        : await copilot!.runCopilot(client!, {
                              repoPath: path.resolve(work.task.repoPath),
                              ripgrepPath,
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
                await copilot!.stopCopilotClient(client);
            } catch (error) {
                process.stderr.write(
                    `warning: Copilot CLI shutdown required force stop: ${(error as Error).message}\n`,
                );
            }
        }
    }
}

function repositorySearchEvidence(
    ripgrepPath: string,
    sha256: string,
): Record<string, unknown> {
    return {
        engine: "ripgrep",
        source: "copilot-packaged",
        executable: path.basename(ripgrepPath),
        sha256,
        sharedAcrossArms: true,
        snapshot: "filtered-immutable-directory",
    };
}

async function readRuntimeEvidenceIfExists(
    evidencePath: string,
): Promise<Record<string, unknown> | undefined> {
    try {
        const parsed: unknown = JSON.parse(
            await readFile(evidencePath, "utf8"),
        );
        if (!isRecord(parsed)) {
            throw new Error("runtime evidence must be a JSON object");
        }
        return parsed;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}

export function validateRuntimeEvidence(
    evidence: Record<string, unknown>,
    expected: RuntimeEvidenceExpectation,
): void {
    const repositorySearch = evidence.repositorySearch;
    if (
        evidence.schemaVersion !== 1 ||
        typeof evidence.capturedAt !== "string" ||
        !isRecord(repositorySearch) ||
        repositorySearch.engine !== "ripgrep" ||
        repositorySearch.source !== "copilot-packaged" ||
        repositorySearch.executable !== path.basename(expected.ripgrepPath) ||
        repositorySearch.sha256 !== expected.ripgrepSha256 ||
        repositorySearch.sharedAcrossArms !== true ||
        repositorySearch.snapshot !== "filtered-immutable-directory"
    ) {
        throw new Error(
            "Runtime evidence does not match the current shared ripgrep snapshot runtime",
        );
    }

    if (
        evidence.cachedOnly !== undefined &&
        typeof evidence.cachedOnly !== "boolean"
    ) {
        throw new Error("Runtime evidence has an invalid cachedOnly marker");
    }
    if (evidence.cachedOnly === true && expected.allowCachedOnly === false) {
        throw new Error(
            "Runtime evidence for a direct cache source cannot itself be cached-only",
        );
    }

    if (
        !Array.isArray(evidence.harnesses) ||
        !evidence.harnesses.every(isRecord)
    ) {
        throw new Error("Runtime evidence must contain well-formed harnesses");
    }
    const harnesses = new Map<string, Record<string, unknown>>();
    for (const harness of evidence.harnesses) {
        if (typeof harness.name !== "string" || harnesses.has(harness.name)) {
            throw new Error(
                "Runtime evidence harness names must be present and unique",
            );
        }
        if (harness.name === "copilot-sdk") {
            if (
                typeof harness.sdkVersion !== "string" ||
                harness.sdkVersion.length === 0 ||
                harness.copilotPath !== expected.copilotPath ||
                typeof harness.version !== "string" ||
                harness.version.length === 0 ||
                !Number.isInteger(harness.protocolVersion)
            ) {
                throw new Error(
                    "Runtime evidence has invalid Copilot SDK executable identity",
                );
            }
        } else if (harness.name === "typeagent-dispatcher") {
            if (
                harness.outerTranslation !== "natural-language" ||
                !isDeepStrictEqual(harness.applicationAgents, ["explorer"]) ||
                harness.mcp !== false
            ) {
                throw new Error(
                    "Runtime evidence has invalid TypeAgent dispatcher identity",
                );
            }
        } else {
            throw new Error(
                `Runtime evidence contains unknown harness ${JSON.stringify(harness.name)}`,
            );
        }
        harnesses.set(harness.name, harness);
    }
    const requiredHarnesses = new Set(
        expected.variants.map((variant) =>
            variant === "baseline" ? "copilot-sdk" : "typeagent-dispatcher",
        ),
    );
    for (const name of requiredHarnesses) {
        if (!harnesses.has(name)) {
            throw new Error(
                `Runtime evidence is missing required ${name} harness identity`,
            );
        }
    }
}

export function validateResumeTaskRows(
    tasks: BenchTask[],
    rows: RunResult[],
): void {
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    for (const row of rows) {
        const task = tasksById.get(row.taskId);
        if (
            !task ||
            row.repoPath !== task.repoPath ||
            !taskMatchesResult(task, row)
        ) {
            throw new Error(
                `Existing result row for ${JSON.stringify(row.taskId)} does not match the current task payload`,
            );
        }
    }
}

function variantsForRows(rows: RunResult[]): BenchmarkVariant[] {
    return [...new Set(rows.map((row) => row.variant))];
}

async function validateCachedRuntimeSources(
    rows: RunResult[],
    ripgrepPath: string,
    ripgrepSha256: string,
): Promise<CachedRuntimeSources> {
    const groups = new Map<
        string,
        {
            runId: string;
            resultsPath: string;
            manifestPath: string;
            runtimeEvidence: string;
            variants: Set<BenchmarkVariant>;
            taskIds: Set<string>;
            models: Map<string, string>;
        }
    >();
    for (const row of rows) {
        const source = row.reusedFrom;
        if (!source) {
            continue;
        }
        if (
            source.originalRunId !== source.sourceRunId ||
            typeof source.manifestPath !== "string" ||
            typeof source.runtimeEvidence !== "string"
        ) {
            throw new Error(
                "Cached source runtime evidence must identify one direct, non-cached source",
            );
        }
        const existing = groups.get(source.sourceRunId);
        if (
            existing &&
            (existing.resultsPath !== source.resultsPath ||
                existing.manifestPath !== source.manifestPath ||
                existing.runtimeEvidence !== source.runtimeEvidence)
        ) {
            throw new Error(
                `Cached source runtime evidence has conflicting provenance for ${JSON.stringify(source.sourceRunId)}`,
            );
        }
        const group = existing ?? {
            runId: source.sourceRunId,
            resultsPath: source.resultsPath,
            manifestPath: source.manifestPath,
            runtimeEvidence: source.runtimeEvidence,
            variants: new Set<BenchmarkVariant>(),
            taskIds: new Set<string>(),
            models: new Map<string, string>(),
        };
        const priorModel = group.models.get(row.matrixName);
        if (priorModel && priorModel !== row.model) {
            throw new Error(
                `Cached source runtime evidence has conflicting model identity for ${JSON.stringify(row.matrixName)}`,
            );
        }
        group.variants.add(row.variant);
        group.taskIds.add(row.taskId);
        group.models.set(row.matrixName, row.model);
        groups.set(source.sourceRunId, group);
    }

    const harnesses = new Map<string, Record<string, unknown>>();
    const sources: CachedRuntimeSources["sources"] = [];
    for (const group of groups.values()) {
        let manifestText: string;
        let evidenceText: string;
        let manifest;
        let evidence: Record<string, unknown>;
        try {
            [manifestText, evidenceText, manifest] = await Promise.all([
                readFile(group.manifestPath, "utf8"),
                readFile(group.runtimeEvidence, "utf8"),
                readRunManifest(group.manifestPath),
            ]);
            const parsed: unknown = JSON.parse(evidenceText);
            if (!isRecord(parsed)) {
                throw new Error("artifact must be a JSON object");
            }
            evidence = parsed;
        } catch (error) {
            throw new Error(
                `Cached source runtime evidence could not be read: ${error instanceof Error ? error.message : String(error)}`,
            );
        }

        const variants = [...group.variants].sort();
        const manifestModels = new Map(
            manifest.matrix.map((entry) => [
                entry.name ?? entry.model,
                entry.model,
            ]),
        );
        if (
            manifest.runId !== group.runId ||
            path.resolve(manifest.output) !== path.resolve(group.resultsPath) ||
            path.resolve(manifest.runtimeEvidence) !==
                path.resolve(group.runtimeEvidence) ||
            manifest.cacheCompatibilityRevision !==
                CACHE_COMPATIBILITY_REVISION ||
            [...group.taskIds].some(
                (taskId) => !manifest.taskIds.includes(taskId),
            ) ||
            variants.some((variant) => !manifest.variants.includes(variant)) ||
            [...group.models].some(
                ([matrixName, model]) =>
                    manifestModels.get(matrixName) !== model,
            )
        ) {
            throw new Error(
                `Cached source runtime evidence manifest does not match ${JSON.stringify(group.runId)}`,
            );
        }
        validateRuntimeEvidence(evidence, {
            ripgrepPath,
            ripgrepSha256,
            variants,
            copilotPath: manifest.copilotPath,
            allowCachedOnly: false,
        });
        for (const harness of evidence.harnesses as Record<string, unknown>[]) {
            const name = harness.name as string;
            const prior = harnesses.get(name);
            if (prior && !isDeepStrictEqual(prior, harness)) {
                throw new Error(
                    `Cached source runtime evidence disagrees on ${JSON.stringify(name)} harness identity`,
                );
            }
            harnesses.set(name, harness);
        }
        sources.push({
            runId: group.runId,
            resultsPath: group.resultsPath,
            manifestPath: group.manifestPath,
            runtimeEvidence: group.runtimeEvidence,
            variants,
            manifestSha256: createHash("sha256")
                .update(manifestText)
                .digest("hex"),
            evidenceSha256: createHash("sha256")
                .update(evidenceText)
                .digest("hex"),
        });
    }
    sources.sort((left, right) => left.runId.localeCompare(right.runId));
    return { harnesses: [...harnesses.values()], sources };
}

function validateCachedRuntimeMetadata(
    evidence: Record<string, unknown>,
    cached: CachedRuntimeSources | undefined,
): void {
    if (cached) {
        if (!isDeepStrictEqual(evidence.cachedSources, cached.sources)) {
            throw new Error(
                "Runtime evidence cached-source metadata does not match verified source artifacts",
            );
        }
    } else if (evidence.cachedSources !== undefined) {
        throw new Error(
            "Runtime evidence contains cached-source metadata without reused rows",
        );
    }
}

export function mergeHarnessEvidence(
    existing: Record<string, unknown> | undefined,
    current: Record<string, unknown>[],
): Record<string, unknown>[] {
    const merged = new Map<string, Record<string, unknown>>();
    const prior = Array.isArray(existing?.harnesses)
        ? existing.harnesses.filter(isRecord)
        : [];
    for (const harness of [...prior, ...current]) {
        if (typeof harness.name === "string") {
            const previous = merged.get(harness.name);
            if (previous && !isDeepStrictEqual(previous, harness)) {
                throw new Error(
                    `Runtime harness identity changed for ${JSON.stringify(harness.name)}`,
                );
            }
            merged.set(harness.name, harness);
        }
    }
    return [...merged.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
