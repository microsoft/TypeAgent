// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RouteHandler } from "../router.js";

const execFileAsync = promisify(execFile);

// Abbreviated or full SHA-1/SHA-256 hex. Rejects refs and options like "--all".
const HASH_PATTERN = /^[0-9a-f]{4,64}$/i;

export type StoryCommit = {
    hash: string;
    subject: string;
};

// GET /api/story/commits/{hash}: the commit's story. No story capture exists
// yet, so this returns the resolved commit.
// Example: /api/story/commits/739e112 -> {"hash":"739e112dd...","subject":"..."}
export const storyCommitsApiHandler: RouteHandler = async ({ hash }) => {
    if (!HASH_PATTERN.test(hash)) {
        return { status: 400, body: { error: `Invalid commit hash: ${hash}` } };
    }
    let stdout: string;
    try {
        ({ stdout } = await execFileAsync("git", [
            "show",
            "-s",
            "--format=%H%n%s",
            `${hash}^{commit}`,
        ]));
    } catch {
        return { status: 404, body: { error: `Commit not found: ${hash}` } };
    }
    const [full, subject] = stdout.trimEnd().split("\n");
    const body: StoryCommit = { hash: full, subject };
    return { status: 200, body };
};
