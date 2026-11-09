// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
    ActionContext,
    ActionIO,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import type { GithubCliActions } from "../src/github-cliSchema.js";
import { instantiate } from "../src/github-cliActionHandler.js";
import {
    completeMergeConflictResolution,
    mergeAndCommit,
} from "../src/mergeConflict.js";

function gitAt(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function executeMergeAction(
    action: TypeAgentAction<GithubCliActions>,
    workingDirectory?: string,
    abortSignal?: AbortSignal,
) {
    const context: ActionContext<unknown> = {
        get actionIO(): ActionIO {
            throw new Error(
                "Merge actions should return their display content",
            );
        },
        get sessionContext(): SessionContext<unknown> {
            throw new Error(
                "Merge actions should not require agent session state",
            );
        },
        activityContext: undefined,
        isFromReasoningLoop: false,
        queueToggleTransientAgent: async () => {},
        streamingContext: undefined,
        workingDirectory,
        abortSignal,
    };
    return instantiate().executeAction!(action, context);
}

describe("merge conflict resolution with real Git", () => {
    let repository: string;
    const file = "source file.ts";
    const git = (...args: string[]) => gitAt(repository, ...args);

    beforeEach(() => {
        repository = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-merge-test-"),
        );
        git("init", "-b", "main");
        git("config", "user.name", "Merge test");
        git("config", "user.email", "merge-test@example.invalid");
        git("config", "commit.gpgsign", "false");
        git("config", "core.autocrlf", "false");
        git("config", "core.hooksPath", path.join(repository, "no-hooks"));
        fs.writeFileSync(
            path.join(repository, file),
            "export const base = 1;\n",
        );
        git("add", "--", file);
        git("commit", "-m", "base");
        git("checkout", "-b", "feature");
        fs.writeFileSync(
            path.join(repository, file),
            "export const ours = 1;\n",
        );
        git("add", "--", file);
        git("commit", "-m", "feature change");
        git("checkout", "main");
        fs.writeFileSync(
            path.join(repository, file),
            "export const theirs = 1;\n",
        );
        git("add", "--", file);
        git("commit", "-m", "main change");
        git("checkout", "feature");
        git("remote", "add", "origin", repository);
    });

    afterEach(() => {
        fs.rmSync(repository, { recursive: true, force: true });
    });

    test("leaves an incomplete resolution blocked, then verifies and commits both parents", async () => {
        const before = git("rev-parse", "HEAD");
        const target = git("rev-parse", "main");
        const merged = await mergeAndCommit("main", { cwd: repository });
        expect(merged).toMatchObject({
            status: "conflicts",
            conflicts: [file],
        });
        expect(git("rev-parse", "HEAD")).toBe(before);

        // A model returning without editing must not count as completion.
        expect(
            await completeMergeConflictResolution({ cwd: repository }),
        ).toMatchObject({
            status: "blocked",
            errorCode: "unresolvedConflicts",
        });
        expect(git("rev-parse", "HEAD")).toBe(before);

        fs.writeFileSync(
            path.join(repository, file),
            "export const ours = 1;\nexport const theirs = 1;\n",
        );
        git("add", "--", file);
        const completed = await completeMergeConflictResolution({
            cwd: repository,
        });
        expect(completed).toMatchObject({ status: "committed" });
        expect(git("show", "-s", "--format=%P", "HEAD").split(" ")).toEqual([
            before,
            target,
        ]);
        expect(git("status", "--porcelain")).toBe("");
        expect(fs.existsSync(path.join(repository, ".git", "MERGE_HEAD"))).toBe(
            false,
        );
        expect(
            fs.existsSync(
                path.join(repository, ".git", "TYPEAGENT_MERGE_CONFLICTS"),
            ),
        ).toBe(false);
    });

    test("rejects staged conflict markers even when Git considers the path resolved", async () => {
        const before = git("rev-parse", "HEAD");
        await mergeAndCommit("main", { cwd: repository });
        git("add", "--", file);
        expect(git("diff", "--name-only", "--diff-filter=U")).toBe("");
        expect(
            await completeMergeConflictResolution({ cwd: repository }),
        ).toMatchObject({
            status: "blocked",
            errorCode: "conflictMarkers",
        });
        expect(git("rev-parse", "HEAD")).toBe(before);
    });

    test("allows an auto-merged rename plus a separate conflict resolution", async () => {
        // Git applies main's edit through the feature branch's rename.
        const renamed = "src/renamed.ts";
        const original = "src/original.ts";
        const conflictFile = "src/conflict.txt";

        git("checkout", "main");
        fs.mkdirSync(path.join(repository, "src"), { recursive: true });
        fs.writeFileSync(
            path.join(repository, original),
            "export const value = 1;\n",
        );
        fs.writeFileSync(path.join(repository, conflictFile), "shared line\n");
        git("add", "--", original, conflictFile);
        git("commit", "-m", "add rename base");

        git("checkout", "-b", "rename-feature");
        fs.renameSync(
            path.join(repository, original),
            path.join(repository, renamed),
        );
        fs.writeFileSync(path.join(repository, conflictFile), "feature line\n");
        git("add", "--all");
        git("commit", "-m", "feature rename");

        git("checkout", "main");
        fs.writeFileSync(
            path.join(repository, original),
            "export const value = 2;\n",
        );
        fs.writeFileSync(path.join(repository, conflictFile), "main line\n");
        git("add", "--", original, conflictFile);
        git("commit", "-m", "main change");

        git("checkout", "rename-feature");
        const before = git("rev-parse", "HEAD");

        const started = await mergeAndCommit("main", { cwd: repository });
        expect(started).toMatchObject({
            status: "conflicts",
            conflicts: [conflictFile],
        });
        expect(
            git("diff", "--cached", "--name-only", "HEAD").split("\n"),
        ).toContain(renamed);

        fs.writeFileSync(
            path.join(repository, conflictFile),
            "feature line\nmain line\n",
        );
        git("add", "--", conflictFile);

        const completed = await completeMergeConflictResolution({
            cwd: repository,
        });
        expect(completed).toMatchObject({ status: "committed" });
        expect(git("status", "--porcelain")).toBe("");
        expect(git("rev-parse", "HEAD")).not.toBe(before);
        expect(fs.existsSync(path.join(repository, ".git", "MERGE_HEAD"))).toBe(
            false,
        );
        expect(
            fs.existsSync(
                path.join(repository, ".git", "TYPEAGENT_MERGE_CONFLICTS"),
            ),
        ).toBe(false);
    });

    test("both actions honor the request repository rather than the server cwd or action parameter", async () => {
        const request = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-merge-request-"),
        );
        const originalCwd = process.cwd();
        const serverHead = git("rev-parse", "HEAD");
        const requestGit = (...args: string[]) => gitAt(request, ...args);
        try {
            git("clone", "--quiet", repository, request);
            requestGit("config", "user.name", "Merge test");
            requestGit("config", "user.email", "merge-test@example.invalid");
            requestGit("config", "commit.gpgsign", "false");
            requestGit(
                "config",
                "core.hooksPath",
                path.join(request, "no-hooks"),
            );
            process.chdir(repository);
            expect(
                await executeMergeAction(
                    {
                        schemaName: "github-cli",
                        actionName: "resolveMergeConflicts",
                        parameters: { targetBranch: "main" },
                    },
                    request,
                ),
            ).toMatchObject({ resultValue: { status: "conflicts" } });

            fs.writeFileSync(
                path.join(request, file),
                "export const resolved = 1;\n",
            );
            requestGit("add", "--", file);
            expect(
                await executeMergeAction(
                    {
                        schemaName: "github-cli",
                        actionName: "completeMergeConflictResolution",
                        parameters: { repositoryRoot: repository },
                    },
                    request,
                ),
            ).toMatchObject({ resultValue: { status: "committed" } });
            expect(
                requestGit("show", "-s", "--format=%P", "HEAD").split(" "),
            ).toEqual([serverHead, git("rev-parse", "main")]);
            expect(requestGit("status", "--porcelain")).toBe("");
            expect(git("rev-parse", "HEAD")).toBe(serverHead);
            expect(git("status", "--porcelain")).toBe("");
            expect(
                fs.existsSync(path.join(repository, ".git", "MERGE_HEAD")),
            ).toBe(false);
        } finally {
            process.chdir(originalCwd);
            fs.rmSync(request, { recursive: true, force: true });
        }
    });

    test.each([
        {
            actionName: "resolveMergeConflicts",
            parameters: { targetBranch: "main" },
        },
        {
            actionName: "completeMergeConflictResolution",
            parameters: { repositoryRoot: "not-authorized" },
        },
    ] as const)(
        "$actionName rejects missing request context and propagates cancellation",
        async (action) => {
            const requestAction = { ...action, schemaName: "github-cli" };
            expect(await executeMergeAction(requestAction)).toMatchObject({
                errorCode: "notRepository",
            });
            const controller = new AbortController();
            controller.abort();
            await expect(
                executeMergeAction(
                    requestAction,
                    repository,
                    controller.signal,
                ),
            ).rejects.toMatchObject({ name: "AbortError" });
            expect(git("status", "--porcelain")).toBe("");
            expect(
                fs.existsSync(path.join(repository, ".git", "MERGE_HEAD")),
            ).toBe(false);
        },
    );
});
