// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import dotenv from "dotenv";
import registerDebug from "debug";

import { flatten, mergeFlat } from "./flatten.js";
import { fetchKeyVaultConfig } from "./keyVault.js";
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
 * Async loader. Performs the same work as `loadConfigSync` plus the
 * optional Key Vault fetch when `options.keyVault` is supplied.
 *
 * Existing entry points should `await loadConfig()` once at startup,
 * before any code that reads `process.env`.
 *
 * Precedence (low → high): `.env` → defaults → Key Vault → local →
 * pre-existing `process.env`.
 */
export async function loadConfig(
    options: LoadConfigOptions = {},
): Promise<LoadConfigResult> {
    if (!options.keyVault) {
        return loadConfigSync(options);
    }

    // Fetch the Key Vault layer first, then run the sync loader with
    // the rest of the precedence chain. We splice the KV layer in at
    // the correct position by routing through a custom assembly path.
    const root = options.workspaceRoot ?? defaultWorkspaceRoot();
    const defaultsPath =
        options.defaultsPath ?? path.join(root, "config.defaults.yaml");
    const localPath = options.localPath ?? path.join(root, "config.local.yaml");
    const dotEnvPath = options.dotEnvPath ?? path.join(root, ".env");
    const trackSources = options.trackSources ?? false;
    const populateProcessEnv = options.populateProcessEnv ?? true;
    const strict = options.strict ?? true;

    // Resolve vault name. If the caller didn't supply one, do a quick
    // sync pre-pass of defaults+local to discover TYPEAGENT_SHAREDVAULT
    // (the flat form of `vault.shared`).
    let vaultName = options.keyVault.vaultName;
    if (!vaultName) {
        const preLayers: { source: ConfigSource; flat: FlatEnv }[] = [];
        pushYamlLayer(preLayers, ConfigSource.Defaults, defaultsPath, false);
        pushYamlLayer(preLayers, ConfigSource.Local, localPath, false);
        pushFileLayer(
            preLayers,
            ConfigSource.DotEnv,
            () => readDotEnvFile(dotEnvPath),
            false,
            ".env",
        );
        const preMerged = mergeFlat(...preLayers.map((l) => l.flat));
        vaultName = preMerged.TYPEAGENT_SHAREDVAULT;
        if (!vaultName) {
            debug(
                "key vault requested but no vault name supplied and " +
                    "vault.shared not found in defaults/local — skipping KV layer",
            );
            return loadConfigSync(options);
        }
        debug("auto-discovered vault name: %s", vaultName);
    }

    debug(
        "loading config with key vault (workspaceRoot=%s, vault=%s)",
        root,
        vaultName,
    );

    const layers: { source: ConfigSource; flat: FlatEnv }[] = [];

    // .env
    pushFileLayer(
        layers,
        ConfigSource.DotEnv,
        () => readDotEnvFile(dotEnvPath),
        strict,
        ".env",
    );

    // defaults
    pushYamlLayer(layers, ConfigSource.Defaults, defaultsPath, strict);

    // Key Vault (between defaults and local, per the locked design)
    try {
        const tree = await fetchKeyVaultConfig({
            ...options.keyVault,
            vaultName,
            failOnError: options.keyVault.failOnError ?? strict,
        });
        if (tree) {
            layers.push({
                source: ConfigSource.KeyVault,
                flat: flatten(tree),
            });
        }
    } catch (err) {
        if (strict) throw err;
        debug("key vault layer skipped: %s", err);
    }

    // local
    pushYamlLayer(layers, ConfigSource.Local, localPath, strict);

    return finalize(layers, populateProcessEnv, trackSources);
}

/**
 * Push a flat env layer (read from a `.env` file) into the layers
 * array, honoring `strict` mode for error handling. Helper extracted
 * so `loadConfig` and `loadConfigSync` share identical semantics.
 */
function pushFileLayer(
    layers: { source: ConfigSource; flat: FlatEnv }[],
    source: ConfigSource,
    read: () => FlatEnv,
    strict: boolean,
    label: string,
): void {
    try {
        const flat = read();
        if (Object.keys(flat).length > 0) {
            layers.push({ source, flat });
        }
    } catch (err) {
        if (strict) throw err;
        debug("error reading %s (continuing): %s", label, err);
    }
}

/**
 * Push a YAML layer into the layers array, honoring `strict` mode.
 */
function pushYamlLayer(
    layers: { source: ConfigSource; flat: FlatEnv }[],
    source: ConfigSource,
    filePath: string,
    strict: boolean,
): void {
    try {
        const tree = readYamlFile(filePath);
        if (tree) {
            layers.push({ source, flat: flatten(tree) });
        }
    } catch (err) {
        if (strict) throw err;
        debug("error reading %s (continuing): %s", filePath, err);
    }
}

/**
 * Merge layers in precedence order, optionally produce a source map,
 * and (optionally) push the result into `process.env`.
 */
function finalize(
    layers: { source: ConfigSource; flat: FlatEnv }[],
    populateProcessEnv: boolean,
    trackSources: boolean,
): LoadConfigResult {
    const merged: FlatEnv = mergeFlat(...layers.map((l) => l.flat));

    let sources: SourceMap | undefined;
    if (trackSources) {
        sources = {};
        for (const layer of layers) {
            for (const k of Object.keys(layer.flat)) {
                sources[k] = layer.source;
            }
        }
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
