// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import path from "node:path";
import { findAutogenRegion } from "./autogenRegion.js";

/**
 * Snapshot of a package's hand-written `README.md`, distilled to the
 * portions worth feeding the LLM as authoritative source material.
 */
export interface ReadmeContext {
    /** True when README.md exists on disk. */
    readonly exists: boolean;
    /** Raw file contents (empty when missing). */
    readonly raw: string;
    /**
     * Body with any AUTOGEN region and the `## Trademarks` block
     * removed. This is the "human-curated documentation" the
     * generator should mirror or extend in `README.AUTOGEN.md`.
     */
    readonly handAuthored: string;
    /** Approximate word count of the hand-authored body. */
    readonly wordCount: number;
}

/**
 * Load `README.md` for a package and isolate the hand-authored
 * portions. Used both as LLM context and to detect first-run packages
 * (where the README contains nothing but boilerplate).
 *
 * Never throws on a missing file — callers can branch on
 * `result.exists`.
 */
export async function readReadmeContext(
    packageDir: string,
): Promise<ReadmeContext> {
    const readmePath = path.join(packageDir, "README.md");
    let raw: string;
    try {
        raw = await fs.readFile(readmePath, "utf8");
    } catch {
        return { exists: false, raw: "", handAuthored: "", wordCount: 0 };
    }

    const handAuthored = stripGeneratedSections(raw);
    return {
        exists: true,
        raw,
        handAuthored,
        wordCount: countWords(handAuthored),
    };
}

/**
 * Remove the AUTOGEN region (markers + body) and the `## Trademarks`
 * boilerplate block from a README, leaving only hand-authored prose.
 */
export function stripGeneratedSections(raw: string): string {
    let working = raw;

    try {
        const region = findAutogenRegion(working);
        if (region !== null) {
            const lines = working.split(/\r?\n/u);
            const before = lines.slice(0, region.startLine);
            const after = lines.slice(region.endLine + 1);
            working = [...before, ...after].join("\n");
        }
    } catch {
        // Malformed AUTOGEN markers — leave content alone rather
        // than risk dropping unrelated prose.
    }

    working = stripTrademarksSection(working);
    return working.replace(/\n{3,}/gu, "\n\n").trim();
}

function stripTrademarksSection(raw: string): string {
    const lines = raw.split(/\r?\n/u);
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^##\s+Trademarks\s*$/u.test(lines[i]!)) {
            start = i;
            break;
        }
    }
    if (start === -1) return raw;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^##\s+\S/u.test(lines[i]!)) {
            end = i;
            break;
        }
    }
    return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

function countWords(text: string): number {
    const stripped = text
        .replace(/```[\s\S]*?```/gu, " ")
        .replace(/`[^`]*`/gu, " ")
        .replace(/\[[^\]]*\]\([^)]*\)/gu, " ")
        .replace(/<!--[\s\S]*?-->/gu, " ");
    const tokens = stripped.trim().split(/\s+/u).filter(Boolean);
    return tokens.length;
}
