// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import child_process, { exec } from "node:child_process";
import chalk from "chalk";
import registerDebug from "debug";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAzCliLoggedInInfo, execAzCliCommand } from "./lib/azureUtils.mjs";

const debug = registerDebug("typeagent:azure:deploy");
const debugError = registerDebug("typeagent:azure:deploy:error");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function status(message) {
    console.log(chalk.gray(message));
}

function success(message) {
    console.log(chalk.greenBright(message));
}

function warn(message) {
    console.error(chalk.yellowBright(message));
}

function error(message) {
    console.error(chalk.redBright(message));
}

const nameColor = chalk.cyanBright;

const defaultGlobalOptions = {
    location: "eastus", // primary deployment location
    name: "", // deployment name (per-region; defaults to <prefix>-<location>-deployment)
    regions: "", // comma-separated list of extra regions to pool after the primary
    prefix: "typeagent", // resource name prefix; override for other naming conventions
    commit: false, // dry-run by default; require explicit opt-in to mutate
    "skip-primary": false, // when true, only deploy --regions (no primary); useful when primary already exists
};

const commands = ["status", "create", "delete", "purge"];
function parseArgs() {
    const args = process.argv;
    if (args.length < 3) {
        throw new Error(
            `Command not specified. Valid commands are: ${commands.map((c) => `'${c}'`).join(", ")}`,
        );
    }
    const command = args[2];
    if (!commands.includes(command)) {
        throw new Error(
            `Invalid command '${command}'. Valid commands are: ${commands.map((c) => `'${c}'`).join(", ")}`,
        );
    }

    const options =
        command === "delete"
            ? {
                  ...defaultGlobalOptions,
                  purge: true, // for delete: default to purge.
              }
            : { ...defaultGlobalOptions };

    for (let i = 3; i < args.length; i++) {
        if (!args[i].startsWith("--")) {
            throw new Error(
                `Unknown argument for command ${command}: ${args[i]}`,
            );
        }
        const key = args[i].slice(2);
        if (!(key in options)) {
            throw new Error(
                `Unknown options for command ${command}: ${args[i]}`,
            );
        }

        const value = args[i + 1];
        if (typeof options[key] === "boolean") {
            if (value === "false" || value === "0") {
                options[key] = false;
            } else {
                options[key] = true;
                if (value !== "true" && value !== "1") {
                    // Don't consume the next argument
                    continue;
                }
            }
        } else {
            // string
            options[key] = value;
        }
        // Consume the next argument
        i++;
    }
    return { command, options };
}

function parseRegionsList(regionsStr) {
    if (!regionsStr) return [];
    return regionsStr
        .split(",")
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean);
}

function getDeploymentName(options) {
    return options.name
        ? options.name
        : `typeagent-${options.location}-deployment`;
}

async function createDeployment(options, location, primaryRegion) {
    const effectiveLocation = location ?? options.location;
    const prefix = options.prefix || "typeagent";
    const deploymentName =
        primaryRegion && options.name
            ? options.name
            : `${prefix}-${effectiveLocation}-deployment`;
    status(
        `Creating deployment ${nameColor(deploymentName)} in ${nameColor(effectiveLocation)}${primaryRegion ? " (primary)" : " (pool-only)"}...`,
    );
    if (!options.commit) {
        const rg = `${prefix}-${effectiveLocation}-rg`;
        warn(
            `  [dry-run] would deploy ARM template ${path.resolve(__dirname, "./armTemplates/template.json")} to location=${effectiveLocation} prefix=${prefix} primaryRegion=${primaryRegion}`,
        );
        warn(
            `  [dry-run] expected resource group: ${rg}; OpenAI account: ${prefix}-openai-${effectiveLocation}`,
        );
        return {
            deploymentName,
            resourceGroup: rg,
            vaultName: undefined,
        };
    }
    const output = JSON.parse(
        await execAzCliCommand([
            "deployment",
            "sub",
            "create",
            "--location",
            effectiveLocation,
            "--template-file",
            path.resolve(__dirname, "./armTemplates/template.json"),
            "--name",
            deploymentName,
            "--parameters",
            `primaryRegion=${primaryRegion ? "true" : "false"}`,
            "--parameters",
            `prefix=${prefix}`,
        ]),
    );

    status("Resources created:");
    status(
        output.properties.outputResources.map((r) => `  ${r.id}`).join("\n"),
    );

    success(
        `Deployment ${nameColor(deploymentName)} deployed to resource group ${nameColor(output.properties.parameters.group_name.value)}`,
    );
    return {
        deploymentName,
        resourceGroup: output.properties.parameters.group_name.value,
        vaultName: output.properties.parameters.vaults_name.value,
    };
}

