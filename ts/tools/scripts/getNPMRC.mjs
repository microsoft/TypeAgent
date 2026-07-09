#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * getNPMRC — provision the internal npm registry config + feed auth for
 * developers, mirroring the getKeys workflow.
 *
 * The repo `.npmrc` points pnpm at an Azure Artifacts feed.
 * Because that URL is internal (and this repo is public), the
 * `.npmrc` is gitignored rather than committed — it is stored as a single Azure
 * Key Vault secret and pulled onto developer machines by this script.
 *
 *   pull (default):
 *     1. Read the '<secret>' secret from the '<vault>' Key Vault -> ts/.npmrc.
 *     2. Install a pnpm `tokenHelper` for the feed in ~/.npmrc that mints a
 *        fresh Azure DevOps token on demand (via the Azure CLI) — so feed auth
 *        auto-refreshes and never goes stale while you are signed in to `az`.
 *   push:
 *     Upload the local ts/.npmrc as the '<secret>' secret (vault writers only).
 *
 * Key Vault auth uses @azure/identity (DefaultAzureCredential, falling back to
 * an interactive browser login) — identical to getKeys. The feed tokenHelper
 * uses the Azure CLI (run `az login` once); pnpm re-runs it on every install.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import chalk from "chalk";
import {
    DefaultAzureCredential,
    InteractiveBrowserCredential,
} from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

const require = createRequire(import.meta.url);
const config = require("./getNPMRC.config.json");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoNpmrcPath = path.resolve(__dirname, config.npmrcPath);
const userNpmrcPath = path.join(os.homedir(), ".npmrc");

const KEY_VAULT_SCOPE = "https://vault.azure.net/.default";
const typeagentDir = path.join(os.homedir(), ".typeagent");

let paramVault = undefined;
let paramSecret = undefined;
let paramCommit = true;
let paramAuthOnly = false;

// --- identity (mirrors getKeys.mjs) --------------------------------------

// Decode a JWT (no signature verification — we only want the claims to print
// friendly identity info).
function decodeJwtClaims(token) {
    try {
        const [, payload] = token.split(".");
        if (!payload) return undefined;
        const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        const pad =
            b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
        return JSON.parse(Buffer.from(b64 + pad, "base64").toString("utf8"));
    } catch {
        return undefined;
    }
}

function printIdentity(jwt) {
    const claims = decodeJwtClaims(jwt);
    const who = claims?.upn ?? claims?.preferred_username ?? claims?.name;
    if (who) console.log(`Logged in as ${chalk.cyanBright(who)}`);
}

// Try DefaultAzureCredential (az cli, az powershell, VS Code, managed identity,
// env vars, ...) and fall back to an interactive browser login. Returns a
// credential usable for Key Vault requests.
async function getAzureCredential() {
    const tenantId = process.env.AZURE_TENANT_ID;
    const defaultCred = new DefaultAzureCredential(
        tenantId ? { tenantId } : undefined,
    );
    let token;
    try {
        token = await defaultCred.getToken(KEY_VAULT_SCOPE);
    } catch {
        // fall through to interactive login below
    }
    if (!token) {
        console.warn(
            chalk.yellowBright(
                "No silent Azure credential available — launching interactive browser login...",
            ),
        );
        const interactive = new InteractiveBrowserCredential({
            ...(tenantId ? { tenantId } : {}),
            // Key Vaults / feeds may live in a different tenant than the
            // user's home tenant.
            additionallyAllowedTenants: ["*"],
        });
        token = await interactive.getToken(KEY_VAULT_SCOPE);
        printIdentity(token.token);
        return interactive;
    }
    printIdentity(token.token);
    return defaultCred;
}

// --- npmrc helpers -------------------------------------------------------

function parseRegistry(npmrcContent) {
    for (const line of npmrcContent.split(/\r?\n/)) {
        const m = line.match(/^\s*registry\s*=\s*(\S+)/);
        if (m) return m[1];
    }
    return undefined;
}

// https://host/path/ -> //host/path/  (the npm auth "nerf dart" key prefix)
function registryToNerfDart(registryUrl) {
    const noScheme = registryUrl.replace(/^https?:/i, "");
    return noScheme.endsWith("/") ? noScheme : noScheme + "/";
}

