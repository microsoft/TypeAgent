// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    completeMergeConflictResolution,
    mergeAndCommit,
} from "../src/mergeConflict.js";

describe("merge conflict resolution with real Git", () => {
    let repository: string;
    const file = "source file.ts";
    const git = (...args: string[]) =>
        execFileSync("git", args, {
            cwd: repository,
            encoding: "utf8",
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        }).trim();

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
});
