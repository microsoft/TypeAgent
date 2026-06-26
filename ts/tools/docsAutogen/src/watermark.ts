// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Git } from "./git.js";

/**
 * Conventional name of the lightweight tag that records the SHA of
 * the most recent docs-autogen run.
 *
 * The `azure-docs-generate` Azure DevOps pipeline advances this tag at
 * the end of every non-dry-run run (and seeds it on the first run), so
 * each run diffs against the commit the previous run was based on.
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
 * The caller is responsible for pushing the tag. The
 * `azure-docs-generate` pipeline advances + pushes the tag directly via
 * git after a successful non-dry-run run; these helpers exist for
 * local/tooling use.
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
