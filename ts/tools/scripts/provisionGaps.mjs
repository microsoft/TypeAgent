#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Fill deployment gaps so each model's regional pool has N members.
//
// For each model currently in the subscription (or an explicit --model list):
//   1. Count regions where the model is already deployed.
//   2. If fewer than --target, find more regions where Azure OpenAI offers
//      the model via `az cognitiveservices model list`.
//   3. Propose creating deployments with canonical names (ada-002, gpt-4o,
//      embedding-small, ...) in accounts that already exist.
//   4. If --include-new-regions, also surface regions that don't have an
//      OpenAI account yet but where the model IS available — the user can
//      provision the account via azureDeploy.mjs first, then re-run this.
//
// Dry-run by default; --commit to actually create. This script does NOT
// create new OpenAI accounts itself — that's azureDeploy.mjs's job.
//
// Usage:
//   node tools/scripts/provisionGaps.mjs
//   node tools/scripts/provisionGaps.mjs --target 4 --include-new-regions
//   node tools/scripts/provisionGaps.mjs --model text-embedding-ada-002 --commit
//   node tools/scripts/provisionGaps.mjs --model gpt-5 --include-new-regions

import chalk from "chalk";
import { escapeRegExp } from "lodash-es";
import { execAzCliCommand, getAzCliLoggedInInfo } from "./lib/azureUtils.mjs";

// ---------------- config ----------------

// Candidate Azure regions where Cognitive Services has OpenAI capacity at
// some point. We'll probe each one via `az cognitiveservices model list` to
// see what's actually offered today. Unknown / unavailable regions are
// filtered out silently.
const CANDIDATE_REGIONS = [
    "eastus",
    "eastus2",
    "westus",
    "westus2",
    "westus3",
    "centralus",
    "northcentralus",
    "southcentralus",
    "westcentralus",
    "canadacentral",
    "canadaeast",
    "brazilsouth",
    "swedencentral",
    "francecentral",
    "germanywestcentral",
    "norwayeast",
    "northeurope",
    "westeurope",
    "uksouth",
    "switzerlandnorth",
    "japaneast",
    "australiaeast",
    "koreacentral",
    "southeastasia",
    "centralindia",
    "southindia",
];

// ---------------- arg parsing ----------------

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        target: 4,
        models: new Set(),
        regions: undefined, // undefined = all candidates
        includeNewRegions: false,
        sku: undefined, // inferred per-model if not set
        capacity: undefined, // inferred per-model if not set
        prefix: undefined, // account-name prefix for tie-breaking
        commit: false,
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--target":
                options.target = parseInt(args[++i], 10);
                if (!Number.isFinite(options.target) || options.target < 1) {
                    throw new Error("--target must be a positive integer");
                }
                break;
            case "--model":
                for (const m of (args[++i] ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)) {
                    options.models.add(m);
                }
                break;
            case "--regions":
                if (args[i + 1] === "all") {
                    options.regions = undefined;
                    i++;
                } else {
                    options.regions = (args[++i] ?? "")
                        .split(",")
                        .map((r) => r.trim().toLowerCase())
                        .filter(Boolean);
                }
                break;
            case "--include-new-regions":
                options.includeNewRegions = true;
                break;
            case "--sku":
                options.sku = args[++i];
                break;
            case "--capacity":
                options.capacity = parseInt(args[++i], 10);
                if (!Number.isFinite(options.capacity)) {
                    throw new Error("--capacity must be an integer");
                }
                break;
            case "--prefix":
                options.prefix = args[++i];
                break;
            case "--commit":
                options.commit = true;
                break;
            case "--dry-run":
                options.commit = false;
                break;
            default:
                throw new Error(`Unknown argument: ${args[i]}`);
        }
    }
    return options;
}

// ---------------- logging ----------------

const status = (m) => console.log(chalk.gray(m));
const info = (m) => console.log(m);
const ok = (m) => console.log(chalk.greenBright(m));
const warn = (m) => console.error(chalk.yellowBright(m));
const errLog = (m) => console.error(chalk.redBright(m));

