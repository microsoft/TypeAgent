#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import chalk from "chalk";
import {
    DefaultAzureCredential,
    InteractiveBrowserCredential,
} from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import yaml from "js-yaml";

const require = createRequire(import.meta.url);
const config = require("./getKeys.config.json");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dotenvPath = path.resolve(__dirname, config.defaultDotEnvPath);
// Output location for config.local.yaml. Mirrors the @typeagent/config loader's
// path precedence so getKeys can provision config on a machine WITHOUT the repo
// checked out (the service launcher sets TYPEAGENT_CONFIG_DIR/_LOCAL):
//   TYPEAGENT_CONFIG_LOCAL
//   > <TYPEAGENT_CONFIG_DIR>/config.local.yaml
//   > <repo ts/>/config.local.yaml   (the in-repo default; unchanged for devs)
const yamlPath =
    process.env.TYPEAGENT_CONFIG_LOCAL ??
    (process.env.TYPEAGENT_CONFIG_DIR
        ? path.join(process.env.TYPEAGENT_CONFIG_DIR, "config.local.yaml")
        : path.resolve(__dirname, "../../config.local.yaml"));
const sharedKeys = config.env.shared;
const privateKeys = config.env.private;
const deleteKeys = config.env.delete;
const sharedPatterns = (config.env.sharedPatterns ?? []).map(
    (p) => new RegExp(p),
);
let paramSharedVault = undefined;
let paramPrivateVault = undefined;
let paramCommit = true;
let paramVerbose = false;
let paramFormat = undefined; // "yaml" | "dotenv" | undefined (defaults to yaml)

function nowHHMMSS() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function vlog(msg) {
    if (paramVerbose) {
        console.log(chalk.gray(`[${nowHHMMSS()}] ${msg}`));
    }
}

async function timed(label, fn) {
    if (!paramVerbose) {
        return fn();
    }
    const start = Date.now();
    vlog(`> ${label}`);
    try {
        const result = await fn();
        vlog(`< ${label} (${Date.now() - start}ms)`);
        return result;
    } catch (e) {
        vlog(`! ${label} FAILED after ${Date.now() - start}ms: ${e.message}`);
        throw e;
    }
}

function matchesSharedPattern(envKey) {
    return sharedPatterns.some((re) => re.test(envKey));
}

function isSharedKey(envKey) {
    return sharedKeys.includes(envKey) || matchesSharedPattern(envKey);
}

function isForbiddenByRbac(e) {
    // Azure SDK RestError surfaces RBAC denial as 403 with the inner code
    // "ForbiddenByRbac" carried in the message body. Az CLI's old check used
    // the message text — keep both so we work whichever side throws.
    return (
        e?.statusCode === 403 ||
        (typeof e?.message === "string" &&
            e.message.includes("ForbiddenByRbac"))
    );
}

// PIM elevation is only needed when the signed-in user lacks STANDING access to
// the vault (the vault read returns 403). It pulls in @azure/arm-authorization,
// which is intentionally NOT shipped in the repo-less service artifact — the
// documented flow is browser-credential auth with standing access. Load the PIM
// client lazily so the common path needs neither the module nor its deps; if it
// is missing, the elevation attempt below fails gracefully and we fall back to a
// plain (unelevated) read, surfacing the original 403 to the user.
async function getPIMClient() {
    let getClient;
    try {
        ({ getClient } = await import("./lib/pimClient.mjs"));
    } catch (e) {
        throw new Error(
            `PIM elevation unavailable (@azure/arm-authorization not installed): ${e?.message}`,
        );
    }
    return getClient();
}

// Self-activate a PIM role for a short window so the following data-plane
// operation can succeed. Throws if PIM is unavailable or activation fails, so
// callers can fall back to another role or an unelevated retry.
async function elevate(roleName) {
    console.warn(chalk.yellowBright(`Elevating to '${roleName}'...`));
    const pimClient = await getPIMClient();
    await pimClient.elevate({
        requestType: "SelfActivate",
        roleName,
        expirationType: "AfterDuration",
        expirationDuration: "PT5M", // activate for 5 minutes
        continueOnFailure: true,
    });

    // Wait for the role to be activated
    console.log(chalk.green("Elevation successful."));
    console.warn(chalk.yellowBright("Waiting 5 seconds..."));
    await new Promise((res) => setTimeout(res, 5000));
}

