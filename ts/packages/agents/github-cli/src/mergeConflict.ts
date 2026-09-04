// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitCommandResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
    failureCode?: string | undefined;
    timedOut?: boolean | undefined;
};

export type GitCommandRunner = (
    args: readonly string[],
    cwd?: string,
    timeoutMs?: number,
) => Promise<GitCommandResult>;

export type MergeConflictKind =
    | "bothModified"
    | "bothAdded"
    | "bothDeleted"
    | "addedByUs"
    | "addedByThem"
    | "deletedByUs"
    | "deletedByThem"
    | "unmerged";

export type MergeConflictDetail = {
    path: string;
    status: string;
    kind: MergeConflictKind;
    binary: boolean;
    submodule: boolean;
};

export type MergeTarget = {
    remote: string;
    branch: string;
    displayName: string;
    fetchedCommit: string;
};

export type MergePreparationSuccess = {
    status: "conflicts" | "ready" | "upToDate";
    repositoryRoot: string;
    currentBranch: string;
    target: MergeTarget;
    mergeInProgress: boolean;
    conflicts: MergeConflictDetail[];
    recovery: string[];
};

export type MergePreparationFailure = {
    status: "blocked";
    errorCode:
        | "notRepository"
        | "gitUnavailable"
        | "detachedHead"
        | "branchChanged"
        | "operationInProgress"
        | "dirtyWorktree"
        | "missingRemote"
        | "ambiguousRemote"
        | "remoteUnavailable"
        | "invalidTargetBranch"
        | "missingTargetBranch"
        | "fetchFailed"
        | "mergeFailed";
    message: string;
    repositoryRoot?: string;
    currentBranch?: string;
    changedPaths?: string[];
    operation?: string;
    remotes?: string[];
    recovery: string[];
    mayHaveSideEffects: boolean;
};

export type MergePreparationResult =
    | MergePreparationSuccess
    | MergePreparationFailure;

export type MergeVerificationSuccess = {
    status: "resolved" | "unresolved" | "markersRemain" | "unstagedChanges";
    repositoryRoot: string;
    currentBranch: string;
    mergeInProgress: true;
    inspectedPaths: string[];
    remainingConflicts: MergeConflictDetail[];
    markerPaths: string[];
    unstagedPaths: string[];
    recovery: string[];
};

export type MergeVerificationFailure = {
    status: "blocked";
    errorCode:
        | "notRepository"
        | "gitUnavailable"
        | "detachedHead"
        | "noMergeInProgress"
        | "verificationFailed";
    message: string;
    repositoryRoot?: string;
    currentBranch?: string;
    recovery: string[];
    mayHaveSideEffects: false;
};

export type MergeVerificationResult =
    | MergeVerificationSuccess
    | MergeVerificationFailure;

export type PrepareMergeOptions = {
    cwd?: string;
    runGit?: GitCommandRunner;
    pathExists?: (filePath: string) => boolean;
    isBinaryFile?: (filePath: string) => boolean;
};

type ResolvedTarget = {
    remote: string;
    branch: string;
    displayName: string;
};

const UNMERGED_STATUSES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const MUTATING_GIT_TIMEOUT_MS = 10 * 60_000;

const CONFLICT_KIND_BY_STATUS: Record<string, MergeConflictKind> = {
    DD: "bothDeleted",
    AU: "addedByUs",
    UD: "deletedByThem",
    UA: "addedByThem",
    DU: "deletedByUs",
    AA: "bothAdded",
    UU: "bothModified",
};

export async function runGitCommand(
    args: readonly string[],
    cwd = process.cwd(),
    timeoutMs = 60_000,
): Promise<GitCommandResult> {
    try {
        const { stdout, stderr } = await execFileAsync("git", [...args], {
            cwd,
            encoding: "utf8",
            maxBuffer: 4 * 1024 * 1024,
            timeout: timeoutMs,
            windowsHide: true,
        });
        return {
            exitCode: 0,
            stdout,
            stderr,
        };
    } catch (error) {
        const failure = error as Error & {
            code?: number | string;
            stdout?: string;
            stderr?: string;
        };
        return {
            exitCode:
                typeof failure.code === "number" ? failure.code : Number.NaN,
            stdout: String(failure.stdout ?? ""),
            stderr: String(failure.stderr ?? failure.message),
            failureCode:
                typeof failure.code === "string" ? failure.code : undefined,
            timedOut: Boolean((failure as Error & { killed?: boolean }).killed),
        };
    }
}

