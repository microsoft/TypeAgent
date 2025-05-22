// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import child_process from "node:child_process";
import chalk from "chalk";

const debug = registerDebug("typeagent:azure:utils");
const debugError = registerDebug("typeagent:azure:utils:error");

export async  function getAzCliLoggedInInfo(print = true) {
    // We use this to validate that the user is logged in (already ran `az login`).
    try {
        const account =  JSON.parse(
            await execAzCliCommand(["account", "show"]),
        );     

        debug("Account details: ", account);
        const info = {
            user: account.user.name,
            subscription: {
                id: account.id,
                name: account.name,
            }
        }; 

        if (print) {
            console.log(`Logged in as ${chalk.cyanBright(info.user)}`);
            console.log(`Subscription: ${chalk.cyanBright(info.subscription.name)} (${chalk.cyanBright(info.subscription.id)})`);
        }
        return info;
    } catch (e) {
        debugError(e);
        throw new Error("User not logged in to Azure CLI. Run 'az login'.");
    }
}

export async function execAzCliCommand(args) {
    return new Promise((res, rej) => {
        child_process.execFile("az", args, { shell: true }, (err, stdout, stderr) => {
            if (err) {
                debugError(err.stdout);
                debugError(err.stderr);
                rej(err);
                return;
            }
            if (stderr) {
                debugError(stderr + stdout);
            }
            res(stdout);
        });
    });
}