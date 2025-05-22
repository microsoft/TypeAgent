// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// More info on JS Azure Auth: https://github.com/Azure/azure-sdk-for-js/blob/@azure/identity_4.4.1/sdk/identity/identity/samples/AzureIdentityExamples.md
import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { DefaultAzureCredential } from "@azure/identity";
import { randomUUID } from "node:crypto";
import { getAzCliLoggedInInfo } from "./azureUtils.mjs";

import child_process from "node:child_process";
import chalk from "chalk";

function fatal(code, message) {
    console.error(chalk.redBright(`ERROR: ${message}`));
    process.exit(code);
}

class AzPIMClient {
    static async get() {
        return new AzPIMClient(await getAzCliLoggedInInfo());
    }

    constructor(azCliLoggedInUser) {
        this.azCliLoggedInUser = azCliLoggedInUser;
    }

    // More details on elevation here: https://learn.microsoft.com/en-us/rest/api/authorization/role-assignment-schedule-requests/create?view=rest-authorization-2020-10-01&tabs=JavaScript&tryIt=true&source=docs#code-try-0
    // More details on role schedule requests here: https://learn.microsoft.com/en-us/javascript/api/@azure/arm-authorization/roleassignmentschedulerequests?view=azure-node-latest
    async elevate(options) {
        const credential = new DefaultAzureCredential();
        const subscriptionId = this.azCliLoggedInUser.subscription.id;
        const scope = `/subscriptions/${subscriptionId}`;

        // ARM client
        const client = new AuthorizationManagementClient(
            credential,
            subscriptionId,
        );

        // describe elevation
        console.log(`Looking up role information for ${options.roleName}...`);
        const roleAssignmentScheduleRequestName = randomUUID();
        const parameters = {
            principalId: await this.getPrincipalId(options?.continueOnFailure),
            requestType: options.requestType,
            roleDefinitionId: await this.getRoleDefinitionId(
                client,
                options.roleName,
                scope,
            ),
            scheduleInfo: {
                expiration: {
                    type: options.expirationType,
                    duration: options.expirationDuration,
                    endDateTime: null,
                },
                startDateTime: options.startDateTime !== undefined ? options.startDateTime : new Date(),
            },
            justification: "self elevate from typeagent script",
        };

        console.log(
            `Elevating ${chalk.cyanBright(parameters.principalId)} to ${chalk.cyanBright(options.roleName)} for ${chalk.cyanBright(options.expirationDuration)}`,
        );

        // elevate
        try {
            const result = await client.roleAssignmentScheduleRequests.create(
                scope,
                roleAssignmentScheduleRequestName,
                parameters,
            );

            console.log(result);
            console.log(chalk.greenBright(`ELEVATION SUCCESSFUL for role ${options.roleName}`));
        } catch (e) {
            console.log(e);
            console.log(chalk.red(`Unable to elevate for role ${options.roleName}.`));
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
            const roleId = role.expandedProperties.roleDefinition.id;
            console.log(
                `Found Role Definition ${chalk.cyanBright(roleName)} with id ${chalk.cyanBright(roleId)}`,
            );
            return roleId;
        } else {
            fatal(
                13,
                "Unable to find the requested role. Are you certain you are logged into the correct [default] subscription?",
            );
        }
    }

    async getPrincipalId(continueOnFailure = false) {
        try {
            const accountDetails = JSON.parse(
                await execAsync("az ad signed-in-user show"),
            );

            return accountDetails.id;
        } catch (e) {
            console.log(e);

            if (!continueOnFailure) {
                fatal(12, "Unable to get principal id of the current user.");
            } else {
                throw "Unable to get principal id of the current user.";
            }
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

export async function getClient() {
    return AzPIMClient.get();
}
