// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    LoggerSink,
    LogEvent,
    CosmosContainerClient,
    CosmosContainerClientFactory,
    CosmosPartitionKeyBuilder,
    CosmosBulkOperation,
} from "./logger.js";
import registerDebug from "debug";
import { randomUUID } from "crypto";

const debugCosmos = registerDebug("typeagent:logger:cosmosdb");

const UPLOAD_DELAY = 1000;
const MAX_RETRY = 3;

export type CosmosPartitionKeyBuilderFactory = () => CosmosPartitionKeyBuilder;

class CosmosDBLoggerSink implements LoggerSink {
    private pendingEvents: LogEvent[] = [];
    private timeout: NodeJS.Timeout | undefined;
    private disabled = false;
    private container: CosmosContainerClient | undefined;

    constructor(
        private readonly endpoint: string,
        private readonly databaseName: string,
        private readonly containerName: string,
        private readonly containerFactory: CosmosContainerClientFactory,
        private readonly partitionKeyBuilderFactory: CosmosPartitionKeyBuilderFactory,
        private readonly isEnabled?: () => boolean,
        private readonly onErrorDisable?: (error: string) => void,
    ) {}

    public logEvent(event: LogEvent) {
        if (this.endpoint && !this.disabled && this.isEnabled?.() !== false) {
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

    private async getContainer(): Promise<CosmosContainerClient> {
        if (!this.container) {
            this.container = await this.containerFactory(
                this.endpoint,
                this.databaseName,
                this.containerName,
            );
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
                const operations: CosmosBulkOperation[] = events.map(
                    (event: any) => {
                        const partitionKey = this.partitionKeyBuilderFactory()
                            .addValue(event.id || randomUUID().toString())
                            .build();
                        return {
                            operationType: "Create" as const,
                            partitionKey: partitionKey,
                            resourceBody: {
                                ...event,
                                id: partitionKey.toString(),
                            },
                        };
                    },
                );

                const result =
                    await container.executeBulkOperations(operations);
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
    containerFactory: CosmosContainerClientFactory,
    partitionKeyBuilderFactory: CosmosPartitionKeyBuilderFactory,
    isEnabled?: () => boolean,
    onErrorDisable?: (error: string) => void,
): LoggerSink {
    const endpoint = process.env["COSMOSDB_CONNECTION_STRING"] ?? "";
    if (endpoint === "") {
        throw new Error(
            "COSMOSDB_CONNECTION_STRING environment variable not set",
        );
    }
    return new CosmosDBLoggerSink(
        endpoint,
        databaseName,
        containerName,
        containerFactory,
        partitionKeyBuilderFactory,
        isEnabled,
        onErrorDisable,
    );
}
