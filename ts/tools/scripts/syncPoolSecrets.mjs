#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Phase B: aggregate Azure OpenAI endpoints from every provisioned region
// into the central shared Key Vault with region-suffixed secret names, so
// the aiclient pool discovery can find them via env-var naming convention.
//
// For each OpenAI/AIServices account in the subscription:
//   - list its deployments (chat, embedding, image, video)
//   - compute the endpoint URL and the env-var-style suffix
//   - write AZURE-OPENAI-ENDPOINT-<SUFFIX>-<REGION> and
//     AZURE-OPENAI-API-KEY-<SUFFIX>-<REGION> to the central vault
//     (API key = "identity" when disableLocalAuth=true; else the actual key)
// Then build AZURE-OPENAI-POOL-<SUFFIX> JSON secrets that list members
// with mode (PTU/PAYG) and capacity, so clients can override the default
// priority without additional env config.
//
// Dry-run by default. Pass --commit to actually write to the vault.
//
// Usage:
//   node tools/scripts/syncPoolSecrets.mjs [--vault aisystems] \
//       [--regions eastus,swedencentral,westus]
//   node tools/scripts/syncPoolSecrets.mjs --commit

import chalk from "chalk";
import child_process from "node:child_process";
import { execAzCliCommand, getAzCliLoggedInInfo } from "./lib/azureUtils.mjs";

// ---------------- arg parsing ----------------

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        vault: "aisystems",
        regions: undefined,
        commit: false,
        includeLegacy: new Set(),
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--vault":
                options.vault = args[++i];
                break;
            case "--regions":
                options.regions = args[++i]
                    .split(",")
                    .map((r) => r.trim().toLowerCase())
                    .filter(Boolean);
                break;
            case "--commit":
                options.commit = true;
                break;
            case "--dry-run":
                // Explicit no-op; dry-run is default.
                options.commit = false;
                break;
            case "--include-legacy":
                // Force these numeric-tagged deployments into the pool as if
                // they were canonical. Use this for legacy deployments you
                // want to surface as pool members (e.g. a PTU deployment
                // named "gpt-4o-2") until you can rename them.
                for (const name of (args[++i] ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)) {
                    options.includeLegacy.add(name);
                }
                break;
            default:
                throw new Error(`Unknown argument: ${args[i]}`);
        }
    }
    return options;
}

// ---------------- logging ----------------

function status(msg) {
    console.log(chalk.gray(msg));
}
function info(msg) {
    console.log(msg);
}
function ok(msg) {
    console.log(chalk.greenBright(msg));
}
function warn(msg) {
    console.error(chalk.yellowBright(msg));
}
function err(msg) {
    console.error(chalk.redBright(msg));
}

// ---------------- model → env-var suffix mapping ----------------

// Convert an OpenAI deployment's model name (e.g. "gpt-4o",
// "text-embedding-ada-002") into the env-var suffix convention this repo
// uses (e.g. "GPT_4_O", "EMBEDDING").
function modelNameToSuffix(modelName) {
    if (!modelName) return undefined;
    let n = modelName.toLowerCase();

    // embeddings — the ada family collapses to the legacy EMBEDDING root
    // (matches existing AZURE_OPENAI_*_EMBEDDING env var convention).
    // text-embedding-3-small / -large are distinct models (different
    // dimensions, different schema) and MUST NOT be folded into EMBEDDING.
    if (n === "text-embedding-3-small") return "EMBEDDING_3_SMALL";
    if (n === "text-embedding-3-large") return "EMBEDDING_3_LARGE";
    if (n === "text-embedding-ada-002" || /^ada(-\d+)?$/.test(n)) {
        return "EMBEDDING";
    }
    // Catch-all for other embedding model names we haven't enumerated.
    if (n.includes("embedding")) {
        return "EMBEDDING";
    }

    // image
    if (n === "gpt-image-1.5") return "GPT_IMAGE_1_5";
    if (n === "gpt-image-1") return "GPT_IMAGE_1";
    if (n.startsWith("dall-e") || n === "dalle") return "DALLE";

    // video
    if (n === "sora-2") return "SORA_2";
    if (n === "sora") return "SORA_2"; // legacy alias

    // Preserve the repo's env-var convention: "gpt-4o" maps to GPT_4_O (with
    // a separator between the 4 and the O) rather than GPT_4O. All existing
    // AZURE_OPENAI_ENDPOINT_GPT_4_O* secrets assume this shape — producing
    // GPT_4O would cause aiclient's discovery to miss the new regional
    // variants alongside the legacy single-endpoint secret.
    n = n.replace(/gpt-4o/g, "gpt-4-o");

    // chat — replace dots/dashes with _ to match existing suffix convention
    // gpt-4o -> GPT_4_O; gpt-4o-mini -> GPT_4_O_MINI; gpt-35-turbo-16k -> GPT_35_TURBO_16K;
    // gpt-5 -> GPT_5; gpt-5-mini -> GPT_5_MINI; gpt-5.4-pro -> GPT_5_4_PRO
    const upper = n.replace(/[.\-]/g, "_").replace(/__+/g, "_").toUpperCase();
    // normalise gpt-35-turbo-16k → GPT_35_TURBO (drop explicit context length)
    if (upper === "GPT_35_TURBO_16K") return "GPT_35_TURBO";
    return upper;
}

