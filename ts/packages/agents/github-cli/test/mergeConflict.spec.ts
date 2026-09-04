// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseConflictStatuses,
    parsePorcelainPaths,
    parseSubmodulePaths,
    prepareMerge,
    verifyMergeConflictsResolved,
} from "../src/mergeConflict.js";
import type {
    GitCommandResult,
    GitCommandRunner,
} from "../src/mergeConflict.js";
import {
    buildMergeResult,
    buildVerificationResult,
    getRequestedMergeTarget,
} from "../src/github-cliActionHandler.js";

const ROOT = process.platform === "win32" ? "C:\\repo" : "/repo";

function commandKey(args: readonly string[]): string {
    return args.join("\0");
}

type RunnerState = {
    calls: string[][];
    mergeStarted: boolean;
};

type RunnerOverrides = {
    branch?: GitCommandResult;
    headSequence?: string[];
    initialStatus?: string;
    statusSequence?: string[];
    remotes?: string[];
    configuredDefault?: string;
    localDefault?: string;
    remoteBranches?: Record<string, string[]>;
    fetch?: GitCommandResult;
    fetchedCommit?: GitCommandResult;
    merge?: GitCommandResult;
    conflictStatus?: string;
    conflictInspection?: GitCommandResult;
    conflictIndex?: string;
    changedPaths?: string;
    unstagedPaths?: string;
    stagedCheck?: GitCommandResult;
    unstagedCheck?: GitCommandResult;
};

function ok(stdout = ""): GitCommandResult {
    return { exitCode: 0, stdout, stderr: "" };
}

function fail(stderr = "failed", exitCode = 1): GitCommandResult {
    return { exitCode, stdout: "", stderr };
}

function createRunner(overrides: RunnerOverrides = {}): {
    runGit: GitCommandRunner;
    state: RunnerState;
} {
    const state: RunnerState = { calls: [], mergeStarted: false };
    const statusSequence = [...(overrides.statusSequence ?? [])];
    const headSequence = [...(overrides.headSequence ?? [])];
    const remotes = overrides.remotes ?? ["origin"];
    const remoteBranches = overrides.remoteBranches ?? {
        origin: ["main", "master", "feature"],
    };
    const runGit: GitCommandRunner = async (args) => {
        state.calls.push([...args]);
        const key = commandKey(args);
        if (key === commandKey(["rev-parse", "--show-toplevel"])) {
            return ok(ROOT);
        }
        if (
            key === commandKey(["symbolic-ref", "--quiet", "--short", "HEAD"])
        ) {
            return overrides.branch ?? ok("feature/work");
        }
        if (
            args[0] === "rev-parse" &&
            args[1] === "--git-path" &&
            args[2] !== undefined
        ) {
            return ok(`.git/${args[2]}`);
        }
        if (key === commandKey(["rev-parse", "--verify", "HEAD^{commit}"])) {
            return ok(headSequence.shift() ?? "fedcba9876543210");
        }
        if (
            key ===
            commandKey([
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
            ])
        ) {
            return ok(statusSequence.shift() ?? overrides.initialStatus ?? "");
        }
        if (key === commandKey(["remote"])) {
            return ok(remotes.join("\n"));
        }
        if (
            args[0] === "symbolic-ref" &&
            args[1] === "--quiet" &&
            args[2]?.startsWith("refs/remotes/")
        ) {
            const remote = args[2].split("/")[2];
            const localDefault =
                overrides.localDefault ?? overrides.configuredDefault;
            return localDefault === undefined
                ? fail()
                : ok(`refs/remotes/${remote}/${localDefault}`);
        }
        if (args[0] === "ls-remote" && args.includes("--symref")) {
            return overrides.configuredDefault === undefined
                ? ok()
                : ok(
                      `ref: refs/heads/${overrides.configuredDefault}\tHEAD\nabc\tHEAD`,
                  );
        }
        if (args[0] === "check-ref-format") {
            const branch = args[2] ?? "";
            return branch.startsWith("-") || branch.includes(" ")
                ? fail("invalid branch")
                : ok(branch);
        }
        if (args[0] === "ls-remote" && args.includes("--heads")) {
            const remote = args[3];
            const branch = args[4]?.replace("refs/heads/", "");
            return remoteBranches[remote]?.includes(branch) === true
                ? ok(`abc\trefs/heads/${branch}`)
                : fail("missing");
        }
        if (args[0] === "fetch") {
            return overrides.fetch ?? ok();
        }
        if (
            args[0] === "rev-parse" &&
            args[1] === "--verify" &&
            args[2]?.startsWith("refs/typeagent/merge-conflict/") === true &&
            args[2].endsWith("^{commit}")
        ) {
            return overrides.fetchedCommit ?? ok("0123456789abcdef");
        }
        if (args[0] === "update-ref" && args[1] === "-d") {
            return ok();
        }
        if (args[0] === "merge") {
            state.mergeStarted = true;
            return overrides.merge ?? ok();
        }
        if (
            key ===
            commandKey([
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=no",
            ])
        ) {
            return (
                overrides.conflictInspection ??
                ok(overrides.conflictStatus ?? "")
            );
        }
        if (key === commandKey(["ls-files", "-u", "-z"])) {
            return ok(overrides.conflictIndex ?? "");
        }
        if (key === commandKey(["diff", "--name-only", "-z", "HEAD", "--"])) {
            return ok(overrides.changedPaths ?? "");
        }
        if (key === commandKey(["diff", "--name-only", "-z", "--"])) {
            return ok(overrides.unstagedPaths ?? "");
        }
        if (key === commandKey(["diff", "--cached", "--check", "--"])) {
            return overrides.stagedCheck ?? ok();
        }
        if (key === commandKey(["diff", "--check", "--"])) {
            return overrides.unstagedCheck ?? ok();
        }
        throw new Error(`Unexpected git command: ${args.join(" ")}`);
    };
    return { runGit, state };
}