function blocked(
    errorCode: MergePreparationFailure["errorCode"],
    message: string,
    details: Partial<MergePreparationFailure> = {},
): MergePreparationFailure {
    return {
        status: "blocked",
        errorCode,
        message,
        recovery: [],
        mayHaveSideEffects: false,
        ...details,
    };
}

function verificationBlocked(
    errorCode: MergeVerificationFailure["errorCode"],
    message: string,
    details: Partial<MergeVerificationFailure> = {},
): MergeVerificationFailure {
    return {
        status: "blocked",
        errorCode,
        message,
        recovery: [],
        mayHaveSideEffects: false,
        ...details,
    };
}

function splitNullTerminated(output: string): string[] {
    return output.split("\0").filter((entry) => entry.length > 0);
}

function scalarOutput(output: string): string {
    return output.trim();
}

export function parsePorcelainPaths(output: string): string[] {
    const records = splitNullTerminated(output);
    const paths: string[] = [];
    for (let index = 0; index < records.length; index++) {
        const record = records[index];
        if (record.length < 4) {
            continue;
        }
        paths.push(record.slice(3));
        const status = record.slice(0, 2);
        if (status.includes("R") || status.includes("C")) {
            const originalPath = records[index + 1];
            if (originalPath !== undefined) {
                paths.push(originalPath);
                index++;
            }
        }
    }
    return paths;
}

export function parseConflictStatuses(
    output: string,
): Array<{ path: string; status: string; kind: MergeConflictKind }> {
    const records = splitNullTerminated(output);
    const conflicts: Array<{
        path: string;
        status: string;
        kind: MergeConflictKind;
    }> = [];
    for (let index = 0; index < records.length; index++) {
        const record = records[index];
        const status = record.slice(0, 2);
        if (UNMERGED_STATUSES.has(status)) {
            conflicts.push({
                path: record.slice(3),
                status,
                kind: CONFLICT_KIND_BY_STATUS[status] ?? "unmerged",
            });
        }
        if (status.includes("R") || status.includes("C")) {
            index++;
        }
    }
    return conflicts;
}

export function parseSubmodulePaths(output: string): Set<string> {
    const submodulePaths = new Set<string>();
    for (const entry of parseConflictIndex(output)) {
        if (entry.mode === "160000") {
            submodulePaths.add(entry.path);
        }
    }
    return submodulePaths;
}

type ConflictIndexEntry = {
    mode: string;
    objectId: string;
    path: string;
};

function parseConflictIndex(output: string): ConflictIndexEntry[] {
    const entries: ConflictIndexEntry[] = [];
    for (const record of splitNullTerminated(output)) {
        const match = /^(\d{6}) ([0-9a-f]+) [123]\t(.*)$/s.exec(record);
        if (match !== null) {
            entries.push({
                mode: match[1],
                objectId: match[2],
                path: match[3],
            });
        }
    }
    return entries;
}

function parseRemoteDefaultBranch(output: string): string | undefined {
    const match = /^ref:\s+refs\/heads\/([^\t\r\n]+)\s+HEAD$/m.exec(output);
    return match?.[1];
}

type RemoteBranchLookup =
    | { status: "found" }
    | { status: "missing" }
    | { status: "error"; message: string };

async function lookupRemoteBranch(
    runGit: GitCommandRunner,
    root: string,
    remote: string,
    branch: string,
): Promise<RemoteBranchLookup> {
    const result = await runGit(
        ["ls-remote", "--exit-code", "--heads", remote, `refs/heads/${branch}`],
        root,
    );
    if (result.exitCode === 0 && scalarOutput(result.stdout).length > 0) {
        return { status: "found" };
    }
    if (result.exitCode === 2) {
        return { status: "missing" };
    }
    return {
        status: "error",
        message:
            result.stderr ||
            `Unable to inspect branch '${branch}' on remote '${remote}'.`,
    };
}

async function validateBranchName(
    runGit: GitCommandRunner,
    root: string,
    branch: string,
): Promise<boolean> {
    const result = await runGit(["check-ref-format", "--branch", branch], root);
    return result.exitCode === 0;
}

async function getConfiguredDefaultBranch(
    runGit: GitCommandRunner,
    root: string,
    remote: string,
): Promise<
    | { status: "found"; branch: string }
    | { status: "missing" }
    | { status: "error"; message: string }
> {
    const remoteHead = await runGit(
        ["ls-remote", "--symref", remote, "HEAD"],
        root,
    );
    if (remoteHead.exitCode === 0) {
        const branch = parseRemoteDefaultBranch(remoteHead.stdout);
        if (branch !== undefined) {
            return { status: "found", branch };
        }
        return { status: "missing" };
    }
    return {
        status: "error",
        message:
            remoteHead.stderr ||
            `Unable to inspect the default branch on remote '${remote}'.`,
    };
}

