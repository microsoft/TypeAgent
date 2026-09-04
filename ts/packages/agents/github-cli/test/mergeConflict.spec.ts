// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    completeMergeConflictResolution,
    mergeAndCommit,
} from "../src/mergeConflict.js";
import type {
    GitCommandResult,
    GitCommandRunner,
} from "../src/mergeConflict.js";
import {
    buildMergeResult,
    getRequestedMergeTarget,
} from "../src/github-cliActionHandler.js";

const ROOT = process.platform === "win32" ? "C:\\repo" : "/repo";

function ok(stdout = ""): GitCommandResult {
    return { exitCode: 0, stdout, stderr: "" };
}

function fail(stderr = "failed"): GitCommandResult {
    return { exitCode: 1, stdout: "", stderr };
}

function key(args: readonly string[]): string {
    return args.join("\0");
}

type RunnerOptions = {
    dirty?: boolean;
    remotes?: string[];
    defaultBranch?: string;
    mainExists?: boolean;
    merge?: GitCommandResult;
    conflicts?: string[];
    mergeInProgress?: boolean;
    unstaged?: boolean;
    stagedPaths?: string[];
    allowedPaths?: string[];
    markers?: boolean;
    whitespaceErrors?: boolean;
    commit?: GitCommandResult;
};

function createRunner(options: RunnerOptions = {}): {
    runGit: GitCommandRunner;
    calls: string[][];
} {
    const calls: string[][] = [];
    const runGit: GitCommandRunner = async (args) => {
        calls.push([...args]);
        switch (key(args)) {
            case key(["rev-parse", "--show-toplevel"]):
                return ok(ROOT);
            case key(["symbolic-ref", "--quiet", "--short", "HEAD"]):
                return ok("feature/work");
            case key([
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
            ]):
                return ok(options.dirty ? " M local.txt\0" : "");
            case key(["remote"]):
                return ok((options.remotes ?? ["origin"]).join("\n"));
            case key(["ls-remote", "--symref", "origin", "HEAD"]):
                return options.defaultBranch === undefined
                    ? fail()
                    : ok(
                          `ref: refs/heads/${options.defaultBranch}\tHEAD\nabc\tHEAD\n`,
                      );
            case key(["ls-remote", "--exit-code", "--heads", "origin", "main"]):
                return options.mainExists
                    ? ok("abc\trefs/heads/main\n")
                    : fail();
            case key(["rev-parse", "--verify", "MERGE_HEAD"]):
                return options.mergeInProgress === false ? fail() : ok("abc");
            case key(["diff", "--name-only", "--diff-filter=U", "-z"]):
                return ok((options.conflicts ?? []).join("\0"));
            case key(["diff", "--quiet"]):
                return options.unstaged ? fail() : ok();
            case key(["merge-base", "HEAD", "MERGE_HEAD"]):
                return ok("base");
            case key(["diff", "--name-only", "base", "MERGE_HEAD", "-z"]):
                return ok((options.allowedPaths ?? ["src/a.ts"]).join("\0"));
            case key(["diff", "--cached", "--name-only", "HEAD", "-z"]):
                return ok((options.stagedPaths ?? ["src/a.ts"]).join("\0"));
            case key(["diff", "--cached", "--check"]):
                return options.markers
                    ? fail("leftover conflict marker")
                    : options.whitespaceErrors
                      ? fail("trailing whitespace")
                      : ok();
            case key(["commit", "--no-edit"]):
                return options.commit ?? ok();
            case key(["rev-parse", "HEAD"]):
                return ok("0123456789abcdef");
            default:
                if (args[0] === "rev-parse" && args[1] === "--git-path") {
                    return ok(`.git/${args[2]}`);
                }
                if (args[0] === "check-ref-format" && args[1] === "--branch") {
                    return args[2]?.startsWith("-") ? fail() : ok(args[2]);
                }
                if (args[0] === "fetch") {
                    return ok();
                }
                if (
                    args[0] === "rev-parse" &&
                    args[1] === "--verify" &&
                    args[2]?.startsWith("refs/typeagent/merge/")
                ) {
                    return ok("fetched-commit");
                }
                if (
                    key(args) ===
                    key(["merge", "--no-commit", "--no-ff", "fetched-commit"])
                ) {
                    return options.merge ?? ok();
                }
                if (args[0] === "update-ref" && args[1] === "-d") {
                    return ok();
                }
                if (
                    args[0] === "ls-remote" &&
                    args[1] === "--symref" &&
                    args[2] === "upstream"
                ) {
                    return fail();
                }
                return fail(`Unexpected command: ${args.join(" ")}`);
        }
    };
    return { runGit, calls };
}

