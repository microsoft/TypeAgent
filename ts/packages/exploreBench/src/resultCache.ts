// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { validateResultRows } from "./integrity.js";
import {
    appendResults,
    readJsonFileIfExists,
    readResults,
    readRunManifest,
    resultKey,
    writeJsonAtomic,
} from "./io.js";
import type { BenchTask, RunManifest, RunResult } from "./types.js";

export const CACHE_COMPATIBILITY_REVISION = 5;

export interface ResultCacheSource {
    manifest: RunManifest;
    resultsPath: string;
    rows: RunResult[];
}

export interface CacheSeedSummary {
    importedKeys: number;
    importedRows: number;
    sources: Array<{
        runId: string;
        resultsPath: string;
        keys: number;
        rows: number;
    }>;
    warnings: string[];
    provenancePath: string;
}

interface SelectReusableOptions {
    targetManifest: RunManifest;
    tasks: BenchTask[];
    targetRows: RunResult[];
    sources: ResultCacheSource[];
    importedAt: string;
}

interface SeedResultsOptions {
    runsDir: string;
    targetManifest: RunManifest;
    tasks: BenchTask[];
    output: string;
}

export function cacheManifestsCompatible(
    source: RunManifest,
    target: RunManifest,
): boolean {
    return (
        JSON.stringify(cacheManifestIdentity(source)) ===
        JSON.stringify(cacheManifestIdentity(target))
    );
}

export function selectReusableAttempts(
    options: SelectReusableOptions,
): RunResult[] {
    const tasks = new Map(options.tasks.map((task) => [task.id, task]));
    const models = new Map(
        options.targetManifest.matrix.map((entry) => [
            entry.name ?? entry.model,
            entry.model,
        ]),
    );
    const variants = new Set(options.targetManifest.variants);
    const occupied = new Set(
        options.targetRows.map((row) =>
            resultKey(row.taskId, row.matrixName, row.variant),
        ),
    );
    const reusable: RunResult[] = [];

    for (const source of options.sources) {
        if (
            !cacheManifestsCompatible(source.manifest, options.targetManifest)
        ) {
            continue;
        }
        const grouped = groupResults(source.rows);
        for (const [key, attempts] of grouped) {
            if (occupied.has(key) || attempts.at(-1)?.ok !== true) {
                continue;
            }
            const latest = attempts.at(-1)!;
            const task = tasks.get(latest.taskId);
            if (
                !task ||
                attempts.some(
                    (row) =>
                        models.get(row.matrixName) !== row.model ||
                        !variants.has(row.variant) ||
                        !taskMatchesResult(task, row),
                )
            ) {
                continue;
            }
            occupied.add(key);
            reusable.push(
                ...attempts.map((row) => ({
                    ...row,
                    runId: options.targetManifest.runId,
                    rowIndex: task.swebench.rowIndex,
                    repoPath: task.repoPath,
                    query: task.query,
                    swebench: task.swebench,
                    reusedFrom: {
                        originalRunId:
                            row.reusedFrom?.originalRunId ?? row.runId,
                        sourceRunId: source.manifest.runId,
                        resultsPath: source.resultsPath,
                        importedAt: options.importedAt,
                    },
                })),
            );
        }
    }
    return reusable;
}

export async function seedResultsFromPriorRuns(
    options: SeedResultsOptions,
): Promise<CacheSeedSummary> {
    const warnings: string[] = [];
    const sources = await loadCacheSources(
        options.runsDir,
        options.targetManifest,
        warnings,
    );
    const importedAt = new Date().toISOString();
    const targetRows = await readResults(options.output);
    const reused = selectReusableAttempts({
        targetManifest: options.targetManifest,
        tasks: options.tasks,
        targetRows,
        sources,
        importedAt,
    });
    await appendResults(options.output, reused);

    const counts = new Map<string, { keys: Set<string>; rows: number }>();
    for (const row of reused) {
        const source = row.reusedFrom!;
        const count = counts.get(source.sourceRunId) ?? {
            keys: new Set<string>(),
            rows: 0,
        };
        count.keys.add(resultKey(row.taskId, row.matrixName, row.variant));
        count.rows += 1;
        counts.set(source.sourceRunId, count);
    }
    const sourceByRunId = new Map(
        sources.map((source) => [source.manifest.runId, source.resultsPath]),
    );
    const provenancePath = path.join(
        path.dirname(options.output),
        "cache-provenance.json",
    );
    const existingProvenance =
        await readJsonFileIfExists<unknown>(provenancePath);
    const summary: CacheSeedSummary = {
        importedKeys: new Set(
            reused.map((row) =>
                resultKey(row.taskId, row.matrixName, row.variant),
            ),
        ).size,
        importedRows: reused.length,
        sources: [...counts].map(([runId, count]) => ({
            runId,
            resultsPath: sourceByRunId.get(runId)!,
            keys: count.keys.size,
            rows: count.rows,
        })),
        warnings,
        provenancePath,
    };
    if (reused.length > 0 || !existingProvenance) {
        await writeJsonAtomic(provenancePath, {
            schemaVersion: 1,
            targetRunId: options.targetManifest.runId,
            importedAt,
            ...summary,
        });
    }
    return summary;
}

