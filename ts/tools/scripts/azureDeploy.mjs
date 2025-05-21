// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import child_process from "node:child_process";
import chalk from "chalk";
import registerDebug from "debug";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const defaultGlobalOptions = {
    location: "eastus", // deployment location
    name: "", // deployment name
};

const commands = ["create", "delete", "purge"];
function parseArgs() {
    const args = process.argv;
    if (args.length < 3) {
        throw new Error("Command not specified.");
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

function checkAzCliLoggedIn() {
    // We use this to validate that the user is logged in (already ran `az login`).
    try {
        const account = JSON.parse(
            child_process.execFileSync("az", ["account", "show"]),
        );
        console.log(`Logged in as ${chalk.cyanBright(account.user.name)}`);
    } catch (e) {
        debugError(e);
        throw new Error("User not logged in to Azure CLI. Run 'az login'.");
    }
}

function getSubscriptionId() {
    let subscriptionId, subscriptionName;

    try {
        const subscriptions = JSON.parse(
            child_process.execFileSync("az", ["account", "list"]),
        );

        subscriptions.forEach((subscription) => {
            if (subscription.isDefault) {
                subscriptionId = subscription.id;
                subscriptionName = subscription.name;
            }
        });
    } catch (e) {
        debugError(e);
        throw new Error("Unable to get principal id of the current user.");
    }

    if (subscriptionId) {
        console.log(
            `Using subscription ${chalk.cyanBright(subscriptionName)} [${chalk.cyanBright(subscriptionId)}].`,
        );
        return subscriptionId;
    } else {
        throw new Error(
            "Unable to find default subscription! Unable to continue.",
        );
    }
}

function getDeploymentName(options) {
    if (options.name) {
        return options.name;
    }
    return `typeagent-${options.location}`;
}

function createDeployment(options) {
    const deploymentName = getDeploymentName(options);
    status(`Creating deployment ${deploymentName}...`);
    const output = JSON.parse(
        child_process.execFileSync("az", [
            "deployment",
            "sub",
            "create",
            "--location",
            options.location,
            "--template-file",
            path.resolve(__dirname, "./armTemplates/template.json"),
            "--name",
            getDeploymentName(options),
        ]),
    );

    console.log("Resources created:");
    console.log(
        output.properties.outputResources.map((r) => `  ${r.id}`).join("\n"),
    );

    return output.properties.parameters.vaults_name.value;
}

function deleteDeployment(options, subscriptionId) {
    const deploymentName = getDeploymentName(options);
    status("Getting deployment details...");
    const deployment = JSON.parse(
        child_process.execFileSync("az", [
            "deployment",
            "sub",
            "show",
            "--name",
            deploymentName,
        ]),
    );
    const resourceGroupName = deployment.properties.parameters.group_name.value;
    try {
        status(`Deleting resource group ${resourceGroupName}...`);
        child_process.execFileSync("az", [
            "group",
            "delete",
            "--name",
            resourceGroupName,
            "--yes",
        ]);

        success(`Resource group ${resourceGroupName} deleted`);
    } catch (e) {
        if (!e.message.includes(" could not be found")) {
            throw e;
        }
        warn(e.message);
    }

    status(`Deleting deployment ${deploymentName}...`);
    child_process.execFileSync("az", [
        "deployment",
        "sub",
        "delete",
        "--name",
        deploymentName,
    ]);

    success(`Deployment ${deploymentName} deleted`);

    if (options.purge) {
        purgeDeleted(options, subscriptionId);
    }
}

function getDeletedResources(uri, tag) {
    const deleted = child_process.execFileSync("az", [
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

function getDeleteKeyVaults(tag) {
    const deleted = child_process.execFileSync("az", [
        "keyvault",
        "list-deleted",
    ]);
    debug(`Get Delete KeyVault: ${deleted}`);
    const deletedJson = JSON.parse(deleted);
    return deletedJson
        .filter((r) => r.properties?.tags?.typeagent === tag)
        .map((r) => r.name);
}

function purgeDeleted(options, subscriptionId) {
    const deploymentName = getDeploymentName(options);
    status(`Purging resources for deployment ${deploymentName}...`);
    try {
        const resources = getDeletedResources(
            `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CognitiveServices/deletedAccounts?api-version=2021-04-30`,
            deploymentName,
        );

        if (resources.length !== 0) {
            status("Purging deleted cognitive services...");
            status(resources.map((r) => `  ${r}`).join("\n"));
            child_process.execFileSync(
                "az",
                ["resource", "delete", "--ids", ...resources],
                { encoding: "utf8" },
            );
        }

        const kvs = getDeleteKeyVaults(deploymentName);
        if (kvs.length !== 0) {
            status("Purging delete keyvault...");
            status(kvs.map((r) => `  ${r}`).join("\n"));
            for (const kv of kvs) {
                const kvPurgeResult = child_process.execFileSync(
                    "az",
                    ["keyvault", "purge", "--no-wait", "--name", kv],
                    { encoding: "utf8" },
                );
            }
        }
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
    child_process.execFileSync("node", [
        path.resolve(__dirname, "./getKeys.mjs"),
        "--vault",
        vaultName,
    ]);
}

function main() {
    let usage = true;
    try {
        const { command, options } = parseArgs();
        usage = false;
        checkAzCliLoggedIn();
        const subscriptionId = getSubscriptionId();
        if (command === "create") {
            const kv = createDeployment(options);
            getKeys(kv);
        } else if (command === "delete") {
            deleteDeployment(options, subscriptionId);
        } else if (command === "purge") {
            purgeDeleted(options, subscriptionId);
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
                    "  --name <name>          The name of the deployment. Default: typeagent-<location>",
                    "  --purge [true|false]   Purge deleted resources. Default: true",
                ].join("\n"),
            );
        }
        process.exit(1);
    }
}

main();
