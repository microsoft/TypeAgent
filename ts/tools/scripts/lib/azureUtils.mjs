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
    // Ensure an explicit output format so we don't depend on the user's
    // configured az CLI default (which can be set to table/tsv/etc. via
    // `az configure`). Default to JSON unless the caller already specified
    // an output format.
    const hasOutputFlag = args.some(
        (a) => a === "-o" || a === "--output" || a.startsWith("--output="),
    );
    const finalArgs = hasOutputFlag ? args : [...args, "-o", "json"];
    return new Promise((res, rej) => {
        child_process.execFile("az", finalArgs, { shell: true }, (err, stdout, stderr) => {
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