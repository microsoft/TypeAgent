// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LoggerSink } from "./logger.js";
import { createMongoDBLoggerSink } from "./mongoLoggerSink.js";
import { createCosmosDBLoggerSink } from "./cosmosDBLoggerSink.js";
import registerDebug from "debug";

const debugDatabase = registerDebug("typeagent:logger:database");

/**
 * Creates a database logger sink that automatically selects between MongoDB and Cosmos DB
 * based on which environment variable is set.
 *
 * Priority order:
 * 1. COSMOSDB_CONNECTION_STRING - Uses Azure Cosmos DB
 * 2. MONGODB_CONNECTION_STRING - Uses MongoDB
 *
 * @param dbName - The name of the database
 * @param collectionName - The name of the collection/container
 * @param isEnabled - Optional function to check if logging is enabled
 * @param onErrorDisable - Optional callback when logging is disabled due to error
 * @returns A LoggerSink instance or undefined if no connection string is configured
 */
export function createDatabaseLoggerSink(
    dbName: string,
    collectionName: string,
    isEnabled?: () => boolean,
    onErrorDisable?: (error: string) => void,
): LoggerSink | undefined {
    const cosmosConnectionString = process.env["COSMOSDB_CONNECTION_STRING"];
    const mongoConnectionString = process.env["MONGODB_CONNECTION_STRING"];

    // Try Cosmos DB first
    if (cosmosConnectionString && cosmosConnectionString !== "") {
        try {
            debugDatabase("Using Azure Cosmos DB for database logging");
            return createCosmosDBLoggerSink(
                dbName,
                collectionName,
                isEnabled,
                onErrorDisable,
            );
        } catch (e) {
            debugDatabase(`Failed to create Cosmos DB logger sink: ${e}`);
            // Fall through to try MongoDB
        }
    }

    // Try MongoDB second
    if (mongoConnectionString && mongoConnectionString !== "") {
        try {
            debugDatabase("Using MongoDB for database logging");
            return createMongoDBLoggerSink(
                dbName,
                collectionName,
                isEnabled,
                onErrorDisable,
            );
        } catch (e) {
            debugDatabase(`Failed to create MongoDB logger sink: ${e}`);
            throw e;
        }
    }

    // No connection string found
    throw new Error(
        "No database connection string found. Set either COSMOSDB_CONNECTION_STRING or MONGODB_CONNECTION_STRING environment variable.",
    );
}