async function getSecretListWithElevation(keyVaultClient, vaultName) {
    try {
        return await keyVaultClient.getSecrets(vaultName);
    } catch (e) {
        if (!isForbiddenByRbac(e)) {
            throw e;
        }

        try {
            await elevate("Key Vault Administrator");
            return await keyVaultClient.getSecrets(vaultName);
        } catch {
            console.warn(
                chalk.yellow(
                    "Elevation to key vault admin failed...attempting to get secrets as key vault reader.",
                ),
            );
        }

        try {
            await elevate("Key Vault Secrets User");
        } catch {
            console.warn(
                chalk.yellow(
                    "Elevation failed...attempting to get secrets without elevation.",
                ),
            );
        }

        return await keyVaultClient.getSecrets(vaultName);
    }
}

// Write a secret, self-elevating via PIM if the vault rejects the write with a
// 403 (the signed-in user lacks STANDING write access). Mirrors
// getSecretListWithElevation, but targets roles that grant write (set)
// permission: "Key Vault Secrets User" is read-only and useless here, so we try
// "Key Vault Administrator" then "Key Vault Secrets Officer".
async function writeSecretWithElevation(
    keyVaultClient,
    vaultName,
    secretName,
    secretValue,
) {
    try {
        return await keyVaultClient.writeSecret(
            vaultName,
            secretName,
            secretValue,
        );
    } catch (e) {
        if (!isForbiddenByRbac(e)) {
            throw e;
        }

        try {
            await elevate("Key Vault Administrator");
            return await keyVaultClient.writeSecret(
                vaultName,
                secretName,
                secretValue,
            );
        } catch {
            console.warn(
                chalk.yellow(
                    "Elevation to key vault admin failed...trying key vault secrets officer.",
                ),
            );
        }

        try {
            await elevate("Key Vault Secrets Officer");
        } catch {
            console.warn(
                chalk.yellow(
                    "Elevation failed...attempting to write without elevation.",
                ),
            );
        }

        return await keyVaultClient.writeSecret(
            vaultName,
            secretName,
            secretValue,
        );
    }
}

async function getSecrets(keyVaultClient, vaultName, shared) {
    const overallStart = Date.now();
    console.log(
        `Getting existing ${shared ? "shared" : "private"} secrets from ${chalk.cyanBright(vaultName)} key vault.`,
    );
    const listStart = Date.now();
    const secretList = await getSecretListWithElevation(
        keyVaultClient,
        vaultName,
    );
    const listElapsed = Date.now() - listStart;
    const enabled = secretList
        .filter((s) => s.attributes.enabled)
        .map((s) => s.id.split("/").pop());
    vlog(
        `list ${vaultName}: ${secretList.length} total, ${enabled.length} enabled (${listElapsed}ms)`,
    );

    const results = [];
    const failures = [];
    // SDK reads are HTTPS round-trips (no per-call process spawn), so we can
    // parallelize aggressively. Key Vault per-vault rate limit is ~2000 ops
    // per 10s, so 20 concurrent reads is well within bounds.
    const concurrency = 20;
    const batchCount = Math.ceil(enabled.length / concurrency);
    for (let i = 0; i < enabled.length; i += concurrency) {
        const batch = enabled.slice(i, i + concurrency);
        const batchIdx = Math.floor(i / concurrency) + 1;
        const batchStart = Date.now();
        vlog(
            `batch ${batchIdx}/${batchCount} (${batch.length} secrets) starting`,
        );
        const batchResults = await Promise.all(
            batch.map(async (secretName) => {
                const t0 = Date.now();
                try {
                    const response = await keyVaultClient.readSecret(
                        vaultName,
                        secretName,
                    );
                    vlog(`  read ${secretName} (${Date.now() - t0}ms)`);
                    return [secretName, response.value];
                } catch (e) {
                    vlog(
                        `  read ${secretName} FAILED (${Date.now() - t0}ms): ${e.message}`,
                    );
                    failures.push({ name: secretName, error: e.message });
                    return null;
                }
            }),
        );
        vlog(
            `batch ${batchIdx}/${batchCount} done in ${Date.now() - batchStart}ms`,
        );
        results.push(...batchResults.filter((r) => r !== null));
    }

    vlog(
        `getSecrets ${vaultName} total: ${Date.now() - overallStart}ms (${results.length} ok, ${failures.length} failed)`,
    );
    return { results, failures };
}

