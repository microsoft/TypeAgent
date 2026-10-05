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

// End to end: `init` writes hooks, then a real commit runs them through Git.
test("git hooks attach human-only stories without duplicate blocks", () => {
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
    fs.writeFileSync(path.join(repo, "file.txt"), "story\n");
    run("git", ["add", "file.txt"]);
    const commit = ["-c", "user.name=t", "-c", "user.email=t@t"];
    run("git", [...commit, "commit", "-m", "x"]);
    run("git", [...commit, "commit", "--amend", "--allow-empty", "--no-edit"]);
    const message = run("git", ["log", "-1", "--format=%B"]);
    expect(message.match(/~~~story v2/g)).toHaveLength(1);
    expect(message).toContain('"humanOnly":["file.txt"]');
});

// `init` registers each capture hook, and each command answers `{}`.
test("Copilot capture hooks are registered and answer {}", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "git-story-"));
    // Isolate from the user's git config (e.g. a global core.hooksPath).
    const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: path.join(repo, "gitconfig"),
        GIT_CONFIG_NOSYSTEM: "1",
    };
    spawnSync("git", ["init", "-q"], { cwd: repo, env });
    expect(spawnSync("node", [CLI, "init"], { cwd: repo, env }).status).toBe(0);
    const settings = JSON.parse(
        fs.readFileSync(
            path.join(repo, ".github/copilot/settings.local.json"),
            "utf8",
        ),
    );
    const payload = JSON.stringify({
        sessionId: "s1",
        timestamp: 0,
        cwd: repo,
    });
    for (const [hook, command] of [
        ["userPromptSubmitted", "user-prompt-submitted"],
        ["sessionStart", "session-start"],
        ["preToolUse", "pre-tool-use"],
        ["postToolUse", "post-tool-use"],
        ["postToolUseFailure", "post-tool-use-failure"],
        ["agentStop", "agent-stop"],
        ["sessionEnd", "session-end"],
    ]) {
        expect(settings.hooks[hook][0].bash).toBe(
            `git story hooks copilot ${command}`,
        );
        const r = spawnSync("node", [CLI, "hooks", "copilot", command], {
            cwd: repo,
            input: payload,
            encoding: "utf8",
        });
        expect(r.stdout).toBe("{}\n");
    }
});
