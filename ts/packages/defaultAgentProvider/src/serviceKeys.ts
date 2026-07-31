// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared LLM-key bootstrap for TypeAgent Studio's service-side dispatchers
 * (the onboarding-only dispatcher and the generated-agent "Try it" translator).
 *
 * The Studio service process — where these dispatchers run, loaded via a lazy
 * external import — does not otherwise load any keys, so an LLM translation
 * would fail with an auth error. `loadConfigSync` mirrors how the rest of
 * TypeAgent resolves keys: it auto-detects the `ts/` workspace root and merges
 * `config.defaults.yaml` + `config.local.yaml` + the legacy `.env`, populating
 * only vars that are still undefined (so a process already launched with keys
 * in its environment is never clobbered). Best-effort and idempotent: a missing
 * or malformed config never blocks the wizard here — a genuinely missing key
 * surfaces later as a clear translation/auth error.
 *
 * The `keysLoaded` guard is module-level so keys are loaded at most once across
 * BOTH dispatchers in a service process.
 */

import { loadConfigSync } from "@typeagent/config";
import registerDebug from "debug";

const debug = registerDebug("typeagent:studio:serviceKeys");

let keysLoaded = false;

export function ensureServiceKeysLoaded(): void {
    if (keysLoaded) {
        return;
    }
    keysLoaded = true;
    try {
        const { env } = loadConfigSync({ strict: false });
        debug(
            "loaded %d config key(s) into process.env",
            Object.keys(env).length,
        );
    } catch (e) {
        debug("config load skipped: %s", (e as Error).message);
    }
}
