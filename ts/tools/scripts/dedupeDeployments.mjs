#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Dedupe Azure OpenAI deployments that share (account, model family, mode).
// For each duplicate group, picks a winner (highest SKU tier, then highest
// capacity) and plans the deletion of the losers. BEFORE deleting, scans the
// shared Key Vault for any secret whose value references the loser's
// endpoint URL and re-points those secrets to the winner. This prevents
// runtime breakage on the live app.
//
// Dry-run by default. Nothing mutates until you pass --commit.
//
// Usage:
//   node tools/scripts/dedupeDeployments.mjs [--vault aisystems]
//   node tools/scripts/dedupeDeployments.mjs --commit

import chalk from "chalk";
import child_process from "node:child_process";
import { execAzCliCommand, getAzCliLoggedInInfo } from "./lib/azureUtils.mjs";

// --------------- arg parsing ---------------

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        vault: "aisystems",
        commit: false,
        dropDeployments: new Set(),
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--vault":
                options.vault = args[++i];
                break;
            case "--commit":
                options.commit = true;
                break;
            case "--dry-run":
                // Explicitly no-op: dry-run is the default. Accepted for
                // clarity / muscle memory.
                options.commit = false;
                break;
            case "--drop-deployment":
                // Force-drop these specific deployments regardless of
                // classification. Useful when you want to retire an entire
                // alias group (e.g. France's gpt-4/gpt-4-32k) without any
                // replacement. Any KV secret referencing a dropped
                // deployment with no available winner is deleted too.
                for (const name of (args[++i] ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)) {
                    options.dropDeployments.add(name);
                }
                break;
            default:
                throw new Error(`Unknown argument: ${args[i]}`);
        }
    }
    return options;
}

// --------------- logging ---------------

const status = (m) => console.log(chalk.gray(m));
const info = (m) => console.log(m);
const ok = (m) => console.log(chalk.greenBright(m));
const warn = (m) => console.error(chalk.yellowBright(m));
const errLog = (m) => console.error(chalk.redBright(m));

// --------------- classification ---------------

function skuMode(skuName) {
    if (!skuName) return "unknown";
    if (skuName.includes("Provisioned")) return "PTU";
    return "PAYG";
}

