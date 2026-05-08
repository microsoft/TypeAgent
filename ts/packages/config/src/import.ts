// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import dotenv from "dotenv";
import registerDebug from "debug";

import { flatten } from "./flatten.js";
import type { ConfigTree, FlatEnv } from "./types.js";

const debug = registerDebug("typeagent:config:import");

/**
 * Result of importing a flat `.env` file. The `tree` field contains
 * the YAML-shaped configuration ready to be written to disk; the
 * `roundTrip` field is the result of re-flattening that tree, used
 * by the verification step to prove no information was lost.
 */
export interface ImportResult {
    /** Parsed-and-restructured configuration tree. */
    tree: ConfigTree;
    /**
     * Re-flattened form of `tree`. When the importer is correct, this
     * equals the input flat map (modulo any keys flagged in
     * `intentionalRewrites`).
     */
    roundTrip: FlatEnv;
    /**
     * Number of keys placed under each top-level bucket. Useful for
     * humans reading the import summary.
     */
    counts: { structured: number; extras: number; total: number };
    /**
     * Keys that were rewritten away from their literal flat form (for
     * example `AZURE_OPENAI_API_KEY=identity` becoming `auth: identity`
     * in a future iteration). Excluded from the round-trip diff.
     */
    intentionalRewrites: string[];
}

/**
 * Parse a `.env` file at `filePath` into a flat env map, mirroring
 * `dotenv.config()` behavior but without mutating `process.env`.
 */
export function parseDotEnvFile(filePath: string): FlatEnv {
    const raw = fs.readFileSync(filePath, "utf8");
    return parseDotEnvText(raw);
}

/**
 * Parse a `.env` text blob into a flat env map.
 */
export function parseDotEnvText(text: string): FlatEnv {
    const parsed = dotenv.parse(text);
    const out: FlatEnv = {};
    for (const [k, v] of Object.entries(parsed)) {
        // dotenv yields strings already; preserve as-is.
        out[k] = v;
    }
    return out;
}

/**
 * Convert a flat env map into a `ConfigTree` suitable for writing as
 * YAML. Phase 2.7 places every key into the `extra:` passthrough
 * bucket, which guarantees a byte-identical round trip through
 * `flatten`. Future iterations will recognize well-known prefixes
 * (e.g., `AZURE_OPENAI_*`) and rewrite them into nested form, with
 * the round-trip verification continuing to enforce equivalence.
 */
export function flatEnvToConfigTree(flat: FlatEnv): ConfigTree {
    const extras: Record<string, string> = {};
    for (const [k, v] of Object.entries(flat)) {
        extras[k] = v;
    }
    return Object.keys(extras).length > 0 ? { extra: extras } : {};
}

/**
 * Run the full importer: read a `.env` file, build a `ConfigTree`,
 * verify round-trip equivalence, and return the result.
 *
 * Throws when round-trip verification fails — the caller's input is
 * truly something we cannot represent losslessly, and silently
 * dropping data here would defeat the whole point of the importer.
 */
export function importDotEnv(filePath: string): ImportResult {
    debug("importing %s", filePath);
    const flat = parseDotEnvFile(filePath);
    const tree = flatEnvToConfigTree(flat);
    const roundTrip = flatten(tree);

    // Verify: every input key must round-trip to the same value.
    const intentionalRewrites: string[] = [];
    const missing: string[] = [];
    const wrong: string[] = [];
    for (const [k, v] of Object.entries(flat)) {
        if (intentionalRewrites.includes(k)) continue;
        if (!(k in roundTrip)) {
            missing.push(k);
        } else if (roundTrip[k] !== v) {
            wrong.push(k);
        }
    }
    if (missing.length > 0 || wrong.length > 0) {
        throw new Error(
            `Importer round-trip verification failed. ` +
                (missing.length > 0
                    ? `Missing keys: ${missing.slice(0, 5).join(", ")}` +
                      (missing.length > 5 ? `, ...` : "") +
                      `. `
                    : "") +
                (wrong.length > 0
                    ? `Mismatched values: ${wrong.slice(0, 5).join(", ")}` +
                      (wrong.length > 5 ? `, ...` : "") +
                      `.`
                    : ""),
        );
    }

    const extras = (tree.extra as Record<string, string> | undefined) ?? {};
    return {
        tree,
        roundTrip,
        counts: {
            structured: 0,
            extras: Object.keys(extras).length,
            total: Object.keys(flat).length,
        },
        intentionalRewrites,
    };
}

/**
 * Serialize a `ConfigTree` to YAML and write it to disk. Creates
 * intermediate directories as needed. The output uses block style
 * with a 2-space indent for human-friendly diffs.
 */
export function writeConfigYamlFile(
    filePath: string,
    tree: ConfigTree,
    header?: string,
): void {
    const body = yaml.dump(tree, {
        indent: 2,
        lineWidth: 120,
        sortKeys: true,
        noRefs: true,
    });
    const text = header ? `${header.trimEnd()}\n${body}` : body;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text, { encoding: "utf8" });
}