// Decode a JWT (no signature verification — we only want the claims to
// print friendly identity info).
function decodeJwtClaims(token) {
    try {
        const [, payload] = token.split(".");
        if (!payload) return undefined;
        const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        const pad =
            b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
        const json = Buffer.from(b64 + pad, "base64").toString("utf8");
        return JSON.parse(json);
    } catch {
        return undefined;
    }
}

const KEY_VAULT_SCOPE = "https://vault.azure.net/.default";

// Resolve an Azure credential without shelling out to `az`. Tries
// DefaultAzureCredential first (which already covers az cli, az
// powershell, VS Code, managed identity, env vars, etc.), and if no
// silent credential is available, falls back to InteractiveBrowserCredential
// to force an interactive login. Prints friendly identity info from the
// access token's claims.
async function getAzureCredential() {
    const tenantId = process.env.AZURE_TENANT_ID;
    const defaultCred = new DefaultAzureCredential(
        tenantId ? { tenantId } : undefined,
    );
    let token;
    try {
        token = await defaultCred.getToken(KEY_VAULT_SCOPE);
    } catch (e) {
        vlog(`silent credential failed: ${e?.message}`);
    }

    if (!token) {
        console.warn(
            chalk.yellowBright(
                "No silent Azure credential available — launching interactive browser login...",
            ),
        );
        const interactive = new InteractiveBrowserCredential({
            ...(tenantId ? { tenantId } : {}),
            // Allow the credential to acquire tokens for any tenant the
            // user has access to — Key Vaults often live in a different
            // tenant than the user's home tenant.
            additionallyAllowedTenants: ["*"],
        });
        token = await interactive.getToken(KEY_VAULT_SCOPE);
        const claims = decodeJwtClaims(token.token);
        const who = claims?.upn ?? claims?.preferred_username ?? claims?.name;
        if (who) console.log(`Logged in as ${chalk.cyanBright(who)}`);
        // Return the interactive credential directly. Wrapping it in a
        // ChainedTokenCredential with DefaultAzureCredential causes the
        // SDK's downstream getToken calls to incorrectly route through
        // DefaultAzureCredential (which has already failed) instead of
        // reusing the just-acquired interactive token.
        return interactive;
    }

    const claims = decodeJwtClaims(token.token);
    const who = claims?.upn ?? claims?.preferred_username ?? claims?.name;
    if (who) console.log(`Logged in as ${chalk.cyanBright(who)}`);
    return defaultCred;
}

class SdkKeyVaultClient {
    static async get() {
        const credential = await getAzureCredential();
        return new SdkKeyVaultClient(credential);
    }

    constructor(credential) {
        this.credential = credential;
        this.clients = new Map();
    }

    clientFor(vaultName) {
        let client = this.clients.get(vaultName);
        if (client === undefined) {
            client = new SecretClient(
                `https://${vaultName}.vault.azure.net`,
                this.credential,
            );
            this.clients.set(vaultName, client);
        }
        return client;
    }

    async getSecrets(vaultName) {
        // Iterate the paged async iterable into the shape the rest of this
        // script expects: [{ id, attributes: { enabled } }].
        const items = [];
        for await (const props of this.clientFor(
            vaultName,
        ).listPropertiesOfSecrets()) {
            items.push({
                id: props.id,
                attributes: { enabled: props.enabled },
            });
        }
        return items;
    }

    async readSecret(vaultName, secretName) {
        const result = await this.clientFor(vaultName).getSecret(secretName);
        return { value: result.value };
    }

    async writeSecret(vaultName, secretName, secretValue) {
        return this.clientFor(vaultName).setSecret(secretName, secretValue);
    }
}

async function getKeyVaultClient() {
    return SdkKeyVaultClient.get();
}

