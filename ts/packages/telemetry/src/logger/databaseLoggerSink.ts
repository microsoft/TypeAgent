// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    LoggerSink,
    CosmosContainerClientFactory,
} from "./logger.js";
import { createMongoDBLoggerSink } from "./mongoLoggerSink.js";
import {
    createCosmosDBLoggerSink,
    CosmosPartitionKeyBuilderFactory,
} from "./cosmosDBLoggerSink.js";
import registerDebug from "debug";

const debugDatabase = registerDebug("typeagent:logger:database");

export interface DatabaseLoggerSinkOptions {
    dbName: string;
    collectionName: string;
    isEnabled?: () => boolean;
    onErrorDisable?: (error: string) => void;
    /**
     * Factory to create a Cosmos container client. Required if using Cosmos DB.
     */
    cosmosContainerFactory?: CosmosContainerClientFactory | undefined;
    /**
     * Factory to create a Cosmos partition key builder. Required if using Cosmos DB.
     */
    cosmosPartitionKeyBuilderFactory?: CosmosPartitionKeyBuilderFactory | undefined;
}

/**
 * Creates a database logger sink that automatically selects between MongoDB and Cosmos DB
 * based on which environment variable is set.
 *
 * Priority order:
 * 1. COSMOSDB_CONNECTION_STRING - Uses Azure Cosmos DB (requires cosmosContainerFactory and cosmosPartitionKeyBuilderFactory)
 * 2. MONGODB_CONNECTION_STRING - Uses MongoDB
 *
 * @param options - Configuration options for the database logger sink
 * @returns A LoggerSink instance or undefined if no connection string is configured
 */
export function createDatabaseLoggerSink(
    options: DatabaseLoggerSinkOptions,
): LoggerSink | undefined {
    const {
        dbName,
        collectionName,
        isEnabled,
        onErrorDisable,
        cosmosContainerFactory,
        cosmosPartitionKeyBuilderFactory,
    } = options;

    const cosmosConnectionString = process.env["COSMOSDB_CONNECTION_STRING"];
    const mongoConnectionString = process.env["MONGODB_CONNECTION_STRING"];

    // Try Cosmos DB first (if factories are provided)
    if (cosmosConnectionString && cosmosConnectionString !== "") {
        if (cosmosContainerFactory && cosmosPartitionKeyBuilderFactory) {
            try {
                debugDatabase("Using Azure Cosmos DB for database logging");
                return createCosmosDBLoggerSink(
                    dbName,
                    collectionName,
                    cosmosContainerFactory,
                    cosmosPartitionKeyBuilderFactory,
                    isEnabled,
                    onErrorDisable,
                );
            } catch (e) {
                debugDatabase(`Failed to create Cosmos DB logger sink: ${e}`);
                // Fall through to try MongoDB
            }
        } else {
            debugDatabase(
                "Cosmos DB connection string found but no factories provided, falling back to MongoDB",
            );
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
