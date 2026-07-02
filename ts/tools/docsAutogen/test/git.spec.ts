// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Git, type GitResult, type GitRunner } from "../src/git.js";

function recordingRunner(
    impl: (args: readonly string[]) => GitResult = () => ({
        stdout: "",
        stderr: "",
        code: 0,
    }),
): { runner: GitRunner; calls: string[][] } {
    const calls: string[][] = [];
    const runner: GitRunner = async (args) => {
        calls.push([...args]);
        return impl(args);
    };
    return { runner, calls };
}

describe("Git arg validation (CodeQL second-order command-injection)", () => {
    it("rejects a ref starting with '-' in revParse", async () => {
        const { runner } = recordingRunner();
        const git = new Git("/repo", runner);
        await expect(git.revParse("--upload-pack=evil")).rejects.toThrow(
            /must not start with '-'/u,
        );
    });
    it("rejects a ref containing whitespace in mergeBase", async () => {
        const { runner } = recordingRunner();
        const git = new Git("/repo", runner);
        await expect(git.mergeBase("HEAD", "origin/main bad")).rejects.toThrow(
            /must not contain whitespace/u,
        );
    });
    it("rejects an empty ref in diffNameOnly", async () => {
        const { runner } = recordingRunner();
        const git = new Git("/repo", runner);
        await expect(git.diffNameOnly("")).rejects.toThrow(
            /must be a non-empty string/u,
        );
    });
    it("rejects a tag starting with '-' in setTag", async () => {
        const { runner } = recordingRunner();
        const git = new Git("/repo", runner);
        await expect(git.setTag("--malicious", "deadbeef")).rejects.toThrow(
            /must not start with '-'/u,
        );
    });
    it("rejects a sha containing a NUL byte in setTag", async () => {
        const { runner } = recordingRunner();
        const git = new Git("/repo", runner);
        await expect(git.setTag("good-tag", "dead\0beef")).rejects.toThrow(
            /control character/u,
        );
    });
    it("rejects a remote starting with '-' in pushTag", async () => {
        const { runner } = recordingRunner();
        const git = new Git("/repo", runner);
        await expect(git.pushTag("-evil", "good-tag")).rejects.toThrow(
            /must not start with '-'/u,
        );
    });
});

describe("Git arg shape", () => {
    it("emits --end-of-options before the ref in revParse", async () => {
        const { runner, calls } = recordingRunner(() => ({
            stdout: "deadbeef\n",
            stderr: "",
            code: 0,
        }));
        const git = new Git("/repo", runner);
        await git.revParse("HEAD");
        expect(calls[0]).toContain("--end-of-options");
        expect(calls[0]?.indexOf("--end-of-options")).toBeLessThan(
            calls[0]!.indexOf("HEAD"),
        );
    });
    it("emits --end-of-options before the refs in mergeBase", async () => {
        const { runner, calls } = recordingRunner(() => ({
            stdout: "ancestor\n",
            stderr: "",
            code: 0,
        }));
        const git = new Git("/repo", runner);
        await git.mergeBase("HEAD", "origin/main");
        expect(calls[0]).toEqual([
            "merge-base",
            "--end-of-options",
            "HEAD",
            "origin/main",
        ]);
    });
    // Regression: change detection maps changed files to packages by their
    // relDir, which is relative to the monorepo root (the git cwd). git prints
    // paths relative to the repo root by default, so when the monorepo root is
    // a subdirectory (TypeAgent under `ts/`) the paths carry a `ts/` prefix and
    // match nothing — the `--since` run silently selects zero packages. The
    // `--relative` flag makes git speak the same coordinate system.
    it("passes --relative in diffNameOnly (paths relative to cwd, not repo root)", async () => {
        const { runner, calls } = recordingRunner(() => ({
            stdout: "packages/cache/src/cache.ts\n",
            stderr: "",
            code: 0,
        }));
        const git = new Git("/repo/ts", runner);
        await git.diffNameOnly("base-sha", "head-sha");
        expect(calls[0]).toEqual([
            "diff",
            "--name-only",
            "--relative",
            "base-sha..head-sha",
            "--",
        ]);
    });
    it("builds a single-ref diffNameOnly refspec with --relative", async () => {
        const { runner, calls } = recordingRunner(() => ({
            stdout: "",
            stderr: "",
            code: 0,
        }));
        const git = new Git("/repo/ts", runner);
        await git.diffNameOnly("HEAD");
        expect(calls[0]).toEqual([
            "diff",
            "--name-only",
            "--relative",
            "HEAD",
            "--",
        ]);
    });
});
