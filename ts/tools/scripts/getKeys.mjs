#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { getClient as getPIMClient } from "./lib/pimClient.mjs";
import { getAzCliLoggedInInfo } from "./lib/azureUtils.mjs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import chalk from "chalk";
import { exit } from "node:process";
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

const require = createRequire(import.meta.url);
const config = require("./getKeys.config.json");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dotenvPath = path.resolve(__dirname, config.defaultDotEnvPath);
const sharedKeys = config.env.shared;
const privateKeys = config.env.private;
const deleteKeys = config.env.delete;
const sharedPatterns = (config.env.sharedPatterns ?? []).map(
    (p) => new RegExp(p),
);
let paramSharedVault = undefined;
let paramPrivateVault = undefined;
let paramCommit = false;
let paramVerbose = false;

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

async function getSecretListWithElevation(keyVaultClient, vaultName) {
    try {
        return await keyVaultClient.getSecrets(vaultName);
    } catch (e) {
        if (!isForbiddenByRbac(e)) {
            throw e;
        }

        try {
            console.warn(chalk.yellowBright("Elevating to get secrets..."));
            const pimClient = await getPIMClient();
            await pimClient.elevate({
                requestType: "SelfActivate",
                roleName: "Key Vault Administrator",
                expirationType: "AfterDuration",
                expirationDuration: "PT5M", // activate for 5 minutes
                continueOnFailure: true,
            });

            // Wait for the role to be activated
            console.log(chalk.green("Elevation successful."));
            console.warn(chalk.yellowBright("Waiting 5 seconds..."));
            await new Promise((res) => setTimeout(res, 5000));

            return await keyVaultClient.getSecrets(vaultName);
        } catch (e) {
            console.warn(
                chalk.yellow(
                    "Elevation to key vault admin failed...attempting to get secrets as key vault reader.",
                ),
            );
        }

        try {
            console.warn(chalk.yellowBright("Elevating to get secrets..."));
            const pimClient = await getPIMClient();
            await pimClient.elevate({
                requestType: "SelfActivate",
                roleName: "Key Vault Secrets User",
                expirationType: "AfterDuration",
                expirationDuration: "PT5M", // activate for 5 minutes
                continueOnFailure: true,
            });

            // Wait for the role to be activated
            console.log(chalk.green("Elevation successful."));
            console.warn(chalk.yellowBright("Waiting 5 seconds..."));
            await new Promise((res) => setTimeout(res, 5000));
        } catch (e) {
            console.warn(
                chalk.yellow(
                    "Elevation failed...attempting to get secrets without elevation.",
                ),
            );
        }

        return await keyVaultClient.getSecrets(vaultName);
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

class SdkKeyVaultClient {
    static async get() {
        // Print friendly identity info (one az call, like before). The actual
        // secret operations below use DefaultAzureCredential — no more shell-outs.
        try {
            await getAzCliLoggedInInfo();
        } catch (e) {
            console.error(
                "ERROR: User not logged in to Azure CLI. Run 'az login'.",
            );
            process.exit(1);
        }
        return new SdkKeyVaultClient(new DefaultAzureCredential());
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
    const dotEnv = await readDotenv();
    const keyVaultClient = await getKeyVaultClient();
    const vaultNames = getVaultNames(dotEnv);
    const sharedSecrets = new Map(
        await getSecrets(keyVaultClient, vaultNames.shared, true),
    );
    const privateSecrets = new Map(
        vaultNames.private
            ? await getSecrets(keyVaultClient, vaultNames.private, false)
            : undefined,
    );

    console.log(`Pushing secrets from ${dotenvPath} to key vault.`);
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
    const dotEnv = new Map(await timed("readDotenv", () => readDotenv()));
    const keyVaultClient = await timed("az login check", () =>
        getKeyVaultClient(),
    );
    const vaultNames = getVaultNames(dotEnv);
    console.log(`Pulling secrets to ${chalk.cyanBright(dotenvPath)}`);
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
                `\nWARNING: Failed to fetch ${allFailures.length} secret(s) — these values were not updated in .env:`,
            ),
        );
        for (const { name, error } of allFailures) {
            console.warn(chalk.yellow(`  - ${name}: ${error}`));
        }
        process.exitCode = 1;
    }

    if (updated === 0) {
        console.log(
            `\nAll values up to date in ${chalk.cyanBright(dotenvPath)}`,
        );
        return;
    }
    if (!paramCommit) {
        console.log(
            `\n[dry-run] ${updated} value(s) would be updated in ${chalk.cyanBright(dotenvPath)}. Re-run with ${chalk.yellowBright("--commit")} to write.`,
        );
        return;
    }
    console.log(
        `\n${updated} values updated.\nWriting '${chalk.cyanBright(dotenvPath)}'.`,
    );

    await fs.promises.writeFile(
        dotenvPath,
        [...dotEnv.entries()]
            .map(([key, value]) => (key ? `${key}=${value}` : ""))
            .join("\n"),
    );
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
            paramCommit = true;
            continue;
        }

        if (arg === "--dry-run") {
            // Explicit no-op; dry-run is the default.
            paramCommit = false;
            continue;
        }

        if (arg === "--verbose" || arg === "-v") {
            paramVerbose = true;
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
    if (
        e.message.includes(
            "'az' is not recognized as an internal or external command",
        )
    ) {
        console.error(
            chalk.red(
                `ERROR: Azure CLI is not installed. Install it and run 'az login' before running this tool.`,
            ),
        );
        // eslint-disable-next-line no-undef
        exit(0);
    }

    console.error(chalk.red(`FATAL ERROR: ${e.stack}`));
    process.exit(-1);
});