async function readDotenv() {
    if (!fs.existsSync(dotenvPath)) {
        return [];
    }
    const dotenvFile = await fs.promises.readFile(dotenvPath, "utf8");
    const dotEnv = dotenvFile
        .split(/\r?\n/)
        .filter((line) => {
            const trimmed = line.trim();
            return trimmed !== "" && !trimmed.startsWith("#");
        })
        .map((line) => {
            const [key, ...value] = line.split("=");
            const trimmedKey = key.trim();
            if (trimmedKey.includes("-")) {
                throw new Error(
                    `Invalid dotenv key '${trimmedKey}' for key vault. Keys cannot contain dashes.`,
                );
            }
            return [trimmedKey, value.join("=").trimEnd()];
        });
    return dotEnv;
}

/**
 * Read config.local.yaml and flatten to [key, value] pairs compatible with
 * the .env format used by Key Vault secrets.
 */
async function readYamlConfig() {
    if (!fs.existsSync(yamlPath)) {
        return [];
    }
    // Dynamic import — @typeagent/config provides the flatten function that
    // converts the YAML tree to flat KEY=VALUE pairs identical to .env format.
    const { flatten } = await import("@typeagent/config");
    const raw = await fs.promises.readFile(yamlPath, "utf8");
    const tree = yaml.load(raw);
    if (!tree || typeof tree !== "object") return [];
    const flat = flatten(tree);
    return Object.entries(flat);
}

/**
 * Write a Map of env entries back to config.local.yaml by converting
 * flat KEY=VALUE pairs through the config pipeline into a structured
 * YAML tree.
 */
async function writeYamlConfig(envMap) {
    const { envToYamlTree } = await import("@typeagent/config");
    const flat = Object.fromEntries(envMap);
    const tree = envToYamlTree(flat);
    const header = `# TypeAgent configuration — auto-generated by getKeys on ${new Date().toISOString().slice(0, 10)}\n`;
    await fs.promises.mkdir(path.dirname(yamlPath), { recursive: true });
    await fs.promises.writeFile(
        yamlPath,
        header +
            yaml.dump(tree, {
                lineWidth: -1,
                noRefs: true,
                sortKeys: false,
            }),
    );
}

/**
 * Detect output format: explicit --dotenv flag selects legacy dotenv mode.
 * Otherwise default to YAML (the current standard format).
 */
function resolveFormat() {
    if (paramFormat) return paramFormat;
    return "yaml";
}

/**
 * Read config from the appropriate format.
 */
async function readConfig() {
    const format = resolveFormat();
    if (format === "yaml") {
        return {
            entries: await readYamlConfig(),
            format: "yaml",
            path: yamlPath,
        };
    }
    return { entries: await readDotenv(), format: "dotenv", path: dotenvPath };
}

function toSecretKey(envKey) {
    return envKey.split("_").join("-");
}

function toEnvKey(secretKey) {
    return secretKey.split("-").join("_");
}

// Two-phase push: first decide what to do for each secret (possibly
// prompting the user for overwrite confirmation — this MUST run serially so
// prompts don't interleave), then execute the writes in parallel batches.

// Returns { action: "skip" | "create" | "overwrite" | "noop", displayName }
async function planPush(stdio, secrets, secretKey, value, shared = true) {
    const suffix = shared ? "" : " (private)";
    const secretValue = secrets.get(secretKey);
    if (secretValue === value) {
        return { action: "noop", displayName: secretKey };
    }
    if (!paramCommit) {
        if (secrets.has(secretKey)) {
            console.log(
                `  [dry-run] would overwrite ${secretKey}${suffix} (was: ${secretValue?.slice(0, 30)}...)`,
            );
        } else {
            console.log(`  [dry-run] would create ${secretKey}${suffix}`);
        }
        return { action: "noop", displayName: secretKey };
    }
    if (secrets.has(secretKey)) {
        const answer = await stdio.question(
            `  ${secretKey} changed.\n    Current value: ${secretValue}\n    New value: ${value}\n  Are you sure you want to overwrite the value of ${secretKey}? (y/n)`,
        );
        if (answer.toLowerCase() !== "y") {
            console.log("Skipping...");
            return { action: "skip", displayName: secretKey };
        }
        return { action: "overwrite", displayName: secretKey + suffix };
    }
    return { action: "create", displayName: secretKey + suffix };
}

