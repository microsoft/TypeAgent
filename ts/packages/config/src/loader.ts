// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import dotenv from "dotenv";
import registerDebug from "debug";

import { flatten, mergeFlat } from "./flatten.js";
import { validateConfigTree } from "./schema.js";
import {
    ConfigSource,
    ConfigTree,
    FlatEnv,
    LoadConfigOptions,
    LoadConfigResult,
    SourceMap,
} from "./types.js";

const debug = registerDebug("typeagent:config");

/**
 * Locate the TypeAgent `ts/` workspace root by walking up from this
 * source file. The package lives at
 * `ts/packages/config/dist/loader.js` once built (or `src/loader.ts`
 * when run from source under ts-node), so we walk up four levels and
 * verify by looking for `pnpm-workspace.yaml`.
 */
function defaultWorkspaceRoot(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    let candidate = here;
    for (let i = 0; i < 8; i++) {
        if (
            fs.existsSync(path.join(candidate, "pnpm-workspace.yaml")) &&
            fs.existsSync(path.join(candidate, "package.json"))
        ) {
            return candidate;
        }
        const parent = path.dirname(candidate);
        if (parent === candidate) break;
        candidate = parent;
    }
    // Fall back to the current working directory; callers can override
    // via `LoadConfigOptions.workspaceRoot`.
    return process.cwd();
}

function readYamlFile(filePath: string): ConfigTree | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const text = fs.readFileSync(filePath, "utf8");
    const data = yaml.load(text, { filename: filePath });
    if (data === null || data === undefined) {
        return null;
    }
    if (typeof data !== "object" || Array.isArray(data)) {
        throw new Error(
            `Config file ${filePath} must contain a YAML mapping at the top level.`,
        );
    }
    validateConfigTree(data, filePath);
    return data as ConfigTree;
}

function readDotEnvFile(filePath: string): FlatEnv {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    const text = fs.readFileSync(filePath, "utf8");
    const parsed = dotenv.parse(text);
    return parsed;
}

/**
 * Synchronous loader used by tests and any entry point that cannot
 * await. Reads YAML files and the `.env` fallback only — never reaches
 * out to Key Vault.
 *
 * Precedence (low → high): `.env` → defaults → local → caller-provided
 * `process.env`-style overrides via the `populateProcessEnv` flag.
 */
export function loadConfigSync(
    options: LoadConfigOptions = {},
): LoadConfigResult {
    const root = options.workspaceRoot ?? defaultWorkspaceRoot();
    const defaultsPath =
        options.defaultsPath ?? path.join(root, "config.defaults.yaml");
    const localPath = options.localPath ?? path.join(root, "config.local.yaml");
    const dotEnvPath = options.dotEnvPath ?? path.join(root, ".env");
    const trackSources = options.trackSources ?? false;
    const populateProcessEnv = options.populateProcessEnv ?? true;
    const strict = options.strict ?? true;

    debug(
        "loading config (workspaceRoot=%s, defaults=%s, local=%s, dotenv=%s)",
        root,
        defaultsPath,
        localPath,
        dotEnvPath,
    );

    const layers: { source: ConfigSource; flat: FlatEnv }[] = [];

    // .env (legacy fallback, lowest precedence)
    try {
        const envFlat = readDotEnvFile(dotEnvPath);
        if (Object.keys(envFlat).length > 0) {
            layers.push({ source: ConfigSource.DotEnv, flat: envFlat });
        }
    } catch (err) {
        if (strict) throw err;
        debug("error reading .env (continuing): %s", err);
    }

    // config.defaults.yaml
    try {
        const tree = readYamlFile(defaultsPath);
        if (tree) {
            layers.push({
                source: ConfigSource.Defaults,
                flat: flatten(tree),
            });
        }
    } catch (err) {
        if (strict) throw err;
        debug("error reading defaults (continuing): %s", err);
    }

    // config.local.yaml
    try {
        const tree = readYamlFile(localPath);
        if (tree) {
            layers.push({
                source: ConfigSource.Local,
                flat: flatten(tree),
            });
        }
    } catch (err) {
        if (strict) throw err;
        debug("error reading local (continuing): %s", err);
    }

    // Merge in precedence order (later layers win).
    const merged: FlatEnv = mergeFlat(...layers.map((l) => l.flat));

    let sources: SourceMap | undefined;
    if (trackSources) {
        sources = {};
        for (const layer of layers) {
            for (const k of Object.keys(layer.flat)) {
                sources[k] = layer.source;
            }
        }
        // Pre-existing process.env values are tracked but not
        // overwritten — they sit at the top of the precedence chain
        // when populateProcessEnv chooses not to clobber them. (See
        // below.)
    }

    if (populateProcessEnv) {
        applyToProcessEnv(merged, sources);
    }

    debug(
        "loaded %d keys from %d layer(s)",
        Object.keys(merged).length,
        layers.length,
    );

    return sources !== undefined ? { env: merged, sources } : { env: merged };
}

/**
 * Async loader. In Phase 1 this is a thin wrapper around
 * `loadConfigSync`; Phase 2 will add the Key Vault fetch step here.
 *
 * Existing entry points should `await loadConfig()` once at startup,
 * before any code that reads `process.env`.
 */
export async function loadConfig(
    options: LoadConfigOptions = {},
): Promise<LoadConfigResult> {
    return loadConfigSync(options);
}

/**
 * Merge a flat env map into `process.env`. Existing values in
 * `process.env` are preserved — they sit at higher precedence than
 * any config file (matching how `dotenv.config()` behaved). This
 * lets developers override individual keys ad-hoc from the shell
 * without editing YAML.
 */
function applyToProcessEnv(merged: FlatEnv, sources?: SourceMap): void {
    for (const [key, value] of Object.entries(merged)) {
        if (process.env[key] === undefined) {
            process.env[key] = value;
        } else if (sources) {
            // Caller wants source tracking — record that the live
            // process env "won" against the config file value.
            sources[key] = ConfigSource.ProcessEnv;
        }
    }
}
