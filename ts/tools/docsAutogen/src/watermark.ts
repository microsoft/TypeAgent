// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Git } from "./git.js";

/**
 * Conventional name of the lightweight tag that can record the SHA a
 * docs-autogen run was generated against.
 *
 * This is an optional `--since` fallback for local / standalone CLI runs.
 * The shipped GitHub Actions workflow (.github/workflows/docs-generate.yml)
 * does NOT use or advance it — it diffs against the last README.AUTOGEN.md
 * commit instead.
 */
export const WATERMARK_TAG = "docs-bot/last-run";

/**
 * Read the watermark SHA from the `docs-bot/last-run` tag. Returns
 * null when the tag does not exist (e.g. the very first run).
 */
export async function readWatermark(git: Git): Promise<string | null> {
    if (!(await git.tagExists(WATERMARK_TAG))) {
        return null;
    }
    return git.revParse(`refs/tags/${WATERMARK_TAG}`);
}

/**
 * Move (or create) the watermark tag to point at `sha` locally.
 * The caller is responsible for pushing the tag. Provided for local /
 * tooling use; the shipped CI workflow does not advance the watermark.
 */
export async function writeWatermark(git: Git, sha: string): Promise<void> {
    const ok = await git.setTag(WATERMARK_TAG, sha);
    if (!ok) {
        throw new Error(`Failed to set watermark tag ${WATERMARK_TAG}=${sha}`);
    }
}

/**
 * Push the watermark tag to a remote. Force-pushed because each run
 * advances the tag forward.
 */
export async function pushWatermark(git: Git, remote: string): Promise<void> {
    await git.pushTag(remote, WATERMARK_TAG, true);
}
