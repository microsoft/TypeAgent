// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../cli.js",
);

test("sync indexes each story commit once", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "story-memory-"));
    const env = {
        ...process.env,
        TYPEAGENT_CONFIG_DIR: path.join(repo, "config"),
        TYPEAGENT_EMBEDDING_PROVIDER: "none",
        AZURE_OPENAI_ENDPOINT: "https://example.invalid",
        AZURE_OPENAI_API_KEY: "test",
        GIT_CONFIG_GLOBAL: "/dev/null",
    };
    const run = (command: string, args: string[]) =>
        execFileSync(command, args, { cwd: repo, env, encoding: "utf8" });
    run("git", ["init", "-q"]);
    run("git", ["config", "user.name", "t"]);
    run("git", ["config", "user.email", "t@t"]);
    const story =
        '{"version":2,"sessions":[{"session":"copilot-cli/s1","turns":1,"files":[],"commands":[],"uncommitted":[],"snippets":[]}],"humanOnly":["file.txt"]}';
    const message = `story\n\n~~~story v2\n${story}\n~~~\n\nStory-Session: copilot-cli/s1`;
    run("git", ["commit", "--allow-empty", "-qm", message]);
    expect(run("node", [CLI, "memory", "sync"])).toContain(
        "Indexed 1 commit story; skipped 0.",
    );
    expect(run("node", [CLI, "memory", "sync"])).toContain(
        "Indexed 0 commit stories; skipped 1.",
    );
    const data = fs.readFileSync(
        path.join(repo, ".git/story/memory/commit-stories_data.json"),
        "utf8",
    );
    expect(data).toContain("session:copilot-cli/s1");
});
