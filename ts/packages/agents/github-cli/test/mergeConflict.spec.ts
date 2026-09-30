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
const HEAD_SHA = "1111111111111111111111111111111111111111";
const MERGE_HEAD_SHA = "2222222222222222222222222222222222222222";

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
    markers?: boolean;
    whitespaceErrors?: boolean;
    commit?: GitCommandResult;
    head?: string;
    mergeHead?: string;
};

function createRunner(options: RunnerOptions = {}): {
    runGit: GitCommandRunner;
    calls: string[][];
} {
    const head = options.head ?? HEAD_SHA;
    const mergeHead = options.mergeHead ?? MERGE_HEAD_SHA;
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
            case key(["rev-parse", "HEAD", "MERGE_HEAD"]):
                return options.mergeInProgress === false
                    ? fail()
                    : ok(`${head}\n${mergeHead}`);
            case key(["rev-parse", "HEAD"]):
                return ok(head);
            case key(["diff", "--name-only", "--diff-filter=U", "-z"]):
                return ok((options.conflicts ?? []).join("\0"));
            case key(["diff", "--quiet"]):
                return options.unstaged ? fail() : ok();
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
                    args[0] === "merge" &&
                    args[1] === "--no-commit" &&
                    args[2] === "--no-ff" &&
                    args[3]?.startsWith("refs/typeagent/merge/")
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

function stateFixture(
    overrides: {
        head?: string;
        mergeHead?: string;
        conflicts?: string[];
        stagedPaths?: string[];
    } = {},
): string {
    return JSON.stringify({
        version: 1,
        head: overrides.head ?? HEAD_SHA,
        mergeHead: overrides.mergeHead ?? MERGE_HEAD_SHA,
        conflicts: overrides.conflicts ?? ["src/a.ts"],
        stagedPaths: overrides.stagedPaths ?? ["src/a.ts"],
    });
}

const resolutionState = {
    pathExists: (filePath: string) =>
        filePath.includes("TYPEAGENT_MERGE_CONFLICTS"),
    readFile: () => stateFixture(),
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
            commit: HEAD_SHA,
        });
        expect(calls).toContainEqual([
            "merge",
            "--no-commit",
            "--no-ff",
            expect.stringMatching(/^refs\/typeagent\/merge\//),
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

    test("returns conflicted paths for Reasoning and persists v1 state", async () => {
        let stored: { path: string; content: string } | undefined;
        const { runGit, calls } = createRunner({
            merge: fail("CONFLICT"),
            conflicts: ["src/a.ts", "src/b.ts"],
            stagedPaths: ["src/a.ts", "src/b.ts", "src/autoMerged.ts"],
        });
        const result = await mergeAndCommit("main", {
            cwd: ROOT,
            runGit,
            pathExists: () => false,
            writeFile: (path, content) => {
                stored = { path, content };
            },
        });

        expect(result).toMatchObject({
            status: "conflicts",
            conflicts: ["src/a.ts", "src/b.ts"],
        });
        expect(calls.some(([command]) => command === "commit")).toBe(false);
        expect(calls.some(([command]) => command === "push")).toBe(false);

        expect(stored).toBeDefined();
        expect(stored!.path).toContain("TYPEAGENT_MERGE_CONFLICTS");
        const parsed = JSON.parse(stored!.content);
        expect(parsed).toEqual({
            version: 1,
            head: HEAD_SHA,
            mergeHead: MERGE_HEAD_SHA,
            conflicts: ["src/a.ts", "src/b.ts"],
            // Snapshot includes the auto-merged rename target that the
            // previous diff-based reconstruction would have missed.
            stagedPaths: ["src/a.ts", "src/b.ts", "src/autoMerged.ts"],
        });
    });

    test("cleans up the temporary fetch ref even when the merge fails", async () => {
        const { runGit, calls } = createRunner({
            merge: fail("CONFLICT"),
            conflicts: ["src/a.ts"],
        });
        await mergeAndCommit("main", {
            cwd: ROOT,
            runGit,
            pathExists: () => false,
            writeFile: () => {},
        });
        expect(
            calls.some(
                ([command, flag, ref]) =>
                    command === "update-ref" &&
                    flag === "-d" &&
                    ref?.startsWith("refs/typeagent/merge/"),
            ),
        ).toBe(true);
    });

    test("propagates AbortError when the signal is already aborted", async () => {
        const controller = new AbortController();
        controller.abort();
        const { runGit, calls } = createRunner();
        await expect(
            mergeAndCommit("main", {
                cwd: ROOT,
                runGit,
                pathExists: () => false,
                signal: controller.signal,
            }),
        ).rejects.toMatchObject({ name: "AbortError" });
        // Never even reached repo detection.
        expect(calls.length).toBe(0);
    });

    test.each(["interrupted", "just completed"])(
        "cancelling a %s fetch prevents merge and commit and cleans up",
        async (fetchState) => {
            const controller = new AbortController();
            const { runGit, calls } = createRunner();
            const cancelledRunner: GitCommandRunner = async (
                args,
                cwd,
                signal,
            ) => {
                if (args[0] === "fetch") {
                    expect(signal).toBe(controller.signal);
                    controller.abort();
                    if (fetchState === "interrupted") {
                        throw new DOMException(
                            "The operation was aborted.",
                            "AbortError",
                        );
                    }
                    return ok();
                }
                if (args[0] === "update-ref" && args[1] === "-d") {
                    expect(signal).toBeUndefined();
                }
                return runGit(args, cwd, signal);
            };
            await expect(
                mergeAndCommit("main", {
                    cwd: ROOT,
                    runGit: cancelledRunner,
                    pathExists: () => false,
                    signal: controller.signal,
                }),
            ).rejects.toMatchObject({ name: "AbortError" });
            expect(calls.some(([command]) => command === "merge")).toBe(false);
            expect(calls.some(([command]) => command === "commit")).toBe(false);
            expect(
                calls.some(
                    ([command, flag]) =>
                        command === "update-ref" && flag === "-d",
                ),
            ).toBe(true);
        },
    );

    test("reports failed ref cleanup without masking cancellation", async () => {
        const controller = new AbortController();
        const { runGit } = createRunner();
        const originalWarn = console.warn;
        const warnings: string[] = [];
        console.warn = (message: string) => warnings.push(message);
        try {
            await expect(
                mergeAndCommit("main", {
                    cwd: ROOT,
                    pathExists: () => false,
                    signal: controller.signal,
                    runGit: async (args, cwd, signal) => {
                        if (args[0] === "fetch") {
                            controller.abort();
                            throw new DOMException("Cancelled", "AbortError");
                        }
                        if (args[0] === "update-ref") {
                            expect(signal).toBeUndefined();
                            return fail("cannot lock ref");
                        }
                        return runGit(args, cwd, signal);
                    },
                }),
            ).rejects.toMatchObject({ name: "AbortError" });
            expect(warnings).toEqual([
                expect.stringMatching(
                    /Could not remove temporary merge ref .*cannot lock ref/,
                ),
            ]);
        } finally {
            console.warn = originalWarn;
        }
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
            commit: HEAD_SHA,
        });
        expect(calls).toContainEqual(["commit", "--no-edit"]);
        expect(calls.some(([command]) => command === "push")).toBe(false);
    });

    test.each([
        ["legacy format", JSON.stringify(["src/a.ts"])],
        ["invalid JSON", "not json"],
        ["changed HEAD", stateFixture({ head: "different-commit" })],
        ["changed MERGE_HEAD", stateFixture({ mergeHead: "different-commit" })],
    ])("rejects resolution state with %s", async (_description, raw) => {
        const { runGit, calls } = createRunner();
        const result = await completeMergeConflictResolution({
            cwd: ROOT,
            runGit,
            ...resolutionState,
            readFile: () => raw,
        });
        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "missingResolutionState",
            mayHaveSideEffects: true,
        });
        expect(calls.some(([command]) => command === "commit")).toBe(false);
    });

    test("surfaces a state-read failure instead of silently proceeding", async () => {
        const { runGit, calls } = createRunner();
        const result = await completeMergeConflictResolution({
            cwd: ROOT,
            runGit,
            ...resolutionState,
            readFile: () => {
                throw new Error("EACCES");
            },
        });
        expect(result).toMatchObject({
            status: "blocked",
            errorCode: "missingResolutionState",
            mayHaveSideEffects: true,
        });
        expect(result).toMatchObject({
            message: expect.stringContaining("EACCES"),
        });
        expect(calls.some(([command]) => command === "commit")).toBe(false);
    });

    test("cancellation after index checks prevents committing or removing state", async () => {
        const controller = new AbortController();
        const { runGit, calls } = createRunner();
        let removed = false;
        await expect(
            completeMergeConflictResolution({
                cwd: ROOT,
                runGit: async (args, cwd, signal) => {
                    const result = await runGit(args, cwd, signal);
                    if (key(args) === key(["diff", "--cached", "--check"])) {
                        controller.abort();
                    }
                    return result;
                },
                ...resolutionState,
                removeFile: () => {
                    removed = true;
                },
                signal: controller.signal,
            }),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(calls.some(([command]) => command === "commit")).toBe(false);
        expect(removed).toBe(false);
    });
});

describe("merge action results", () => {
    test("queues verification after Reasoning instead of relying on model completion", () => {
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
            {
                schemaName: "github-cli",
                actionName: "completeMergeConflictResolution",
                parameters: { repositoryRoot: ROOT },
            },
        ]);
        expect(
            result.additionalActions?.[0].parameters?.originalRequest,
        ).toContain(ROOT);
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