// Parallel writer. `jobs` is an array of
// { vault, secretKey, value, displayName, action }.
async function writePlanInParallel(keyVaultClient, jobs) {
    const concurrency = 20;
    let updated = 0;
    const failures = [];
    for (let i = 0; i < jobs.length; i += concurrency) {
        const batch = jobs.slice(i, i + concurrency);
        const batchResults = await Promise.all(
            batch.map(async (job) => {
                const label =
                    job.action === "create" ? "Creating" : "Overwriting";
                console.log(`  ${label} ${job.displayName}`);
                try {
                    await keyVaultClient.writeSecret(
                        job.vault,
                        job.secretKey,
                        job.value,
                    );
                    return { ok: true };
                } catch (e) {
                    failures.push({
                        secretKey: job.secretKey,
                        error: e.message,
                    });
                    return { ok: false };
                }
            }),
        );
        updated += batchResults.filter((r) => r.ok).length;
    }
    return { updated, failures };
}

function getVaultNames(dotEnv) {
    return {
        shared:
            paramSharedVault ??
            dotEnv.get("TYPEAGENT_SHAREDVAULT") ??
            config.vault.shared,
        private:
            paramPrivateVault ??
            dotEnv.get("TYPEAGENT_PRIVATEVAULT") ??
            undefined,
    };
}

async function pushSecrets() {
    const format = resolveFormat();

    // YAML mode: push the whole file as a single secret
    if (format === "yaml") {
        return pushYamlConfig();
    }

    // Legacy dotenv mode: push individual secrets
    console.log(
        chalk.yellow(
            "[DEPRECATED] Pushing individual .env secrets. Use YAML format instead.\n" +
                "  Run without --dotenv to push config.local.yaml as a single secret.\n",
        ),
    );
    return pushDotenvSecrets();
}

/**
 * Push config.local.yaml as a single secret to Key Vault.
 */
async function pushYamlConfig() {
    if (!fs.existsSync(yamlPath)) {
        console.error(chalk.red(`${yamlPath} not found. Nothing to push.`));
        process.exitCode = 1;
        return;
    }

    const keyVaultClient = await timed("az login check", () =>
        getKeyVaultClient(),
    );
    const vaultName = paramSharedVault ?? config.vault.shared;
    const secretName = config.vault.configSecret ?? "typeagent-config";
    const yamlContent = await fs.promises.readFile(yamlPath, "utf8");

    console.log(
        `Pushing ${chalk.cyanBright(yamlPath)} as '${chalk.cyanBright(secretName)}' to ${chalk.cyanBright(vaultName)} key vault.`,
    );

    if (!paramCommit) {
        console.log(
            `\n[dry-run] Would write secret '${secretName}' to vault '${vaultName}'.\n` +
                `Re-run without ${chalk.yellowBright("--dry-run")} to write.`,
        );
        return;
    }

    try {
        await writeSecretWithElevation(
            keyVaultClient,
            vaultName,
            secretName,
            yamlContent,
        );
        console.log(
            chalk.green(
                `\nSecret '${secretName}' updated in vault '${vaultName}'.`,
            ),
        );
    } catch (e) {
        console.error(
            chalk.red(`Failed to write '${secretName}': ${e.message}`),
        );
        process.exitCode = 1;
    }
}

/**
 * Legacy path: push individual secrets from .env to Key Vault.
 */
