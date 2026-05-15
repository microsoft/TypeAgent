// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Result of running a git command.
 */
export interface GitResult {
    stdout: string;
    stderr: string;
    code: number;
}

/**
 * Function shape for running git commands. Defaulted to spawning the
 * real `git` binary; tests can substitute a fake.
 */
export type GitRunner = (
    args: readonly string[],
    cwd: string,
) => Promise<GitResult>;

/**
 * Default git runner: invokes the `git` executable on PATH.
 */
export const realGit: GitRunner = (args, cwd) =>
    new Promise<GitResult>((resolve, reject) => {
        const child = spawn("git", args, {
            cwd,
            shell: false,
            windowsHide: true,
        });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        child.stdout.on("data", (c) => stdoutChunks.push(c as Buffer));
        child.stderr.on("data", (c) => stderrChunks.push(c as Buffer));
        child.on("error", reject);
        child.on("close", (code) => {
            resolve({
                stdout: Buffer.concat(stdoutChunks).toString("utf8"),
                stderr: Buffer.concat(stderrChunks).toString("utf8"),
                code: code ?? -1,
            });
        });
    });

function trim(s: string): string {
    return s.replace(/\r?\n$/u, "");
}

/**
 * Thin, focused git wrapper for the operations docs-autogen needs.
 *
 * All methods return `null` (rather than throwing) for the well-known
 * "not present" cases: missing ref, missing tag, no merge-base, etc.
 * Underlying git failures still surface as thrown errors.
 */
export class Git {
    constructor(
        public readonly cwd: string,
        private readonly runner: GitRunner = realGit,
    ) {}

    private async run(args: readonly string[]): Promise<GitResult> {
        return this.runner(args, this.cwd);
    }

    private async runOk(args: readonly string[]): Promise<string> {
        const r = await this.run(args);
        if (r.code !== 0) {
            throw new Error(
                `git ${args.join(" ")} failed (${r.code}): ${r.stderr.trim()}`,
            );
        }
        return trim(r.stdout);
    }

    /**
     * Resolve a ref (branch, tag, sha-ish) to a full SHA. Returns null
     * when the ref does not exist.
     */
    async revParse(ref: string): Promise<string | null> {
        const r = await this.run(["rev-parse", "--verify", "--quiet", ref]);
        if (r.code !== 0) return null;
        const out = trim(r.stdout);
        return out.length > 0 ? out : null;
    }

    /** Returns the SHA of HEAD. */
    async headSha(): Promise<string> {
        return this.runOk(["rev-parse", "HEAD"]);
    }

    /**
     * Returns the current branch name, or null when in detached HEAD.
     */
    async currentBranch(): Promise<string | null> {
        const r = await this.run([
            "symbolic-ref",
            "--quiet",
            "--short",
            "HEAD",
        ]);
        if (r.code !== 0) return null;
        const name = trim(r.stdout);
        return name.length > 0 ? name : null;
    }

    /**
     * Returns the merge-base SHA of two refs, or null if there is no
     * common ancestor (or either ref is missing).
     */
    async mergeBase(a: string, b: string): Promise<string | null> {
        const r = await this.run(["merge-base", a, b]);
        if (r.code !== 0) return null;
        const out = trim(r.stdout);
        return out.length > 0 ? out : null;
    }

    /**
     * Returns the path-relative repository root (the output of
     * `git rev-parse --show-toplevel`).
     */
    async repoRoot(): Promise<string> {
        const out = await this.runOk(["rev-parse", "--show-toplevel"]);
        return path.resolve(out);
    }

    /**
     * Files changed between two refs (or between a ref and the working
     * tree if `to` is omitted). Returns paths POSIX-style, repo-rooted.
     */
    async diffNameOnly(
        from: string,
        to: string | null = null,
    ): Promise<string[]> {
        const args =
            to === null
                ? ["diff", "--name-only", from]
                : ["diff", "--name-only", `${from}..${to}`];
        const out = await this.runOk(args);
        return parseLines(out);
    }

    /**
     * Files staged or unstaged in the working tree (excludes untracked
     * unless `includeUntracked` is true).
     */
    async statusFiles(includeUntracked = false): Promise<string[]> {
        const args = ["status", "--porcelain"];
        const out = await this.runOk(args);
        const files: string[] = [];
        for (const raw of out.split("\n")) {
            if (raw.length === 0) continue;
            const code = raw.slice(0, 2);
            const filePart = raw.slice(3).trim();
            if (!includeUntracked && code === "??") continue;
            files.push(filePart);
        }
        return files;
    }

    /** True iff the named tag exists locally. */
    async tagExists(tag: string): Promise<boolean> {
        const r = await this.run([
            "rev-parse",
            "--verify",
            "--quiet",
            `refs/tags/${tag}`,
        ]);
        return r.code === 0;
    }

    /**
     * Create or move a lightweight tag to `sha`. Returns true on
     * success.
     */
    async setTag(tag: string, sha: string): Promise<boolean> {
        const r = await this.run(["tag", "-f", tag, sha]);
        return r.code === 0;
    }

    /**
     * Push a tag to a remote. `force` corresponds to `+refs/tags/...`
     * to overwrite an existing remote tag.
     */
    async pushTag(remote: string, tag: string, force = false): Promise<void> {
        const refspec = force
            ? `+refs/tags/${tag}:refs/tags/${tag}`
            : `refs/tags/${tag}:refs/tags/${tag}`;
        await this.runOk(["push", remote, refspec]);
    }
}

function parseLines(s: string): string[] {
    return s
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}
