// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { IngestionMode, MemoryService } from "@typeagent/memory-service";
import { waitForMemoryJob } from "@typeagent/memory-service/rpc";

export interface MarkdownImportOptions {
    batchId?: string;
    corpusId: string;
    path: string;
    expectedKind?: "file" | "folder";
    recursive?: boolean;
    include?: readonly string[];
    exclude?: readonly string[];
    maxFiles?: number;
    maxTotalBytes?: number;
    concurrency?: number;
    wait?: boolean;
    pipeline?: {
        mode: IngestionMode;
        maxCharsPerChunk: number;
    };
    cwd?: string;
    signal?: AbortSignal;
    onJobAccepted?: (jobId: string) => void | Promise<void>;
}

export interface ImportFileResult {
    relativePath: string;
    sourceId?: string;
    jobId?: string;
    state?: string;
    unchanged?: boolean;
    error?: string;
}

export interface ImportBatchManifest {
    batchId: string;
    corpusId: string;
    root: string;
    startedAt: string;
    completedAt: string;
    discovered: number;
    accepted: number;
    failed: number;
    totalBytes: number;
    cancelled: boolean;
    files: ImportFileResult[];
}

interface Candidate {
    absolutePath: string;
    relativePath: string;
    size: number;
}

const DEFAULT_MAX_FILES = 1_000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 4;

class ImportLimitError extends Error {}