async function pushDotenvSecrets() {
    const { entries, format, path: cfgPath } = await readConfig();
    const dotEnv = entries;
    const keyVaultClient = await getKeyVaultClient();
    const vaultNames = getVaultNames(new Map(dotEnv));
    const sharedSecrets = new Map(
        (await getSecrets(keyVaultClient, vaultNames.shared, true)).results,
    );
    const privateSecrets = new Map(
        vaultNames.private
            ? (await getSecrets(keyVaultClient, vaultNames.private, false))
                  .results
            : [],
    );

    console.log(
        `Pushing secrets from ${chalk.cyanBright(cfgPath)} (${format}) to key vault.`,
    );
    let skipped = 0;
    const jobs = [];
    const stdio = readline.createInterface(process.stdin, process.stdout);
    try {
        // Phase 1: plan serially (prompts must not interleave).
        for (const [envKey, value] of dotEnv) {
            const secretKey = toSecretKey(envKey);
            if (isSharedKey(envKey)) {
                const plan = await planPush(
                    stdio,
                    sharedSecrets,
                    secretKey,
                    value,
                    true,
                );
                if (plan.action === "create" || plan.action === "overwrite") {
                    jobs.push({
                        vault: vaultNames.shared,
                        secretKey,
                        value,
                        displayName: plan.displayName,
                        action: plan.action,
                    });
                } else if (plan.action === "skip") {
                    skipped++;
                }
            } else if (privateKeys.includes(envKey)) {
                if (vaultNames.private === undefined) {
                    console.log(`  Skipping private key ${envKey}.`);
                    continue;
                }
                const plan = await planPush(
                    stdio,
                    privateSecrets,
                    secretKey,
                    value,
                    false,
                );
                if (plan.action === "create" || plan.action === "overwrite") {
                    jobs.push({
                        vault: vaultNames.private,
                        secretKey,
                        value,
                        displayName: plan.displayName,
                        action: plan.action,
                    });
                } else if (plan.action === "skip") {
                    skipped++;
                }
            } else {
                console.log(`  Skipping unknown key ${envKey}.`);
            }
        }
    } finally {
        stdio.close();
    }

    // Phase 2: execute writes in parallel (concurrency 5).
    const { updated, failures } = paramCommit
        ? await writePlanInParallel(keyVaultClient, jobs)
        : { updated: 0, failures: [] };

    if (skipped === 0 && updated === 0 && jobs.length === 0) {
        console.log("All values up to date in key vault.");
        return;
    }
    if (skipped !== 0) {
        console.log(`${skipped} secrets skipped.`);
    }
    if (updated !== 0) {
        console.log(`${updated} secrets updated.`);
    }
    if (!paramCommit && jobs.length > 0) {
        console.log(
            `[dry-run] ${jobs.length} secret(s) would be written. Re-run with --commit.`,
        );
    }
    if (failures.length > 0) {
        console.warn(
            chalk.yellow(
                `\n${failures.length} secret write(s) FAILED — values not updated in vault:`,
            ),
        );
        for (const { secretKey, error } of failures) {
            console.warn(chalk.yellow(`  - ${secretKey}: ${error}`));
        }
        process.exitCode = 1;
    }
}

async function pullSecretsFromVault(keyVaultClient, vaultName, shared, dotEnv) {
    const { results: secrets, failures } = await getSecrets(
        keyVaultClient,
        vaultName,
        shared,
    );
    if (secrets.length === 0) {
        console.log(
            chalk.yellow(
                `WARNING: No secrets found in key vault ${chalk.cyanBright(vaultName)}.`,
            ),
        );
        return { updated: undefined, failures };
    }

    const matches = shared
        ? (envKey) => isSharedKey(envKey)
        : (envKey) => privateKeys.includes(envKey);

    let updated = 0;
    for (const [secretKey, value] of secrets) {
        const envKey = toEnvKey(secretKey);
        if (matches(envKey) && dotEnv.get(envKey) !== value) {
            console.log(`  Updating ${envKey}`);
            dotEnv.set(envKey, value);
            updated++;
        }
    }
    return { updated, failures };
}

async function pullSecrets() {
    const overallStart = Date.now();
    const format = resolveFormat();

    // YAML mode: pull the single consolidated config secret directly
    if (format === "yaml") {
        return pullYamlConfig(overallStart);
    }

    // Legacy dotenv mode: pull individual secrets
    console.log(
        chalk.yellow(
            "[DEPRECATED] Pulling individual .env secrets. Use YAML format instead (default for new installs).\n" +
                "  Run without --dotenv to get config.local.yaml.\n",
        ),
    );
    return pullDotenvSecrets(overallStart);
}

/**
 * Pull the single typeagent-config YAML secret from Key Vault and write
 * it directly as config.local.yaml.
 */