const resolutionState = {
    pathExists: (filePath: string) =>
        filePath.includes("TYPEAGENT_MERGE_CONFLICTS"),
    readFile: () => JSON.stringify(["src/a.ts"]),
    removeFile: () => {},
};

describe("mergeAndCommit", () => {
    test("uses the remote default branch and creates a merge commit", async () => {
        const { runGit, calls } = createRunner({ defaultBranch: "main" });
        const result = await mergeAndCommit(undefined, {
            cwd: ROOT,
            runGit,
            pathExists: () => false,
        });

        expect(result).toMatchObject({
            status: "committed",
            currentBranch: "feature/work",
            target: { displayName: "origin/main" },
            commit: "0123456789abcdef",
        });
        expect(calls).toContainEqual([
            "merge",
            "--no-commit",
            "--no-ff",
            "fetched-commit",
        ]);
        expect(calls).toContainEqual(["commit", "--no-edit"]);
        expect(calls.some(([command]) => command === "push")).toBe(false);
    });

    test("falls back to an existing main branch", async () => {
        const { runGit, calls } = createRunner({ mainExists: true });
        const result = await mergeAndCommit(undefined, {
            cwd: ROOT,
            runGit,
            pathExists: () => false,
        });

        expect(result).toMatchObject({
            status: "committed",
            target: { displayName: "origin/main" },
        });
        expect(calls).toContainEqual([
            "ls-remote",
            "--exit-code",
            "--heads",
            "origin",
            "main",
        ]);
    });

    test("supports an explicit remote and branch", async () => {
        const { runGit, calls } = createRunner({
            remotes: ["origin", "upstream"],
        });
        const result = await mergeAndCommit("upstream/release/2.0", {
            cwd: ROOT,
            runGit,
            pathExists: () => false,
        });

        expect(result).toMatchObject({
            status: "committed",
            target: { displayName: "upstream/release/2.0" },
        });
        expect(
            calls.some(
                ([command, noTags, noFetchHead, remote, refspec]) =>
                    command === "fetch" &&
                    noTags === "--no-tags" &&
                    noFetchHead === "--no-write-fetch-head" &&
                    remote === "upstream" &&
                    refspec?.startsWith("refs/heads/release/2.0:"),
            ),
        ).toBe(true);
    });

    test("does not mutate a dirty worktree", async () => {
        const { runGit, calls } = createRunner({ dirty: true });
        const result = await mergeAndCommit("main", {
            cwd: ROOT,
            runGit,
            pathExists: () => false,
        });

        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "dirtyWorktree",
            mayHaveSideEffects: false,
        });
        expect(calls.some(([command]) => command === "fetch")).toBe(false);
    });

    test("rejects an option-like target before fetch", async () => {
        const { runGit, calls } = createRunner();
        const result = await mergeAndCommit("--upload-pack=bad", {
            cwd: ROOT,
            runGit,
            pathExists: () => false,
        });

        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "missingTargetBranch",
        });
        expect(calls.some(([command]) => command === "fetch")).toBe(false);
    });

    test("returns conflicted paths for Reasoning instead of committing", async () => {
        const { runGit, calls } = createRunner({
            merge: fail("CONFLICT"),
            conflicts: ["src/a.ts", "src/b.ts"],
        });
        const result = await mergeAndCommit("main", {
            cwd: ROOT,
            runGit,
            pathExists: () => false,
            writeFile: () => {},
        });

        expect(result).toMatchObject({
            status: "conflicts",
            conflicts: ["src/a.ts", "src/b.ts"],
        });
        expect(calls.some(([command]) => command === "commit")).toBe(false);
        expect(calls.some(([command]) => command === "push")).toBe(false);
    });
});

