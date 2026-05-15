// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs/promises";
import path from "node:path";
import type { ExtractedLink } from "./linkExtraction.js";

/**
 * Result of validating a single link against the filesystem.
 */
export interface ValidatedLink {
    readonly link: ExtractedLink;
    /** Absolute path the link resolves to. */
    readonly resolved: string;
    /** True when the resolved path exists on disk. */
    readonly exists: boolean;
}

/**
 * Aggregate result for a batch of links.
 */
export interface LinkValidationResult {
    readonly all: ValidatedLink[];
    readonly broken: ValidatedLink[];
}

/**
 * Validate that every link in `links` (extracted from a markdown
 * document at `sourceFile`) resolves to a path that exists on disk.
 *
 * The fragment portion of a link (`./foo.ts#bar`) is dropped before
 * existence-checking; we cannot verify in-document anchors against
 * the filesystem.
 */
export async function validateLinks(
    links: readonly ExtractedLink[],
    sourceFile: string,
): Promise<LinkValidationResult> {
    const sourceDir = path.dirname(path.resolve(sourceFile));
    const all: ValidatedLink[] = [];
    for (const link of links) {
        const targetWithoutFragment = link.target.split("#")[0] ?? "";
        const resolved = path.resolve(sourceDir, targetWithoutFragment);
        const exists = await fileExists(resolved);
        all.push({ link, resolved, exists });
    }
    return { all, broken: all.filter((v) => !v.exists) };
}

async function fileExists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}
