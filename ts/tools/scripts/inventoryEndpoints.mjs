#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Phase 0 of the multi-region endpoint load balancer rollout: enumerate all
// Azure OpenAI accounts, their deployments, and the secret names in the
// shared Key Vault. The output drives Phase A's default priority assignments
// and Phase B's region list.
//
// Usage: node tools/scripts/inventoryEndpoints.mjs [--vault <name>] [--json <path>]

import chalk from "chalk";
import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execAzCliCommand, getAzCliLoggedInInfo } from "./lib/azureUtils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function status(msg) {
    console.log(chalk.gray(msg));
}
function title(msg) {
    console.log(chalk.cyanBright(`\n== ${msg} ==`));
}
function error(msg) {
    console.error(chalk.redBright(msg));
}

function parseArgs() {
    const args = process.argv.slice(2);
    const options = { vault: undefined, json: undefined };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--vault") {
            options.vault = args[++i];
        } else if (args[i] === "--json") {
            options.json = args[++i];
        } else {
            throw new Error(`Unknown argument: ${args[i]}`);
        }
    }
    return options;
}

async function execAsync(command) {
    return new Promise((res, rej) => {
        child_process.exec(command, (err, stdout, stderr) => {
            if (err) {
                rej(err);
                return;
            }
            if (stderr) process.stderr.write(stderr);
            res(stdout);
        });
    });
}

async function listOpenAiAccounts(subscriptionId) {
    status("Listing cognitive services accounts...");
    const raw = await execAzCliCommand([
        "cognitiveservices",
        "account",
        "list",
        "--subscription",
        subscriptionId,
    ]);
    const all = JSON.parse(raw);
    return all.filter((a) => a.kind === "OpenAI" || a.kind === "AIServices");
}

async function listDeployments(account) {
    const raw = await execAzCliCommand([
        "cognitiveservices",
        "account",
        "deployment",
        "list",
        "--name",
        account.name,
        "--resource-group",
        account.resourceGroup,
    ]);
    return JSON.parse(raw);
}

async function listKeyVaultSecrets(vaultName) {
    try {
        const raw = await execAsync(
            `az keyvault secret list --vault-name ${vaultName}`,
        );
        return JSON.parse(raw);
    } catch (e) {
        error(`Could not list secrets from vault ${vaultName}: ${e.message}`);
        return [];
    }
}

function classifyModel(modelName) {
    const n = modelName.toLowerCase();
    if (n.includes("embedding") || n.includes("ada")) return "embedding";
    if (n.includes("image") || n.includes("dalle")) return "image";
    if (n.includes("sora")) return "video";
    return "chat";
}

function skuMode(skuName) {
    if (!skuName) return "unknown";
    if (skuName.includes("Provisioned")) return "PTU";
    if (skuName === "GlobalStandard" || skuName === "Standard") return "PAYG";
    return skuName;
}

async function main() {
    const options = parseArgs();
    const info = await getAzCliLoggedInInfo();

    const accounts = await listOpenAiAccounts(info.subscription.id);
    if (accounts.length === 0) {
        error("No OpenAI / AIServices accounts found in this subscription.");
        process.exit(1);
    }

    const report = {
        subscription: info.subscription,
        accounts: [],
    };

    for (const account of accounts) {
        const deployments = await listDeployments(account);
        report.accounts.push({
            name: account.name,
            location: account.location,
            resourceGroup: account.resourceGroup,
            kind: account.kind,
            customSubDomain:
                account.properties?.customSubDomainName ?? undefined,
            endpoint: account.properties?.endpoint ?? undefined,
            deployments: deployments.map((d) => ({
                name: d.name,
                model: d.properties?.model?.name,
                version: d.properties?.model?.version,
                sku: d.sku?.name,
                capacity: d.sku?.capacity ?? d.properties?.currentCapacity,
                mode: skuMode(d.sku?.name),
                family: classifyModel(d.properties?.model?.name ?? d.name),
            })),
        });
    }

    // Shared KV inventory
    const vaultName = options.vault ?? "aisystems";
    const secrets = await listKeyVaultSecrets(vaultName);
    const openaiSecrets = secrets
        .map((s) => s.id.split("/").pop())
        .filter((name) => /^AZURE-OPENAI-(ENDPOINT|API-KEY)/.test(name))
        .sort();

    report.vault = {
        name: vaultName,
        openaiSecrets,
    };

    // Human-readable output
    title("OpenAI/AIServices accounts by region");
    for (const a of report.accounts) {
        console.log(
            `  ${chalk.yellow(a.location.padEnd(20))} ${chalk.cyan(a.name)} (rg=${a.resourceGroup})`,
        );
        for (const d of a.deployments) {
            console.log(
                `    ${d.family.padEnd(10)} ${d.model ?? "?"}@${d.version ?? "?"} sku=${d.sku ?? "?"} cap=${d.capacity ?? "?"} mode=${d.mode}`,
            );
        }
    }

    title(`Shared KV secrets (${vaultName})`);
    if (openaiSecrets.length === 0) {
        console.log(chalk.yellow("  (no AZURE-OPENAI-* secrets found)"));
    } else {
        for (const name of openaiSecrets) {
            console.log(`  ${name}`);
        }
    }

    // Summary table grouped by family
    title("Pool summary by model family");
    const byFamily = new Map();
    for (const a of report.accounts) {
        for (const d of a.deployments) {
            if (!byFamily.has(d.family)) byFamily.set(d.family, []);
            byFamily.get(d.family).push({
                region: a.location,
                account: a.name,
                model: d.model,
                version: d.version,
                sku: d.sku,
                capacity: d.capacity,
                mode: d.mode,
            });
        }
    }
    for (const [family, rows] of byFamily) {
        console.log(`  ${chalk.yellow(family)}:`);
        for (const r of rows) {
            console.log(
                `    ${r.region.padEnd(20)} ${r.model}@${r.version} sku=${r.sku} cap=${r.capacity} mode=${r.mode} (${r.account})`,
            );
        }
    }

    // JSON output
    const outPath =
        options.json ?? path.resolve(__dirname, "./pools.inventory.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    title(`Wrote ${outPath}`);
}

main().catch((e) => {
    error(`ERROR: ${e.message}`);
    process.exit(1);
});