function classifyFamily(suffix) {
    if (!suffix) return "chat";
    if (suffix === "EMBEDDING" || suffix.startsWith("EMBEDDING_")) {
        return "embedding";
    }
    if (suffix.startsWith("GPT_IMAGE") || suffix === "DALLE") return "image";
    if (suffix.startsWith("SORA")) return "video";
    return "chat";
}

// Normalize a model / deployment name for comparison (lowercased, dots
// removed, common prefixes stripped). Mirrors the rule in
// dedupeDeployments.mjs.
function normalizeForMatch(name) {
    if (!name) return "";
    return name
        .toLowerCase()
        .replace(/^text-embedding-/, "")
        .replace(/\./g, "");
}

// Extract the purpose tag from a deployment name relative to the model it
// serves. Returns:
//   { tag: undefined, isLegacy: false } — canonical (name matches model)
//   { tag: "INDEXING",  isLegacy: false } — purposeful tag → add to secret name
//   { tag: "2", isLegacy: true }     — numeric/capacity variant → skip entirely
//   { tag: undefined, isLegacy: false } — alias (doesn't match model) → fold
//                                        into base secret; dedupe handles it
function extractDeploymentTag(deploymentName, modelName) {
    const model = normalizeForMatch(modelName);
    const d = normalizeForMatch(deploymentName);
    if (!model || !d || d === model) {
        return { tag: undefined, isLegacy: false };
    }
    if (d.startsWith(model + "-")) {
        const raw = d.slice(model.length + 1);
        if (/^v?\d+$/i.test(raw)) {
            return { tag: raw, isLegacy: true };
        }
        return {
            tag: raw.replace(/-/g, "_").toUpperCase(),
            isLegacy: false,
        };
    }
    return { tag: undefined, isLegacy: false };
}

// Build the Azure OpenAI endpoint URL for a deployment. Subdomain comes from
// the account's `properties.endpoint` (e.g. https://foo.openai.azure.com/).
function buildEndpointUrl(accountEndpoint, deploymentName, family) {
    const base = accountEndpoint.replace(/\/+$/, "");
    switch (family) {
        case "embedding":
            return `${base}/openai/deployments/${deploymentName}/embeddings?api-version=2023-05-15`;
        case "image":
            return `${base}/openai/deployments/${deploymentName}/images/generations?api-version=2025-04-01-preview`;
        case "video":
            return `${base}/openai/deployments/${deploymentName}/videos/generations/jobs?api-version=2025-04-01-preview`;
        case "chat":
        default:
            return `${base}/openai/deployments/${deploymentName}/chat/completions?api-version=2025-01-01-preview`;
    }
}

function skuMode(skuName) {
    if (!skuName) return "unknown";
    if (skuName.includes("Provisioned")) return "PTU";
    if (skuName === "GlobalStandard" || skuName === "Standard") return "PAYG";
    return "unknown";
}

// Ranking for dedupe: higher score wins when two deployments collide on the
// same (region, model, mode) secret. GlobalStandard beats Standard; then the
// higher-capacity one wins.
function skuRank(skuName) {
    if (!skuName) return 0;
    if (skuName === "GlobalStandard") return 3;
    if (skuName === "Standard") return 2;
    if (skuName === "ProvisionedManaged") return 10;
    return 1;
}

function better(existing, candidate) {
    // true means KEEP existing, drop candidate.
    const rExisting = skuRank(existing.skuName);
    const rCandidate = skuRank(candidate.skuName);
    if (rExisting !== rCandidate) return rExisting > rCandidate;
    return (existing.capacity ?? 0) >= (candidate.capacity ?? 0);
}

// Region token normalization: az returns lowercased location strings like
// "eastus"; our env-var convention uses uppercase (EASTUS). For "swedencentral"
// we keep the full token; shortening would be ambiguous.
function regionToken(location) {
    return location.toUpperCase();
}

// ---------------- azure queries ----------------

