// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ConfigTree, FlatEnv } from "./types.js";

/**
 * Default pattern matching keys whose values are sensitive. Matches
 * the convention used elsewhere in the codebase (look for `key`,
 * `secret`, `password`, `token`, `credential` substrings — case
 * insensitive). The pattern is exported so callers can extend it.
 */
export const SECRET_KEY_PATTERN = /key|secret|password|token|credential/i;

/** Sentinel used in place of redacted values. */
export const REDACTED = "<redacted>";

/**
 * The string value of an Azure managed-identity setting in TypeAgent;
 * always safe to display in plaintext.
 */
const NON_SECRET_VALUES = new Set(["", "identity"]);

/**
 * Should the value at `keyPath` be redacted? `keyPath` is expected to
 * be a dotted path like `azure.openai.api_key`, or a flat env name
 * like `AZURE_OPENAI_API_KEY`.
 */
export function shouldRedact(keyPath: string, value: unknown): boolean {
    if (typeof value !== "string") return false;
    if (NON_SECRET_VALUES.has(value)) return false;
    return SECRET_KEY_PATTERN.test(keyPath);
}

/**
 * Return a copy of `tree` with values at sensitive keys replaced by
 * `<redacted>`. Non-string scalars are left as-is (booleans /
 * numbers cannot leak credentials in any meaningful way).
 */
export function redactTree(tree: ConfigTree): ConfigTree {
    return walk(tree, []) as ConfigTree;
}

function walk(node: unknown, path: string[]): unknown {
    if (node === null || node === undefined) return node;
    if (typeof node !== "object") {
        return shouldRedact(path.join("."), node) ? REDACTED : node;
    }
    if (Array.isArray(node)) {
        return node.map((item, i) => walk(item, [...path, String(i)]));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v, [...path, k]);
    }
    return out;
}

/**
 * Return a copy of `flat` with values at sensitive keys replaced by
 * `<redacted>`. Used by `typeagent-config show` when printing a
 * merged flat env map.
 */
export function redactFlat(flat: FlatEnv): FlatEnv {
    const out: FlatEnv = {};
    for (const [k, v] of Object.entries(flat)) {
        out[k] = shouldRedact(k, v) ? REDACTED : v;
    }
    return out;
}
