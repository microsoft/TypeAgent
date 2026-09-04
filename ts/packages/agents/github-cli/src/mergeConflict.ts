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
};

export type GitCommandRunner = (
    args: readonly string[],
    cwd?: string,
) => Promise<GitCommandResult>;

export type MergeTarget = {
    remote: string;
    branch: string;
    displayName: string;
};

export type MergeConflictResult =
    | {
          status: "committed";
          repositoryRoot: string;
          currentBranch: string;
          target?: MergeTarget;
          commit: string;
      }
    | {
          status: "conflicts";
          repositoryRoot: string;
          currentBranch: string;
          target: MergeTarget;
          conflicts: string[];
      }
    | {
          status: "upToDate";
          repositoryRoot: string;
          currentBranch: string;
          target: MergeTarget;
      }
    | {
          status: "blocked";
          errorCode:
              | "notRepository"
              | "detachedHead"
              | "dirtyWorktree"
              | "operationInProgress"
              | "noMergeInProgress"
              | "missingRemote"
              | "ambiguousRemote"
              | "missingTargetBranch"
              | "fetchFailed"
              | "mergeFailed"
              | "unresolvedConflicts"
              | "missingResolutionState"
              | "unstagedChanges"
              | "unrelatedChanges"
              | "conflictMarkers"
              | "commitFailed";
          message: string;
          recovery?: string;
          conflicts?: string[];
          mayHaveSideEffects: boolean;
      };

export type MergeOptions = {
    cwd?: string;
    runGit?: GitCommandRunner;
    pathExists?: (filePath: string) => boolean;
    readFile?: (filePath: string) => string;
    writeFile?: (filePath: string, content: string) => void;
    removeFile?: (filePath: string) => void;
};

export async function runGitCommand(
    args: readonly string[],
    cwd = process.cwd(),
): Promise<GitCommandResult> {
    try {
        const { stdout, stderr } = await execFileAsync("git", [...args], {
            cwd,
            encoding: "utf8",
            maxBuffer: 4 * 1024 * 1024,
            timeout: 10 * 60_000,
            windowsHide: true,
        });
        return { exitCode: 0, stdout, stderr };
    } catch (error) {
        const failure = error as Error & {
            code?: number;
            stdout?: string;
            stderr?: string;
        };
        return {
            exitCode:
                typeof failure.code === "number" ? failure.code : Number.NaN,
            stdout: String(failure.stdout ?? ""),
            stderr: String(failure.stderr ?? failure.message),
        };
    }
}

function blocked(
    errorCode: Extract<MergeConflictResult, { status: "blocked" }>["errorCode"],
    message: string,
    mayHaveSideEffects = false,
    details: Partial<Extract<MergeConflictResult, { status: "blocked" }>> = {},
): MergeConflictResult {
    return {
        status: "blocked",
        errorCode,
        message,
        mayHaveSideEffects,
        ...details,
    };
}

function lines(output: string): string[] {
    return output
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
}

function nullSeparated(output: string): string[] {
    return output.split("\0").filter(Boolean);
}

async function getRepository(
    cwd: string,
    runGit: GitCommandRunner,
): Promise<
    { repositoryRoot: string; currentBranch: string } | MergeConflictResult
> {
    const root = await runGit(["rev-parse", "--show-toplevel"], cwd);
    if (root.exitCode !== 0) {
        return blocked(
            "notRepository",
            "Run this action from a Git repository.",
        );
    }
    const repositoryRoot = root.stdout.trim();
    const branch = await runGit(
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        repositoryRoot,
    );
    if (branch.exitCode !== 0) {
        return blocked(
            "detachedHead",
            "Check out a local branch before merging.",
        );
    }
    return { repositoryRoot, currentBranch: branch.stdout.trim() };
}

async function findOperation(
    repositoryRoot: string,
    runGit: GitCommandRunner,
    pathExists: (filePath: string) => boolean,
): Promise<string | undefined> {
    for (const [gitPath, operation] of [
        ["MERGE_HEAD", "merge"],
        ["rebase-merge", "rebase"],
        ["rebase-apply", "rebase"],
        ["CHERRY_PICK_HEAD", "cherry-pick"],
        ["REVERT_HEAD", "revert"],
    ]) {
        const result = await runGit(
            ["rev-parse", "--git-path", gitPath],
            repositoryRoot,
        );
        if (result.exitCode === 0) {
            const resolved = path.resolve(repositoryRoot, result.stdout.trim());
            if (pathExists(resolved)) {
                return operation;
            }
        }
    }
    return undefined;
}