async function listOpenAiAccounts(subscriptionId, regionFilter) {
    status("Listing OpenAI / AIServices accounts...");
    const raw = await execAzCliCommand([
        "cognitiveservices",
        "account",
        "list",
        "--subscription",
        subscriptionId,
    ]);
    const all = JSON.parse(raw);
    const matching = all.filter(
        (a) =>
            (a.kind === "OpenAI" || a.kind === "AIServices") &&
            (!regionFilter || regionFilter.includes(a.location.toLowerCase())),
    );
    return matching;
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

async function getAccountKeys(account) {
    // Returns { key1, key2 } when local auth is enabled; fails otherwise.
    try {
        const raw = await execAzCliCommand([
            "cognitiveservices",
            "account",
            "keys",
            "list",
            "--name",
            account.name,
            "--resource-group",
            account.resourceGroup,
        ]);
        return JSON.parse(raw);
    } catch (e) {
        return undefined;
    }
}

// ---------------- key vault writes ----------------

async function vaultSetSecret(vault, name, value, commit) {
    if (!commit) {
        info(`  [dry-run] set ${name}=[REDACTED]`);
        return;
    }
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

async function vaultListSecretNames(vault) {
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
                    resolve(new Set(JSON.parse(stdout)));
                } catch {
                    resolve(new Set());
                }
            },
        );
    });
}

// ---------------- main ----------------

