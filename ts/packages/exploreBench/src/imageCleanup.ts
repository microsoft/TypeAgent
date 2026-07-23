// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { getDockerRepoProvenancePath } from "./docker.js";
import { resultKey } from "./io.js";
import { swebenchDockerImage } from "./dataset.js";
import {
    normalizeBenchmarkVariant,
    type BenchmarkVariant,
    type MatrixEntry,
} from "./types.js";

export interface ImageCleanupManifest {
    runId: string;
    taskIds: readonly string[];
    matrix: readonly MatrixEntry[];
    variants: readonly BenchmarkVariant[];
    maxAttempts: number;
}

export interface CleanupResultRow {
    runId: string;
    taskId: string;
    matrixName: string;
    variant: BenchmarkVariant;
    ok: boolean;
    attempt: number;
    maxAttempts: number;
    repoPath: string;
    swebench: { dockerImage: string };
}

export interface ProcessedImageCandidate {
    taskId: string;
    image: string;
    repoPath: string;
}

export interface ImageCleanupCommands {
    runDocker(args: string[]): Promise<string>;
}

export interface ImageCleanupResult {
    removed: ProcessedImageCandidate[];
    missing: ProcessedImageCandidate[];
    inUse: ProcessedImageCandidate[];
    wouldRemove: ProcessedImageCandidate[];
    skippedProvenance: ProcessedImageCandidate[];
    errors: Array<{ candidate: ProcessedImageCandidate; error: string }>;
}

export function collectProcessedTaskImages(
    manifest: ImageCleanupManifest,
    rows: readonly CleanupResultRow[],
): ProcessedImageCandidate[] {
    const taskIds = new Set(manifest.taskIds);
    const matrixNames = new Set(
        manifest.matrix.map((entry) => entry.name ?? entry.model),
    );
    const variants = new Set<string>(manifest.variants);
    const latest = new Map<string, CleanupResultRow>();

    for (const row of rows) {
        if (row.runId !== manifest.runId) {
            throw new Error(
                `result run mismatch: expected ${manifest.runId}, observed ${row.runId}`,
            );
        }
        if (!taskIds.has(row.taskId)) {
            throw new Error(`unexpected result task: ${row.taskId}`);
        }
        if (!matrixNames.has(row.matrixName)) {
            throw new Error(`unexpected result matrix: ${row.matrixName}`);
        }
        if (!variants.has(row.variant)) {
            throw new Error(`unexpected result variant: ${row.variant}`);
        }
        const expectedImage = swebenchDockerImage(row.taskId);
        if (
            !isScopedSwebenchImage(expectedImage) ||
            row.swebench?.dockerImage !== expectedImage
        ) {
            throw new Error(
                `result image mismatch for ${row.taskId}: expected ${expectedImage}, observed ${row.swebench?.dockerImage}`,
            );
        }
        latest.set(resultKey(row.taskId, row.matrixName, row.variant), row);
    }

    const candidates: ProcessedImageCandidate[] = [];
    for (const taskId of manifest.taskIds) {
        const taskRows: CleanupResultRow[] = [];
        let terminal = true;
        for (const entry of manifest.matrix) {
            const matrixName = entry.name ?? entry.model;
            for (const variant of manifest.variants) {
                const row = latest.get(resultKey(taskId, matrixName, variant));
                if (!row || !isTerminal(row, manifest.maxAttempts)) {
                    terminal = false;
                    break;
                }
                taskRows.push(row);
            }
            if (!terminal) {
                break;
            }
        }
        if (!terminal) {
            continue;
        }
        const repoPaths = new Set(taskRows.map((row) => row.repoPath));
        if (repoPaths.size !== 1 || !taskRows[0]?.repoPath) {
            throw new Error(`result repository mismatch for ${taskId}`);
        }
        candidates.push({
            taskId,
            image: swebenchDockerImage(taskId),
            repoPath: taskRows[0].repoPath,
        });
    }
    return candidates;
}

