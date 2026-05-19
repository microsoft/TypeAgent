// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Process-wide singleton accessor for the typed runtime `Config`.
 *
 * The shell / cli / api hosts each populate `process.env` early (from
 * YAML, .env, key vault, OS env, in their preferred precedence). Once
 * that is done they call `setRuntimeConfig(buildConfig(process.env))`
 * — or just `initRuntimeConfigFromProcessEnv()` for the common case —
 * and from that point any aiclient code can obtain the typed view by
 * calling `getRuntimeConfig()`.
 *
 * Until the explicit init call, `getRuntimeConfig()` lazily builds
 * one from `process.env` on first access. That makes existing tests
 * and ad-hoc scripts Just Work, while still letting hosts pin a
 * curated config (e.g. one assembled from multiple files) up front.
 */

import { buildConfig, type Config } from "@typeagent/config";
import { setActiveModelProvider } from "./providerMode.js";

let cached: Config | undefined;

/**
 * Replace the cached typed Config. Hosts should call this after they
 * finish populating `process.env` and before any aiclient operation.
 */
export function setRuntimeConfig(config: Config): void {
    cached = config;
    if (config.modelProvider !== undefined) {
        setActiveModelProvider(config.modelProvider);
    }
}

/**
 * Build a Config from the current `process.env` and install it as the
 * cached singleton. Convenience for the common host-startup case.
 */
export function initRuntimeConfigFromProcessEnv(): Config {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (typeof v === "string") flat[k] = v;
    }
    cached = buildConfig(flat);
    if (cached.modelProvider !== undefined) {
        setActiveModelProvider(cached.modelProvider);
    }
    return cached;
}

/**
 * Return the cached typed Config, building one lazily from
 * `process.env` if no host has installed one yet.
 */
export function getRuntimeConfig(): Config {
    if (cached === undefined) {
        return initRuntimeConfigFromProcessEnv();
    }
    return cached;
}

/**
 * Test-only: clear the cached singleton so the next access rebuilds.
 * Not exported through the package barrel.
 */
export function _resetRuntimeConfigForTests(): void {
    cached = undefined;
}
