// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Context } from "hono";

const execFileAsync = promisify(execFile);

// Abbreviated or full SHA-1/SHA-256 hex. Rejects refs and options like "--all".
const HASH_PATTERN = /^[0-9a-f]{4,64}$/i;

export type StoryCommit = {
    hash: string;
    subject: string;
};

// GET /api/story/commits/{hash}?project=<absolute path>: the commit's story.
// No story capture exists yet, so this returns the resolved commit.
// `project` is any directory inside a git work tree, e.g. /Users/me/repo or
// C:\Users\me\repo. It must be absolute: the daemon has no meaningful cwd.
// Example: /api/story/commits/739e112?project=%2FUsers%2Fme%2Frepo
//   -> {"hash":"739e112dd...","subject":"..."}
export const storyCommitsApiHandler = async (c: Context) => {
    const hash = c.req.param("hash") ?? "";
    const project = c.req.query("project") ?? "";
    if (
        !path.isAbsolute(project) ||
        !fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()
    ) {
        return c.json(
            { error: "project must be an absolute directory path" },
            400,
        );
    }
    if (!HASH_PATTERN.test(hash)) {
        return c.json({ error: "Invalid commit hash" }, 400);
    }
    let stdout: string;
    try {
        ({ stdout } = await execFileAsync(
            "git",
            ["show", "-s", "--format=%H%n%s", `${hash}^{commit}`],
            { cwd: project, windowsHide: true },
        ));
    } catch {
        return c.json({ error: "Commit not found" }, 404);
    }
    const [full, subject] = stdout.trimEnd().split("\n");
    const body: StoryCommit = { hash: full, subject };
    return c.json(body);
};
