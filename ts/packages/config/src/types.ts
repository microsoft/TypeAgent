// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Phase 1 type definitions for the layered YAML configuration loader.
 *
 * Later phases (Key Vault fetch, encrypted cache, structured deployment
 * arrays via the importer) extend these types — the current shape is
 * intentionally permissive so users can author YAML before the full
 * structured schema lands.
 */

/**
 * A leaf value in a YAML configuration tree. Anything else (objects,
 * arrays, nulls) is structural and handled by the flattener.
 */
export type ConfigScalar = string | number | boolean;

/**
 * A node in the in-memory representation of a parsed YAML config file.
 * Maps are nested arbitrarily deep; leaves are scalars (or nulls, which
 * are dropped during flattening).
 */
export type ConfigTree = {
    [key: string]: ConfigScalar | ConfigTree | null;
};

/**
 * A flat environment-variable map of the shape `process.env` uses.
 * The flattener produces this from a `ConfigTree`; the loader merges it
 * into `process.env` for backwards compatibility with existing
 * `getEnvSetting` consumers in aiclient.
 */
export type FlatEnv = Record<string, string>;

/**
 * Origin of a resolved configuration value. Used by the loader for
 * source-aware diagnostics (`typeagent config show --source`, planned
 * for Phase 2.7) and for the straggler-catcher in Phase 3.
 */
export enum ConfigSource {
    Defaults = "defaults",
    KeyVault = "key-vault",
    Cache = "cache",
    Local = "local",
    DotEnv = "dotenv",
    ProcessEnv = "process-env",
}

/**
 * Per-key provenance: which source supplied the final value for each
 * flat env key. Populated by the loader when source tracking is enabled.
 */
export type SourceMap = Record<string, ConfigSource>;

/**
 * Options for fetching a YAML configuration blob from Azure Key Vault.
 *
 * The default vault for TypeAgent dev work is `aisystems`; CI workflows
 * pass an explicit vault name. The default secret name is
 * `typeagent-config` (defined in `keyVault.ts`).
 */
export interface KeyVaultOptions {
    /** Azure Key Vault name (e.g., `aisystems`). Required. */
    vaultName: string;

    /**
     * Secret name holding the YAML blob. Defaults to
     * `typeagent-config`.
     */
    secretName?: string;

    /**
     * Custom Azure credential. Defaults to `DefaultAzureCredential`,
     * which mirrors the rest of the TypeAgent codebase.
     */
    credential?: import("@azure/identity").TokenCredential;

    /**
     * Custom fetcher (vault, secret) -> raw string | null. Used by
     * tests to bypass the live Azure SDK; production callers should
     * leave this undefined.
     */
    fetcher?: (vaultName: string, secretName: string) => Promise<string | null>;

    /**
     * If `true`, throw on fetch / parse / validation errors. If
     * `false` (the default), errors are logged and the layer is
     * skipped — the loader falls through to lower-precedence layers,
     * matching the offline-friendly behavior the migration plan
     * requires.
     */
    failOnError?: boolean;
}

/**
 * Options accepted by `loadConfig`. All fields are optional; sensible
 * defaults locate `config.defaults.yaml` / `config.local.yaml` / `.env`
 * relative to the TypeAgent `ts/` workspace root.
 */
export interface LoadConfigOptions {
    /**
     * Workspace root used to resolve relative file paths. Defaults to
     * the `ts/` directory inferred from this package's location.
     */
    workspaceRoot?: string;

    /**
     * Path to the committed defaults file. Defaults to
     * `<workspaceRoot>/config.defaults.yaml`.
     */
    defaultsPath?: string;

    /**
     * Path to the gitignored local override file. Defaults to
     * `<workspaceRoot>/config.local.yaml`.
     */
    localPath?: string;

    /**
     * Path to the legacy `.env` fallback. Defaults to
     * `<workspaceRoot>/.env`.
     *
     * `.env` is read at the lowest precedence and exists for the
     * duration of the migration; it will be removed in a future
     * release.
     */
    dotEnvPath?: string;

    /**
     * If supplied, the loader fetches the YAML blob from the named
     * Azure Key Vault secret and inserts it into the precedence
     * chain between `defaults` and `local` (matches the locked
     * design). Async-only — `loadConfigSync` ignores this option.
     */
    keyVault?: KeyVaultOptions;

    /**
     * If `true`, populate `process.env` with the merged result.
     * Defaults to `true`.
     */
    populateProcessEnv?: boolean;

    /**
     * If `true`, throw when validation fails. If `false`, validation
     * issues are logged but loading continues. Defaults to `true`.
     */
    strict?: boolean;

    /**
     * If `true`, track per-key provenance and return it on the result.
     * Defaults to `false` (small extra cost).
     */
    trackSources?: boolean;
}

/**
 * Result returned by `loadConfig`. Always includes the merged flat env
 * map; provenance is included only when `trackSources` is enabled.
 */
export interface LoadConfigResult {
    /** Final merged flat env map (also pushed into `process.env`). */
    env: FlatEnv;

    /** Per-key provenance, when `trackSources: true`. */
    sources?: SourceMap;
}