// Generate a small platform token helper in ~/.typeagent that prints a fresh
// Azure DevOps access token to stdout. pnpm runs it on every feed auth and `az`
// refreshes the token transparently, so auth never goes stale while the az login
// session is valid. Returns the helper's absolute path (forward slashes —
// accepted by both pnpm and Windows, and safe from .npmrc backslash escaping).
function writeTokenHelperScript() {
    fs.mkdirSync(typeagentDir, { recursive: true });
    const adoResource =
        process.env.TYPEAGENT_ADO_RESOURCE ?? config.adoResource;
    const azCmd = `az account get-access-token --resource ${adoResource} --query accessToken --output tsv --only-show-errors`;

    let helperPath;
    if (process.platform === "win32") {
        helperPath = path.join(typeagentDir, "npmrc-token-helper.cmd");
        fs.writeFileSync(helperPath, `@echo off\r\n${azCmd}\r\n`);
    } else {
        // macOS / Linux: an executable shell script. Prepend the common
        // Homebrew/az install locations so the helper finds `az` even when pnpm
        // is launched with a minimal PATH (e.g. a macOS GUI app), while still
        // honoring an `az` already on the inherited PATH.
        helperPath = path.join(typeagentDir, "npmrc-token-helper.sh");
        fs.writeFileSync(
            helperPath,
            `#!/bin/sh\nexport PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"\nexec ${azCmd}\n`,
        );
        fs.chmodSync(helperPath, 0o755);
    }
    return helperPath.replace(/\\/g, "/");
}

// Write/refresh the feed tokenHelper in ~/.npmrc without disturbing the user's
// other registry credentials (office / msctoproj / etc.). Also clears any prior
// static _authToken for the same registry.
function upsertTokenHelper(nerfDart, helperPath) {
    const line = `${nerfDart}:tokenHelper=${helperPath}`;
    let lines = fs.existsSync(userNpmrcPath)
        ? fs.readFileSync(userNpmrcPath, "utf8").split(/\r?\n/)
        : [];
    const esc = nerfDart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stale = new RegExp(
        `^${esc}:(_authToken|tokenHelper|username|_password|email)=`,
    );
    lines = lines.filter((l) => !stale.test(l));
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push(line);
    fs.writeFileSync(userNpmrcPath, lines.join("\n") + "\n");
}

// Quick, non-fatal check that the Azure CLI is available and signed in — the
// feed tokenHelper depends on it at pnpm-install time.
async function hasAzLogin() {
    try {
        const { execFileSync } = await import("node:child_process");
        execFileSync("az", ["account", "show"], {
            stdio: "ignore",
            shell: process.platform === "win32",
        });
        return true;
    } catch {
        return false;
    }
}

// --- commands ------------------------------------------------------------

async function pull() {
    const vault = paramVault ?? config.vault;
    const secret = paramSecret ?? config.secret;

    let npmrcContent;
    if (paramAuthOnly) {
        if (!fs.existsSync(repoNpmrcPath)) {
            console.error(
                chalk.red(
                    `${repoNpmrcPath} not found — run without --auth-only first.`,
                ),
            );
            process.exitCode = 1;
            return;
        }
        npmrcContent = fs.readFileSync(repoNpmrcPath, "utf8");
    } else {
        console.log(
            `Pulling ${chalk.cyanBright(secret)} from ${chalk.cyanBright(vault)} key vault...`,
        );
        const credential = await getAzureCredential();
        const client = new SecretClient(
            `https://${vault}.vault.azure.net`,
            credential,
        );
        let value;
        try {
            value = (await client.getSecret(secret)).value;
        } catch (e) {
            console.error(
                chalk.red(
                    `Failed to read '${secret}' from vault '${vault}': ${e?.message ?? String(e)}`,
                ),
            );
            console.log(
                chalk.yellow(
                    `\nHint: seed it first with:  npm run getNPMRC -- push`,
                ),
            );
            process.exitCode = 1;
            return;
        }
        if (!value) {
            console.error(chalk.red(`Secret '${secret}' is empty.`));
            process.exitCode = 1;
            return;
        }
        npmrcContent = value;
        if (paramCommit) {
            await fs.promises.writeFile(repoNpmrcPath, npmrcContent, "utf8");
            console.log(`Written ${chalk.cyanBright(repoNpmrcPath)}.`);
        } else {
            console.log(
                `[dry-run] Would write ${chalk.cyanBright(repoNpmrcPath)}.`,
            );
        }
    }

    // Feed auth: install a pnpm tokenHelper that mints a fresh Azure DevOps
    // token on demand (auto-refreshing) instead of a static, short-lived token.
    const registry = parseRegistry(npmrcContent);
    if (!registry) {
        console.warn(
            chalk.yellow("No registry= line in .npmrc — skipping feed auth."),
        );
        return;
    }
    const nerfDart = registryToNerfDart(registry);
    if (!paramCommit) {
        console.log(
            `[dry-run] Would install a feed tokenHelper for ${chalk.cyanBright(registry)}.`,
        );
        return;
    }
    const helperPath = writeTokenHelperScript();
    upsertTokenHelper(nerfDart, helperPath);
    console.log(
        chalk.green(
            `Feed tokenHelper installed in ${chalk.cyanBright(userNpmrcPath)} (auto-refreshes via az).`,
        ),
    );
    if (!(await hasAzLogin())) {
        console.warn(
            chalk.yellowBright(
                "\nWARNING: `az` is not signed in (or not installed). Run `az login` so the\n" +
                    "feed tokenHelper can mint tokens — otherwise `pnpm install` will 401.",
            ),
        );
    }
}

