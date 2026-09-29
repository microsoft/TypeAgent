// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../cli.js",
);

// End to end: `init` writes the hook, then a real `git commit` runs it
// through git's own sh (Git Bash on Windows). An extensionless sh shim puts
// `git-story` on PATH, same as `npm link` does on every OS.
test("pre-commit hook forwards args and stdin to git-story", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-story-"));
    const bin = path.join(dir, "bin");
    const repo = path.join(dir, "repo");
    fs.mkdirSync(bin);
    const cli = CLI.replace(/\\/g, "/");
    fs.writeFileSync(
        path.join(bin, "git-story"),
        `#!/bin/sh\nexec node "${cli}" "$@"\n`,
        { mode: 0o755 },
    );
    const env = {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        GIT_CONFIG_GLOBAL: path.join(dir, "gitconfig"),
        GIT_CONFIG_NOSYSTEM: "1",
    };
    // Returns stdout + stderr; git sends hook output to stderr.
    const run = (cmd: string, args: string[], input = "") => {
        const r = spawnSync(cmd, args, {
            cwd: repo,
            env,
            input,
            encoding: "utf8",
        });
        expect(r.status).toBe(0);
        return r.stdout + r.stderr;
    };
    fs.mkdirSync(repo);
    run("git", ["init", "-q"]);
    run("node", [CLI, "init"]);
    const commit = ["-c", "user.name=t", "-c", "user.email=t@t"];
    const out = run("git", [...commit, "commit", "--allow-empty", "-m", "x"]);
    expect(out).toContain('git-story pre-commit: args=[] stdin=""');

    const hook = path.join(repo, ".git/hooks/pre-commit");
    const direct = run("sh", [hook, "a"], "piped\n");
    expect(direct).toContain('args=["a"] stdin="piped\\n"');
});
