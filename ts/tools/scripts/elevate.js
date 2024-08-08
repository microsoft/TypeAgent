#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// More info on JS Azure Auth: https://github.com/Azure/azure-sdk-for-js/blob/@azure/identity_4.4.1/sdk/identity/identity/samples/AzureIdentityExamples.md
const { AuthorizationManagementClient } = require("@azure/arm-authorization");
const {
    DefaultAzureCredential,
    InteractiveBrowserCredential,
} = require("@azure/identity");

const { executionAsyncId } = require("async_hooks");
const child_process = require("child_process");
const config = require("./elevate.config.json");
const { randomUUID } = require("crypto");

class AzPIMClient {
    static async get() {
        // We use this to validate that the user is logged in (already ran `az login`).
        try {
            const account = JSON.parse(await execAsync("az account show"));
            console.log(`Logged in as ${account.user.name}`);
        } catch (e) {
            console.log(e);
            console.error(
                "ERROR: User not logged in to Azure CLI. Run 'az login'.",
            );
            process.exit(1);
        }

        return new AzPIMClient();
    }

    // More details on elevation here: https://learn.microsoft.com/en-us/rest/api/authorization/role-assignment-schedule-requests/create?view=rest-authorization-2020-10-01&tabs=JavaScript&tryIt=true&source=docs#code-try-0
    // More details on role schedule requests here: https://learn.microsoft.com/en-us/javascript/api/@azure/arm-authorization/roleassignmentschedulerequests?view=azure-node-latest
    async elevate() {
        const credential = new DefaultAzureCredential();
        const subscriptionId = await this.getSubscriptionId();
        const scope = `/subscriptions/${subscriptionId}`;

        // ARM client
        const client = new AuthorizationManagementClient(
            credential,
            subscriptionId,
        );

        // describe elevation
        console.log("Looking up role information...");
        const roleAssignmentScheduleRequestName = randomUUID();
        const parameters = {
            principalId: await this.getPrincipalId(),
            requestType: config.properties.RequestType,
            roleDefinitionId: await this.getRoleDefinitionId(
                client,
                config.roleName,
                scope,
            ),
            scheduleInfo: {
                expiration: {
                    type: config.properties.ScheduleInfo.Expiration.Type,
                    duration:
                        config.properties.ScheduleInfo.Expiration.Duration,
                    endDateTime: null,
                },
                startDateTime: new Date(),
            },
            justification: "self elevate from typeagent script",
        };

        console.log(
            `Elevating ${parameters.principalId} to ${config.roleName} for ${config.properties.ScheduleInfo.Expiration.Duration}`,
        );

        // elevate
        try {
            const result = await client.roleAssignmentScheduleRequests.create(
                scope,
                roleAssignmentScheduleRequestName,
                parameters,
            );

            console.log(result);
            console.log("ELEVATION SUCCESSFUL");
        } catch (e) {
            console.log(e);
            console.log("Unable to elevate.");
        }
    }

    async getRoleDefinitionId(client, roleName, scope) {
        const filter = "asTarget()";
        const options = {
            filter,
        };
        var role;

        for await (let item of client.roleEligibilitySchedules.listForScope(
            scope,
            options,
        )) {
            if (
                item.expandedProperties.roleDefinition.displayName == roleName
            ) {
                role = item;
            }
        }

        if (role) {
            console.log(
                `Found Role Definition ${roleName} with id ${role.expandedProperties.roleDefinition.id}`,
            );
            return role.expandedProperties.roleDefinition.id;
        } else {
            console.log(
                "Unable to find the requested role. Are you certain you are logged into the correct [default] subscription?",
            );
            process.exit(12);
        }
    }

    async getSubscriptionId() {
        var subscriptionId, subscriptionName;

        try {
            const subscriptions = JSON.parse(
                await execAsync("az account list"),
            );

            subscriptions.forEach((subscription) => {
                if (subscription.isDefault) {
                    subscriptionId = subscription.id;
                    subscriptionName = subscription.name;
                }
            });
        } catch (e) {
            console.log(e);
            console.error(
                "ERROR - unable to get principal id of the current user.",
            );

            process.exit(10);
        }

        if (subscriptionId) {
            console.log(
                `Using subscription ${subscriptionName} [${subscriptionId}].`,
            );
            return subscriptionId;
        } else {
            console.log(
                "Unable to find default subscription! Unable to continue.",
            );
            process.exit(11);
        }
    }

    async getPrincipalId() {
        try {
            const accountDetails = JSON.parse(
                await execAsync("az ad signed-in-user show"),
            );

            return accountDetails.id;
        } catch (e) {
            console.log(e);
            console.error(
                "ERROR - unable to get principal id of the current user.",
            );

            process.exit(10);
        }
    }
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

async function getClient() {
    return AzPIMClient.get();
}

async function elevate() {
    // get PIM client
    const client = await getClient();

    // elevate
    var v = await client.elevate();
}

(async () => {
    const command = process.argv[2];
    switch (command) {
        case "help":
            console.log("elevate");
            console.log(
                "Uses the logged in account to elevate. Will prompt for login if the user is not logged in.",
            );
            console.log("Uses configuration from elevate.config.json.");
            return;
        default:
            await elevate();
            break;
    }
})().catch((e) => {
    if (
        e.message.includes(
            "'az' is not recognized as an internal or external command",
        )
    ) {
        console.error(
            `ERROR: Azure CLI is not installed. Install it and run 'az login' before running this tool.`,
        );

        exit(0);
    }

    console.error(`FATAL ERROR: ${e.stack}`);
    process.exit(-1);
});
