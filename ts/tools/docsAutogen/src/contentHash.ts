// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";

/**
 * Comment markers used to embed/extract the content hash inside the
 * AUTOGEN block. Format:
 *
 *   <!-- AUTOGEN:DOCS:HASH:sha256=<64-hex> -->
 */
export const HASH_PREFIX = "<!-- AUTOGEN:DOCS:HASH:sha256=";
export const HASH_SUFFIX = " -->";
const HASH_REGEX = /<!-- AUTOGEN:DOCS:HASH:sha256=([0-9a-f]{64}) -->/u;

/**
 * Deterministic sha256 over a labelled set of inputs.
 *
 * The input map is sorted by key (unicode order) and each entry is
 * serialized as `<key>\n<value>\n` before being hashed. This makes
 * the hash insensitive to insertion order while still binding values
 * to their labels.
 */
export function computeContentHash(
    parts: Readonly<Record<string, string>>,
): string {
    const keys = Object.keys(parts).sort();
    const hash = createHash("sha256");
    for (const key of keys) {
        hash.update(key);
        hash.update("\n");
        hash.update(parts[key] ?? "");
        hash.update("\n");
    }
    return hash.digest("hex");
}

/** Render a hash as the inline HTML comment embedded in AUTOGEN blocks. */
export function formatHashComment(hash: string): string {
    return `${HASH_PREFIX}${hash}${HASH_SUFFIX}`;
}

/**
 * Extract the embedded hash from a string (typically the AUTOGEN
 * block body). Returns null when no hash comment is found.
 */
export function parseHashComment(text: string): string | null {
    const m = HASH_REGEX.exec(text);
    return m ? (m[1] ?? null) : null;
}
