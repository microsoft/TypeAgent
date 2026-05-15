// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import path from "node:path";
import { END_MARKER, START_MARKER } from "./autogenRegion.js";
import { compareReadmes } from "./diffGuard.js";

/**
 * The standard MIT copyright header emitted at the top of every
 * `README.AUTOGEN.md` file. Markdown comments so they don't render.
 */
const COPYRIGHT_LINES: readonly string[] = [
    "<!-- Copyright (c) Microsoft Corporation. -->",
    "<!-- Licensed under the MIT License. -->",
];

/**
 * Wrap an assembled AUTOGEN body with copyright header + START/END
 * markers and return the full file contents that should land at
 * `<package>/README.AUTOGEN.md`.
 *
 * The body argument is expected to come straight from
 * `assembleAutogenBlock(...).body` — i.e. it already starts with the
 * `<!-- AUTOGEN:DOCS:HASH:... -->` line and ends with the staleness
 * footer.
 */
export function composeAutogenFile(body: string): string {
    const trimmed = trimEdges(body);
    const lines = [
        ...COPYRIGHT_LINES,
        "",
        START_MARKER,
        "",
        trimmed,
        "",
        END_MARKER,
        "",
    ];
    return lines.join("\n");
}

/**
 * Verdict returned by `writeAutogenFile`. Mirrors the diff-guard's
 * vocabulary so callers can log the same way they used to for the
 * old in-place README writer.
 */
export type WriteVerdict = "wrote" | "unchanged" | "footer-only";

export interface WriteResult {
    readonly attempted: boolean;
    readonly verdict: WriteVerdict;
    readonly note?: string;
    /** Absolute path of the file that was (or would be) written. */
    readonly filePath: string;
}

/**
 * Persist a `README.AUTOGEN.md` file for a package. The body the
 * caller supplies is written verbatim (modulo the standard header /
 * footer composed by `composeAutogenFile`).
 *
 * The caller is responsible for any pre-write sanitisation (broken
 * link stripping, etc.) — this function only decides whether the
 * write is meaningful (changed body vs unchanged vs footer-only).
 */
export async function writeAutogenFile(
    packageDir: string,
    body: string,
): Promise<WriteResult> {
    const filePath = path.join(packageDir, "README.AUTOGEN.md");

    const newText = composeAutogenFile(body);

    let oldText: string;
    try {
        oldText = await fs.readFile(filePath, "utf8");
    } catch {
        oldText = "";
    }

    if (oldText.length > 0) {
        const diff = compareReadmes(oldText, newText);
        if (diff.verdict === "unchanged") {
            return {
                attempted: true,
                verdict: "unchanged",
                filePath,
            };
        }
        if (diff.verdict === "footer-only") {
            return {
                attempted: true,
                verdict: "footer-only",
                filePath,
            };
        }
    }

    await fs.writeFile(filePath, newText, "utf8");
    return {
        attempted: true,
        verdict: "wrote",
        filePath,
    };
}

function trimEdges(body: string): string {
    return body.replace(/^[ \t\r\n]+/u, "").replace(/[ \t\r\n]+$/u, "");
}