export function isPathContained(root: string, candidate: string): boolean {
    const rel = relative(root, candidate);
    return (
        rel === "" ||
        (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
    );
}

export function createStableSourceId(
    realRoot: string,
    relativePath: string,
): string {
    const identity = `${normalizeIdentityPath(realRoot)}\n${relativePath.replaceAll("\\", "/")}`;
    return `file:${createHash("sha256").update(identity).digest("hex")}`;
}

function normalizeIdentityPath(path: string): string {
    const normalized = resolve(path).replaceAll("\\", "/").replace(/\/+$/, "");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function globToRegExp(glob: string): RegExp {
    let expression = "^";
    const normalized = glob.replaceAll("\\", "/");
    for (let index = 0; index < normalized.length; index++) {
        const char = normalized[index];
        if (char === "*") {
            if (normalized[index + 1] === "*") {
                if (normalized[index + 2] === "/") {
                    expression += "(?:.*/)?";
                    index += 2;
                } else {
                    expression += ".*";
                    index++;
                }
            } else {
                expression += "[^/]*";
            }
        } else if (char === "?") {
            expression += "[^/]";
        } else {
            expression += char.replace(/[\\^$.[\]{}()+|]/g, "\\$&");
        }
    }
    return new RegExp(`${expression}$`, "i");
}

function matchesGlobs(path: string, globs: readonly string[]): boolean {
    return globs.some((glob) => globToRegExp(glob).test(path));
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function collectCandidates(
    requestedPath: string,
    options: MarkdownImportOptions,
): Promise<{
    root: string;
    candidates: Candidate[];
    errors: ImportFileResult[];
}> {
    const absolutePath = resolve(options.cwd ?? process.cwd(), requestedPath);
    const requestedInfo = await stat(absolutePath);
    const root = await realpath(
        requestedInfo.isDirectory()
            ? absolutePath
            : resolve(absolutePath, ".."),
    );
    const candidates: Candidate[] = [];
    const errors: ImportFileResult[] = [];
    const include = options.include ?? ["**/*.md", "*.md"];
    const exclude = options.exclude ?? [];
    const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_BYTES;
    positiveInteger(maxFiles, "maxFiles");
    positiveInteger(maxTotalBytes, "maxTotalBytes");
    let discoveredBytes = 0;

    const visit = async (path: string): Promise<void> => {
        const pathInfo = await lstat(path);
        const resolvedPath = await realpath(path);
        const relativePath = relative(root, resolvedPath).replaceAll("\\", "/");
        if (!isPathContained(root, resolvedPath)) {
            errors.push({
                relativePath: relative(root, path).replaceAll("\\", "/"),
                error: `Resolved path escapes import root: ${resolvedPath}`,
            });
            return;
        }
        if (pathInfo.isSymbolicLink()) {
            const targetInfo = await stat(resolvedPath);
            if (targetInfo.isDirectory()) {
                errors.push({
                    relativePath,
                    error: "Symbolic-link and junction directories are not traversed",
                });
                return;
            }
        }
        const resolvedInfo = await stat(resolvedPath);
        if (resolvedInfo.isDirectory()) {
            if (path !== absolutePath && options.recursive !== true) {
                return;
            }
            const entries = await readdir(resolvedPath);
            entries.sort((left, right) => left.localeCompare(right));
            for (const entry of entries) {
                const childPath = resolve(resolvedPath, entry);
                try {
                    await visit(childPath);
                } catch (error: unknown) {
                    if (error instanceof ImportLimitError) {
                        throw error;
                    }
                    errors.push({
                        relativePath: relative(root, childPath).replaceAll(
                            "\\",
                            "/",
                        ),
                        error: getErrorMessage(error),
                    });
                }
            }
            return;
        }
        if (
            resolvedInfo.isFile() &&
            matchesGlobs(relativePath, include) &&
            !matchesGlobs(relativePath, exclude)
        ) {
            candidates.push({
                absolutePath: resolvedPath,
                relativePath,
                size: resolvedInfo.size,
            });
            discoveredBytes += resolvedInfo.size;
            if (candidates.length > maxFiles) {
                throw new ImportLimitError(
                    `Import contains more than the ${maxFiles} file limit`,
                );
            }
            if (discoveredBytes > maxTotalBytes) {
                throw new ImportLimitError(
                    `Import exceeds the ${maxTotalBytes} byte limit`,
                );
            }
        }
    };

    if (
        options.expectedKind !== undefined &&
        requestedInfo.isDirectory() !== (options.expectedKind === "folder")
    ) {
        throw new Error(
            `Expected a ${options.expectedKind}, but '${absolutePath}' is not one`,
        );
    }
    await visit(absolutePath);
    return { root, candidates, errors };
}

function positiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

function validateLimits(
    candidates: Candidate[],
    maxFiles: number,
    maxTotalBytes: number,
): number {
    positiveInteger(maxFiles, "maxFiles");
    positiveInteger(maxTotalBytes, "maxTotalBytes");
    if (candidates.length > maxFiles) {
        throw new Error(
            `Import contains ${candidates.length} files; limit is ${maxFiles}`,
        );
    }
    const totalBytes = candidates.reduce(
        (sum, candidate) => sum + candidate.size,
        0,
    );
    if (totalBytes > maxTotalBytes) {
        throw new Error(
            `Import contains ${totalBytes} bytes; limit is ${maxTotalBytes}`,
        );
    }
    return totalBytes;
}

async function importCandidate(
    service: MemoryService,
    root: string,
    candidate: Candidate,
    options: MarkdownImportOptions,
): Promise<ImportFileResult> {
    const sourceId = createStableSourceId(root, candidate.relativePath);
    try {
        const markdown = await readFile(candidate.absolutePath, "utf8");
        const result = await service.ingestDocument(
            {
                corpusId: options.corpusId,
                source: {
                    sourceId,
                    sourceType: "markdown",
                    title: candidate.relativePath,
                    canonicalUri: pathToFileURL(candidate.absolutePath).href,
                    markdown,
                    metadata: {
                        importRoot: root,
                        relativePath: candidate.relativePath,
                    },
                },
                pipeline: {
                    updatePolicy: "skipIfUnchanged",
                    ...options.pipeline,
                },
            },
            options.signal,
        );
        await options.onJobAccepted?.(result.jobId);
        let state: string = result.state;
        if (result.state === "failed" || result.state === "cancelled") {
            return {
                relativePath: candidate.relativePath,
                sourceId,
                jobId: result.jobId,
                state,
                error: `Job was returned in state '${result.state}'`,
            };
        }
        let unchanged = false;
        if (options.wait === true) {
            const job = await waitForMemoryJob(service, result.jobId, {
                ...(options.signal === undefined
                    ? {}
                    : { signal: options.signal }),
            });
            state = job.state;
            unchanged = job.progress.message === "Source is unchanged";
            if (job.state === "failed" || job.state === "cancelled") {
                return {
                    relativePath: candidate.relativePath,
                    sourceId,
                    jobId: result.jobId,
                    state,
                    error: job.error ?? `Job ended in state '${job.state}'`,
                };
            }
        }
        return {
            relativePath: candidate.relativePath,
            sourceId,
            jobId: result.jobId,
            state,
            ...(unchanged ? { unchanged: true } : {}),
        };
    } catch (error: unknown) {
        return {
            relativePath: candidate.relativePath,
            sourceId,
            error: getErrorMessage(error),
        };
    }
}

export async function importMarkdownPath(
    service: MemoryService,
    options: MarkdownImportOptions,
): Promise<ImportBatchManifest> {
    const startedAt = new Date().toISOString();
    const { root, candidates, errors } = await collectCandidates(
        options.path,
        options,
    );
    const totalBytes = validateLimits(
        candidates,
        options.maxFiles ?? DEFAULT_MAX_FILES,
        options.maxTotalBytes ?? DEFAULT_MAX_BYTES,
    );
    const results: ImportFileResult[] = [...errors];
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
        while (
            nextIndex < candidates.length &&
            options.signal?.aborted !== true
        ) {
            const candidate = candidates[nextIndex++];
            results.push(
                await importCandidate(service, root, candidate, options),
            );
        }
    };
    const concurrency = positiveInteger(
        options.concurrency ?? DEFAULT_CONCURRENCY,
        "concurrency",
    );
    const workerCount = Math.max(1, Math.min(concurrency, candidates.length));
    await Promise.all(Array.from({ length: workerCount }, worker));
    if (options.signal?.aborted === true) {
        for (const candidate of candidates.slice(nextIndex)) {
            results.push({
                relativePath: candidate.relativePath,
                sourceId: createStableSourceId(root, candidate.relativePath),
                error: "Import cancelled before this file was processed",
            });
        }
    }
    results.sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
    );
    return {
        batchId: options.batchId ?? randomUUID(),
        corpusId: options.corpusId,
        root,
        startedAt,
        completedAt: new Date().toISOString(),
        discovered: results.length,
        accepted: results.filter((result) => result.error === undefined).length,
        failed: results.filter((result) => result.error !== undefined).length,
        totalBytes,
        cancelled: options.signal?.aborted === true,
        files: results,
    };
}
