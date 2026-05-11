// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import dotenv from "dotenv";
import registerDebug from "debug";

import { flatten } from "./flatten.js";
import { buildConfig } from "./runtime/build.js";
import { configToEnv } from "./runtime/shim.js";
import { configToTree } from "./runtime/tree.js";
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
 * YAML. The importer runs `buildConfig` to lift well-known env-var
 * conventions (Azure OpenAI deployments, Speech, Maps, etc.) into the
 * typed `Config` shape, then projects that back to the YAML tree via
 * `configToTree`. Anything `buildConfig` didn't recognize lands in
 * `extra:` verbatim, with `"identity"`-valued keys hoisted into the
 * `identity:` shorthand list.
 */
export function flatEnvToConfigTree(flat: FlatEnv): ConfigTree {
    const config = buildConfig(flat);
    const tree: ConfigTree = configToTree(config);

    // Partition Config.extra into identity-shorthand vs. true extras.
    const identity: string[] = [];
    const extras: Record<string, string> = {};
    for (const [k, v] of config.extra) {
        if (v === "identity") {
            identity.push(k);
        } else {
            extras[k] = v;
        }
    }
    if (identity.length > 0) {
        identity.sort();
        tree.identity = identity;
    }
    if (Object.keys(extras).length > 0) {
        tree.extra = extras;
    }
    return tree;
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

    // Verify: every input key must round-trip into the equivalent
    // flat env. Typed sections normalize values (booleans -> "1"/"0",
    // identity-keyed endpoints inherit defaultAuth, etc.), so we
    // compare against the canonical projection of the rebuilt Config
    // rather than the raw input map. If the rebuilt config produces
    // the same env as the input config does, no information was lost.
    const canonicalInput = configToEnv(buildConfig(flat));
    const intentionalRewrites: string[] = [];
    const missing: string[] = [];
    const wrong: string[] = [];
    for (const [k, v] of Object.entries(canonicalInput)) {
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
    const identity = (tree.identity as string[] | undefined) ?? [];
    const structured = Object.keys(tree).filter(
        (k) => k !== "extra" && k !== "identity",
    ).length;
    return {
        tree,
        roundTrip,
        counts: {
            structured: structured + identity.length,
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