async function resolveTarget(
    runGit: GitCommandRunner,
    root: string,
    remotes: string[],
    requestedTarget?: string,
): Promise<ResolvedTarget | MergePreparationFailure> {
    const target = requestedTarget?.trim();
    if (target === undefined || target.length === 0) {
        if (remotes.length > 1) {
            return blocked(
                "ambiguousRemote",
                "This repository has multiple remotes, so the default target repository is ambiguous.",
                {
                    repositoryRoot: root,
                    remotes,
                    recovery: [
                        "Retry with an explicit REMOTE/BRANCH target, such as upstream/main.",
                        "No fetch or merge was attempted.",
                    ],
                },
            );
        }

        const remote = remotes[0];
        const configuredDefault = await getConfiguredDefaultBranch(
            runGit,
            root,
            remote,
        );
        if (configuredDefault.status === "error") {
            return blocked(
                "remoteUnavailable",
                `Unable to inspect remote '${remote}' for its default branch.`,
                {
                    repositoryRoot: root,
                    remotes,
                    recovery: [
                        configuredDefault.message,
                        "Check network access and remote credentials, then retry.",
                        "No fetch or merge was attempted.",
                    ],
                },
            );
        }
        if (configuredDefault.status === "found") {
            return {
                remote,
                branch: configuredDefault.branch,
                displayName: `${remote}/${configuredDefault.branch}`,
            };
        }

        for (const fallback of ["main", "master"]) {
            const lookup = await lookupRemoteBranch(
                runGit,
                root,
                remote,
                fallback,
            );
            if (lookup.status === "error") {
                return blocked(
                    "remoteUnavailable",
                    `Unable to inspect branch '${fallback}' on remote '${remote}'.`,
                    {
                        repositoryRoot: root,
                        remotes,
                        recovery: [
                            lookup.message,
                            "Check network access and remote credentials, then retry.",
                            "No fetch or merge was attempted.",
                        ],
                    },
                );
            }
            if (lookup.status === "found") {
                return {
                    remote,
                    branch: fallback,
                    displayName: `${remote}/${fallback}`,
                };
            }
        }
        return blocked(
            "missingTargetBranch",
            `Remote '${remote}' has no configured default branch and neither main nor master exists.`,
            {
                repositoryRoot: root,
                remotes,
                recovery: [
                    "Retry with an explicit branch that exists on the remote.",
                    "No fetch or merge was attempted.",
                ],
            },
        );
    }

    const explicitRemote = [...remotes]
        .sort((left, right) => right.length - left.length)
        .find((remote) => target.startsWith(`${remote}/`));
    const branch =
        explicitRemote === undefined
            ? target
            : target.slice(explicitRemote.length + 1);
    if (!(await validateBranchName(runGit, root, branch))) {
        return blocked(
            "invalidTargetBranch",
            `'${target}' is not a valid branch name.`,
            {
                repositoryRoot: root,
                recovery: ["Use a valid BRANCH or REMOTE/BRANCH target."],
            },
        );
    }

    if (explicitRemote !== undefined) {
        const lookup = await lookupRemoteBranch(
            runGit,
            root,
            explicitRemote,
            branch,
        );
        if (lookup.status === "error") {
            return blocked(
                "remoteUnavailable",
                `Unable to inspect branch '${branch}' on remote '${explicitRemote}'.`,
                {
                    repositoryRoot: root,
                    remotes,
                    recovery: [
                        lookup.message,
                        "Check network access and remote credentials, then retry.",
                        "No fetch or merge was attempted.",
                    ],
                },
            );
        }
        if (lookup.status === "missing") {
            return blocked(
                "missingTargetBranch",
                `Branch '${branch}' does not exist on remote '${explicitRemote}'.`,
                {
                    repositoryRoot: root,
                    remotes,
                    recovery: [
                        "Check the remote and branch names, then retry.",
                        "No fetch or merge was attempted.",
                    ],
                },
            );
        }
        return {
            remote: explicitRemote,
            branch,
            displayName: `${explicitRemote}/${branch}`,
        };
    }

    const matchingRemotes: string[] = [];
    for (const remote of remotes) {
        const lookup = await lookupRemoteBranch(runGit, root, remote, branch);
        if (lookup.status === "error") {
            return blocked(
                "remoteUnavailable",
                `Unable to inspect branch '${branch}' on remote '${remote}'.`,
                {
                    repositoryRoot: root,
                    remotes,
                    recovery: [
                        lookup.message,
                        "Check network access and remote credentials, then retry.",
                        "No fetch or merge was attempted.",
                    ],
                },
            );
        }
        if (lookup.status === "found") {
            matchingRemotes.push(remote);
        }
    }
    if (matchingRemotes.length === 0) {
        return blocked(
            "missingTargetBranch",
            `Branch '${branch}' does not exist on any configured remote.`,
            {
                repositoryRoot: root,
                remotes,
                recovery: [
                    "Check the branch name or use REMOTE/BRANCH to select a remote.",
                    "No fetch or merge was attempted.",
                ],
            },
        );
    }
    if (matchingRemotes.length > 1) {
        return blocked(
            "ambiguousRemote",
            `Branch '${branch}' exists on multiple remotes: ${matchingRemotes.join(", ")}.`,
            {
                repositoryRoot: root,
                remotes: matchingRemotes,
                recovery: [
                    `Retry with one of: ${matchingRemotes.map((remote) => `${remote}/${branch}`).join(", ")}.`,
                    "No fetch or merge was attempted.",
                ],
            },
        );
    }
    return {
        remote: matchingRemotes[0],
        branch,
        displayName: `${matchingRemotes[0]}/${branch}`,
    };
}

