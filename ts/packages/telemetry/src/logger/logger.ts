// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type LogEvent = {
    eventName: string;
    timestamp: string;
    event: LogEventData;
};

export interface LogEventData {
    [key: string]: any;
}
export interface Logger {
    logEvent<T extends LogEventData>(eventName: string, entry: T): void;
}

export interface LoggerSink {
    logEvent(event: LogEvent): void;
}

export class ChildLogger implements Logger {
    constructor(
        private readonly parent: Logger,
        private readonly name?: string,
        private readonly commonProperties?: LogEventData,
    ) {}
    public logEvent<T extends LogEventData>(eventName: string, entry: T) {
        const event: LogEventData = {};
        if (this.commonProperties) {
            for (const [key, value] of Object.entries(this.commonProperties)) {
                event[key] = typeof value === "function" ? value() : value;
            }
        }
        Object.assign(event, entry);
        const name = this.name ? `${this.name}:${eventName}` : eventName;
        this.parent.logEvent(name, event);
    }
}

export class MultiSinkLogger implements Logger {
    constructor(private readonly sinks: LoggerSink[]) {}
    public addSink(sink: LoggerSink) {
        this.sinks.push(sink);
    }
    public logEvent<T extends LogEventData>(eventName: string, event: T) {
        for (const sink of this.sinks) {
            sink.logEvent({
                eventName,
                timestamp: new Date().toISOString(),
                event,
            });
        }
    }
}

/**
 * Cosmos DB abstractions to avoid direct dependency on @azure/cosmos and @azure/identity
 */

export interface CosmosBulkOperationResponse {
    statusCode?: number;
}

export interface CosmosBulkOperationResult {
    response?: CosmosBulkOperationResponse;
}

export interface CosmosPartitionKey {
    toString(): string;
    length: number;
}

export interface CosmosBulkOperation {
    operationType: "Create";
    partitionKey: CosmosPartitionKey;
    resourceBody: Record<string, unknown>;
}

export interface CosmosContainerClient {
    executeBulkOperations(
        operations: CosmosBulkOperation[],
    ): Promise<CosmosBulkOperationResult[]>;
}

export type CosmosContainerClientFactory = (
    endpoint: string,
    databaseName: string,
    containerName: string,
) => Promise<CosmosContainerClient>;

export interface CosmosPartitionKeyBuilder {
    addValue(value: string): CosmosPartitionKeyBuilder;
    build(): CosmosPartitionKey;
}
