// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LoggerSink, LogEvent } from "./logger.js";
import {
    CosmosClient,
    Container,
    BulkOperationResult,
    CosmosClientOptions,
    PartitionKeyBuilder,
} from "@azure/cosmos";
import registerDebug from "debug";
import { DefaultAzureCredential } from "@azure/identity";
import { randomUUID } from "crypto";

const debugCosmos = registerDebug("typeagent:logger:cosmosdb");

const UPLOAD_DELAY = 1000;
const MAX_RETRY = 3;

class CosmosDBLoggerSink implements LoggerSink {
    private pendingEvents: LogEvent[] = [];
    private timeout: NodeJS.Timeout | undefined;
    private disabled = false;
    private container: Container | undefined;

    constructor(
        private readonly connectionString: string,
        private readonly databaseName: string,
        private readonly containerName: string,
        private readonly isEnabled?: () => boolean,
        private readonly onErrorDisable?: (error: string) => void,
    ) {}

    public logEvent(event: LogEvent) {
        if (
            this.connectionString &&
            !this.disabled &&
            this.isEnabled?.() !== false
        ) {
            this.pendingEvents.push(event);
            if (this.timeout === undefined) {
                this.timeout = setTimeout(() => this.upload(), UPLOAD_DELAY);
            }
        }
    }

    private async upload() {
        let attempt = 0;
        while (attempt < MAX_RETRY) {
            attempt++;
            try {
                await this.drain();
                break;
            } catch (e: any) {
                // TODO: add backoff/queuing logic for ENOTFOUND (no internet)
                if (
                    typeof e.message === "string" &&
                    (e.message.includes("Invalid key") ||
                        e.message.includes("Unauthorized") ||
                        e.message.includes("authorization"))
                ) {
                    // Disable
                    if (this.onErrorDisable) {
                        this.onErrorDisable(
                            `DB Logging disabled: ${e.toString()}`,
                        );
                    } else {
                        console.error(`DB Logging disabled: ${e.toString()}`);
                    }

                    this.disabled = true;
                    break;
                }

                // Retry
                debugCosmos(`ERROR: ${e}`);
            }
        }
        // Clear the timeout so it can schedule after the next log event.
        this.timeout = undefined;
    }

    private async getContainer(): Promise<Container> {
        if (!this.container) {
            let options = {} as CosmosClientOptions;
            options.endpoint = this.connectionString;
            options.aadCredentials = new DefaultAzureCredential();
            const client = new CosmosClient(options);
            const database = client.database(this.databaseName);

            // with RBAC and AAD, we assume DB and Container already exist
            // // Create database if it doesn't exist
            // await client.databases.createIfNotExists({ id: this.databaseName });

            // // Create container if it doesn't exist
            // await database.containers.createIfNotExists({
            //     id: this.containerName,
            //     partitionKey: { paths: ["/id"] }
            // });

            this.container = database.container(this.containerName);
        }
        return this.container;
    }

    private async drain() {
        const container = await this.getContainer();

        while (true) {
            const events = this.pendingEvents;
            if (events.length === 0) {
                // done
                return;
            }
            this.pendingEvents = [];

            try {
                // Azure Cosmos DB requires each document to have an 'id' field
                // We'll add it if not present and use bulk operations
                const operations = events.map((event: any) => {
                    const partitionKey = new PartitionKeyBuilder()
                        .addValue(event.id || randomUUID().toString())
                        .build();
                    return {
                        operationType: "Create" as const,
                        partitionKey: partitionKey,
                        resourceBody: {
                            ...event,
                            id: partitionKey?.toString(),
                        },
                    };
                });

                const result: BulkOperationResult[] =
                    await container.items.executeBulkOperations(operations);
                debugCosmos(
                    `Status: ${result[0].response?.statusCode}. ${operations.length} events uploaded`,
                );
            } catch (e: any) {
                if (this.pendingEvents.length !== 0) {
                    events.push(...this.pendingEvents);
                }
                this.pendingEvents = events;
                throw e;
            }
        }
    }
}

export function createCosmosDBLoggerSink(
    databaseName: string,
    containerName: string,
    isEnabled?: () => boolean,
    onErrorDisable?: (error: string) => void,
): LoggerSink | undefined {
    const connectionString = process.env["COSMOSDB_CONNECTION_STRING"] ?? null;
    if (connectionString === null || connectionString === "") {
        throw new Error(
            "COSMOSDB_CONNECTION_STRING environment variable not set",
        );
    }
    return new CosmosDBLoggerSink(
        connectionString,
        databaseName,
        containerName,
        isEnabled,
        onErrorDisable,
    );
}