function selectRemote(
    remotes: string[],
    explicitRemote: string | undefined,
): string | MergeConflictResult {
    if (explicitRemote !== undefined) {
        return remotes.includes(explicitRemote)
            ? explicitRemote
            : blocked(
                  "missingRemote",
                  `Remote '${explicitRemote}' does not exist.`,
              );
    }
    if (remotes.includes("origin")) {
        return "origin";
    }
    if (remotes.length === 1) {
        return remotes[0];
    }
    if (remotes.length === 0) {
        return blocked("missingRemote", "This repository has no Git remote.");
    }
    return blocked(
        "ambiguousRemote",
        `Choose a remote explicitly. Available remotes: ${remotes.join(", ")}.`,
    );
}

function parseTarget(
    targetBranch: string | undefined,
    remotes: string[],
): {
    remote?: string;
    branch?: string;
} {
    if (targetBranch === undefined) {
        return {};
    }
    const slash = targetBranch.indexOf("/");
    return slash > 0 && remotes.includes(targetBranch.slice(0, slash))
        ? {
              remote: targetBranch.slice(0, slash),
              branch: targetBranch.slice(slash + 1),
          }
        : { branch: targetBranch };
}

async function getDefaultBranch(
    repositoryRoot: string,
    remote: string,
    runGit: GitCommandRunner,
): Promise<string | undefined> {
    const head = await runGit(
        ["ls-remote", "--symref", remote, "HEAD"],
        repositoryRoot,
    );
    const match = /^ref:\s+refs\/heads\/(.+)\s+HEAD$/m.exec(head.stdout);
    if (head.exitCode === 0 && match?.[1]) {
        return match[1];
    }
    for (const fallback of ["main", "master"]) {
        const result = await runGit(
            ["ls-remote", "--exit-code", "--heads", remote, fallback],
            repositoryRoot,
        );
        if (result.exitCode === 0 && result.stdout.trim() !== "") {
            return fallback;
        }
    }
    return undefined;
}

async function resolveTarget(
    targetBranch: string | undefined,
    repositoryRoot: string,
    runGit: GitCommandRunner,
): Promise<MergeTarget | MergeConflictResult> {
    const remoteResult = await runGit(["remote"], repositoryRoot);
    const remotes = lines(remoteResult.stdout);
    const requested = parseTarget(targetBranch?.trim() || undefined, remotes);
    const remote = selectRemote(remotes, requested.remote);
    if (typeof remote !== "string") {
        return remote;
    }
    const branch =
        requested.branch ??
        (await getDefaultBranch(repositoryRoot, remote, runGit));
    if (branch === undefined || branch === "") {
        return blocked(
            "missingTargetBranch",
            `Could not determine the default branch for '${remote}'. Specify a target branch.`,
        );
    }
    const validBranch = await runGit(
        ["check-ref-format", "--branch", branch],
        repositoryRoot,
    );
    if (validBranch.exitCode !== 0) {
        return blocked(
            "missingTargetBranch",
            `'${branch}' is not a valid Git branch name.`,
        );
    }
    return { remote, branch, displayName: `${remote}/${branch}` };
}

async function listConflicts(
    repositoryRoot: string,
    runGit: GitCommandRunner,
): Promise<string[]> {
    const result = await runGit(
        ["diff", "--name-only", "--diff-filter=U", "-z"],
        repositoryRoot,
    );
    return result.exitCode === 0 ? nullSeparated(result.stdout) : [];
}

async function hasMergeHead(
    repositoryRoot: string,
    runGit: GitCommandRunner,
): Promise<boolean> {
    const result = await runGit(
        ["rev-parse", "--verify", "MERGE_HEAD"],
        repositoryRoot,
    );
    return result.exitCode === 0;
}

async function getResolutionStatePath(
    repositoryRoot: string,
    runGit: GitCommandRunner,
): Promise<string | undefined> {
    const result = await runGit(
        ["rev-parse", "--git-path", "TYPEAGENT_MERGE_CONFLICTS"],
        repositoryRoot,
    );
    return result.exitCode === 0
        ? path.resolve(repositoryRoot, result.stdout.trim())
        : undefined;
}