async function push() {
    if (!fs.existsSync(repoNpmrcPath)) {
        console.error(
            chalk.red(`${repoNpmrcPath} not found. Nothing to push.`),
        );
        process.exitCode = 1;
        return;
    }
    const content = await fs.promises.readFile(repoNpmrcPath, "utf8");
    const vault = paramVault ?? config.vault;
    const secret = paramSecret ?? config.secret;
    const credential = await getAzureCredential();
    console.log(
        `Pushing ${chalk.cyanBright(repoNpmrcPath)} as '${chalk.cyanBright(secret)}' to ${chalk.cyanBright(vault)} key vault.`,
    );
    if (!paramCommit) {
        console.log(
            `[dry-run] Would write secret '${secret}' to vault '${vault}'.`,
        );
        return;
    }
    const client = new SecretClient(
        `https://${vault}.vault.azure.net`,
        credential,
    );
    try {
        await client.setSecret(secret, content);
        console.log(
            chalk.green(`Secret '${secret}' updated in vault '${vault}'.`),
        );
    } catch (e) {
        console.error(
            chalk.red(
                `Failed to write '${secret}': ${e?.message ?? String(e)}`,
            ),
        );
        process.exitCode = 1;
    }
}

function printHelp() {
    console.log(`
${chalk.bold("getNPMRC")} — provision the internal npm registry config + feed auth

${chalk.bold("Usage:")}
  node getNPMRC.mjs [command] [options]

${chalk.bold("Commands:")}
  pull    Download ts/.npmrc from Key Vault and set up feed auth (default)
  push    Upload local ts/.npmrc to Key Vault (vault writers only)
  help    Show this help

${chalk.bold("Options:")}
  --auth-only   Skip the Key Vault download; just (re)install the feed tokenHelper
  --vault <n>   Key Vault name (default: ${config.vault})
  --secret <n>  Secret name (default: ${config.secret})
  --commit      Write changes (default)
  --dry-run     Preview without writing

Feed auth uses a pnpm tokenHelper backed by the Azure CLI — run 'az login' once
and tokens refresh automatically.
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
            paramVault = process.argv[++i];
            if (paramVault === undefined) {
                throw new Error("Missing value for --vault");
            }
            continue;
        }
        if (arg === "--secret") {
            paramSecret = process.argv[++i];
            if (paramSecret === undefined) {
                throw new Error("Missing value for --secret");
            }
            continue;
        }
        if (arg === "--auth-only") {
            paramAuthOnly = true;
            continue;
        }
        if (arg === "--commit") {
            paramCommit = true;
            continue;
        }
        if (arg === "--dry-run") {
            paramCommit = false;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    switch (command) {
        case "push":
            await push();
            break;
        case "pull":
        case undefined:
            await pull();
            break;
        case "help":
            printHelp();
            break;
    }
})().catch((e) => {
    console.error(chalk.red(`FATAL ERROR: ${e.stack ?? e.message}`));
    process.exit(1);
});