export async function cleanupProcessedImages(
    candidates: readonly ProcessedImageCandidate[],
    options: {
        dryRun?: boolean;
        runDocker?: ImageCleanupCommands["runDocker"];
    } = {},
): Promise<ImageCleanupResult> {
    for (const candidate of candidates) {
        if (
            !isScopedSwebenchImage(candidate.image) ||
            candidate.image !== swebenchDockerImage(candidate.taskId)
        ) {
            throw new Error(
                `unsafe cleanup image for ${candidate.taskId}: ${candidate.image}`,
            );
        }
    }
    const runDocker = options.runDocker ?? defaultCommands.runDocker;
    const result: ImageCleanupResult = {
        removed: [],
        missing: [],
        inUse: [],
        wouldRemove: [],
        skippedProvenance: [],
        errors: [],
    };
    for (const candidate of candidates) {
        if (!(await hasMatchingProvenance(candidate))) {
            result.skippedProvenance.push(candidate);
            continue;
        }
        try {
            await runDocker(["image", "inspect", candidate.image]);
        } catch (error) {
            if (isMissingImageError(error)) {
                result.missing.push(candidate);
            } else {
                result.errors.push({
                    candidate,
                    error: (error as Error).message,
                });
            }
            continue;
        }
        try {
            const containers = await runDocker([
                "container",
                "ls",
                "-aq",
                "--filter",
                `ancestor=${candidate.image}`,
            ]);
            if (containers.trim()) {
                result.inUse.push(candidate);
                continue;
            }
            if (options.dryRun) {
                result.wouldRemove.push(candidate);
                continue;
            }
            await runDocker(["image", "rm", candidate.image]);
            result.removed.push(candidate);
        } catch (error) {
            result.errors.push({
                candidate,
                error: (error as Error).message,
            });
        }
    }
    return result;
}

export async function readCleanupResultSnapshot(
    input: string,
): Promise<CleanupResultRow[]> {
    const text = await readFile(input, "utf8");
    const lines = text.split(/\r?\n/);
    const rows: CleanupResultRow[] = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line) {
            continue;
        }
        try {
            const parsed: unknown = JSON.parse(line);
            if (
                typeof parsed !== "object" ||
                parsed === null ||
                Array.isArray(parsed)
            ) {
                throw new Error("Result row must be an object");
            }
            rows.push({
                ...parsed,
                variant: normalizeBenchmarkVariant(
                    (parsed as Record<string, unknown>).variant,
                ),
            } as CleanupResultRow);
        } catch (error) {
            const partialTrailingLine =
                index === lines.length - 1 && !text.endsWith("\n");
            if (partialTrailingLine) {
                break;
            }
            throw new Error(
                `Invalid JSONL at ${input}:${index + 1}: ${(error as Error).message}`,
            );
        }
    }
    return rows;
}

function isTerminal(row: CleanupResultRow, maxAttempts: number): boolean {
    return (
        row.ok === true ||
        (row.ok === false &&
            row.maxAttempts === maxAttempts &&
            row.attempt >= maxAttempts)
    );
}

function isScopedSwebenchImage(image: string): boolean {
    return /^docker[.]io\/swebench\/sweb[.]eval[.]x86_64[.][a-z0-9_.-]+:latest$/.test(
        image,
    );
}

async function hasMatchingProvenance(
    candidate: ProcessedImageCandidate,
): Promise<boolean> {
    try {
        const value: unknown = JSON.parse(
            await readFile(
                getDockerRepoProvenancePath(candidate.repoPath),
                "utf8",
            ),
        );
        return (
            typeof value === "object" &&
            value !== null &&
            (value as Record<string, unknown>).dockerImage === candidate.image
        );
    } catch {
        return false;
    }
}

function isMissingImageError(error: unknown): boolean {
    return /no such (?:image|object)/i.test((error as Error).message);
}

const defaultCommands: ImageCleanupCommands = {
    runDocker: (args) => runCommand("docker", args),
};

function runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => child.kill("SIGKILL"), 5 * 60_000);
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(
                    new Error(
                        `${command} ${args.join(" ")} failed (${code})\n${stdout}${stderr}`,
                    ),
                );
            }
        });
    });
}
