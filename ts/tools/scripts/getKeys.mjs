#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import child_process from "node:child_process";
import readline from "node:readline/promises";
import { getClient as getPIMClient } from "./lib/pimClient.mjs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import chalk from "chalk";
import { exit } from "node:process";

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

function matchesSharedPattern(envKey) {
    return sharedPatterns.some((re) => re.test(envKey));
}

function isSharedKey(envKey) {
    return sharedKeys.includes(envKey) || matchesSharedPattern(envKey);
}

async function getSecretListWithElevation(keyVaultClient, vaultName) {
    try {
        return await keyVaultClient.getSecrets(vaultName);
    } catch (e) {
        if (!e.message.includes("ForbiddenByRbac")) {
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
    console.log(
        `Getting existing ${shared ? "shared" : "private"} secrets from ${chalk.cyanBright(vaultName)} key vault.`,
    );
    const secretList = await getSecretListWithElevation(
        keyVaultClient,
        vaultName,
    );
    const enabled = secretList
        .filter((s) => s.attributes.enabled)
        .map((s) => s.id.split("/").pop());

    const results = [];
    const failures = [];
    const concurrency = 5;
    for (let i = 0; i < enabled.length; i += concurrency) {
        const batch = enabled.slice(i, i + concurrency);
        const batchResults = await Promise.all(
            batch.map(async (secretName) => {
                try {
                    const response = await keyVaultClient.readSecret(
                        vaultName,
                        secretName,
                    );
                    return [secretName, response.value];
                } catch (e) {
                    failures.push({ name: secretName, error: e.message });
                    return null;
                }
            }),
        );
        results.push(...batchResults.filter((r) => r !== null));
    }

    return { results, failures };
}

async function execAsync(command, options) {
    return new Promise((res, rej) => {
        child_process.exec(command, options, (err, stdout, stderr) => {
            if (err) {
                rej(err);
                return;
            }
            if (stderr) {
                console.log(stderr + stdout);
            }
            res(stdout);
        });
    });
}

async function execWithRetry(command, options, maxRetries = 3) {
    const SSL_ERROR = "SSL: UNEXPECTED_EOF_WHILE_READING";
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await execAsync(command, options);
        } catch (e) {
            if (attempt < maxRetries && e.message.includes(SSL_ERROR)) {
                const delay = attempt * 1000;
                console.warn(
                    chalk.yellow(
                        `SSL error on attempt ${attempt}/${maxRetries}, retrying in ${delay}ms...`,
                    ),
                );
                await new Promise((res) => setTimeout(res, delay));
            } else {
                throw e;
            }
        }
    }
}

class AzCliKeyVaultClient {
    static async get() {
        // We use this to validate that the user is logged in (already ran `az login`).
        try {
            const account = JSON.parse(await execAsync("az account show"));
            console.log(`Logged in as ${chalk.cyanBright(account.user.name)}`);
        } catch (e) {
            console.error(
                "ERROR: User not logged in to Azure CLI. Run 'az login'.",
            );
            process.exit(1);
        }
        // Note: 'az keyvault' commands work regardless of which subscription is currently "in context",
        // as long as the user is listed in the vault's access policy, so we don't need to do 'az account set'.
        return new AzCliKeyVaultClient();
    }

    async getSecrets(vaultName) {
        return JSON.parse(
            await execWithRetry(
                `az keyvault secret list --vault-name ${vaultName}`,
            ),
        );
    }

    async readSecret(vaultName, secretName) {
        return JSON.parse(
            await execWithRetry(
                `az keyvault secret show --vault-name ${vaultName} --name ${secretName}`,
            ),
        );
    }

    async writeSecret(vaultName, secretName, secretValue) {
        return JSON.parse(
            await execAsync(
                `az keyvault secret set --vault-name ${vaultName} --name ${secretName} --value '${secretValue}'`,
            ),
        );
    }
}

async function getKeyVaultClient() {
    return AzCliKeyVaultClient.get();
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

// Concurrency-5 parallel writer. `jobs` is an array of
// { vault, secretKey, value, displayName, action }.
async function writePlanInParallel(keyVaultClient, jobs) {
    const concurrency = 5;
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
    const dotEnv = new Map(await readDotenv());
    const keyVaultClient = await getKeyVaultClient();
    const vaultNames = getVaultNames(dotEnv);
    console.log(`Pulling secrets to ${chalk.cyanBright(dotenvPath)}`);
    const sharedResult = await pullSecretsFromVault(
        keyVaultClient,
        vaultNames.shared,
        true,
        dotEnv,
    );
    const privateResult = vaultNames.private
        ? await pullSecretsFromVault(
              keyVaultClient,
              vaultNames.private,
              false,
              dotEnv,
          )
        : undefined;

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
