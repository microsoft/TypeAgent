// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import yaml from "js-yaml";
import registerDebug from "debug";
import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

import { validateConfigTree } from "./schema.js";
import type { ConfigTree, KeyVaultOptions } from "./types.js";

const debug = registerDebug("typeagent:config:keyvault");

/** Default Key Vault secret name holding the YAML configuration blob. */
export const DEFAULT_SECRET_NAME = "typeagent-config";

/** Maximum size of a single Key Vault secret value (Azure-enforced). */
const MAX_SECRET_BYTES = 25 * 1024;

/**
 * A `fetcher` that returns the raw secret string for a given vault and
 * secret name, or `null` if the secret does not exist. Provided so
 * tests can substitute the live Azure SDK call.
 */
export type KeyVaultFetcher = (
    vaultName: string,
    secretName: string,
) => Promise<string | null>;

/**
 * Build a `KeyVaultFetcher` backed by the live Azure SDK. Credentials
 * fall through `DefaultAzureCredential`, matching the pattern used in
 * [packages/aiclient/src/auth.ts](../../aiclient/src/auth.ts) and the
 * `tools/scripts/getKeys.mjs` administrative script.
 */
export function makeAzureFetcher(
    credential: TokenCredential = new DefaultAzureCredential(),
): KeyVaultFetcher {
    const clients = new Map<string, SecretClient>();
    return async (vaultName, secretName) => {
        let client = clients.get(vaultName);
        if (!client) {
            client = new SecretClient(
                `https://${vaultName}.vault.azure.net`,
                credential,
            );
            clients.set(vaultName, client);
        }
        try {
            const result = await client.getSecret(secretName);
            return result.value ?? null;
        } catch (e) {
            // The Key Vault SDK throws a RestError-shaped object on
            // 404; treat "not found" as a soft miss so the loader can
            // fall through to other layers.
            if (
                typeof e === "object" &&
                e !== null &&
                (e as { statusCode?: number }).statusCode === 404
            ) {
                return null;
            }
            throw e;
        }
    };
}

/**
 * Are we running inside Jest? Used by the test-isolation guard so
 * unit-test runs (`*.spec.ts`, `pnpm test:local`) never make live
 * Key Vault calls. Live integration tests (`*.test.ts`,
 * `pnpm test:live`) opt in by setting
 * `TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS=1`.
 */
function inJest(): boolean {
    return (
        process.env.JEST_WORKER_ID !== undefined ||
        process.env.NODE_ENV === "test"
    );
}

function keyVaultAllowedInTests(): boolean {
    const v = process.env.TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS;
    return v === "1" || v?.toLowerCase() === "true";
}

/**
 * Fetch and parse a TypeAgent YAML configuration blob from Azure
 * Key Vault. Returns `null` when:
 *
 * - The secret does not exist (404).
 * - The secret exists but is empty.
 * - The fetch fails and `failOnError` is false (default — the loader
 *   chain treats this as cache-miss / fall through to other layers).
 *
 * Refuses to make a live call when running under Jest unless the
 * caller has set `TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS=1` or supplied a
 * custom `fetcher` (the test substitution path).
 */
export async function fetchKeyVaultConfig(
    options: KeyVaultOptions,
): Promise<ConfigTree | null> {
    const {
        vaultName,
        secretName = DEFAULT_SECRET_NAME,
        failOnError = false,
    } = options;

    const fetcher = options.fetcher ?? makeAzureFetcher(options.credential);

    // Test-isolation guard: only block live fetches, not test-supplied
    // fetcher functions.
    if (
        options.fetcher === undefined &&
        inJest() &&
        !keyVaultAllowedInTests()
    ) {
        const msg =
            `Refusing live Key Vault fetch from inside Jest ` +
            `(vault=${vaultName}, secret=${secretName}). ` +
            `Set TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS=1 to opt in, or ` +
            `inject a stub fetcher.`;
        if (failOnError) throw new Error(msg);
        debug(msg);
        return null;
    }

    debug("fetching vault=%s secret=%s", vaultName, secretName);

    if (!vaultName) {
        const msg = "vaultName is required for Key Vault fetch";
        if (failOnError) throw new Error(msg);
        debug(msg);
        return null;
    }

    let raw: string | null;
    try {
        raw = await fetcher(vaultName, secretName);
    } catch (err) {
        if (failOnError) throw err;
        debug("fetch failed (continuing): %s", err);
        return null;
    }

    if (raw === null || raw.length === 0) {
        debug("secret missing or empty");
        return null;
    }

    if (Buffer.byteLength(raw, "utf8") > MAX_SECRET_BYTES) {
        // The Azure SDK would have rejected the upload, but a
        // hand-edited secret could in principle exceed this; surface
        // a useful error rather than silently truncate.
        const msg =
            `Key Vault secret ${secretName} exceeds the ${MAX_SECRET_BYTES}-byte ` +
            `limit. Split into multiple secrets or reduce content.`;
        if (failOnError) throw new Error(msg);
        debug(msg);
        return null;
    }

    let parsed: unknown;
    try {
        parsed = yaml.load(raw, {
            filename: `keyvault://${vaultName}/${secretName}`,
        });
    } catch (err) {
        if (failOnError) throw err;
        debug("parse failed (continuing): %s", err);
        return null;
    }

    if (parsed === null || parsed === undefined) {
        return null;
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
        const msg =
            `Key Vault secret ${vaultName}/${secretName} must contain a ` +
            `YAML mapping at the top level.`;
        if (failOnError) throw new Error(msg);
        debug(msg);
        return null;
    }

    validateConfigTree(parsed, `keyvault://${vaultName}/${secretName}`);
    return parsed as ConfigTree;
}