function createPathExists(
    state: RunnerState,
    preExistingOperation?: string,
): (filePath: string) => boolean {
    return (filePath) => {
        const normalized = filePath.replaceAll("\\", "/");
        if (
            preExistingOperation !== undefined &&
            normalized.endsWith(`/.git/${preExistingOperation}`)
        ) {
            return true;
        }
        return state.mergeStarted && normalized.endsWith("/.git/MERGE_HEAD");
    };
}

describe("merge-conflict parsers", () => {
    test("parses dirty paths including both sides of a rename", () => {
        expect(
            parsePorcelainPaths(
                " M src/local.ts\0?? notes.txt\0R  src/new.ts\0src/old.ts\0",
            ),
        ).toEqual(["src/local.ts", "notes.txt", "src/new.ts", "src/old.ts"]);
    });

    test("classifies modify, add, and delete conflicts", () => {
        expect(
            parseConflictStatuses(
                "UU src/both.ts\0UD src/theirs-deleted.ts\0DU src/ours-deleted.ts\0AA src/new.ts\0",
            ),
        ).toEqual([
            {
                path: "src/both.ts",
                status: "UU",
                kind: "bothModified",
            },
            {
                path: "src/theirs-deleted.ts",
                status: "UD",
                kind: "deletedByThem",
            },
            {
                path: "src/ours-deleted.ts",
                status: "DU",
                kind: "deletedByUs",
            },
            { path: "src/new.ts", status: "AA", kind: "bothAdded" },
        ]);
    });

    test("identifies submodule index entries", () => {
        expect(
            parseSubmodulePaths(
                "160000 abcdef 1\tdeps/library\0" +
                    "100644 abcdef 2\tsrc/file.ts\0",
            ).has("deps/library"),
        ).toBe(true);
    });
});