async function findInProgressOperation(
    runGit: GitCommandRunner,
    root: string,
    pathExists: (filePath: string) => boolean,
): Promise<string | undefined> {
    const operationPaths: Array<[string, string]> = [
        ["MERGE_HEAD", "merge"],
        ["rebase-merge", "rebase"],
        ["rebase-apply", "rebase"],
        ["CHERRY_PICK_HEAD", "cherry-pick"],
    ];
    for (const [gitPath, operation] of operationPaths) {
        const result = await runGit(["rev-parse", "--git-path", gitPath], root);
        if (
            result.exitCode === 0 &&
            pathExists(path.resolve(root, scalarOutput(result.stdout)))
        ) {
            return operation;
        }
    }
    return undefined;
}

type ConflictReadResult =
    | { ok: true; conflicts: MergeConflictDetail[] }
    | { ok: false; message: string };

function isBinaryFile(filePath: string): boolean {
    const stats = fs.lstatSync(filePath);
    if (!stats.isFile()) {
        return false;
    }
    const handle = fs.openSync(filePath, "r");
    try {
        const prefix = Buffer.alloc(8_000);
        const bytesRead = fs.readSync(handle, prefix, 0, prefix.length, 0);
        return prefix.subarray(0, bytesRead).includes(0);
    } finally {
        fs.closeSync(handle);
    }
}

async function readConflicts(
    runGit: GitCommandRunner,
    root: string,
    pathExists: (filePath: string) => boolean,
    inspectBinaryFile: (filePath: string) => boolean,
): Promise<ConflictReadResult> {
    const [status, index] = await Promise.all([
        runGit(
            ["status", "--porcelain=v1", "-z", "--untracked-files=no"],
            root,
        ),
        runGit(["ls-files", "-u", "-z"], root),
    ]);
    if (status.exitCode !== 0 || index.exitCode !== 0) {
        return {
            ok: false,
            message:
                status.stderr ||
                index.stderr ||
                "Git could not inspect the unmerged index.",
        };
    }

    const conflicts = parseConflictStatuses(status.stdout);
    const submodulePaths = parseSubmodulePaths(index.stdout);
    const binaryPaths = new Set<string>();
    for (const conflict of conflicts) {
        if (submodulePaths.has(conflict.path)) {
            continue;
        }
        const absolutePath = path.resolve(root, conflict.path);
        if (!pathExists(absolutePath)) {
            continue;
        }
        try {
            if (inspectBinaryFile(absolutePath)) {
                binaryPaths.add(conflict.path);
            }
        } catch (error) {
            return {
                ok: false,
                message:
                    error instanceof Error
                        ? error.message
                        : `Unable to inspect conflicted file '${conflict.path}'.`,
            };
        }
    }
    return {
        ok: true,
        conflicts: conflicts.map((conflict) => ({
            ...conflict,
            binary: binaryPaths.has(conflict.path),
            submodule: submodulePaths.has(conflict.path),
        })),
    };
}

function reviewRecovery(): string[] {
    return [
        "Review the unstaged and staged diffs before finishing the merge.",
        "To abandon this merge and restore the pre-merge tree, run: git merge --abort",
        "Do not commit or push until the working tree has been reviewed.",
    ];
}

