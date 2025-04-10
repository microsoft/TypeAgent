// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { MongoClient } from "mongodb";

// Load environment variables from .env file
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

// Run database query to get all issued commands
const query = {
    "event.originalInput": { $regex: "^@" },
};

const histogram: Record<string, number> = {};
await queryMongoDB(query).then((commands) => {
    console.log(`Found ${commands.length} documents.`);

    commands.forEach((command) => {
        //const commandName = command.event.originalInput.split(" ");
        const commandName = command.event.originalInput.substring(0, 50);
        //console.log(commandName);
        if (commandName) {
            histogram[commandName] = (histogram[commandName] || 0) + 1;
        }
    });
});

// sort and then print the command histogram
const sortedHistogram = sortHistogram(histogram);
printHistogram(Object.fromEntries(sortedHistogram));

function sortHistogram(histogram: Record<string, number>): [string, number][] {
    return Object.entries(histogram).sort((a, b) => b[1] - a[1]);
}

function printHistogram(histogram: Record<string, number>) {
    console.log("\nCommand Histogram:");
    const maxLabelLength = Math.max(
        ...Object.keys(histogram).map((key) => key.length),
    );
    const maxValue = Math.max(...Object.values(histogram));
    const scaleFactor = maxValue > 50 ? 50 / maxValue : 1;

    for (const [command, count] of Object.entries(histogram)) {
        const barLength = Math.round(count * scaleFactor);
        const bar = "#".repeat(barLength);
        console.log(`${command.padEnd(maxLabelLength)} | ${bar} (${count})`);
    }
}

async function queryMongoDB(query: object) {
    const dbUrl = process.env["MONGODB_CONNECTION_STRING"] ?? null;
    if (dbUrl === null || dbUrl === "") {
        throw new Error(
            "MONGODB_CONNECTION_STRING environment variable not set",
        );
    }

    const client = new MongoClient(dbUrl);

    try {
        await client.connect();
        // TODO: move DB name to .env/config?
        const database = client.db("telemetrydb");
        // TODO: move collection name to .env/config?
        const collection = database.collection("dispatcherlogs");

        const documents = await collection.find(query).toArray();
        return documents;
    } catch (error) {
        console.error("Error querying MongoDB:", error);
        throw error;
    } finally {
        await client.close();
    }
}