// Higher rank = better. GlobalStandard > Standard. ProvisionedManaged is in
// its own mode bucket so we never rank it against PAYG deployments.
function skuRank(skuName) {
    if (!skuName) return 0;
    if (skuName === "GlobalStandard") return 3;
    if (skuName === "Standard") return 2;
    if (skuName === "ProvisionedManaged") return 10;
    return 1;
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Mirrors modelNameToSuffix in syncPoolSecrets.mjs — translate an OpenAI model
// name (e.g. "gpt-4o", "text-embedding-ada-002") into the env-var suffix
// convention this repo uses (e.g. "GPT_4_O", "EMBEDDING").
function modelNameToSuffix(modelName) {
    if (!modelName) return undefined;
    let n = modelName.toLowerCase();
    // Specific embedding models before the generic EMBEDDING fallback.
    if (n === "text-embedding-3-small") return "EMBEDDING_3_SMALL";
    if (n === "text-embedding-3-large") return "EMBEDDING_3_LARGE";
    if (n === "text-embedding-ada-002" || /^ada(-\d+)?$/.test(n)) {
        return "EMBEDDING";
    }
    if (n.includes("embedding")) return "EMBEDDING";
    if (n === "gpt-image-1.5") return "GPT_IMAGE_1_5";
    if (n === "gpt-image-1") return "GPT_IMAGE_1";
    if (n.startsWith("dall-e") || n === "dalle") return "DALLE";
    if (n === "sora-2" || n === "sora") return "SORA_2";
    // Preserve the repo's "GPT_4_O" separator convention (see note in
    // syncPoolSecrets.mjs).
    n = n.replace(/gpt-4o/g, "gpt-4-o");
    const upper = n.replace(/[.\-]/g, "_").replace(/__+/g, "_").toUpperCase();
    if (upper === "GPT_35_TURBO_16K") return "GPT_35_TURBO";
    return upper;
}

const REGION_TOKENS = new Set([
    "EASTUS",
    "EASTUS2",
    "WESTUS",
    "WESTUS2",
    "WESTUS3",
    "CENTRALUS",
    "NORTHCENTRALUS",
    "SOUTHCENTRALUS",
    "WESTCENTRALUS",
    "SWEDENCENTRAL",
    "FRANCECENTRAL",
    "GERMANYWESTCENTRAL",
    "NORWAYEAST",
    "NORTHEUROPE",
    "WESTEUROPE",
    "UKSOUTH",
    "UKWEST",
    "SWITZERLANDNORTH",
    "JAPANEAST",
    "JAPANWEST",
    "AUSTRALIAEAST",
    "KOREACENTRAL",
    "SOUTHEASTASIA",
    "EASTASIA",
    "CENTRALINDIA",
    "SOUTHINDIA",
    "BRAZILSOUTH",
    "CANADACENTRAL",
    "CANADAEAST",
    "SWEDEN",
    "JAPAN",
    "AUSTRALIA",
    "BRAZIL",
    "CANADA",
    "KOREA",
    "UK",
]);

// Normalize a model or deployment name for comparison:
// lowercase, drop dots (so "gpt-4.1-mini" == "gpt-41-mini"), strip common
// verbose prefixes ("text-embedding-ada-002" → "ada-002").
function normalizeForMatch(name) {
    if (!name) return "";
    return name
        .toLowerCase()
        .replace(/^text-embedding-/, "")
        .replace(/\./g, "");
}

// Classify a deployment's name relative to the model it actually serves:
//   canonical: name matches the model (e.g. "gpt-4o" serving gpt-4o,
//              "ada-002" serving text-embedding-ada-002).
//   tagged:    name starts with the model and adds a purpose token
//              (e.g. "ada-002-indexing" serving text-embedding-ada-002).
//              The tag is kept and surfaces as a distinct secret name.
//   legacy:    name starts with the model and adds a numeric suffix
//              (e.g. "gpt-4o-2", "gpt-4o-v3"). Historical capacity-stacking
//              variants, not purposeful ones. We don't surface these as pool
//              members and don't dedupe them — keep them running for
//              existing consumers while new canonical names get provisioned
//              and migrated to.
//   alias:     name doesn't match the model (e.g. "gpt-35-turbo"
//              serving gpt-4.1-mini — a historical in-place upgrade). An
//              alias is a dedupe candidate; we'd rather drop it than keep
//              a misleading deployment name.
function classifyDeployment(deploymentName, modelName) {
    const model = normalizeForMatch(modelName);
    const d = normalizeForMatch(deploymentName);
    if (!model || !d) return { kind: "alias", tag: undefined };
    if (d === model) return { kind: "canonical", tag: undefined };
    if (d.startsWith(model + "-")) {
        const tag = d.slice(model.length + 1);
        // Numeric-only tags (including v-prefixed) are legacy capacity-stacking
        // variants, not purposeful tags.
        if (/^v?\d+$/i.test(tag)) return { kind: "legacy", tag };
        return { kind: "tagged", tag };
    }
    return { kind: "alias", tag: undefined };
}

// Parse the model-family suffix out of a secret name:
//   AZURE-OPENAI-ENDPOINT-GPT-35-TURBO            -> "GPT_35_TURBO"
//   AZURE-OPENAI-ENDPOINT-GPT-4-O-EASTUS          -> "GPT_4_O"
//   AZURE-OPENAI-API-KEY-GPT-4-O-EASTUS-PTU       -> "GPT_4_O"
//   AZURE-OPENAI-ENDPOINT-EMBEDDING               -> "EMBEDDING"
// Returns undefined if the name doesn't fit the convention.
function extractModelFromSecret(secretName) {
    let s = secretName;
    if (s.startsWith("AZURE-OPENAI-ENDPOINT-")) {
        s = s.slice("AZURE-OPENAI-ENDPOINT-".length);
    } else if (s.startsWith("AZURE-OPENAI-API-KEY-")) {
        s = s.slice("AZURE-OPENAI-API-KEY-".length);
    } else {
        return undefined;
    }
    if (s.endsWith("-PTU")) s = s.slice(0, -"-PTU".length);
    const tokens = s.split("-");
    // Strip a trailing region token if present.
    if (tokens.length > 1 && REGION_TOKENS.has(tokens[tokens.length - 1])) {
        tokens.pop();
    }
    return tokens.join("_");
}

// --------------- azure queries ---------------

async function listAccounts(subscriptionId) {
    status("Listing OpenAI / AIServices accounts...");
    const raw = await execAzCliCommand([
        "cognitiveservices",
        "account",
        "list",
        "--subscription",
        subscriptionId,
    ]);
    return JSON.parse(raw).filter(
        (a) => a.kind === "OpenAI" || a.kind === "AIServices",
    );
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

async function listVaultSecretNames(vault) {
    return new Promise((resolve, reject) => {
        child_process.execFile(
            "az",
            [
                "keyvault",
                "secret",
                "list",
                "--vault-name",
                vault,
                "--query",
                "[].name",
            ],
            { shell: true },
            (e, stdout, stderr) => {
                if (e) {
                    reject(
                        new Error(
                            `az keyvault secret list failed: ${stderr || e.message}`,
                        ),
                    );
                    return;
                }
                try {
                    resolve(JSON.parse(stdout));
                } catch {
                    resolve([]);
                }
            },
        );
    });
}

async function readSecret(vault, name) {
    return new Promise((resolve, reject) => {
        child_process.execFile(
            "az",
            [
                "keyvault",
                "secret",
                "show",
                "--vault-name",
                vault,
                "--name",
                name,
                "--query",
                "value",
                "-o",
                "tsv",
            ],
            { shell: true },
            (e, stdout, stderr) => {
                if (e) {
                    reject(
                        new Error(
                            `az keyvault secret show ${name} failed: ${stderr || e.message}`,
                        ),
                    );
                    return;
                }
                resolve(stdout.trimEnd());
            },
        );
    });
}

async function writeSecret(vault, name, value) {
    return new Promise((resolve, reject) => {
        child_process.execFile(
            "az",
            [
                "keyvault",
                "secret",
                "set",
                "--vault-name",
                vault,
                "--name",
                name,
                "--value",
                value,
                "--output",
                "none",
            ],
            { shell: true },
            (e, _stdout, stderr) => {
                if (e) {
                    reject(
                        new Error(
                            `az keyvault secret set ${name} failed: ${stderr || e.message}`,
                        ),
                    );
                    return;
                }
                resolve();
            },
        );
    });
}

async function deleteSecret(vault, name) {
    return new Promise((resolve, reject) => {
        child_process.execFile(
            "az",
            [
                "keyvault",
                "secret",
                "delete",
                "--vault-name",
                vault,
                "--name",
                name,
                "--output",
                "none",
            ],
            { shell: true },
            (e, _stdout, stderr) => {
                if (e) {
                    reject(
                        new Error(
                            `az keyvault secret delete ${name} failed: ${stderr || e.message}`,
                        ),
                    );
                    return;
                }
                resolve();
            },
        );
    });
}

async function deleteDeployment(account, deploymentName) {
    return execAzCliCommand([
        "cognitiveservices",
        "account",
        "deployment",
        "delete",
        "--name",
        account.name,
        "--resource-group",
        account.resourceGroup,
        "--deployment-name",
        deploymentName,
    ]);
}

// --------------- dedupe plan ---------------

function compareBySkuAndCap(a, b) {
    const sa = skuRank(a.sku?.name);
    const sb = skuRank(b.sku?.name);
    if (sa !== sb) return sb - sa;
    const ca = a.sku?.capacity ?? a.properties?.currentCapacity ?? 0;
    const cb = b.sku?.capacity ?? b.properties?.currentCapacity ?? 0;
    if (ca !== cb) return cb - ca;
    const va = a.properties?.model?.version ?? "";
    const vb = b.properties?.model?.version ?? "";
    return vb.localeCompare(va);
}

function buildDedupePlan(accounts, dropDeployments) {
    // group key: accountId | modelName | mode
    // Only ALIAS deployments are dedupe candidates by default. Canonical and
    // tagged deployments are kept as-is. Anything in `dropDeployments` is
    // force-dropped regardless of classification.
    const groups = new Map();
    for (const { account, deployments } of accounts) {
        for (const d of deployments) {
            const model = d.properties?.model?.name;
            if (!model) continue;
            const mode = skuMode(d.sku?.name);
            const { kind, tag } = classifyDeployment(d.name, model);
            const key = `${account.id}|${model}|${mode}`;
            if (!groups.has(key)) {
                groups.set(key, { account, model, mode, entries: [] });
            }
            groups.get(key).entries.push({ d, kind, tag });
        }
    }

    const dupes = [];
    for (const group of groups.values()) {
        // Partition by kind, subtracting force-dropped deployments.
        const forceDropped = group.entries
            .filter((e) => dropDeployments.has(e.d.name))
            .map((e) => e.d);
        const surviving = group.entries.filter(
            (e) => !dropDeployments.has(e.d.name),
        );
        const canonical = surviving
            .filter((e) => e.kind === "canonical")
            .map((e) => e.d);
        const tagged = surviving
            .filter((e) => e.kind === "tagged")
            .map((e) => e.d);
        const legacy = surviving
            .filter((e) => e.kind === "legacy")
            .map((e) => e.d);
        const aliases = surviving
            .filter((e) => e.kind === "alias")
            .map((e) => e.d);

        const aliasesToDrop = [...aliases]; // default behavior: aliases will be reduced below
        const allDrops = [...forceDropped];

        // Pick a winner among survivors if any aliases need re-pointing.
        let winner;
        if (canonical.length > 0) {
            winner = canonical.sort(compareBySkuAndCap)[0];
            allDrops.push(...aliasesToDrop);
        } else if (tagged.length > 0) {
            winner = tagged.sort(compareBySkuAndCap)[0];
            allDrops.push(...aliasesToDrop);
        } else if (legacy.length > 0) {
            // Legacy deployments are kept but not a great re-point target;
            // still usable if nothing else exists in the group.
            winner = legacy.sort(compareBySkuAndCap)[0];
            allDrops.push(...aliasesToDrop);
        } else if (aliasesToDrop.length > 1) {
            // All aliases, no force drops affected us yet — promote best
            // alias as effective winner, drop the rest.
            const sorted = [...aliasesToDrop].sort(compareBySkuAndCap);
            winner = sorted[0];
            allDrops.push(...sorted.slice(1));
        } else {
            // 0 or 1 alias surviving and no other survivors — nothing to
            // promote. Dedupe still emits a plan entry if force drops exist
            // (so KV secret handling runs), but with winner === undefined.
            if (allDrops.length === 0) continue;
            winner = undefined;
        }

        if (allDrops.length === 0) continue;

        dupes.push({
            account: group.account,
            model: group.model,
            mode: group.mode,
            winner,
            losers: allDrops,
        });
    }
    return dupes;
}

// For each secret whose value references a loser deployment, decide whether
// to re-point to the winner or drop the secret outright. Drop is preferred
// when the secret's name implies a *different* model than what the winner
// actually serves — re-pointing in that case would perpetuate misleading
// naming (e.g. a secret named AZURE-OPENAI-ENDPOINT-GPT-35-TURBO pointing at
// a deployment that actually serves gpt-4.1-mini).
//
// Returns { repoints: [...], drops: [...] } where
//   repoint = { secretName, oldValue, newValue, loser, winner, account }
//   drop    = { secretName, loser, winner, account, reason }
function planSecretRewrites(secrets, dupes) {
    const repoints = [];
    const drops = [];
    for (const dupe of dupes) {
        const accountEndpoint = dupe.account.properties?.endpoint?.replace(
            /\/+$/,
            "",
        );
        if (!accountEndpoint) continue;
        const winner = dupe.winner;
        const winnerPath = winner
            ? `/openai/deployments/${winner.name}/`
            : undefined;
        const winnerModel = winner?.properties?.model?.name;
        const winnerModelSuffix = winnerModel
            ? modelNameToSuffix(winnerModel)
            : undefined;
        for (const loser of dupe.losers) {
            const loserPath = `/openai/deployments/${loser.name}/`;
            const loserFull = `${accountEndpoint}${loserPath}`;
            for (const { name, value } of secrets) {
                if (!value || typeof value !== "string") continue;
                if (!value.includes(loserFull)) continue;
                const secretModel = extractModelFromSecret(name);

                // Case 1: no winner in the group at all (e.g. user dropped
                // every deployment in a group). Any referencing secret has
                // nowhere to go → drop it.
                if (!winner || !winnerPath) {
                    drops.push({
                        secretName: name,
                        loser: loser.name,
                        winner: undefined,
                        account: dupe.account.name,
                        reason: `no replacement in ${dupe.account.name} for ${dupe.model}/${dupe.mode}`,
                    });
                    continue;
                }

                // Case 2: winner exists and matches the secret's implied
                // model → re-point.
                // Unknown secret shape → fall back to re-point (don't
                // silently delete something we don't understand).
                if (
                    !secretModel ||
                    !winnerModelSuffix ||
                    secretModel === winnerModelSuffix
                ) {
                    const newValue = value.replace(
                        new RegExp(escapeRegExp(loserFull), "g"),
                        `${accountEndpoint}${winnerPath}`,
                    );
                    repoints.push({
                        secretName: name,
                        oldValue: value,
                        newValue,
                        loser: loser.name,
                        winner: winner.name,
                        account: dupe.account.name,
                    });
                } else {
                    // Case 3: winner exists but serves a different model
                    // than the secret name implies → drop to avoid
                    // perpetuating misleading naming.
                    drops.push({
                        secretName: name,
                        loser: loser.name,
                        winner: winner.name,
                        account: dupe.account.name,
                        reason: `secret says ${secretModel}, winner serves ${winnerModelSuffix}`,
                    });
                }
            }
        }
    }
    return { repoints, drops };
}

// --------------- main ---------------

async function main() {
    const options = parseArgs();
    const azInfo = await getAzCliLoggedInInfo();
    const mode = options.commit
        ? chalk.redBright("COMMIT (will mutate)")
        : chalk.cyan("dry-run (no changes)");
    info(`Mode: ${mode}`);

    const accountList = await listAccounts(azInfo.subscription.id);
    const accounts = [];
    for (const a of accountList) {
        accounts.push({ account: a, deployments: await listDeployments(a) });
    }

    const dupes = buildDedupePlan(accounts, options.dropDeployments);
    if (dupes.length === 0) {
        ok("No duplicate deployments found. Nothing to do.");
        return;
    }

    info(
        `\n${chalk.cyanBright("Deployments to drop")} (aliases, force-dropped via --drop-deployment, or redundant)`,
    );
    for (const d of dupes) {
        info(
            `  ${chalk.yellow(d.account.name)} (${d.account.location}) — ${d.model} [${d.mode}]`,
        );
        if (d.winner) {
            const winnerKind = classifyDeployment(
                d.winner.name,
                d.winner.properties?.model?.name,
            ).kind;
            info(
                `    keep:   ${chalk.green(d.winner.name)} [${winnerKind}] sku=${d.winner.sku?.name} cap=${d.winner.sku?.capacity} version=${d.winner.properties?.model?.version}`,
            );
        } else {
            info(
                `    keep:   ${chalk.gray("(nothing — entire group dropped)")}`,
            );
        }
        for (const l of d.losers) {
            const { kind } = classifyDeployment(
                l.name,
                l.properties?.model?.name,
            );
            info(
                `    drop:   ${chalk.red(l.name)} [${kind}] sku=${l.sku?.name} cap=${l.sku?.capacity} version=${l.properties?.model?.version}`,
            );
        }
    }

    // Also report tagged / legacy variants we're intentionally NOT touching —
    // helpful visibility so the user sees them.
    const tagged = [];
    const legacy = [];
    for (const { account, deployments } of accounts) {
        for (const d of deployments) {
            const model = d.properties?.model?.name;
            if (!model) continue;
            if (options.dropDeployments.has(d.name)) continue;
            const { kind, tag } = classifyDeployment(d.name, model);
            if (kind === "tagged") tagged.push({ account, d, tag });
            if (kind === "legacy") legacy.push({ account, d, tag });
        }
    }
    if (tagged.length > 0) {
        info(
            `\n${chalk.cyanBright("Tagged variants kept")} (distinct purpose; will get their own secret from syncPoolSecrets)`,
        );
        for (const k of tagged) {
            info(
                `  ${chalk.yellow(k.account.name)} (${k.account.location}) — ${k.d.name} [tag=${k.tag}] model=${k.d.properties?.model?.name}`,
            );
        }
    }
    if (legacy.length > 0) {
        info(
            `\n${chalk.cyanBright("Legacy deployments kept (but excluded from pool)")} — numeric-tagged capacity variants. Left running for existing consumers; not added to the new pool secrets.`,
        );
        for (const k of legacy) {
            info(
                `  ${chalk.yellow(k.account.name)} (${k.account.location}) — ${k.d.name} [tag=${k.tag}] model=${k.d.properties?.model?.name} sku=${k.d.sku?.name} cap=${k.d.sku?.capacity}`,
            );
        }
        info(
            `  ${chalk.gray("→ When ready, provision replacement capacity under the canonical name, migrate consumers, then delete these manually.")}`,
        );
    }

    // Read shared vault secrets to plan re-points.
    status(
        `\nReading secrets from vault ${chalk.cyanBright(options.vault)}...`,
    );
    const names = await listVaultSecretNames(options.vault);
    const secrets = [];
    const concurrency = 5;
    for (let i = 0; i < names.length; i += concurrency) {
        const batch = names.slice(i, i + concurrency);
        const vals = await Promise.all(
            batch.map(async (n) => {
                try {
                    return {
                        name: n,
                        value: await readSecret(options.vault, n),
                    };
                } catch (e) {
                    warn(`  could not read ${n}: ${e.message}`);
                    return { name: n, value: undefined };
                }
            }),
        );
        secrets.push(...vals);
    }

    const { repoints, drops } = planSecretRewrites(secrets, dupes);
    if (repoints.length === 0 && drops.length === 0) {
        info(
            `\n${chalk.cyanBright("Secret re-points / drops")}: none — no shared-vault secrets reference the losers.`,
        );
    } else {
        if (repoints.length > 0) {
            info(`\n${chalk.cyanBright("Secret re-points")}`);
            for (const r of repoints) {
                info(
                    `  ${r.secretName}: ${chalk.red(r.loser)} → ${chalk.green(r.winner)} (account ${r.account})`,
                );
            }
        }
        if (drops.length > 0) {
            info(
                `\n${chalk.cyanBright("Secret drops")} (model mismatch — don't want to perpetuate misleading naming)`,
            );
            for (const d of drops) {
                info(
                    `  ${chalk.red(d.secretName)}: ${d.reason} (loser ${d.loser}, account ${d.account})`,
                );
            }
        }
    }

    if (!options.commit) {
        info(
            `\n${chalk.cyan("Dry-run: no secrets written or deleted, no deployments deleted.")} Re-run with ${chalk.yellowBright("--commit")} to apply.`,
        );
        return;
    }

    // Apply re-points first, then deletions, then deployment deletions.
    // Order matters — if we deleted deployments first, live traffic going
    // through the old secret values would fail until the re-point landed.
    // Secret drops happen after re-points so any caller that was relying on
    // the mis-named secret gets a clear 404 rather than silent wrong-model
    // traffic.

    if (repoints.length > 0) {
        info(`\n${chalk.redBright("Applying re-points...")}`);
        for (const r of repoints) {
            try {
                await writeSecret(options.vault, r.secretName, r.newValue);
                info(`  re-pointed ${r.secretName}`);
            } catch (e) {
                errLog(`  FAILED ${r.secretName}: ${e.message}`);
                errLog(
                    "Aborting — losers are NOT being deleted because a re-point failed. Investigate and rerun.",
                );
                process.exit(2);
            }
        }
    }

    if (drops.length > 0) {
        info(`\n${chalk.redBright("Deleting mis-named secrets...")}`);
        for (const d of drops) {
            try {
                await deleteSecret(options.vault, d.secretName);
                info(`  deleted secret ${d.secretName}`);
            } catch (e) {
                errLog(`  FAILED to delete ${d.secretName}: ${e.message}`);
                errLog(
                    "Aborting — loser deployments NOT being deleted because a secret delete failed.",
                );
                process.exit(2);
            }
        }
    }

    info(`\n${chalk.redBright("Deleting loser deployments...")}`);
    let deletedDeployments = 0;
    for (const d of dupes) {
        for (const loser of d.losers) {
            try {
                await deleteDeployment(d.account, loser.name);
                info(`  deleted ${d.account.name}/${loser.name}`);
                deletedDeployments++;
            } catch (e) {
                errLog(
                    `  FAILED to delete ${d.account.name}/${loser.name}: ${e.message}`,
                );
            }
        }
    }

    ok(
        `\nDedupe complete. ${repoints.length} secret(s) re-pointed, ${drops.length} secret(s) deleted, ${deletedDeployments} deployment(s) deleted.`,
    );
    info(
        `Next: run 'node tools/scripts/syncPoolSecrets.mjs --commit' to populate regional pool secrets.`,
    );
}

main().catch((e) => {
    errLog(`ERROR: ${e.message}`);
    process.exit(1);
});