export async function prepareMerge(
    requestedTarget?: string,
    options: PrepareMergeOptions = {},
): Promise<MergePreparationResult> {
    const runGit = options.runGit ?? runGitCommand;
    const cwd = options.cwd ?? process.cwd();
    const pathExists = options.pathExists ?? fs.existsSync;
    const inspectBinaryFile = options.isBinaryFile ?? isBinaryFile;

    const rootResult = await runGit(["rev-parse", "--show-toplevel"], cwd);
    if (rootResult.failureCode === "ENOENT") {
        return blocked(
            "gitUnavailable",
            "Git is not installed or is not available on PATH.",
            { recovery: ["Install Git, then retry."] },
        );
    }
    if (
        rootResult.exitCode !== 0 ||
        scalarOutput(rootResult.stdout).length === 0
    ) {
        return blocked(
            "notRepository",
            "The current working directory is not inside a Git repository.",
            { recovery: ["Open a repository working directory and retry."] },
        );
    }
    const repositoryRoot = path.resolve(scalarOutput(rootResult.stdout));

    const branchResult = await runGit(
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        repositoryRoot,
    );
    if (
        branchResult.exitCode !== 0 ||
        scalarOutput(branchResult.stdout).length === 0
    ) {
        return blocked(
            "detachedHead",
            "HEAD is detached. A local branch must be checked out before preparing a merge.",
            {
                repositoryRoot,
                recovery: [
                    "Check out or create the intended local branch, then retry.",
                    "No fetch or merge was attempted.",
                ],
            },
        );
    }
    const currentBranch = scalarOutput(branchResult.stdout);
    const headResult = await runGit(
        ["rev-parse", "--verify", "HEAD^{commit}"],
        repositoryRoot,
    );
    if (
        headResult.exitCode !== 0 ||
        scalarOutput(headResult.stdout).length === 0
    ) {
        return blocked(
            "mergeFailed",
            "The current branch does not resolve to a commit.",
            {
                repositoryRoot,
                currentBranch,
                recovery: [
                    "Create or check out a branch with at least one commit, then retry.",
                    "No fetch or merge was attempted.",
                ],
            },
        );
    }
    const initialHead = scalarOutput(headResult.stdout);

    const operation = await findInProgressOperation(
        runGit,
        repositoryRoot,
        pathExists,
    );
    if (operation !== undefined) {
        return blocked(
            "operationInProgress",
            `A ${operation} operation is already in progress.`,
            {
                repositoryRoot,
                currentBranch,
                operation,
                recovery: [
                    `Continue or abort the existing ${operation} before retrying.`,
                    "No fetch or new merge was attempted.",
                ],
            },
        );
    }

    const statusResult = await runGit(
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        repositoryRoot,
    );
    if (statusResult.exitCode !== 0) {
        return blocked("mergeFailed", "Unable to inspect the working tree.", {
            repositoryRoot,
            currentBranch,
            recovery: [statusResult.stderr],
        });
    }
    const changedPaths = parsePorcelainPaths(statusResult.stdout);
    if (changedPaths.length > 0) {
        return blocked(
            "dirtyWorktree",
            "The working tree has existing changes. The merge was not started so unrelated edits remain untouched.",
            {
                repositoryRoot,
                currentBranch,
                changedPaths,
                recovery: [
                    "Commit, stash, or otherwise preserve the listed changes, then retry with a clean working tree.",
                    "No fetch or merge was attempted.",
                ],
            },
        );
    }

    const remoteResult = await runGit(["remote"], repositoryRoot);
    const remotes = scalarOutput(remoteResult.stdout)
        .split(/\r?\n/)
        .map((remote) => remote.trim())
        .filter((remote) => remote.length > 0);
    if (remoteResult.exitCode !== 0 || remotes.length === 0) {
        return blocked(
            "missingRemote",
            "This repository has no configured Git remote.",
            {
                repositoryRoot,
                currentBranch,
                recovery: [
                    "Configure the intended remote, then retry.",
                    "No fetch or merge was attempted.",
                ],
            },
        );
    }

    const resolvedTarget = await resolveTarget(
        runGit,
        repositoryRoot,
        remotes,
        requestedTarget,
    );
    if ("status" in resolvedTarget) {
        return { ...resolvedTarget, currentBranch };
    }

    const temporaryRef = `refs/typeagent/merge-conflict/${randomUUID()}`;
    const fetchResult = await runGit(
        [
            "fetch",
            "--no-tags",
            "--no-write-fetch-head",
            resolvedTarget.remote,
            "--",
            `refs/heads/${resolvedTarget.branch}:${temporaryRef}`,
        ],
        repositoryRoot,
        MUTATING_GIT_TIMEOUT_MS,
    );
    const cleanupTemporaryRef = async (): Promise<GitCommandResult> =>
        runGit(["update-ref", "-d", temporaryRef], repositoryRoot);
    if (fetchResult.exitCode !== 0) {
        const cleanup = await cleanupTemporaryRef();
        return blocked(
            "fetchFailed",
            `Unable to fetch '${resolvedTarget.displayName}'.`,
            {
                repositoryRoot,
                currentBranch,
                recovery: [
                    fetchResult.stderr || "Inspect the remote and retry.",
                    ...(cleanup.exitCode === 0
                        ? []
                        : [
                              `Remove the temporary ref before retrying: git update-ref -d ${temporaryRef}`,
                          ]),
                    "No merge was attempted.",
                ],
                mayHaveSideEffects: true,
            },
        );
    }

    const fetchedCommitResult = await runGit(
        ["rev-parse", "--verify", `${temporaryRef}^{commit}`],
        repositoryRoot,
    );
    const cleanup = await cleanupTemporaryRef();
    if (
        fetchedCommitResult.exitCode !== 0 ||
        scalarOutput(fetchedCommitResult.stdout).length === 0 ||
        cleanup.exitCode !== 0
    ) {
        return blocked(
            "fetchFailed",
            `Fetch completed but '${resolvedTarget.displayName}' did not resolve to a commit.`,
            {
                repositoryRoot,
                currentBranch,
                recovery: [
                    fetchedCommitResult.stderr ||
                        "The fetched branch did not resolve to a commit.",
                    ...(cleanup.exitCode === 0
                        ? []
                        : [
                              `Remove the temporary ref before retrying: git update-ref -d ${temporaryRef}`,
                          ]),
                ],
                mayHaveSideEffects: true,
            },
        );
    }
    const target: MergeTarget = {
        ...resolvedTarget,
        fetchedCommit: scalarOutput(fetchedCommitResult.stdout),
    };

    const branchBeforeMerge = await runGit(
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        repositoryRoot,
    );
    const activeBranch = scalarOutput(branchBeforeMerge.stdout);
    if (branchBeforeMerge.exitCode !== 0 || activeBranch !== currentBranch) {
        return blocked(
            "branchChanged",
            "The checked-out branch changed while the target was being fetched.",
            {
                repositoryRoot,
                ...(activeBranch.length > 0
                    ? { currentBranch: activeBranch }
                    : {}),
                recovery: [
                    `Check out '${currentBranch}' with a clean working tree, then retry.`,
                    "No merge was attempted.",
                ],
                mayHaveSideEffects: true,
            },
        );
    }
    const headBeforeMerge = await runGit(
        ["rev-parse", "--verify", "HEAD^{commit}"],
        repositoryRoot,
    );
    if (
        headBeforeMerge.exitCode !== 0 ||
        scalarOutput(headBeforeMerge.stdout) !== initialHead
    ) {
        return blocked(
            "branchChanged",
            "The current branch tip changed while the target was being fetched.",
            {
                repositoryRoot,
                currentBranch,
                recovery: [
                    "Review the new branch state and retry from a clean working tree.",
                    "No merge was attempted.",
                ],
                mayHaveSideEffects: true,
            },
        );
    }
    const operationBeforeMerge = await findInProgressOperation(
        runGit,
        repositoryRoot,
        pathExists,
    );
    if (operationBeforeMerge !== undefined) {
        return blocked(
            "operationInProgress",
            `A ${operationBeforeMerge} operation started while the target was being fetched.`,
            {
                repositoryRoot,
                currentBranch,
                operation: operationBeforeMerge,
                recovery: [
                    `Continue or abort the existing ${operationBeforeMerge} before retrying.`,
                    "No new merge was attempted.",
                ],
                mayHaveSideEffects: true,
            },
        );
    }
    const statusBeforeMerge = await runGit(
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        repositoryRoot,
    );
    if (statusBeforeMerge.exitCode !== 0) {
        return blocked("mergeFailed", "Unable to recheck the working tree.", {
            repositoryRoot,
            currentBranch,
            recovery: [statusBeforeMerge.stderr, "No merge was attempted."],
            mayHaveSideEffects: true,
        });
    }
    const newChangedPaths = parsePorcelainPaths(statusBeforeMerge.stdout);
    if (newChangedPaths.length > 0) {
        return blocked(
            "dirtyWorktree",
            "The working tree changed while the target was being fetched. The merge was not started.",
            {
                repositoryRoot,
                currentBranch,
                changedPaths: newChangedPaths,
                recovery: [
                    "Preserve the listed changes and retry with a clean working tree.",
                    "No merge was attempted.",
                ],
                mayHaveSideEffects: true,
            },
        );
    }

    const mergeResult = await runGit(
        ["merge", "--no-commit", "--no-ff", "--", target.fetchedCommit],
        repositoryRoot,
        MUTATING_GIT_TIMEOUT_MS,
    );
    const conflictRead = await readConflicts(
        runGit,
        repositoryRoot,
        pathExists,
        inspectBinaryFile,
    );
    if (!conflictRead.ok) {
        const mergeInProgress = await hasMergeHead(
            runGit,
            repositoryRoot,
            pathExists,
        );
        return blocked(
            "mergeFailed",
            "The merge ran, but Git could not inspect its conflict state.",
            {
                repositoryRoot,
                currentBranch,
                recovery: [
                    conflictRead.message,
                    ...(mergeInProgress
                        ? reviewRecovery()
                        : ["Inspect the repository state before retrying."]),
                ],
                mayHaveSideEffects: true,
            },
        );
    }
    if (conflictRead.conflicts.length > 0) {
        return {
            status: "conflicts",
            repositoryRoot,
            currentBranch,
            target,
            mergeInProgress: true,
            conflicts: conflictRead.conflicts,
            recovery: reviewRecovery(),
        };
    }

    const mergeInProgress = await hasMergeHead(
        runGit,
        repositoryRoot,
        pathExists,
    );
    if (mergeResult.exitCode !== 0) {
        return blocked("mergeFailed", "Git could not prepare the merge.", {
            repositoryRoot,
            currentBranch,
            recovery: [
                mergeResult.stderr || mergeResult.stdout,
                ...(mergeResult.timedOut
                    ? [
                          "The merge command timed out. Confirm no Git process is still running; if Git reports an index lock, remove only the repository's stale .git/index.lock before recovery.",
                      ]
                    : []),
                ...(mergeInProgress
                    ? reviewRecovery()
                    : ["Inspect the repository state before retrying."]),
            ],
            mayHaveSideEffects: true,
        });
    }

    return {
        status: mergeInProgress ? "ready" : "upToDate",
        repositoryRoot,
        currentBranch,
        target,
        mergeInProgress,
        conflicts: [],
        recovery: mergeInProgress
            ? reviewRecovery()
            : [
                  "The target is already incorporated. No merge commit or push was performed.",
              ],
    };
}