// ---------------- per-model defaults ----------------

// Deployment name to use when creating a canonical deployment. Matches the
// naming seen in the subscription's existing inventory.
function canonicalDeploymentName(modelName) {
    switch (modelName) {
        case "text-embedding-ada-002":
            return "ada-002";
        case "text-embedding-3-small":
            return "embedding-small";
        case "text-embedding-3-large":
            return "embedding-large";
        default:
            return modelName;
    }
}

function defaultSkuFor(modelName) {
    const n = modelName.toLowerCase();
    if (n === "text-embedding-ada-002") return "Standard";
    if (n.startsWith("dall-e")) return "Standard";
    return "GlobalStandard";
}

function defaultCapacityFor(modelName) {
    const n = modelName.toLowerCase();
    if (n === "text-embedding-ada-002") return 120;
    if (n.startsWith("text-embedding-3")) return 250;
    if (n.startsWith("dall-e")) return 2;
    if (n === "gpt-image-1.5") return 30;
    if (n === "sora-2") return 60;
    return 150;
}

// Family classification — only informational in this script.
function classifyFamily(modelName) {
    const n = modelName.toLowerCase();
    if (n.includes("embedding") || /^ada(-\d+)?$/.test(n)) return "embedding";
    if (n.startsWith("dall-e") || n.startsWith("gpt-image")) return "image";
    if (n.startsWith("sora")) return "video";
    return "chat";
}

// ---------------- azure queries ----------------

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

// Returns a Map<modelName, Set<inferenceSkuName>> for the given region:
// which OpenAI models can be deployed here for chat/embedding inference,
// along with the SKUs that offer that inference. Undefined if the region
// query fails.
//
// Azure's `cognitiveservices model list` includes SKUs whose usageName ends
// with "-finetune" (fine-tuning only), or contains "Batch" / "DeveloperTier"
// — those do NOT support regular chat completion / embeddings requests. We
// must filter to SKUs with a plain `OpenAI.<Sku>.<model>` usageName, else
// `deployment create` fails with "SKU not supported in this region".
async function listAvailableModels(region) {
    try {
        const raw = await execAzCliCommand([
            "cognitiveservices",
            "model",
            "list",
            "--location",
            region,
        ]);
        const all = JSON.parse(raw);
        const models = new Map();
        for (const entry of all) {
            if (entry.model?.format !== "OpenAI") continue;
            const name = entry.model?.name;
            if (!name) continue;
            const skus = entry.model?.skus ?? [];
            // Only consider production-grade inference SKUs. Everything else
            // (PTU, LowPriority, DeveloperTier, Batch, fine-tuning) is either
            // not usable as a pool member or requires an explicit commitment.
            const ALLOWED_INFERENCE_SKUS = new Set([
                "GlobalStandard",
                "Standard",
                "DataZoneStandard",
            ]);
            const inferenceSkus = new Set();
            for (const sku of skus) {
                const usage = sku.usageName ?? "";
                if (/-finetune\b/i.test(usage)) continue;
                if (/Batch\b/i.test(usage)) continue;
                if (/DeveloperTier\b/i.test(usage)) continue;
                // Match anywhere in the SKU name (no word-boundary required):
                // ProvisionedManaged, GlobalProvisionedManaged,
                // Provisioned_MultiModal all contain "Provisioned" but lack
                // a word boundary after it.
                if (/Provisioned/.test(sku.name ?? "")) continue;
                if (!ALLOWED_INFERENCE_SKUS.has(sku.name ?? "")) continue;
                inferenceSkus.add(sku.name);
            }
            if (inferenceSkus.size > 0) {
                // If the model already has an entry (duplicate rows), merge.
                const existing = models.get(name);
                if (existing) {
                    for (const s of inferenceSkus) existing.add(s);
                } else {
                    models.set(name, inferenceSkus);
                }
            }
        }
        return models;
    } catch (e) {
        return undefined;
    }
}

