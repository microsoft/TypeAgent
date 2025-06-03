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
    location: "eastus", // deployment location
    name: "", // deployment name
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

function getDeploymentName(options) {
    return options.name
        ? options.name
        : `typeagent-${options.location}-deployment`;
}

async function createDeployment(options) {
    const deploymentName = getDeploymentName(options);
    status(`Creating deployment ${nameColor(deploymentName)}...`);
    const output = JSON.parse(
        await execAzCliCommand([
            "deployment",
            "sub",
            "create",
            "--location",
            options.location,
            "--template-file",
            path.resolve(__dirname, "./armTemplates/template.json"),
            "--name",
            deploymentName,
        ]),
    );

    status("Resources created:");
    status(
        output.properties.outputResources.map((r) => `  ${r.id}`).join("\n"),
    );

    success(
        `Deployment ${nameColor(deploymentName)} deployed to resource group ${nameColor(output.properties.parameters.group_name.value)}`,
    );
    return output.properties.parameters.vaults_name.value;
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
    await execAzCliCommand([
        "cognitiveservices",
        "account",
        "purge",
        "--resource-group",
        `typeagent-${options.location}-rg`,
        "--location",
        options.location,
        "--name",
        "typeagent-test-agent-resource"
    ]);
}

async function purgeMaps(options) {
    await execAzCliCommand([
        "maps",
        "account",
        "delete",
        "--resource-group",
        `typeagent-${options.location}-rg`,
        "--name",
        `typeagent-${options.location}-maps`,
    ]);
}

async function purgeDeleted(options, subscriptionId) {
    const deploymentName = getDeploymentName(options);
    status(`Purging resources for deployment ${nameColor(deploymentName)}...`);
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

function getKeys(vaultName) {
    status(`Populating keys from ${nameColor(vaultName)}...`);
    child_process.execFileSync(process.execPath, [
        path.resolve(__dirname, "./getKeys.mjs"),
        "--vault",
        vaultName,
    ]);
    success(`Keys populated from ${nameColor(vaultName)}.`);
}

async function main() {
    let usage = true;
    try {
        const { command, options } = parseArgs();
        usage = false;

        const azInfo = await getAzCliLoggedInInfo();
        const subscriptionId = azInfo.subscription.id;
        switch (command) {
            case "status":
                const deployment = await getDeploymentDetails(
                    getDeploymentName(options),
                );
                console.log(JSON.stringify(deployment, null, 2));
                break;
            case "create":
                const kv = await createDeployment(options);
                await getKeys(kv);
                break;
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
                    "  node azureDeploy.js create [--location <location>] [--name <name>]",
                    "  node azureDeploy.js delete [--location <location>] [--name <name>] [--purge]",
                    "  node azureDeploy.js purge [--location <location>] [--name <name>]",
                    "",
                    "Options:",
                    "  --location <location>  The location the deployment is in. Default: eastus",
                    "  --name <name>          The name of the deployment. Default: typeagent-<location>-deployment",
                    "  --purge [true|false]   Purge deleted resources. Default: true",
                ].join("\n"),
            );
        }
        process.exit(1);
    }
}

await main();