describe("prepareMerge", () => {
    test("prefers the configured remote default branch", async () => {
        const { runGit, state } = createRunner({
            configuredDefault: "trunk",
            remoteBranches: { origin: ["trunk"] },
        });
        const result = await prepareMerge(undefined, {
            cwd: ROOT,
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result.status).toBe("ready");
        if (result.status !== "blocked") {
            expect(result.target.displayName).toBe("origin/trunk");
        }
        expect(
            state.calls.some(
                (args) =>
                    args[0] === "fetch" &&
                    args[1] === "--no-tags" &&
                    args[2] === "--no-write-fetch-head" &&
                    args[3] === "origin" &&
                    args[5]?.startsWith(
                        "refs/heads/trunk:refs/typeagent/merge-conflict/",
                    ) === true,
            ),
        ).toBe(true);
    });

    test("prefers the authoritative remote default over a stale local HEAD", async () => {
        const { runGit, state } = createRunner({
            configuredDefault: "main",
            localDefault: "master",
            remoteBranches: { origin: ["main", "master"] },
        });
        const result = await prepareMerge(undefined, {
            cwd: ROOT,
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result.status).toBe("ready");
        if (result.status !== "blocked") {
            expect(result.target.displayName).toBe("origin/main");
        }
        expect(state.calls).not.toContainEqual([
            "symbolic-ref",
            "--quiet",
            "refs/remotes/origin/HEAD",
        ]);
    });

    test("falls back to an existing main before master", async () => {
        const { runGit, state } = createRunner({
            remoteBranches: { origin: ["main", "master"] },
        });
        const result = await prepareMerge(undefined, {
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result.status).toBe("ready");
        if (result.status !== "blocked") {
            expect(result.target.branch).toBe("main");
        }
        expect(state.calls).not.toContainEqual([
            "ls-remote",
            "--exit-code",
            "--heads",
            "origin",
            "refs/heads/master",
        ]);
    });

    test("does not guess a default when multiple remotes are present", async () => {
        const { runGit, state } = createRunner({
            remotes: ["origin", "upstream"],
        });
        const result = await prepareMerge(undefined, {
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "ambiguousRemote",
            mayHaveSideEffects: false,
            remotes: ["origin", "upstream"],
        });
        expect(state.calls.some((args) => args[0] === "fetch")).toBe(false);
    });

    test("requires REMOTE/BRANCH when a named branch exists on two remotes", async () => {
        const { runGit, state } = createRunner({
            remotes: ["origin", "upstream"],
            remoteBranches: {
                origin: ["main"],
                upstream: ["main"],
            },
        });
        const result = await prepareMerge("main", {
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "ambiguousRemote",
            remotes: ["origin", "upstream"],
        });
        expect(state.calls.some((args) => args[0] === "fetch")).toBe(false);
    });

    test("rejects dirty worktrees before remote inspection or mutation", async () => {
        const { runGit, state } = createRunner({
            initialStatus: " M src/local.ts\0?? notes.txt\0",
        });
        const result = await prepareMerge("main", {
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "dirtyWorktree",
            changedPaths: ["src/local.ts", "notes.txt"],
            mayHaveSideEffects: false,
        });
        expect(state.calls.some((args) => args[0] === "remote")).toBe(false);
    });

    test("rejects detached HEAD before mutation", async () => {
        const detached = createRunner({ branch: fail("detached") });
        await expect(
            prepareMerge("main", {
                runGit: detached.runGit,
                pathExists: createPathExists(detached.state),
            }),
        ).resolves.toMatchObject({
            status: "blocked",
            errorCode: "detachedHead",
        });
    });

    test.each([
        ["MERGE_HEAD", "merge"],
        ["rebase-merge", "rebase"],
        ["rebase-apply", "rebase"],
        ["CHERRY_PICK_HEAD", "cherry-pick"],
    ])(
        "rejects an existing %s operation before mutation",
        async (gitPath, operation) => {
            const activeOperation = createRunner();
            await expect(
                prepareMerge("main", {
                    runGit: activeOperation.runGit,
                    pathExists: createPathExists(
                        activeOperation.state,
                        gitPath,
                    ),
                }),
            ).resolves.toMatchObject({
                status: "blocked",
                errorCode: "operationInProgress",
                operation,
            });
            expect(
                activeOperation.state.calls.some((args) => args[0] === "fetch"),
            ).toBe(false);
        },
    );

    test("returns typed conflict details without committing or pushing", async () => {
        const { runGit, state } = createRunner({
            merge: fail("Automatic merge failed"),
            conflictStatus:
                "UU src/text.ts\0UD src/deleted.ts\0UU assets/image.png\0UU deps/lib\0",
            conflictIndex:
                "100644 aaaaaa 1\tsrc/text.ts\0" +
                "100644 bbbbbb 2\tsrc/text.ts\0" +
                "100644 cccccc 1\tassets/image.png\0" +
                "100644 dddddd 2\tassets/image.png\0" +
                "160000 eeeeee 1\tdeps/lib\0",
        });
        const result = await prepareMerge("origin/main", {
            runGit,
            pathExists: (filePath) =>
                createPathExists(state)(filePath) ||
                filePath.replaceAll("\\", "/").endsWith("/assets/image.png"),
            isBinaryFile: (filePath) =>
                filePath.replaceAll("\\", "/").endsWith("/assets/image.png"),
        });

        expect(result.status).toBe("conflicts");
        if (result.status === "conflicts") {
            expect(result.mergeInProgress).toBe(true);
            expect(result.conflicts).toEqual([
                {
                    path: "src/text.ts",
                    status: "UU",
                    kind: "bothModified",
                    binary: false,
                    submodule: false,
                },
                {
                    path: "src/deleted.ts",
                    status: "UD",
                    kind: "deletedByThem",
                    binary: false,
                    submodule: false,
                },
                {
                    path: "assets/image.png",
                    status: "UU",
                    kind: "bothModified",
                    binary: true,
                    submodule: false,
                },
                {
                    path: "deps/lib",
                    status: "UU",
                    kind: "bothModified",
                    binary: false,
                    submodule: true,
                },
            ]);
        }
        expect(state.calls).toContainEqual([
            "merge",
            "--no-commit",
            "--no-ff",
            "--",
            "0123456789abcdef",
        ]);
        expect(
            state.calls.some((args) => ["commit", "push"].includes(args[0])),
        ).toBe(false);
    });

    test("reports fetch failures as retryable pre-merge errors", async () => {
        const { runGit, state } = createRunner({
            fetch: fail("authentication failed", 128),
        });
        const result = await prepareMerge("main", {
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "fetchFailed",
            mayHaveSideEffects: true,
        });
        expect(state.calls.some((args) => args[0] === "merge")).toBe(false);
    });

    test("blocks when the worktree changes during fetch", async () => {
        const { runGit, state } = createRunner({
            statusSequence: ["", "?? local.txt\0"],
        });
        const result = await prepareMerge("main", {
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "dirtyWorktree",
            changedPaths: ["local.txt"],
            mayHaveSideEffects: true,
        });
        expect(state.calls.some((args) => args[0] === "merge")).toBe(false);
    });

    test("blocks when the current branch tip changes during fetch", async () => {
        const { runGit, state } = createRunner({
            headSequence: ["aaaaaaaa", "bbbbbbbb"],
        });
        const result = await prepareMerge("main", {
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "branchChanged",
            mayHaveSideEffects: true,
        });
        expect(state.calls.some((args) => args[0] === "merge")).toBe(false);
    });

    test("fails closed when a remote branch cannot be inspected", async () => {
        const { runGit, state } = createRunner({
            remotes: ["origin", "upstream"],
            remoteBranches: { origin: ["main"] },
        });
        const failingRunner: GitCommandRunner = async (
            args,
            cwd,
            timeoutMs,
        ) => {
            if (
                args[0] === "ls-remote" &&
                args[3] === "upstream" &&
                args.includes("--heads")
            ) {
                return fail("authentication failed", 128);
            }
            return runGit(args, cwd, timeoutMs);
        };
        const result = await prepareMerge("main", {
            runGit: failingRunner,
            pathExists: createPathExists(state),
        });

        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "remoteUnavailable",
            mayHaveSideEffects: false,
        });
        expect(state.calls.some((args) => args[0] === "fetch")).toBe(false);
    });

    test("reports missing Git distinctly from a non-repository", async () => {
        const result = await prepareMerge("main", {
            runGit: async () => ({
                exitCode: Number.NaN,
                stdout: "",
                stderr: "spawn git ENOENT",
                failureCode: "ENOENT",
            }),
        });

        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "gitUnavailable",
            mayHaveSideEffects: false,
        });
    });
});