async function commitMerge(
    repositoryRoot: string,
    runGit: GitCommandRunner,
): Promise<string | MergeConflictResult> {
    const commit = await runGit(["commit", "--no-edit"], repositoryRoot);
    if (commit.exitCode !== 0) {
        return blocked(
            "commitFailed",
            commit.stderr.trim() || "Git could not create the merge commit.",
            true,
            {
                recovery:
                    "Resolve the error, then run `git commit` or `git merge --abort`.",
            },
        );
    }
    const head = await runGit(["rev-parse", "HEAD"], repositoryRoot);
    return head.exitCode === 0 ? head.stdout.trim() : "";
}

async function listChangedPaths(
    repositoryRoot: string,
    runGit: GitCommandRunner,
    args: readonly string[],
): Promise<string[] | undefined> {
    const result = await runGit([...args, "-z"], repositoryRoot);
    return result.exitCode === 0 ? nullSeparated(result.stdout) : undefined;
}

export async function mergeAndCommit(
    targetBranch?: string,
    options: MergeOptions = {},
): Promise<MergeConflictResult> {
    const cwd = options.cwd ?? process.cwd();
    const runGit = options.runGit ?? runGitCommand;
    const pathExists = options.pathExists ?? fs.existsSync;
    const writeFile =
        options.writeFile ??
        ((filePath, content) => fs.writeFileSync(filePath, content, "utf8"));
    const removeFile =
        options.removeFile ??
        ((filePath) => fs.rmSync(filePath, { force: true }));
    const repository = await getRepository(cwd, runGit);
    if ("status" in repository) {
        return repository;
    }
    const { repositoryRoot, currentBranch } = repository;
    const resolutionStatePath = await getResolutionStatePath(
        repositoryRoot,
        runGit,
    );
    const operation = await findOperation(repositoryRoot, runGit, pathExists);
    if (operation !== undefined) {
        return blocked(
            "operationInProgress",
            `Finish or abort the current ${operation} before starting another merge.`,
        );
    }
    const status = await runGit(
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        repositoryRoot,
    );
    if (status.exitCode !== 0 || status.stdout !== "") {
        return blocked(
            "dirtyWorktree",
            "Commit or stash local changes before merging.",
        );
    }
    if (resolutionStatePath !== undefined && pathExists(resolutionStatePath)) {
        removeFile(resolutionStatePath);
    }
    const target = await resolveTarget(targetBranch, repositoryRoot, runGit);
    if ("status" in target) {
        return target;
    }
    const temporaryRef = `refs/typeagent/merge/${randomUUID()}`;
    const fetch = await runGit(
        [
            "fetch",
            "--no-tags",
            "--no-write-fetch-head",
            target.remote,
            `refs/heads/${target.branch}:${temporaryRef}`,
        ],
        repositoryRoot,
    );
    if (fetch.exitCode !== 0) {
        return blocked(
            "fetchFailed",
            fetch.stderr.trim() || `Could not fetch ${target.displayName}.`,
        );
    }
    const fetchedCommit = await runGit(
        ["rev-parse", "--verify", `${temporaryRef}^{commit}`],
        repositoryRoot,
    );
    if (fetchedCommit.exitCode !== 0) {
        await runGit(["update-ref", "-d", temporaryRef], repositoryRoot);
        return blocked(
            "fetchFailed",
            `Could not resolve the fetched commit for ${target.displayName}.`,
        );
    }
    const merge = await runGit(
        ["merge", "--no-commit", "--no-ff", fetchedCommit.stdout.trim()],
        repositoryRoot,
    );
    await runGit(["update-ref", "-d", temporaryRef], repositoryRoot);
    if (merge.exitCode !== 0) {
        const conflicts = await listConflicts(repositoryRoot, runGit);
        if (conflicts.length > 0) {
            if (resolutionStatePath === undefined) {
                return blocked(
                    "mergeFailed",
                    "Git could not create conflict-resolution state.",
                    true,
                    { recovery: "Run `git merge --abort`." },
                );
            }
            try {
                writeFile(resolutionStatePath, JSON.stringify(conflicts));
            } catch (error) {
                return blocked(
                    "mergeFailed",
                    `Could not save conflict-resolution state: ${String(error)}`,
                    true,
                    { recovery: "Run `git merge --abort`." },
                );
            }
            return {
                status: "conflicts",
                repositoryRoot,
                currentBranch,
                target,
                conflicts,
            };
        }
        return blocked(
            "mergeFailed",
            merge.stderr.trim() || "Git could not merge the target branch.",
            true,
            {
                recovery:
                    "Inspect `git status`, then run `git merge --abort` if needed.",
            },
        );
    }
    if (!(await hasMergeHead(repositoryRoot, runGit))) {
        return { status: "upToDate", repositoryRoot, currentBranch, target };
    }
    const commit = await commitMerge(repositoryRoot, runGit);
    return typeof commit === "string"
        ? {
              status: "committed",
              repositoryRoot,
              currentBranch,
              target,
              commit,
          }
        : commit;
}

