// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ConfigTree, FlatEnv } from "./types.js";
import { isTypedSectionKey, typedSectionToFlat } from "./runtime/tree.js";

/**
 * Top-level keys whose contents are passed through verbatim into the
 * flat env namespace. Used for keys that already follow the flat
 * `EnvVars` convention exactly (e.g., raw `.env` content rendered as
 * YAML by the importer).
 */
const PASSTHROUGH_KEYS = new Set(["env", "extra"]);

/**
 * Top-level shorthand keys whose value is an array of bare env-var
 * names. Each listed name is emitted into the flat env with the
 * shorthand key's own name as the value. Lets users write:
 *
 *   identity:
 *     - AZURE_OPENAI_API_KEY
 *     - AZURE_OPENAI_API_KEY_GPT_IMAGE_1_5
 *
 * instead of repeating `: identity` on every line.
 */
const VALUE_GROUP_KEYS = new Set(["identity"]);

/**
 * Flatten a parsed YAML configuration tree into a flat env-var map of
 * the shape consumed by `aiclient`'s `getEnvSetting` and the rest of
 * TypeAgent's existing `process.env`-based code.
 *
 * Rules (Phase 1):
 *
 * - Nested map paths are joined with `_` and uppercased, so
 *   `azure.openai.endpoint` becomes `AZURE_OPENAI_ENDPOINT`.
 * - Top-level keys named `env` and `extra` are passed through verbatim
 *   — their child keys are written into the flat env exactly as
 *   spelled. This is the lowest-friction migration form for users
 *   converting an existing `.env`.
 * - Booleans become `"1"` (true) or are dropped (false), matching the
 *   `AZURE_OPENAI_RESPONSE_FORMAT=1` convention already established in
 *   the codebase.
 * - Numbers are stringified.
 * - `null` and `undefined` values are dropped (they signal "unset").
 * - Arrays are not supported in Phase 1 and produce a descriptive
 *   error pointing the caller at the future structured schema.
 */
export function flatten(
    tree: ConfigTree | null | undefined,
    options: FlattenOptions = {},
): FlatEnv {
    if (tree === null || tree === undefined) {
        return {};
    }
    const out: FlatEnv = {};
    walk(tree, [], out, /*passthrough*/ false, options);
    return out;
}

export interface FlattenOptions {
    /**
     * Called when a top-level section fails to convert (a typo'd value,
     * a leftover `<value>` placeholder, ...). When supplied, that one
     * section is skipped and the rest of the file still loads; without
     * it the error propagates and the whole tree is rejected.
     */
    readonly onSectionError?: (section: string, error: Error) => void;
}

function walk(
    node: unknown,
    path: string[],
    out: FlatEnv,
    passthrough: boolean,
    options: FlattenOptions,
): void {
    if (node === null || node === undefined) {
        return;
    }

    if (Array.isArray(node)) {
        throw new Error(
            `Arrays are not supported by the Phase 1 flattener at ` +
                `'${path.join(".")}'. Use the 'env:' passthrough form ` +
                `(flat KEY: value pairs) or wait for the structured ` +
                `deployment schema introduced by the importer.`,
        );
    }

    if (typeof node === "object") {
        for (const [rawKey, value] of Object.entries(
            node as Record<string, unknown>,
        )) {
            if (path.length === 0 && VALUE_GROUP_KEYS.has(rawKey)) {
                tryTopLevel(rawKey, options, () =>
                    expandValueGroup(rawKey, value, out),
                );
                continue;
            }
            if (path.length === 0 && isTypedSectionKey(rawKey)) {
                tryTopLevel(rawKey, options, () => {
                    const sub = typedSectionToFlat(rawKey, value);
                    for (const [k, v] of Object.entries(sub)) {
                        out[k] = v;
                    }
                });
                continue;
            }
            const isPassthroughBoundary =
                path.length === 0 && PASSTHROUGH_KEYS.has(rawKey);
            walk(
                value,
                isPassthroughBoundary ? path : [...path, rawKey],
                out,
                passthrough || isPassthroughBoundary,
                options,
            );
        }
        return;
    }

    // Leaf scalar.
    const flatKey = passthrough ? path.join("_") : toEnvKey(path);
    if (!flatKey) {
        return;
    }
    const stringValue = scalarToString(node);
    if (stringValue !== undefined) {
        out[flatKey] = stringValue;
    }
}

// Run a top-level section's conversion. Without an `onSectionError`
// handler the error propagates (the caller wants all-or-nothing); with
// one, the section is reported and skipped so one bad entry can't
// silently take the whole config file down with it.
function tryTopLevel(
    section: string,
    options: FlattenOptions,
    convert: () => void,
): void {
    if (options.onSectionError === undefined) {
        convert();
        return;
    }
    try {
        convert();
    } catch (e: any) {
        options.onSectionError(
            section,
            e instanceof Error ? e : new Error(String(e)),
        );
    }
}

function toEnvKey(path: string[]): string {
    // Join with underscore and uppercase. Each segment may already
    // contain underscores; we keep them as-is.
    return path.join("_").toUpperCase();
}

function expandValueGroup(
    groupName: string,
    value: unknown,
    out: FlatEnv,
): void {
    if (!Array.isArray(value)) {
        throw new Error(
            `Top-level '${groupName}:' must be an array of env-var ` +
                `names (each will be set to '${groupName}').`,
        );
    }
    for (const entry of value) {
        if (typeof entry !== "string" || entry.length === 0) {
            throw new Error(
                `'${groupName}:' entries must be non-empty strings; ` +
                    `got ${JSON.stringify(entry)}.`,
            );
        }
        out[entry] = groupName;
    }
}

function scalarToString(value: unknown): string | undefined {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            return undefined;
        }
        return String(value);
    }
    if (typeof value === "boolean") {
        // Match the codebase convention: truthy flags are stored as
        // "1"; falsy flags are simply absent.
        return value ? "1" : undefined;
    }
    return undefined;
}

/**
 * Merge two flat env maps. Later wins. Returned object is a fresh
 * shallow copy; inputs are not mutated.
 */
export function mergeFlat(...maps: FlatEnv[]): FlatEnv {
    const out: FlatEnv = {};
    for (const m of maps) {
        for (const k of Object.keys(m)) {
            out[k] = m[k];
        }
    }
    return out;
}
