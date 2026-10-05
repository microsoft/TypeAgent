// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JsonlSessionStore } from "../src/sessionStore.js";
import { linkSessions } from "../src/storyBuilder.js";
const git = (repo: string, ...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], {
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
    }).trim();

test("attributes exact and modified staged files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "story-v2-"));
    git(root, "init", "-q");
    git(root, "config", "user.email", "a@b");
    git(root, "config", "user.name", "t");
    git(root, "commit", "--allow-empty", "-qm", "base");
    const store = new JsonlSessionStore(path.join(root, ".git"));
    writeFileSync(path.join(root, "file.txt"), "agent\n");
    const blob = git(root, "hash-object", "-w", "file.txt");
    store.append({
        kind: "edit",
        session: "copilot-cli/a",
        turn: 1,
        at: "2026-09-26T00:00:00Z",
        path: "file.txt",
        blob,
    });
    git(root, "add", "file.txt");
    const staged = [{ path: "file.txt", blob, kind: "edit" as const }];
    expect(
        linkSessions(root, store, staged).sessions[0].files[0],
    ).toMatchObject({
        attribution: "agent",
    });
    writeFileSync(path.join(root, "file.txt"), "agent\nhuman\n");
    git(root, "add", "file.txt");
    staged[0].blob = git(root, "rev-parse", ":file.txt");
    expect(
        linkSessions(root, store, staged).sessions[0].files[0],
    ).toMatchObject({
        attribution: "modified",
        lines: { kept: 1 },
    });
});