export async function completeMergeConflictResolution(
    options: MergeOptions = {},
): Promise<MergeConflictResult> {
    const cwd = options.cwd ?? process.cwd();
    const runGit = options.runGit ?? runGitCommand;
    const pathExists = options.pathExists ?? fs.existsSync;
    const readFile =
        options.readFile ?? ((filePath) => fs.readFileSync(filePath, "utf8"));
    const removeFile =
        options.removeFile ??
        ((filePath) => fs.rmSync(filePath, { force: true }));
    const repository = await getRepository(cwd, runGit);
    if ("status" in repository) {
        return repository;
    }
    const { repositoryRoot, currentBranch } = repository;
    const resolutionStatePath = await getResolutionStatePath(
        repositoryRoot,
        runGit,
    );
    if (!(await hasMergeHead(repositoryRoot, runGit))) {
        return blocked(
            "noMergeInProgress",
            "There is no merge in progress to complete.",
        );
    }
    const conflicts = await listConflicts(repositoryRoot, runGit);
    if (conflicts.length > 0) {
        return blocked(
            "unresolvedConflicts",
            "Resolve and stage every conflicted file before completing the merge.",
            true,
            { conflicts },
        );
    }
    if (resolutionStatePath === undefined || !pathExists(resolutionStatePath)) {
        return blocked(
            "missingResolutionState",
            "Conflict-resolution state is missing. Inspect the merge and commit or abort it manually.",
            true,
        );
    }
    let originalConflicts: string[];
    try {
        const parsed: unknown = JSON.parse(readFile(resolutionStatePath));
        if (
            !Array.isArray(parsed) ||
            !parsed.every((value) => typeof value === "string")
        ) {
            throw new Error("Invalid conflict path list");
        }
        originalConflicts = parsed;
    } catch {
        return blocked(
            "missingResolutionState",
            "Conflict-resolution state is invalid. Inspect the merge and commit or abort it manually.",
            true,
        );
    }
    const unstaged = await runGit(["diff", "--quiet"], repositoryRoot);
    if (unstaged.exitCode !== 0) {
        return blocked(
            "unstagedChanges",
            "Stage the resolved merge changes before completing the merge.",
            true,
        );
    }
    const mergeBase = await runGit(
        ["merge-base", "HEAD", "MERGE_HEAD"],
        repositoryRoot,
    );
    const allowedPaths =
        mergeBase.exitCode === 0
            ? await listChangedPaths(repositoryRoot, runGit, [
                  "diff",
                  "--name-only",
                  mergeBase.stdout.trim(),
                  "MERGE_HEAD",
              ])
            : undefined;
    const stagedPaths = await listChangedPaths(repositoryRoot, runGit, [
        "diff",
        "--cached",
        "--name-only",
        "HEAD",
    ]);
    if (allowedPaths === undefined || stagedPaths === undefined) {
        return blocked(
            "unrelatedChanges",
            "Git could not verify the staged merge paths.",
            true,
        );
    }
    const allowed = new Set([...allowedPaths, ...originalConflicts]);
    const unrelated = stagedPaths.filter((file) => !allowed.has(file));
    if (unrelated.length > 0) {
        return blocked(
            "unrelatedChanges",
            `Unstage changes unrelated to the merge: ${unrelated.join(", ")}.`,
            true,
        );
    }
    const markerCheck = await runGit(
        ["diff", "--cached", "--check"],
        repositoryRoot,
    );
    if (
        markerCheck.exitCode !== 0 &&
        `${markerCheck.stdout}\n${markerCheck.stderr}`.includes(
            "leftover conflict marker",
        )
    ) {
        return blocked(
            "conflictMarkers",
            "Remove remaining conflict markers before completing the merge.",
            true,
        );
    }
    const commit = await commitMerge(repositoryRoot, runGit);
    if (typeof commit === "string") {
        removeFile(resolutionStatePath);
    }
    return typeof commit === "string"
        ? {
              status: "committed",
              repositoryRoot,
              currentBranch,
              commit,
          }
        : commit;
}
