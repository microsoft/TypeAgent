#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const config = require("./elevate.config.json");

async function elevate(startDateTime) {
    const { getClient } = await import("./lib/pimClient.mjs");

    // get PIM client
    const client = await getClient();

    for (element of config) {
        console.log(`>> Elevating ${element.roleName}`);
        var v = await client.elevate({
            requestType: element.properties.RequestType,
            roleName: element.roleName,
            expirationType: element.properties.ScheduleInfo.Expiration.Type,
            expirationDuration:
                element.properties.ScheduleInfo.Expiration.Duration,
            startDateTime: startDateTime,
        });
    }
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
            let date;
            if (command === "tomorrow_morning") {
                date = new Date();
                date.setDate(date.getDate() + 1);
                date.setHours(8, 0, 0);
            } else if (command !== undefined && command !== "now") {
                try {
                    date = new Date(Date.parse(command));
                } catch {
                    console.log(
                        `Unable to parse date '${command}'.  The expected format is '2024-09-30T09:01:00'`,
                    );
                    return;
                }
            }

            await elevate(date?.toISOString());
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