export async function archiveResultArtifacts(
    output: string,
    now = new Date(),
): Promise<string[]> {
    const suffix = `.before-force-${now.toISOString().replace(/[:.]/g, "-")}`;
    const directory = path.dirname(output);
    const artifacts = [
        output,
        path.join(directory, "report.json"),
        path.join(directory, "report.md"),
        path.join(directory, "cache-provenance.json"),
    ];
    const archived: string[] = [];
    for (const artifact of artifacts) {
        if (!(await readJsonFileIfExistsOrFileExists(artifact))) {
            continue;
        }
        const destination = `${artifact}${suffix}`;
        await rename(artifact, destination);
        archived.push(destination);
    }
    return archived;
}

async function loadCacheSources(
    runsDir: string,
    target: RunManifest,
    warnings: string[],
): Promise<ResultCacheSource[]> {
    let entries;
    try {
        entries = await readdir(runsDir, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
        }
        throw error;
    }
    const sources: ResultCacheSource[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const manifestPath = path.join(runsDir, entry.name, "manifest.json");
        try {
            const manifest = await readRunManifest(manifestPath);
            if (
                !isCacheableManifest(manifest) ||
                manifest.runId === target.runId ||
                path.resolve(manifest.output) === path.resolve(target.output) ||
                !cacheManifestsCompatible(manifest, target)
            ) {
                continue;
            }
            const rows = await readResults(manifest.output);
            validateResultRows(rows, {
                runId: manifest.runId,
                taskIds: manifest.taskIds,
                matrix: manifest.matrix,
                variants: manifest.variants,
                agent: manifest.agent,
            });
            sources.push({
                manifest,
                resultsPath: path.resolve(manifest.output),
                rows,
            });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                continue;
            }
            warnings.push(`${manifestPath}: ${(error as Error).message}`);
        }
    }
    return sources.sort((left, right) =>
        right.manifest.createdAt.localeCompare(left.manifest.createdAt),
    );
}

function isCacheableManifest(manifest: RunManifest): manifest is RunManifest {
    return Boolean(
        manifest.agent &&
            manifest.provider &&
            manifest.mcp &&
            Array.isArray(manifest.taskIds) &&
            Array.isArray(manifest.matrix) &&
            Array.isArray(manifest.variants),
    );
}

function cacheManifestIdentity(manifest: RunManifest): unknown {
    return {
        schemaVersion: manifest.schemaVersion,
        cacheCompatibilityRevision:
            manifest.cacheCompatibilityRevision ?? CACHE_COMPATIBILITY_REVISION,
        dataset: manifest.dataset,
        split: manifest.split,
        copilotPath: manifest.copilotPath,
        provider: {
            type: manifest.provider.type,
            baseUrl: manifest.provider.baseUrl,
            apiKeyEnv: manifest.provider.apiKeyEnv,
            wireApi: manifest.provider.wireApi,
        },
        mcp: {
            command: normalizedCommand(manifest.mcp.command),
            args: manifest.mcp.args,
            cwd: manifest.mcp.cwd,
            envVars: manifest.mcp.envVars,
        },
        agent: {
            name: manifest.agent.name,
            description: manifest.agent.description,
            tools: manifest.agent.tools,
            prompt: manifest.agent.prompt,
            sha256: manifest.agent.sha256,
        },
        maxAttempts: manifest.maxAttempts,
        timeoutMs: manifest.timeoutMs,
        dockerPlatform: manifest.dockerPlatform,
    };
}

function normalizedCommand(command: string): string {
    const executable = path.basename(command).toLowerCase();
    return executable === "node" || executable === "node.exe"
        ? "node"
        : command;
}

function groupResults(rows: RunResult[]): Map<string, RunResult[]> {
    const grouped = new Map<string, RunResult[]>();
    for (const row of rows) {
        const key = resultKey(row.taskId, row.matrixName, row.variant);
        const attempts = grouped.get(key) ?? [];
        attempts.push(row);
        grouped.set(key, attempts);
    }
    return grouped;
}

function taskMatchesResult(task: BenchTask, row: RunResult): boolean {
    return (
        row.taskId === task.id &&
        row.query === task.query &&
        row.rowIndex === task.swebench.rowIndex &&
        row.swebench.dataset === task.swebench.dataset &&
        row.swebench.split === task.swebench.split &&
        row.swebench.rowIndex === task.swebench.rowIndex &&
        row.swebench.instanceId === task.swebench.instanceId &&
        row.swebench.repo === task.swebench.repo &&
        row.swebench.baseCommit === task.swebench.baseCommit &&
        row.swebench.patch === task.swebench.patch &&
        row.swebench.dockerImage === task.swebench.dockerImage
    );
}

async function readJsonFileIfExistsOrFileExists(
    file: string,
): Promise<boolean> {
    try {
        await stat(file);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