async function pullYamlConfig(overallStart) {
    const keyVaultClient = await timed("az login check", () =>
        getKeyVaultClient(),
    );
    const vaultName = paramSharedVault ?? config.vault.shared;
    const secretName = config.vault.configSecret ?? "typeagent-config";

    console.log(
        `Pulling ${chalk.cyanBright(secretName)} from ${chalk.cyanBright(vaultName)} key vault...`,
    );

    let secretValue;
    try {
        const response = await keyVaultClient.readSecret(vaultName, secretName);
        secretValue = response.value;
    } catch (e) {
        console.error(
            chalk.red(
                `Failed to read '${secretName}' from vault '${vaultName}': ${e.message}`,
            ),
        );
        console.log(
            chalk.yellow(
                `\nHint: Make sure the '${secretName}' secret exists in the vault.\n` +
                    `  To push your local config: npm run getKeys -- push --yaml --commit`,
            ),
        );
        process.exitCode = 1;
        return;
    }

    if (!secretValue) {
        console.error(
            chalk.red(
                `Secret '${secretName}' is empty in vault '${vaultName}'.`,
            ),
        );
        process.exitCode = 1;
        return;
    }

    vlog(`pull total elapsed: ${Date.now() - overallStart}ms`);

    if (!paramCommit) {
        console.log(
            `\n[dry-run] Would write ${chalk.cyanBright(yamlPath)} from vault secret '${secretName}'.\n` +
                `Re-run without ${chalk.yellowBright("--dry-run")} to write.`,
        );
        return;
    }

    await fs.promises.mkdir(path.dirname(yamlPath), { recursive: true });
    await fs.promises.writeFile(yamlPath, secretValue, "utf8");
    console.log(
        `\nWritten ${chalk.cyanBright(yamlPath)} from vault secret '${secretName}'.`,
    );

    // If a legacy .env file exists alongside the new YAML config, warn the
    // user so the two formats don't drift out of sync.
    if (fs.existsSync(dotenvPath)) {
        console.warn(
            chalk.yellowBright(
                `\nWARNING: Legacy ${chalk.cyanBright(dotenvPath)} still exists.\n` +
                    `  Only ${chalk.cyanBright(yamlPath)} is used going forward. ` +
                    `Consider deleting the .env file to avoid confusion.`,
            ),
        );
    }
}

/**
 * Legacy path: pull individual secrets and assemble into a .env file.
 */
async function pullDotenvSecrets(overallStart) {
    const cfgPath = dotenvPath;
    const dotEnv = new Map(await timed("readDotenv", () => readDotenv()));
    const keyVaultClient = await timed("az login check", () =>
        getKeyVaultClient(),
    );
    const vaultNames = getVaultNames(dotEnv);
    console.log(`Pulling secrets to ${chalk.cyanBright(cfgPath)} (dotenv)`);
    const sharedResult = await timed(
        `pullSecretsFromVault(shared=${vaultNames.shared})`,
        () =>
            pullSecretsFromVault(
                keyVaultClient,
                vaultNames.shared,
                true,
                dotEnv,
            ),
    );
    const privateResult = vaultNames.private
        ? await timed(
              `pullSecretsFromVault(private=${vaultNames.private})`,
              () =>
                  pullSecretsFromVault(
                      keyVaultClient,
                      vaultNames.private,
                      false,
                      dotEnv,
                  ),
          )
        : undefined;
    vlog(`pull total elapsed: ${Date.now() - overallStart}ms`);

    if (
        sharedResult.updated === undefined &&
        privateResult?.updated === undefined
    ) {
        throw new Error("No secrets found in key vaults.");
    }

    const allFailures = [
        ...(sharedResult.failures ?? []),
        ...(privateResult?.failures ?? []),
    ];

    let updated = (sharedResult.updated ?? 0) + (privateResult?.updated ?? 0);
    for (const key of deleteKeys) {
        if (dotEnv.has(key)) {
            console.log(`  Deleting ${key}`);
            dotEnv.delete(key);
            updated++;
        }
    }
    if (dotEnv.get("TYPEAGENT_SHAREDVAULT") !== vaultNames.shared) {
        console.log(`  Updating TYPEAGENT_SHAREDVAULT`);
        dotEnv.set("TYPEAGENT_SHAREDVAULT", vaultNames.shared);
        updated++;
    }
    if (
        vaultNames.private &&
        dotEnv.get("TYPEAGENT_PRIVATEVAULT") !== vaultNames.private
    ) {
        console.log(`  Updating TYPEAGENT_PRIVATEVAULT`);
        dotEnv.set("TYPEAGENT_PRIVATEVAULT", vaultNames.private);
        updated++;
    }

    if (allFailures.length > 0) {
        console.warn(
            chalk.yellow(
                `\nWARNING: Failed to fetch ${allFailures.length} secret(s) — these values were not updated:`,
            ),
        );
        for (const { name, error } of allFailures) {
            console.warn(chalk.yellow(`  - ${name}: ${error}`));
        }
        process.exitCode = 1;
    }

    if (updated === 0) {
        console.log(`\nAll values up to date in ${chalk.cyanBright(cfgPath)}`);
        return;
    }
    if (!paramCommit) {
        console.log(
            `\n[dry-run] ${updated} value(s) would be updated in ${chalk.cyanBright(cfgPath)}. Re-run without ${chalk.yellowBright("--dry-run")} to write.`,
        );
        return;
    }
    console.log(
        `\n${updated} values updated.\nWriting '${chalk.cyanBright(cfgPath)}'.`,
    );

    await fs.promises.writeFile(
        cfgPath,
        [...dotEnv.entries()]
            .map(([key, value]) => (key ? `${key}=${value}` : ""))
            .join("\n"),
    );
}