// Pick the best inference SKU for a model in a region from the available
// set. Preference: GlobalStandard (cross-region, high quota) > Standard
// (regional) > DataZoneStandard. Falls back to whatever's available.
function pickInferenceSku(availableSkus, preferredSku) {
    if (preferredSku && availableSkus.has(preferredSku)) return preferredSku;
    for (const s of ["GlobalStandard", "Standard", "DataZoneStandard"]) {
        if (availableSkus.has(s)) return s;
    }
    return [...availableSkus][0];
}

async function createDeployment(
    account,
    deploymentName,
    modelName,
    modelVersion,
    sku,
    capacity,
) {
    const args = [
        "cognitiveservices",
        "account",
        "deployment",
        "create",
        "--resource-group",
        account.resourceGroup,
        "--name",
        account.name,
        "--deployment-name",
        deploymentName,
        "--model-name",
        modelName,
        "--model-format",
        "OpenAI",
        "--sku-name",
        sku,
        "--sku-capacity",
        String(capacity),
    ];
    if (modelVersion) {
        args.push("--model-version", modelVersion);
    }
    return execAzCliCommand(args);
}

// ---------------- main ----------------

async function main() {
    const options = parseArgs();
    const azInfo = await getAzCliLoggedInInfo();
    info(
        `Mode: ${options.commit ? chalk.redBright("COMMIT (will mutate)") : chalk.cyan("dry-run (no changes)")}  target=${options.target}  include-new-regions=${options.includeNewRegions}`,
    );

    const accountList = await listAccounts(azInfo.subscription.id);
    const accounts = [];
    for (const a of accountList) {
        accounts.push({ account: a, deployments: await listDeployments(a) });
    }

    // Map of region (lowercase) → account array (some regions have multiple
    // OpenAI accounts; in that case we pick one based on the --prefix flag,
    // falling back to the first account found).
    const accountsByRegion = new Map();
    for (const { account, deployments } of accounts) {
        const region = account.location.toLowerCase();
        if (!accountsByRegion.has(region)) accountsByRegion.set(region, []);
        accountsByRegion.get(region).push({ account, deployments });
    }

    // Collect target models.
    const allDeployedModels = new Set();
    for (const { deployments } of accounts) {
        for (const d of deployments) {
            const name = d.properties?.model?.name;
            if (name) allDeployedModels.add(name);
        }
    }
    const targetModels =
        options.models.size > 0
            ? [...options.models]
            : [...allDeployedModels].sort();

    // Query model availability per candidate region. The candidate set is
    // either the --regions list or the full CANDIDATE_REGIONS array.
    const candidateRegions =
        options.regions !== undefined ? options.regions : CANDIDATE_REGIONS;
    status(
        `Probing ${candidateRegions.length} region${candidateRegions.length === 1 ? "" : "s"} for model availability...`,
    );
    // availability: Map<region, Map<modelName, Set<skuName>>>
    const availability = new Map();
    for (const region of candidateRegions) {
        const models = await listAvailableModels(region);
        if (models) availability.set(region, models);
    }

    // Build plan per model.
    const plans = [];
    for (const modelName of targetModels) {
        // Find where this model is already deployed, and what version is in use.
        const deployedRegions = new Set();
        const versionCounts = new Map();
        for (const { account, deployments } of accounts) {
            for (const d of deployments) {
                if (d.properties?.model?.name !== modelName) continue;
                deployedRegions.add(account.location.toLowerCase());
                const v = d.properties?.model?.version;
                if (v) versionCounts.set(v, (versionCounts.get(v) ?? 0) + 1);
            }
        }
        // Pick the most-common existing version to keep new deployments
        // aligned. If none, leave undefined (az picks the default).
        let modelVersion;
        if (versionCounts.size > 0) {
            modelVersion = [...versionCounts.entries()].sort(
                (a, b) => b[1] - a[1] || b[0].localeCompare(a[0]),
            )[0][0];
        }

        // Compute every region where the model could be deployed:
        //   - fillable: region with an existing account where the model is
        //     available but not yet deployed.
        //   - newRegions: region where the model is available but no account
        //     yet exists (requires azureDeploy.mjs first).
        const fillable = [];
        const newRegions = [];
        for (const [region, modelMap] of availability) {
            if (deployedRegions.has(region)) continue;
            if (!modelMap.has(modelName)) continue;
            if (accountsByRegion.has(region)) {
                fillable.push(region);
            } else {
                newRegions.push(region);
            }
        }
        fillable.sort();
        newRegions.sort();

        if (deployedRegions.size >= options.target) {
            // Already at target. Every fillable / new-region candidate is a
            // bonus (lifts the pool above target). When the user surfaces
            // new regions for other models, this gives those regions a full
            // complement of models with no extra config.
            plans.push({
                modelName,
                modelVersion,
                currentCount: deployedRegions.size,
                deployed: [...deployedRegions].sort(),
                fillable: [],
                newRegions: [],
                bonusFillable: fillable,
                bonusNewRegions: [], // filled in after the primary pass
                allAvailableNewRegions: newRegions,
                sparse: false,
                alreadyMet: true,
            });
            continue;
        }

        // Pick up to (target - currentCount) from fillable first, then
        // optionally from new-regions.
        const needed = options.target - deployedRegions.size;
        const pickedFillable = fillable.slice(0, needed);
        const remaining = needed - pickedFillable.length;
        const pickedNew = options.includeNewRegions
            ? newRegions.slice(0, remaining)
            : [];

        plans.push({
            modelName,
            modelVersion,
            currentCount: deployedRegions.size,
            deployed: [...deployedRegions].sort(),
            fillable: pickedFillable,
            newRegions: pickedNew,
            bonusFillable: fillable.slice(pickedFillable.length),
            bonusNewRegions: [], // filled in after the primary pass
            moreFillable: fillable.slice(pickedFillable.length),
            moreNewRegions: newRegions.slice(pickedNew.length),
            allAvailableNewRegions: newRegions,
            sparse:
                pickedFillable.length + pickedNew.length <
                options.target - deployedRegions.size,
        });
    }

    // Second pass: for every new region that's being surfaced by *any* model,
    // offer to also deploy *other* models that are available there. Once the
    // user has to create an account in a new region (via azureDeploy.mjs),
    // loading that account up is essentially free and lifts other pool sizes
    // above --target. These "bonus" deployments are shown separately so the
    // user can see which are required to hit --target vs which are extras.
    const surfacedNewRegions = new Set();
    for (const p of plans) {
        for (const r of p.newRegions) surfacedNewRegions.add(r);
    }
    if (options.includeNewRegions && surfacedNewRegions.size > 0) {
        for (const p of plans) {
            const already = new Set([
                ...p.deployed,
                ...p.fillable,
                ...p.newRegions,
                ...(p.bonusFillable ?? []),
            ]);
            for (const r of surfacedNewRegions) {
                if (already.has(r)) continue;
                const modelMap = availability.get(r);
                if (!modelMap || !modelMap.has(p.modelName)) continue;
                p.bonusNewRegions.push(r);
            }
            p.bonusNewRegions.sort();
        }
    }

    // Print plan.
    info(
        `\n${chalk.cyanBright("Provisioning plan")}  (target=${options.target} members per pool)`,
    );
    for (const p of plans) {
        const fam = classifyFamily(p.modelName);
        const header = `${chalk.yellow(p.modelName)}${p.modelVersion ? `@${p.modelVersion}` : ""} [${fam}]`;
        info(
            `\n  ${header}  — ${p.currentCount}/${options.target} deployed: ${p.deployed.join(", ") || "(none)"}`,
        );
        if (p.alreadyMet) {
            info(`    ${chalk.gray("already at target — skipping")}`);
            continue;
        }
        const toAddInExisting = p.fillable.length;
        const toAddViaNewRegions = p.newRegions.length;
        if (toAddInExisting === 0 && toAddViaNewRegions === 0) {
            warn(
                `    no candidate regions — model not available in any untouched region${options.includeNewRegions ? "" : " (try --include-new-regions)"}`,
            );
            continue;
        }
        if (toAddInExisting > 0) {
            const sku = options.sku ?? defaultSkuFor(p.modelName);
            const cap = options.capacity ?? defaultCapacityFor(p.modelName);
            info(
                `    Add in existing accounts (deploy name ${chalk.green(canonicalDeploymentName(p.modelName))}, sku=${sku}, cap=${cap}):`,
            );
            for (const region of p.fillable) {
                const targetAccounts = accountsByRegion.get(region);
                const acctName =
                    targetAccounts?.[0]?.account.name ?? "(no account?)";
                info(
                    `      [${chalk.green("+")}] ${region.padEnd(18)} → ${acctName}`,
                );
            }
        }
        if (toAddViaNewRegions > 0) {
            info(
                `    Add via new regions (run ${chalk.cyan("azureDeploy.mjs --regions <list> --commit")} first):`,
            );
            for (const region of p.newRegions) {
                info(`      [${chalk.yellow("!")}] ${region}`);
            }
        }
        if (p.bonusNewRegions.length > 0) {
            info(
                `    ${chalk.gray("Bonus: same new regions can host this model too → pool size")} ${chalk.green(p.currentCount + toAddInExisting + toAddViaNewRegions + p.bonusNewRegions.length)}:`,
            );
            for (const region of p.bonusNewRegions) {
                info(`      [${chalk.cyan("*")}] ${region}`);
            }
        }
        if (p.sparse) {
            warn(
                `    can only reach ${p.currentCount + toAddInExisting + toAddViaNewRegions}/${options.target} — model availability is the limiter.`,
            );
            if (p.moreFillable.length > 0 || p.moreNewRegions.length > 0) {
                info(
                    `    ${chalk.gray("more candidates not selected: " + [...p.moreFillable, ...p.moreNewRegions].slice(0, 6).join(", "))}`,
                );
            }
        }
    }

    // Per-new-region summary. For each new region proposed by any model, list
    // every model that would land there once the account exists. Gives a
    // clear "if I add region X, here's everything that goes into it" view.
    if (options.includeNewRegions && surfacedNewRegions.size > 0) {
        info(
            `\n${chalk.cyanBright("New-region summary")}  (what lands in each new region, primary + bonus)`,
        );
        const sortedRegions = [...surfacedNewRegions].sort();
        for (const region of sortedRegions) {
            const primary = plans
                .filter((p) => p.newRegions.includes(region))
                .map((p) => p.modelName);
            const bonus = plans
                .filter((p) => p.bonusNewRegions.includes(region))
                .map((p) => p.modelName);
            info(
                `\n  ${chalk.yellow(region)}  — ${primary.length + bonus.length} deployments proposed`,
            );
            if (primary.length > 0) {
                info(
                    `    ${chalk.gray("primary (required to hit --target):")} ${primary.join(", ")}`,
                );
            }
            if (bonus.length > 0) {
                info(
                    `    ${chalk.gray("bonus (lifts pool > --target):")}       ${bonus.join(", ")}`,
                );
            }
        }
        info(
            `\n  ${chalk.gray("Prerequisite:")} ${chalk.cyan(`node tools/scripts/azureDeploy.mjs create --regions ${sortedRegions.join(",")} --commit`)}`,
        );
    }

    if (!options.commit) {
        info(
            `\n${chalk.cyan("Dry-run: no deployments created.")} Re-run with ${chalk.yellowBright("--commit")} to apply.`,
        );
        return;
    }

    // Execute. Create deployments in every region that has an account today.
    info(`\n${chalk.redBright("Creating deployments...")}`);
    let created = 0;
    let skipped = 0;
    let failed = 0;
    for (const p of plans) {
        const bonusFillable = p.bonusFillable ?? [];
        // Skip pools with nothing to deploy in any bucket.
        if (
            p.alreadyMet &&
            bonusFillable.length === 0 &&
            p.bonusNewRegions.length === 0
        ) {
            continue;
        }
        const cap = options.capacity ?? defaultCapacityFor(p.modelName);
        const deployName = canonicalDeploymentName(p.modelName);
        const regionsToDeploy = [
            ...p.fillable,
            ...p.newRegions,
            ...bonusFillable,
            ...p.bonusNewRegions,
        ];
        for (const region of regionsToDeploy) {
            const targetAccounts = accountsByRegion.get(region);
            if (!targetAccounts || targetAccounts.length === 0) {
                warn(
                    `  - ${p.modelName} in ${region}: no account yet — run azureDeploy.mjs --regions ${region} --commit first`,
                );
                skipped++;
                continue;
            }
            // Prefer an account whose name starts with the user's --prefix
            // (so deployments land in the canonical account when a region has
            // multiple OpenAI accounts). Fall back to the first one found.
            const prefixPattern = options.prefix
                ? new RegExp(`^${escapeRegExp(options.prefix)}-openai-`, "i")
                : undefined;
            const target =
                (prefixPattern &&
                    targetAccounts.find((x) =>
                        prefixPattern.test(x.account.name),
                    )) ??
                targetAccounts[0];
            const account = target.account;

            // Idempotency: if a deployment with this name already exists and
            // serves the same model, skip.
            const existingDeployment = target.deployments?.find(
                (d) =>
                    d.name === deployName &&
                    d.properties?.model?.name === p.modelName,
            );
            if (existingDeployment) {
                status(
                    `  ${deployName} already exists in ${account.name} — skipping`,
                );
                skipped++;
                continue;
            }

            // Pick the correct SKU for THIS (region, model) from availability.
            const skusAvailable =
                availability.get(region)?.get(p.modelName) ?? new Set();
            const sku = pickInferenceSku(skusAvailable, options.sku);
            if (!sku) {
                warn(
                    `  - ${p.modelName} in ${region}: no inference SKU available; skipping`,
                );
                skipped++;
                continue;
            }

            try {
                status(
                    `  creating ${deployName} in ${region} (${account.name}, sku=${sku})...`,
                );
                await createDeployment(
                    account,
                    deployName,
                    p.modelName,
                    p.modelVersion,
                    sku,
                    cap,
                );
                ok(`    ✓ ${account.name}/${deployName} [${sku}]`);
                created++;
            } catch (e) {
                const firstLine =
                    (e.message || String(e))
                        .split("\n")
                        .find((l) =>
                            /ERROR|InvalidResourceProperties|Quota/i.test(l),
                        ) ?? (e.message || String(e)).split("\n")[0];
                errLog(`    ✗ ${account.name}/${deployName} — ${firstLine}`);
                failed++;
            }
        }
    }

    ok(
        `\nCreated ${created} deployment${created === 1 ? "" : "s"}. ${skipped > 0 ? chalk.yellowBright(`${skipped} skipped (waiting on new-region account).`) : ""} ${failed > 0 ? chalk.redBright(`${failed} failure${failed === 1 ? "" : "s"}.`) : ""}`,
    );
    if (failed > 0) {
        info(
            chalk.gray(
                "Common causes: SKU/capacity quota exhausted in the region, model not available for your subscription's tier, or name collision.",
            ),
        );
    }
    info(
        `Next: 'node tools/scripts/syncPoolSecrets.mjs --include-legacy gpt-4o-2 --commit' to populate pool secrets with the new members.`,
    );
}

main().catch((e) => {
    errLog(`ERROR: ${e.message}`);
    process.exit(1);
});