async function main() {
    const options = parseArgs();
    const azInfo = await getAzCliLoggedInInfo();

    const accounts = await listOpenAiAccounts(
        azInfo.subscription.id,
        options.regions,
    );
    if (accounts.length === 0) {
        err(
            `No OpenAI accounts found${
                options.regions
                    ? ` in regions ${options.regions.join(",")}`
                    : ""
            }.`,
        );
        process.exit(1);
    }

    // Per-model-suffix members we'll push pool metadata for at the end.
    const poolsBySuffix = new Map();

    // Dedupe within (region, model, mode): if a region has two deployments of
    // the same model family in the same mode (PAYG), keep the higher-capacity
    // / better-SKU one. PTU and PAYG in the same region are tracked as
    // *different* members (the pool uses the _PTU suffix to differentiate).
    // Note: this does NOT delete the losing deployment from Azure — that's
    // what dedupeDeployments.mjs is for. This just prevents a secret-name
    // collision when two deployments in the same region-and-mode would map to
    // the same secret.
    const bySecret = new Map(); // secretName → { chosen, contenders: [...] }
    const legacySkipped = []; // deployments with numeric tags — left alone

    let written = 0;
    for (const account of accounts) {
        const region = regionToken(account.location);
        info(
            `\n${chalk.cyanBright(account.location)} — ${chalk.yellow(account.name)} (${account.kind})`,
        );
        const localAuthDisabled = account.properties?.disableLocalAuth === true;
        const endpoint = account.properties?.endpoint;
        if (!endpoint) {
            warn(`  skip: account has no endpoint (custom subdomain missing?)`);
            continue;
        }
        const keys =
            localAuthDisabled || !options.commit
                ? undefined
                : await getAccountKeys(account);
        const apiKey =
            keys?.key1 ??
            keys?.key2 ??
            (localAuthDisabled ? "identity" : "identity");

        const deployments = await listDeployments(account);
        for (const d of deployments) {
            const modelName = d.properties?.model?.name;
            const suffix = modelNameToSuffix(modelName);
            if (!suffix) {
                warn(
                    `  skip deployment ${d.name}: could not map model "${modelName}" to suffix`,
                );
                continue;
            }
            const family = classifyFamily(suffix);
            const endpointUrl = buildEndpointUrl(endpoint, d.name, family);
            const skuName = d.sku?.name;
            const capacity = d.sku?.capacity ?? d.properties?.currentCapacity;
            const mode = skuMode(skuName);
            // PTU deployments get a trailing -PTU in the secret name so they
            // can coexist with a PAYG deployment of the same model in the
            // same region — the client uses the -PTU suffix to mark tier-1.
            const modeTag = mode === "PTU" ? "-PTU" : "";
            // Tagged deployments (e.g. "ada-002-indexing" serving ada-002)
            // get a trailing -<TAG> in the secret name so they surface as a
            // distinct pool member rather than colliding with the canonical
            // deployment of the same model. Legacy (numeric-tagged) variants
            // like "gpt-4o-2" are skipped entirely — they stay available for
            // existing consumers but don't surface in the new pool —
            // *unless* the user explicitly opted them in via --include-legacy,
            // in which case they're treated as canonical (no deployment-tag
            // segment, so the secret lands at the canonical name with the
            // normal mode suffix).
            const rawTagInfo = extractDeploymentTag(d.name, modelName);
            let deployTag = rawTagInfo.tag;
            let isLegacy = rawTagInfo.isLegacy;
            if (isLegacy && options.includeLegacy.has(d.name)) {
                deployTag = undefined;
                isLegacy = false;
            }
            if (isLegacy) {
                legacySkipped.push({
                    account: account.name,
                    region,
                    deployment: d.name,
                    model: modelName,
                    tag: deployTag,
                });
                continue;
            }
            const deployTagSegment = deployTag
                ? `-${deployTag.replace(/_/g, "-")}`
                : "";
            const endpointSecretName = `AZURE-OPENAI-ENDPOINT-${suffix.replace(/_/g, "-")}${deployTagSegment}-${region}${modeTag}`;
            const apiKeySecretName = `AZURE-OPENAI-API-KEY-${suffix.replace(/_/g, "-")}${deployTagSegment}-${region}${modeTag}`;

            const candidate = {
                d,
                account,
                endpoint,
                endpointUrl,
                apiKey,
                endpointSecretName,
                apiKeySecretName,
                suffix,
                deployTag,
                region,
                mode,
                skuName,
                capacity,
            };

            const existing = bySecret.get(endpointSecretName);
            if (existing && better(existing, candidate)) {
                warn(
                    `  dupe: keeping ${existing.d.name} (sku=${existing.skuName} cap=${existing.capacity}); skipping ${d.name} (sku=${skuName} cap=${capacity})`,
                );
                continue;
            }
            if (existing) {
                warn(
                    `  dupe: replacing ${existing.d.name} (sku=${existing.skuName} cap=${existing.capacity}) with ${d.name} (sku=${skuName} cap=${capacity})`,
                );
            }
            bySecret.set(endpointSecretName, candidate);
        }
    }

    // Write the deduped secrets.
    for (const c of bySecret.values()) {
        info(`  ${c.d.name.padEnd(24)} → ${chalk.gray(c.endpointSecretName)}`);
        await vaultSetSecret(
            options.vault,
            c.endpointSecretName,
            c.endpointUrl,
            options.commit,
        );
        await vaultSetSecret(
            options.vault,
            c.apiKeySecretName,
            c.apiKey,
            options.commit,
        );
        written += 2;

        // Collect pool metadata. Deployment-tagged members (e.g. the
        // "indexing" ada-002 variant) are kept in their OWN pool so callers
        // that want the indexing endpoint don't get mixed with the query
        // endpoint. Their pool key uses the tagged suffix.
        const poolKey = c.deployTag ? `${c.suffix}_${c.deployTag}` : c.suffix;
        const entry = {
            suffix: `${poolKey}_${c.region}${c.mode === "PTU" ? "_PTU" : ""}`,
            region: c.region.toLowerCase(),
            mode: c.mode,
            sku: c.skuName,
            capacity: c.capacity,
            priority: c.mode === "PTU" ? 1 : 2,
        };
        if (!poolsBySuffix.has(poolKey)) poolsBySuffix.set(poolKey, []);
        poolsBySuffix.get(poolKey).push(entry);
    }

    // Pool metadata secrets.
    info(`\n${chalk.cyanBright("Pool metadata")}`);
    const existing = options.commit
        ? await vaultListSecretNames(options.vault)
        : new Set();
    for (const [suffix, members] of poolsBySuffix) {
        const secretName = `AZURE-OPENAI-POOL-${suffix.replace(/_/g, "-")}`;
        const value = JSON.stringify(members);
        if (existing.has(secretName) && options.commit) {
            // Don't overwrite a manually-curated pool JSON without asking.
            // The caller can delete it in the portal if they want us to
            // regenerate.
            warn(
                `  ${secretName} already exists; not overwriting (delete in portal to regenerate)`,
            );
            continue;
        }
        info(
            `  ${secretName} (${members.length} member${members.length === 1 ? "" : "s"})`,
        );
        await vaultSetSecret(options.vault, secretName, value, options.commit);
        written += 1;
    }

    if (legacySkipped.length > 0) {
        info(
            `\n${chalk.cyanBright("Legacy deployments skipped")} — numeric-tagged capacity variants left untouched so existing consumers aren't affected.`,
        );
        for (const l of legacySkipped) {
            info(
                `  ${chalk.yellow(l.account)} (${l.region.toLowerCase()}) — ${l.deployment} [tag=${l.tag}] model=${l.model}`,
            );
        }
        info(
            `  ${chalk.gray("→ When replacement capacity exists under the canonical name and traffic has migrated, delete these manually.")}`,
        );
    }

    ok(
        `\nSynced ${written} secret${written === 1 ? "" : "s"} into ${chalk.cyanBright(options.vault)}${options.commit ? "" : " (dry-run)"}.`,
    );
    info(
        options.commit
            ? `Next: run 'node tools/scripts/getKeys.mjs --commit' to pull these into your .env.`
            : `Re-run with ${chalk.yellowBright("--commit")} to write for real.`,
    );
}

main().catch((_e) => {
    err("ERROR: syncPoolSecrets failed.");
    process.exit(1);
});