async function getDeploymentDetails(deploymentName) {
    status(`Getting details on deployment ${nameColor(deploymentName)}...`);
    return JSON.parse(
        await execAzCliCommand([
            "deployment",
            "sub",
            "show",
            "--name",
            deploymentName,
        ]),
    );
}

async function deleteDeployment(options, subscriptionId) {
    const deploymentName = getDeploymentName(options);
    const deployment = await getDeploymentDetails(deploymentName);
    const resourceGroupName = deployment.properties.parameters.group_name.value;
    if (!options.commit) {
        warn(
            `[dry-run] would delete resource group ${resourceGroupName} and deployment ${deploymentName}${options.purge ? " and purge soft-deleted resources" : ""}`,
        );
        return;
    }
    try {
        status(`Deleting resource group ${nameColor(resourceGroupName)}...`);
        await execAzCliCommand([
            "group",
            "delete",
            "--name",
            resourceGroupName,
            "--yes",
        ]);

        success(`Resource group ${nameColor(resourceGroupName)} deleted`);
    } catch (e) {
        if (!e.message.includes(" could not be found")) {
            throw e;
        }
        warn(e.message);
    }

    status(`Deleting deployment ${nameColor(deploymentName)}...`);
    await execAzCliCommand([
        "deployment",
        "sub",
        "delete",
        "--name",
        deploymentName,
    ]);

    success(`Deployment ${nameColor(deploymentName)} deleted`);

    if (options.purge) {
        await purgeDeleted(options, subscriptionId);
    }
}

async function getDeletedResources(uri, tag) {
    const deleted = await execAzCliCommand([
        "rest",
        "--method",
        "get",
        "--header",
        "Accept=application/json",
        "-u",
        uri,
    ]);

    debug(`Get delete: ${uri}\n${deleted}`);
    const deletedJson = JSON.parse(deleted);
    return deletedJson.value
        .filter((r) => r.tags?.typeagent === tag)
        .map((r) => r.id);
}

async function getDeleteKeyVaults(tag) {
    const deleted = await execAzCliCommand(["keyvault", "list-deleted"]);
    debug(`Get Delete KeyVault: ${deleted}`);
    const deletedJson = JSON.parse(deleted);
    return deletedJson
        .filter((r) => r.properties?.tags?.typeagent === tag)
        .map((r) => r.name);
}

async function purgeAIFoundryResources(options) {
    const prefix = options.prefix || "typeagent";
    await execAzCliCommand([
        "cognitiveservices",
        "account",
        "purge",
        "--resource-group",
        `${prefix}-${options.location}-rg`,
        "--location",
        options.location,
        "--name",
        "typeagent-test-agent-resource",
    ]);
}

async function purgeMaps(options) {
    const prefix = options.prefix || "typeagent";
    await execAzCliCommand([
        "maps",
        "account",
        "delete",
        "--resource-group",
        `${prefix}-${options.location}-rg`,
        "--name",
        `${prefix}-maps-${options.location}`,
    ]);
}

async function purgeDeleted(options, subscriptionId) {
    const deploymentName = getDeploymentName(options);
    status(`Purging resources for deployment ${nameColor(deploymentName)}...`);
    if (!options.commit) {
        warn(
            `[dry-run] would purge soft-deleted Cognitive Services / Key Vault / AI Foundry resources tagged ${deploymentName}`,
        );
        return;
    }
    try {
        const resources = await getDeletedResources(
            `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CognitiveServices/deletedAccounts?api-version=2025-04-01-preview`,
            deploymentName,
        );

        if (resources.length !== 0) {
            status("Purging deleted cognitive services...");
            status(resources.map((r) => `  ${r}`).join("\n"));
            await execAzCliCommand(
                ["resource", "delete", "--ids", ...resources],
                { encoding: "utf8" },
            );
        }

        const kvs = await getDeleteKeyVaults(deploymentName);
        if (kvs.length !== 0) {
            status("Purging deleted keyvault...");
            status(kvs.map((r) => `  ${r}`).join("\n"));
            for (const kv of kvs) {
                await execAzCliCommand(
                    ["keyvault", "purge", "--no-wait", "--name", kv],
                    { encoding: "utf8" },
                );
            }
        }

        status("Purging AI Foundry resources...");
        await purgeAIFoundryResources(options);

        success("Purged Completed.");
    } catch (e) {
        e.message = `Error purging deleted resources.\n${e.message}`;
        throw e;
    }
}

