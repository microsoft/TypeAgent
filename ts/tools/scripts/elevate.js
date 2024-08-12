#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const config = require("./elevate.config.json");

async function elevate() {
    const { getClient } = await import("./lib/pimClient.mjs");

    // get PIM client
    const client = await getClient();

    // elevate
    var v = await client.elevate({
        requestType: config.properties.RequestType,
        roleName: config.roleName,
        expirationType: config.properties.ScheduleInfo.Expiration.Type,
        expirationDuration: config.properties.ScheduleInfo.Expiration.Duration,
    });
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
