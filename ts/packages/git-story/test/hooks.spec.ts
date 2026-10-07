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
        GIT_STORY_STATE_DIR: path.join(dir, "state"),
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
    expect(out).toContain("git-story pre-commit: received 0 arguments");
    // prepare-commit-msg appends the trailer once, even on amend.
    run("git", [...commit, "commit", "--amend", "--allow-empty", "--no-edit"]);
    expect(run("git", ["log", "-1", "--format=%B"])).toBe("x\n\ntypeagent\n\n");

    const hook = path.join(repo, ".git/hooks/pre-commit");
    const direct = run("sh", [hook, "a"], "piped\n");
    expect(direct).toContain("received 1 arguments");
    expect(direct).not.toContain("piped");
    fs.rmSync(dir, { recursive: true, force: true });
});

// `init` registers each Copilot hook, and each command answers `{}`.
test("Copilot session and prompt hooks are registered and answer {}", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "git-story-"));
    // Isolate from the user's git config (e.g. a global core.hooksPath).
    const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: path.join(repo, "gitconfig"),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_STORY_STATE_DIR: path.join(repo, "state"),
    };
    spawnSync("git", ["init", "-q"], { cwd: repo, env });
    const vscodePath = path.join(repo, ".github", "hooks", "git-story.json");
    fs.mkdirSync(path.dirname(vscodePath), { recursive: true });
    const userEntry = { type: "command", command: "user-owned" };
    fs.writeFileSync(
        vscodePath,
        JSON.stringify({
            userSetting: "preserved",
            hooks: { SessionStart: [userEntry] },
        }),
    );
    expect(spawnSync("node", [CLI, "init"], { cwd: repo, env }).status).toBe(0);
    expect(spawnSync("node", [CLI, "init"], { cwd: repo, env }).status).toBe(0);
    const vscode = JSON.parse(fs.readFileSync(vscodePath, "utf8"));
    expect(vscode.userSetting).toBe("preserved");
    expect(vscode.hooks.SessionStart).toEqual([
        userEntry,
        { type: "command", command: "git story hooks vscode session-start" },
    ]);
    expect(
        fs.readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8"),
    ).toContain(".github/hooks/git-story.json");
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
        ["agentStop", "agent-stop"],
    ]) {
        expect(settings.hooks[hook][0].bash).toBe(
            `git story hooks copilot ${command}`,
        );
        const r = spawnSync("node", [CLI, "hooks", "copilot", command], {
            cwd: repo,
            input: payload,
            encoding: "utf8",
            env,
        });
        expect(r.stdout).toBe("{}\n");
        expect(r.status).toBe(0);
    }
    for (const input of [
        "{",
        JSON.stringify({
            hook_event_name: "SessionStart",
            session_id: "../escape",
        }),
    ]) {
        const result = spawnSync(
            "node",
            [CLI, "hooks", "vscode", "session-start"],
            {
                cwd: repo,
                env,
                input,
                encoding: "utf8",
            },
        );
        expect(result.status).toBe(0);
        expect(result.stdout).toBe("{}\n");
        expect(result.stderr).toContain("invalid input ignored");
    }
    fs.rmSync(repo, { recursive: true, force: true });
});
