// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { StoryAggregationRequest } from "../src/storyAggregator.js";

const CLI = fileURLToPath(new URL("../cli.js", import.meta.url));
const AGGREGATOR = new URL("../storyAggregator.js", import.meta.url).href;
const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function createRepository() {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "git-story-hooks-"),
    );
    directories.push(directory);
    const repo = path.join(directory, "repo");
    const bin = path.join(directory, "bin");
    const callsFile = path.join(directory, "aggregation.jsonl");
    const preload = path.join(directory, "record-aggregation.mjs");
    fs.mkdirSync(repo);
    fs.mkdirSync(bin);
    fs.writeFileSync(
        preload,
        `import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { StoryAggregator } from ${JSON.stringify(AGGREGATOR)};
StoryAggregator.prototype.aggregate = async (request) => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: request.projectPath,
        encoding: "utf8",
    }).trim();
    fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ request, head }) + "\\n");
    throw new Error("test aggregation failure");
};
`,
    );
    fs.writeFileSync(
        path.join(bin, "git-story"),
        `#!/bin/sh\nexec node --import "${pathToFileURL(preload).href}" "${CLI.replaceAll("\\", "/")}" "$@"\n`,
        { mode: 0o755 },
    );
    const env = {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        GIT_CONFIG_GLOBAL: path.join(directory, "gitconfig"),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
    };
    const run = (args: string[]) => {
        const result = spawnSync("git", args, {
            cwd: repo,
            env,
            encoding: "utf8",
            timeout: 30000,
        });
        if (result.error) throw result.error;
        if (result.status !== 0) {
            throw new Error(
                `git ${args.join(" ")} failed: ${result.stdout}${result.stderr}`,
            );
        }
        return result.stdout.trim();
    };
    run(["init", "-q", "-b", "main"]);
    run(["config", "user.name", "Git Story Test"]);
    run(["config", "user.email", "git-story@example.test"]);
    run(["config", "commit.gpgsign", "false"]);
    run(["config", "core.autocrlf", "false"]);
    run(["config", "core.hooksPath", ".git/hooks"]);
    const init = spawnSync(process.execPath, [CLI, "init"], {
        cwd: repo,
        env,
        encoding: "utf8",
    });
    expect(init.status).toBe(0);

    const clearCalls = () => fs.writeFileSync(callsFile, "");
    const calls = (): { request: StoryAggregationRequest; head: string }[] =>
        fs
            .readFileSync(callsFile, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    const expectAggregationAtHead = () => {
        const recorded = calls();
        expect(recorded.length).toBeGreaterThan(0);
        expect(recorded.at(-1)).toEqual({
            request: {
                projectPath: path.resolve(
                    run(["rev-parse", "--show-toplevel"]),
                ),
                revision: "HEAD",
            },
            head: run(["rev-parse", "HEAD"]),
        });
    };
    return {
        repo,
        run,
        clearCalls,
        calls,
        expectAggregationAtHead,
    };
}

test("branch checkout, switch, and detached checkout aggregate; file checkout does not", () => {
    const { repo, run, clearCalls, calls, expectAggregationAtHead } =
        createRepository();
    fs.writeFileSync(path.join(repo, "tracked.txt"), "initial\n");
    run(["add", "tracked.txt"]);
    run(["commit", "-q", "-m", "initial"]);
    const initial = run(["rev-parse", "HEAD"]);
    expectAggregationAtHead();
    run(["branch", "feature"]);

    for (const args of [
        ["checkout", "-q", "feature"],
        ["switch", "-q", "main"],
        ["checkout", "-q", "--detach", initial],
    ]) {
        clearCalls();
        run(args);
        expectAggregationAtHead();
    }

    clearCalls();
    fs.writeFileSync(path.join(repo, "tracked.txt"), "modified\n");
    run(["checkout", "--", "tracked.txt"]);
    expect(fs.readFileSync(path.join(repo, "tracked.txt"), "utf8")).toBe(
        "initial\n",
    );
    expect(calls()).toEqual([]);
});

test.each(["--ff-only", "--no-rebase", "--rebase"])(
    "git pull %s aggregates the resulting history without blocking on failure",
    (mode) => {
        const { repo, run, clearCalls, calls, expectAggregationAtHead } =
            createRepository();
        run(["commit", "-q", "--allow-empty", "-m", "initial"]);
        run(["checkout", "-q", "-b", "upstream"]);
        fs.writeFileSync(path.join(repo, "upstream.txt"), "upstream\n");
        run(["add", "upstream.txt"]);
        run(["commit", "-q", "-m", "upstream"]);
        const upstream = run(["rev-parse", "HEAD"]);
        run(["checkout", "-q", "main"]);
        if (mode !== "--ff-only") {
            fs.writeFileSync(path.join(repo, "local.txt"), "local\n");
            run(["add", "local.txt"]);
            run(["commit", "-q", "-m", "local"]);
        }

        clearCalls();
        run(["pull", mode, "--no-edit", ".", "upstream"]);
        expectAggregationAtHead();
        expect(run(["merge-base", "HEAD", upstream])).toBe(upstream);
        if (mode !== "--ff-only") {
            expect(fs.existsSync(path.join(repo, "local.txt"))).toBe(true);
        }

        clearCalls();
        run(["pull", mode, "--no-edit", ".", "upstream"]);
        expect(calls()).toEqual([]);
    },
);