async function hasMergeHead(
    runGit: GitCommandRunner,
    repositoryRoot: string,
    pathExists: (filePath: string) => boolean,
): Promise<boolean> {
    const mergeHeadPath = await runGit(
        ["rev-parse", "--git-path", "MERGE_HEAD"],
        repositoryRoot,
    );
    return (
        mergeHeadPath.exitCode === 0 &&
        pathExists(
            path.resolve(repositoryRoot, scalarOutput(mergeHeadPath.stdout)),
        )
    );
}

function parseMarkerPaths(output: string): string[] {
    const markerPaths = new Set<string>();
    for (const line of output.split(/\r?\n/)) {
        const match = /^(.*):\d+: leftover conflict marker$/.exec(line);
        if (match !== null) {
            markerPaths.add(match[1]);
        }
    }
    return [...markerPaths];
}

export async function verifyMergeConflictsResolved(
    options: PrepareMergeOptions = {},
): Promise<MergeVerificationResult> {
    const runGit = options.runGit ?? runGitCommand;
    const cwd = options.cwd ?? process.cwd();
    const pathExists = options.pathExists ?? fs.existsSync;
    const inspectBinaryFile = options.isBinaryFile ?? isBinaryFile;

    const rootResult = await runGit(["rev-parse", "--show-toplevel"], cwd);
    if (rootResult.failureCode === "ENOENT") {
        return verificationBlocked(
            "gitUnavailable",
            "Git is not installed or is not available on PATH.",
            { recovery: ["Install Git, then retry."] },
        );
    }
    if (
        rootResult.exitCode !== 0 ||
        scalarOutput(rootResult.stdout).length === 0
    ) {
        return verificationBlocked(
            "notRepository",
            "The current working directory is not inside a Git repository.",
            { recovery: ["Open the repository working directory and retry."] },
        );
    }
    const repositoryRoot = path.resolve(scalarOutput(rootResult.stdout));
    const branchResult = await runGit(
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        repositoryRoot,
    );
    if (
        branchResult.exitCode !== 0 ||
        scalarOutput(branchResult.stdout).length === 0
    ) {
        return verificationBlocked(
            "detachedHead",
            "HEAD is detached, so the prepared merge cannot be verified safely.",
            {
                repositoryRoot,
                recovery: ["Inspect the repository state manually."],
            },
        );
    }
    const currentBranch = scalarOutput(branchResult.stdout);

    if (!(await hasMergeHead(runGit, repositoryRoot, pathExists))) {
        return verificationBlocked(
            "noMergeInProgress",
            "No merge is in progress. Verification will not guess at a completed or aborted merge.",
            {
                repositoryRoot,
                currentBranch,
                recovery: [
                    "Run resolveMergeConflicts to prepare a merge, or inspect the repository state manually.",
                ],
            },
        );
    }

    const conflictRead = await readConflicts(
        runGit,
        repositoryRoot,
        pathExists,
        inspectBinaryFile,
    );
    if (!conflictRead.ok) {
        return verificationBlocked(
            "verificationFailed",
            "Git could not inspect the merge conflict state.",
            {
                repositoryRoot,
                currentBranch,
                recovery: [conflictRead.message, ...reviewRecovery()],
            },
        );
    }

    const [changed, unstaged, stagedCheck, unstagedCheck] = await Promise.all([
        runGit(["diff", "--name-only", "-z", "HEAD", "--"], repositoryRoot),
        runGit(["diff", "--name-only", "-z", "--"], repositoryRoot),
        runGit(["diff", "--cached", "--check", "--"], repositoryRoot),
        runGit(["diff", "--check", "--"], repositoryRoot),
    ]);
    if (changed.exitCode !== 0 || unstaged.exitCode !== 0) {
        return verificationBlocked(
            "verificationFailed",
            "Git could not inspect the prepared merge changes.",
            {
                repositoryRoot,
                currentBranch,
                recovery: [
                    changed.stderr ||
                        unstaged.stderr ||
                        "Inspect the repository state manually.",
                    ...reviewRecovery(),
                ],
            },
        );
    }
    if (
        (stagedCheck.exitCode !== 0 && stagedCheck.stderr.length > 0) ||
        (unstagedCheck.exitCode !== 0 && unstagedCheck.stderr.length > 0)
    ) {
        return verificationBlocked(
            "verificationFailed",
            "Git could not check the prepared merge for conflict markers.",
            {
                repositoryRoot,
                currentBranch,
                recovery: [
                    stagedCheck.stderr ||
                        unstagedCheck.stderr ||
                        "Inspect the repository state manually.",
                    ...reviewRecovery(),
                ],
            },
        );
    }

    const inspectedPaths = splitNullTerminated(changed.stdout);
    const unstagedPaths = splitNullTerminated(unstaged.stdout);
    if (conflictRead.conflicts.length > 0) {
        return {
            status: "unresolved",
            repositoryRoot,
            currentBranch,
            mergeInProgress: true,
            inspectedPaths,
            remainingConflicts: conflictRead.conflicts,
            markerPaths: [],
            unstagedPaths,
            recovery: [
                "Resolve and stage every remaining unmerged path, then verify again.",
                ...reviewRecovery(),
            ],
        };
    }

    const markerPaths = [
        ...new Set([
            ...parseMarkerPaths(stagedCheck.stdout),
            ...parseMarkerPaths(unstagedCheck.stdout),
        ]),
    ];
    if (markerPaths.length > 0) {
        return {
            status: "markersRemain",
            repositoryRoot,
            currentBranch,
            mergeInProgress: true,
            inspectedPaths,
            remainingConflicts: [],
            markerPaths,
            unstagedPaths,
            recovery: [
                "Remove or intentionally resolve the reported marker lines, stage the affected paths, and verify again.",
                ...reviewRecovery(),
            ],
        };
    }
    if (unstagedPaths.length > 0) {
        return {
            status: "unstagedChanges",
            repositoryRoot,
            currentBranch,
            mergeInProgress: true,
            inspectedPaths,
            remainingConflicts: [],
            markerPaths: [],
            unstagedPaths,
            recovery: [
                "Review and stage the reported paths before considering the merge resolved.",
                ...reviewRecovery(),
            ],
        };
    }

    return {
        status: "resolved",
        repositoryRoot,
        currentBranch,
        mergeInProgress: true,
        inspectedPaths,
        remainingConflicts: [],
        markerPaths: [],
        unstagedPaths: [],
        recovery: reviewRecovery(),
    };
}