describe("verifyMergeConflictsResolved", () => {
    test("reports remaining unmerged paths", async () => {
        const { runGit, state } = createRunner({
            conflictStatus: "UU src/file.ts\0",
        });

        state.mergeStarted = true;
        const result = await verifyMergeConflictsResolved({
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result).toMatchObject({
            status: "unresolved",
            mergeInProgress: true,
            remainingConflicts: [
                {
                    path: "src/file.ts",
                    status: "UU",
                    kind: "bothModified",
                },
            ],
        });
    });

    test("reports conflict markers after index conflicts are resolved", async () => {
        const { runGit, state } = createRunner({
            changedPaths: "src/file.ts\0",
            stagedCheck: {
                exitCode: 2,
                stdout: "src/file.ts:1: leftover conflict marker\n",
                stderr: "",
            },
        });
        state.mergeStarted = true;
        const result = await verifyMergeConflictsResolved({
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result).toMatchObject({
            status: "markersRemain",
            markerPaths: ["src/file.ts"],
            mergeInProgress: true,
        });
    });

    test("returns resolved while leaving the merge uncommitted", async () => {
        const { runGit, state } = createRunner({
            changedPaths: "src/file.ts\0",
        });
        state.mergeStarted = true;
        const result = await verifyMergeConflictsResolved({
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result).toMatchObject({
            status: "resolved",
            mergeInProgress: true,
            markerPaths: [],
            remainingConflicts: [],
        });
        expect(
            state.calls.some((args) =>
                ["add", "commit", "merge --continue", "push"].includes(
                    args.join(" "),
                ),
            ),
        ).toBe(false);
    });

    test("reports unstaged merge changes instead of claiming resolution", async () => {
        const { runGit, state } = createRunner({
            changedPaths: "src/file.ts\0",
            unstagedPaths: "src/file.ts\0",
        });
        state.mergeStarted = true;
        const result = await verifyMergeConflictsResolved({
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result).toMatchObject({
            status: "unstagedChanges",
            unstagedPaths: ["src/file.ts"],
        });
    });

    test("fails closed when Git cannot inspect the unmerged index", async () => {
        const { runGit, state } = createRunner({
            conflictInspection: fail("index unavailable"),
        });
        state.mergeStarted = true;
        const result = await verifyMergeConflictsResolved({
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "verificationFailed",
            mayHaveSideEffects: false,
        });
    });

    test("accepts a clean prepared merge with no conflict paths", async () => {
        const { runGit, state } = createRunner();
        state.mergeStarted = true;
        const result = await verifyMergeConflictsResolved({
            runGit,
            pathExists: createPathExists(state),
        });

        expect(result).toMatchObject({
            status: "resolved",
            inspectedPaths: [],
            remainingConflicts: [],
            markerPaths: [],
            unstagedPaths: [],
        });
    });
});

describe("MCP-facing structured results", () => {
    test("accepts a grammar action with omitted empty parameters", () => {
        expect(
            getRequestedMergeTarget({
                actionName: "resolveMergeConflicts",
            }),
        ).toBeUndefined();
    });

    test("preparation exposes stable raw data without follow-up actions", () => {
        const preparation = {
            status: "conflicts" as const,
            repositoryRoot: ROOT,
            currentBranch: "feature/work",
            target: {
                remote: "origin",
                branch: "main",
                displayName: "origin/main",
                fetchedCommit: "0123456789abcdef",
            },
            mergeInProgress: true,
            conflicts: [
                {
                    path: "src/file.ts",
                    status: "UU",
                    kind: "bothModified" as const,
                    binary: false,
                    submodule: false,
                },
            ],
            recovery: ["Review before committing."],
        };

        const result = buildMergeResult(preparation);
        expect(result.resultValue).toBe(preparation);
        expect(JSON.parse(result.historyText ?? "")).toEqual(preparation);
        expect(result.displayContent).toMatchObject({
            rawData: preparation,
        });
        expect(result.additionalActions).toBeUndefined();
    });

    test("verification exposes resolved state without committing or pushing", () => {
        const verification = {
            status: "resolved" as const,
            repositoryRoot: ROOT,
            currentBranch: "feature/work",
            mergeInProgress: true as const,
            inspectedPaths: ["src/file.ts"],
            remainingConflicts: [],
            markerPaths: [],
            unstagedPaths: [],
            recovery: ["Review before committing."],
        };

        const result = buildVerificationResult(verification);
        expect(result.resultValue).toBe(verification);
        expect(JSON.parse(result.historyText ?? "")).toEqual(verification);
        expect(result.displayContent).toMatchObject({
            rawData: verification,
        });
        expect(result.additionalActions).toBeUndefined();
    });
});