function printHelp() {
    console.log(`
${chalk.bold("getKeys")} — Manage TypeAgent secrets in Azure Key Vault

${chalk.bold("Usage:")}
  node getKeys.mjs [command] [options]

${chalk.bold("Commands:")}
  pull        Pull config from Key Vault to local file (default)
  push        Push local config to Key Vault
  help        Show this help message

${chalk.bold("Options:")}
  --yaml      Force YAML format (config.local.yaml) — pulls/pushes a single secret
  --dotenv    Force legacy .env format — pulls/pushes individual secrets (deprecated)
  --vault     Shared vault name (default: aisystems)
  --private   Private vault name
  --commit    Write changes (default)
  --dry-run   Preview changes without writing
  --verbose   Show detailed timing info

${chalk.bold("Default format:")}
  YAML is the default. Pass --dotenv to use the deprecated .env format.

${chalk.bold("YAML mode (default):")}
  pull: Downloads the '${config.vault.configSecret}' secret as config.local.yaml
  push: Uploads config.local.yaml as the '${config.vault.configSecret}' secret

${chalk.bold("Legacy .env mode (--dotenv):")}
  pull: Enumerates individual secrets and assembles .env file
  push: Pushes individual key=value pairs as separate secrets
`);
}

const commands = ["push", "pull", "help"];
(async () => {
    const command = commands.includes(process.argv[2])
        ? process.argv[2]
        : undefined;
    const start = command !== undefined ? 3 : 2;
    for (let i = start; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (arg === "--vault") {
            paramSharedVault = process.argv[i + 1];
            if (paramSharedVault === undefined) {
                throw new Error("Missing value for --vault");
            }
            i++;
            continue;
        }

        if (arg === "--private") {
            paramPrivateVault = process.argv[i + 1];
            if (paramPrivateVault === undefined) {
                throw new Error("Missing value for --private");
            }
            i++;
            continue;
        }

        if (arg === "--commit") {
            // Explicit no-op; commit is the default.
            paramCommit = true;
            continue;
        }

        if (arg === "--dry-run") {
            paramCommit = false;
            continue;
        }

        if (arg === "--verbose" || arg === "-v") {
            paramVerbose = true;
            continue;
        }

        if (arg === "--dotenv") {
            paramFormat = "dotenv";
            continue;
        }

        if (arg === "--yaml") {
            paramFormat = "yaml";
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }
    switch (command) {
        case "push":
            await pushSecrets();
            break;
        case "pull":
        case undefined:
            await pullSecrets();
            break;
        case "help":
            printHelp();
            return;
        default:
            throw new Error(`Unknown argument '${process.argv[2]}'`);
    }
})().catch((e) => {
    console.error(chalk.red(`FATAL ERROR: ${e.stack}`));
    process.exit(-1);
});
