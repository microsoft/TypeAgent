// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateStoriesAfterGitChange } from "../src/commands/hooks.js";
import type {
    StoryAggregationRequest,
    StoryAggregationResult,
} from "../src/storyAggregator.js";

const CLI = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../cli.js",
);

// End to end: `init` writes the hooks, then a real `git commit` runs them
// through git's own sh (Git Bash on Windows). An extensionless sh shim puts
// `git-story` on PATH, same as `npm link` does on every OS.
test("git hooks are installed and forward to git-story", () => {
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

    for (const hook of [
        "pre-commit",
        "prepare-commit-msg",
        "post-commit",
        "post-merge",
        "post-rewrite",
        "post-checkout",
    ]) {
        expect(
            fs.readFileSync(path.join(repo, ".git/hooks", hook), "utf8"),
        ).toContain(`git-story hooks git ${hook}`);
    }

    const stdin = path.join(dir, "hook-stdin.txt");
    fs.writeFileSync(stdin, "piped\n");
    const direct = run(
        "git",
        ["hook", "run", `--to-stdin=${stdin}`, "pre-commit", "--", "a"],
        "piped\n",
    );
    expect(direct).toContain("received 1 arguments");
    expect(direct).not.toContain("piped");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("post-git hook aggregation targets HEAD and does not block git", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-story-"));
    spawnSync("git", ["init", "-q"], { cwd: dir });
    const expectedRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: dir,
        encoding: "utf8",
    }).stdout.trim();
    const requests: StoryAggregationRequest[] = [];
    const result: StoryAggregationResult = {
        resolvedRevision: "abc123",
        scannedCommits: 1,
        commitsWithoutStory: 0,
        commitsWithMalformedStory: 0,
        commitsWithUnsupportedStory: 0,
        acceptedStories: 1,
        retiredStories: 0,
    };
    await aggregateStoriesAfterGitChange("post-commit", dir, {
        aggregate: async (request) => {
            requests.push(request);
            return result;
        },
    });
    expect(requests).toEqual([
        {
            projectPath: path.resolve(expectedRoot),
            revision: "HEAD",
        },
    ]);

    await expect(
        aggregateStoriesAfterGitChange("post-merge", dir, {
            aggregate: async () => {
                throw new Error("not implemented");
            },
        }),
    ).resolves.toBeUndefined();
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
    const oversizedPayload = JSON.stringify({
        sessionId: "s1",
        timestamp: 0,
        cwd: repo,
        padding: "x".repeat(64 * 1024),
    });
    expect(Buffer.byteLength(oversizedPayload)).toBeGreaterThan(64 * 1024);
    const oversized = spawnSync(
        "node",
        [CLI, "hooks", "copilot", "user-prompt-submitted"],
        {
            cwd: repo,
            env,
            input: oversizedPayload,
            encoding: "utf8",
        },
    );
    expect(oversized.status).toBe(0);
    expect(oversized.stdout).toBe("{}\n");
    expect(oversized.stderr).toContain("invalid input ignored");
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