describe("completeMergeConflictResolution", () => {
    test("refuses to commit while conflicts remain", async () => {
        const { runGit, calls } = createRunner({
            conflicts: ["src/a.ts"],
        });
        const result = await completeMergeConflictResolution({
            cwd: ROOT,
            runGit,
            ...resolutionState,
        });

        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "unresolvedConflicts",
            conflicts: ["src/a.ts"],
        });
        expect(calls.some(([command]) => command === "commit")).toBe(false);
    });

    test("refuses to commit unstaged merge changes", async () => {
        const { runGit } = createRunner({ unstaged: true });
        const result = await completeMergeConflictResolution({
            cwd: ROOT,
            runGit,
            ...resolutionState,
        });
        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "unstagedChanges",
        });
    });

    test("refuses to commit staged changes unrelated to the merge", async () => {
        const { runGit } = createRunner({
            allowedPaths: ["src/a.ts"],
            stagedPaths: ["src/a.ts", "notes.txt"],
        });
        const result = await completeMergeConflictResolution({
            cwd: ROOT,
            runGit,
            ...resolutionState,
        });
        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "unrelatedChanges",
        });
    });

    test("refuses to commit remaining conflict markers", async () => {
        const { runGit } = createRunner({ markers: true });
        const result = await completeMergeConflictResolution({
            cwd: ROOT,
            runGit,
            ...resolutionState,
        });
        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "conflictMarkers",
        });
    });

    test("allows a resolved rename recorded in conflict state", async () => {
        const { runGit } = createRunner({
            allowedPaths: ["src/old.ts"],
            stagedPaths: ["src/new.ts"],
        });
        const result = await completeMergeConflictResolution({
            cwd: ROOT,
            runGit,
            ...resolutionState,
            readFile: () => JSON.stringify(["src/new.ts"]),
        });
        expect(result).toMatchObject({ status: "committed" });
    });

    test("does not mistake incoming whitespace errors for conflict markers", async () => {
        const { runGit } = createRunner({ whitespaceErrors: true });
        const result = await completeMergeConflictResolution({
            cwd: ROOT,
            runGit,
            ...resolutionState,
        });
        expect(result).toMatchObject({ status: "committed" });
    });

    test("commits a fully resolved and staged merge without pushing", async () => {
        const { runGit, calls } = createRunner();
        const result = await completeMergeConflictResolution({
            cwd: ROOT,
            runGit,
            ...resolutionState,
        });

        expect(result).toMatchObject({
            status: "committed",
            commit: "0123456789abcdef",
        });
        expect(calls).toContainEqual(["commit", "--no-edit"]);
        expect(calls.some(([command]) => command === "push")).toBe(false);
    });
});

describe("merge action results", () => {
    test("routes conflicted files to the existing Reasoning action", () => {
        const result = buildMergeResult({
            status: "conflicts",
            repositoryRoot: ROOT,
            currentBranch: "feature/work",
            target: {
                remote: "origin",
                branch: "main",
                displayName: "origin/main",
            },
            conflicts: ["src/a.ts"],
        });

        expect(result.error).toBeUndefined();
        if (result.error !== undefined) {
            throw new Error(result.error);
        }
        expect(result.additionalActions).toEqual([
            expect.objectContaining({
                schemaName: "dispatcher.reasoning",
                actionName: "reasoningAction",
            }),
        ]);
        expect(
            result.additionalActions?.[0].parameters?.originalRequest,
        ).toContain(JSON.stringify(ROOT));
        expect(result.additionalActions?.[0].parameters?.workingDirectory).toBe(
            ROOT,
        );
    });

    test("handles grammar actions whose empty parameters were omitted", () => {
        expect(
            getRequestedMergeTarget({ actionName: "resolveMergeConflicts" }),
        ).toBeUndefined();
    });
});
