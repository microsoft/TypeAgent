// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Orchestrator: load layered YAML/.env config, build the typed `Config`
 * object, and (optionally) populate `process.env` for unmigrated
 * consumers.
 *
 * The plumbing layers (`loadConfigSync`, `flatten`, etc.) are
 * unchanged; this module is the new typed entry point that consumers
 * should migrate toward.
 */

import { loadConfigSync } from "../loader.js";
import type { LoadConfigOptions } from "../types.js";
import { buildConfig } from "./build.js";
import { applyToProcessEnv } from "./shim.js";
import type { Config } from "./types.js";

export interface LoadRuntimeConfigOptions extends LoadConfigOptions {
    /**
     * After building the typed `Config`, project it onto `process.env`
     * so consumers that still call `process.env.AZURE_OPENAI_*`
     * directly keep working. Defaults to true.
     *
     * Set to false in tests that want to verify "no env-var leakage".
     */
    readonly populateProcessEnv?: boolean;
}

export interface RuntimeConfigResult {
    readonly config: Config;
}

/**
 * Synchronous typed-config load. Returns the typed `Config` and, by
 * default, populates `process.env` with the legacy flat keys.
 */
export function loadRuntimeConfigSync(
    options: LoadRuntimeConfigOptions = {},
): RuntimeConfigResult {
    // The underlying loader still does the file/Vault layering and
    // returns a flat env map. We just hand that to the typed builder.
    // Delegate `populateProcessEnv` to our own shim (we want to do it
    // AFTER building, not before — so the typed Config is the source
    // of truth, not whatever was already in process.env).
    const result = loadConfigSync({ ...options, populateProcessEnv: false });
    const config = buildConfig(result.env);
    if (options.populateProcessEnv ?? true) {
        applyToProcessEnv(config);
    }
    return { config };
}
