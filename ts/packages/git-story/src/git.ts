// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import type { FileEffect, StagedFile } from "./gitCommitStory.js";

const GIT_BUFFER_BYTES = 10 * 1024 * 1024;

function runGitRaw(
    repository: string,
    args: string[],
    allowFailure = false,
): string {
    try {
        return execFileSync("git", ["-C", repository, ...args], {
            encoding: "utf8",
            maxBuffer: GIT_BUFFER_BYTES,
            stdio: ["ignore", "pipe", allowFailure ? "ignore" : "pipe"],
        });
    } catch (error) {
        if (allowFailure) {
            return (error as { stdout?: string }).stdout ?? "";
        }
        throw error;
    }
}

export function runGit(
    repository: string,
    args: string[],
    allowFailure = false,
): string {
    return runGitRaw(repository, args, allowFailure).trim();
}

export function findRepository(cwd: string): string | undefined {
    return runGit(cwd, ["rev-parse", "--show-toplevel"], true) || undefined;
}

export function resolveGitDirectory(repository: string): string {
    return path.resolve(
        repository,
        runGit(repository, ["rev-parse", "--git-dir"]),
    );
}

export function readStagedFiles(repository: string): StagedFile[] {
    const fields = runGitRaw(repository, [
        "diff",
        "--cached",
        "--name-status",
        "-z",
        "--find-renames",
    ])
        .split("\0")
        .filter(Boolean);
    const files: StagedFile[] = [];
    for (let index = 0; index < fields.length; ) {
        const status = fields[index++];
        if (status.startsWith("R")) {
            const oldPath = fields[index++];
            const filePath = fields[index++];
            if (isStoryPath(filePath)) {
                files.push({
                    path: filePath,
                    oldPath,
                    kind: "rename",
                    blob: indexBlob(repository, filePath),
                });
            }
            continue;
        }
        const filePath = fields[index++];
        if (!isStoryPath(filePath)) continue;
        const kind =
            status[0] === "A"
                ? "create"
                : status[0] === "D"
                  ? "delete"
                  : "edit";
        files.push({
            path: filePath,
            kind,
            blob: kind === "delete" ? null : indexBlob(repository, filePath),
        });
    }
    return files;
}

function indexBlob(repository: string, filePath: string): string | null {
    return (
        runGit(repository, ["rev-parse", "--verify", `:${filePath}`], true) ||
        null
    );
}

export type WorkingSnapshot = Record<string, string | null>;

// Git supplies repository-relative paths, which keeps snapshots inside the repo.
export function snapshotWorkingTree(repository: string): WorkingSnapshot {
    const fields = runGitRaw(repository, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
    ])
        .split("\0")
        .filter(Boolean);
    const snapshot: WorkingSnapshot = {};
    for (let index = 0; index < fields.length; index++) {
        const entry = fields[index];
        const status = entry.slice(0, 2);
        const filePath = entry.slice(3).replaceAll(path.sep, "/");
        if (status.includes("R") || status.includes("C")) index++;
        if (!isStoryPath(filePath)) continue;
        snapshot[filePath] =
            runGit(repository, ["hash-object", "-w", "--", filePath], true) ||
            null;
    }
    return snapshot;
}

export function diffSnapshots(
    before: WorkingSnapshot,
    after: WorkingSnapshot,
    repository: string,
): FileEffect[] {
    const effects: FileEffect[] = [];
    for (const filePath of new Set([
        ...Object.keys(before),
        ...Object.keys(after),
    ])) {
        if (!isStoryPath(filePath) || before[filePath] === after[filePath])
            continue;
        const prior = before[filePath];
        const current = after[filePath];
        if (current === null || current === undefined) {
            effects.push({ kind: "delete", path: filePath });
            continue;
        }
        const tracked = Boolean(
            runGit(
                repository,
                ["ls-files", "--error-unmatch", "--", filePath],
                true,
            ),
        );
        effects.push({
            kind:
                (prior === undefined || prior === null) && !tracked
                    ? "create"
                    : "edit",
            path: filePath,
            blob: current,
        });
    }
    return effects;
}

export function repositoryPath(
    repository: string,
    cwd: string,
    filePath: string,
): string | undefined {
    const repositoryRoot = realpathSync(repository);
    let target = path.resolve(cwd, filePath);
    try {
        target = realpathSync(target);
    } catch {
        try {
            target = path.join(
                realpathSync(path.dirname(target)),
                path.basename(target),
            );
        } catch {
            return undefined;
        }
    }
    const relative = path
        .relative(repositoryRoot, target)
        .replaceAll(path.sep, "/");
    if (!relative || relative === ".." || relative.startsWith("../"))
        return undefined;
    return isStoryPath(relative) ? relative : undefined;
}

export function isStoryPath(filePath: string): boolean {
    if (path.isAbsolute(filePath)) return false;
    const normalized = filePath.replaceAll("\\", "/");
    const parts = normalized.split("/");
    return (
        !parts.includes("") &&
        !parts.includes(".") &&
        !parts.includes("..") &&
        !parts.includes("node_modules") &&
        !parts.includes(".git")
    );
}
