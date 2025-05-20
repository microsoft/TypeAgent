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
let paramSharedVault = undefined;
let paramPrivateVault = undefined;

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
    const p = [];
    for (const secret of secretList) {
        if (secret.attributes.enabled) {
            const secretName = secret.id.split("/").pop();
            p.push(
                (async () => {
                    const response = await keyVaultClient.readSecret(
                        vaultName,
                        secretName,
                    );
                    return [secretName, response.value];
                })(),
            );
        }
    }

    return Promise.all(p);
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
            await execAsync(
                `az keyvault secret list --vault-name ${vaultName}`,
            ),
        );
    }

    async readSecret(vaultName, secretName) {
        return JSON.parse(
            await execAsync(
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
    const dotEnv = dotenvFile.split("\n").map((line) => {
        const [key, ...value] = line.split("=");
        if (key.includes("-")) {
            throw new Error(
                `Invalid dotenv key '${key}' for key vault. Keys cannot contain dashes.`,
            );
        }
        return [key, value.join("=")];
    });
    return dotEnv;
}

function toSecretKey(envKey) {
    return envKey.split("_").join("-");
}

function toEnvKey(secretKey) {
    return secretKey.split("-").join("_");
}

// Return 0 if the value is the same. -1 if the user skipped. 1 if the value was updated.
async function pushSecret(
    stdio,
    keyVaultClient,
    vault,
    secrets,
    secretKey,
    value,
    shared = true,
) {
    const suffix = shared ? "" : " (private)";
    const secretValue = secrets.get(secretKey);
    if (secretValue === value) {
        return 0;
    }
    if (secrets.has(secretKey)) {
        const answer = await stdio.question(
            `  ${secretKey} changed.\n    Current value: ${secretValue}\n    New value: ${value}\n  Are you sure you want to overwrite the value of ${secretKey}? (y/n)`,
        );
        if (answer.toLowerCase() !== "y") {
            console.log("Skipping...");
            return -1;
        }
        console.log(`  Overwriting ${secretKey}${suffix}`);
    } else {
        console.log(`  Creating ${secretKey}${suffix}`);
    }
    await keyVaultClient.writeSecret(vault, secretKey, value);
    return 1;
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
    let updated = 0;
    let skipped = 0;
    const stdio = readline.createInterface(process.stdin, process.stdout);
    try {
        for (const [envKey, value] of dotEnv) {
            const secretKey = toSecretKey(envKey);
            if (sharedKeys.includes(envKey)) {
                const result = await pushSecret(
                    stdio,
                    keyVaultClient,
                    vaultNames.shared,
                    sharedSecrets,
                    secretKey,
                    value,
                );
                if (result === 1) {
                    updated++;
                }
                if (result === -1) {
                    skipped++;
                }
            } else if (privateKeys.includes(envKey)) {
                if (privateVault === undefined) {
                    console.log(`  Skipping private key ${envKey}.`);
                    continue;
                }
                const result = await pushSecret(
                    stdio,
                    keyVaultClient,
                    vaultNames.private,
                    privateSecrets,
                    secretKey,
                    value,
                    false,
                );
                if (result === 1) {
                    updated++;
                }
                if (result === -1) {
                    skipped++;
                }
            } else {
                console.log(`  Skipping unknown key ${envKey}.`);
            }
        }
    } finally {
        stdio.close();
    }
    if (skipped === 0 && updated === 0) {
        console.log("All values up to date in key vault.");
        return;
    }
    if (skipped !== 0) {
        console.log(`${skipped} secrets skipped.`);
    }
    if (updated !== 0) {
        console.log(`${updated} secrets updated.`);
    }
}

async function pullSecretsFromVault(keyVaultClient, vaultName, shared, dotEnv) {
    const keys = shared ? sharedKeys : privateKeys;
    const secrets = await getSecrets(keyVaultClient, vaultName, shared);
    if (secrets.length === 0) {
        console.log(
            chalk.yellow(
                `WARNING: No secrets found in key vault ${chalk.cyanBright(vaultName)}.`,
            ),
        );
        return undefined;
    }

    let updated = 0;
    for (const [secretKey, value] of secrets) {
        const envKey = toEnvKey(secretKey);
        if (keys.includes(envKey) && dotEnv.get(envKey) !== value) {
            console.log(`  Updating ${envKey}`);
            dotEnv.set(envKey, value);
            updated++;
        }
    }
    return updated;
}

async function pullSecrets() {
    const dotEnv = new Map(await readDotenv());
    const keyVaultClient = await getKeyVaultClient();
    const vaultNames = getVaultNames(dotEnv);
    console.log(`Pulling secrets to ${chalk.cyanBright(dotenvPath)}`);
    const sharedUpdated = await pullSecretsFromVault(
        keyVaultClient,
        vaultNames.shared,
        true,
        dotEnv,
    );
    const privateUpdated = vaultNames.private
        ? await pullSecretsFromVault(
              keyVaultClient,
              vaultNames.private,
              false,
              dotEnv,
          )
        : undefined;

    if (sharedUpdated === undefined && privateUpdated === undefined) {
        throw new Error("No secrets found in key vaults.");
    }

    let updated = (sharedUpdated ?? 0) + (privateUpdated ?? 0);
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

    if (updated === 0) {
        console.log(
            `\nAll values up to date in ${chalk.cyanBright(dotenvPath)}`,
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