function getErrorMessage(e) {
    try {
        const json = JSON.parse(e.message);
        return JSON.stringify(json, null, 2);
    } catch {}
    return e.message;
}

function getKeys(vaultName, commit) {
    if (!vaultName) {
        warn(
            `[dry-run] would run getKeys.mjs against the primary vault (name not yet available in dry-run).`,
        );
        return;
    }
    status(`Populating keys from ${nameColor(vaultName)}...`);
    const args = [
        path.resolve(__dirname, "./getKeys.mjs"),
        "--vault",
        vaultName,
    ];
    if (commit) args.push("--commit");
    child_process.execFileSync(process.execPath, args);
    success(`Keys populated from ${nameColor(vaultName)}.`);
}

async function main() {
    let usage = true;
    try {
        const { command, options } = parseArgs();
        usage = false;

        const azInfo = await getAzCliLoggedInInfo();
        const subscriptionId = azInfo.subscription.id;
        const extraRegions = parseRegionsList(options.regions);
        switch (command) {
            case "status":
                const deployment = await getDeploymentDetails(
                    getDeploymentName(options),
                );
                console.log(JSON.stringify(deployment, null, 2));
                break;
            case "create": {
                // Primary region deploys the full stack (OpenAI + Maps +
                // Speech + Key Vault + AI Foundry). Additional --regions deploy
                // only the OpenAI account + deployments so they can serve as
                // pool members. After all regions are up, run
                // syncPoolSecrets.mjs to populate the shared vault.
                //
                // --skip-primary: when a primary already exists (possibly
                // under a different naming convention than this template
                // produces), skip the primary deploy to avoid name collisions
                // and only provision the --regions as pool-only.
                if (!options.commit) {
                    warn(
                        `[dry-run mode] — no Azure resources will be created. Re-run with --commit to apply.`,
                    );
                }
                let primary;
                if (!options["skip-primary"]) {
                    primary = await createDeployment(
                        options,
                        options.location,
                        true,
                    );
                    if (options.commit) {
                        await getKeys(primary.vaultName, options.commit);
                    }
                } else {
                    status(
                        `Skipping primary deploy (--skip-primary). Will only deploy pool-only regions.`,
                    );
                }
                for (const region of extraRegions) {
                    if (
                        !options["skip-primary"] &&
                        region === options.location
                    ) {
                        status(
                            `Skipping ${nameColor(region)} — already deployed as primary.`,
                        );
                        continue;
                    }
                    await createDeployment(options, region, false);
                }
                if (extraRegions.length > 0) {
                    success(
                        `Multi-region deploy ${options.commit ? "complete" : "planned (dry-run)"}. ` +
                            `Next: 'node tools/scripts/syncPoolSecrets.mjs --vault ${primary?.vaultName ?? "aisystems"}' ` +
                            `(add --commit when ready).`,
                    );
                }
                break;
            }
            case "delete":
                await deleteDeployment(options, subscriptionId);
                break;
            case "purge":
                await purgeDeleted(options, subscriptionId);
                break;
        }
    } catch (e) {
        error(`ERROR: ${getErrorMessage(e)}`);
        if (usage) {
            console.log(
                [
                    "Usage: ",
                    "  node azureDeploy.mjs create [--location <location>] [--name <name>] [--regions <csv>] [--prefix <prefix>] [--commit]",
                    "  node azureDeploy.mjs delete [--location <location>] [--name <name>] [--purge] [--commit]",
                    "  node azureDeploy.mjs purge  [--location <location>] [--name <name>] [--commit]",
                    "",
                    "Options:",
                    "  --location <location>  Primary deployment location. Default: eastus",
                    "  --name <name>          Deployment name. Default: <prefix>-<location>-deployment",
                    "  --regions <csv>        Extra regions to deploy OpenAI-only pool members into",
                    "                         (e.g. --regions swedencentral,westus,eastus2). Each extra",
                    "                         region deploys with primaryRegion=false: OpenAI account +",
                    "                         deployments only, no Maps/Speech/KV/AI-Foundry.",
                    "  --prefix <prefix>      Resource name prefix. Default: typeagent",
                    "  --skip-primary         Skip the primary-region deploy (useful when primary already exists).",
                    "  --purge [true|false]   Purge deleted resources. Default: true",
                    "",
                    "  --commit               REQUIRED to actually mutate Azure. Without it, runs in",
                    "                         dry-run mode and prints what would change.",
                ].join("\n"),
            );
        }
        process.exit(1);
    }
}

await main();
